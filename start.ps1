#Requires -Version 5.1
<#
.SYNOPSIS
    Start the Stock Signal Dashboard (backend + frontend).

.DESCRIPTION
    Two run modes, matching the two documented in CLAUDE.md:

      dev  (default)  Two detached, minimized windows: uvicorn --reload on
                      :8000 and the Vite dev server on :5173 (Vite proxies
                      /api -> :8000). Hot reload on both sides.

      prod            Builds frontend/dist once, then serves the SPA *and* the
                      API from a single uvicorn worker on :8000. No Vite, no
                      proxy, one port.

    Both modes launch detached: the servers keep running after this terminal
    closes. Stop them with `.\start.ps1 -Stop` (or stop.bat), or by closing
    their windows.

    Preflight verifies the backend venv, backend deps and frontend
    node_modules, offering to create/install anything missing, and reports any
    port already in use before starting anything.

    Exactly one uvicorn worker, always: the APScheduler jobs, TTL caches, rate
    limiter and the shared SQLite connection are all in-process.

.PARAMETER Mode
    'dev' (default) or 'prod'. Positional, so `.\start.ps1 prod` works.

.PARAMETER ApiPort
    Backend port. Default 8000. In dev, note that the Vite proxy target in
    frontend/vite.config.js is hard-coded to :8000 -- changing this only makes
    sense together with that file.

.PARAMETER WebPort
    Vite dev-server port (dev mode only). Default 5173. The backend CORS
    allowlist is pointed at it automatically.

.PARAMETER NoBrowser
    Don't open a browser once the API answers /api/health.

.PARAMETER Force
    Answer every preflight prompt with "yes" (install deps, free busy ports).

.PARAMETER Stop
    Don't start anything: stop whatever is serving the dashboard on ApiPort /
    WebPort and exit.

.EXAMPLE
    .\start.ps1
    Dev: API on :8000 with reload, UI on :5173.

.EXAMPLE
    .\start.ps1 prod
    Build the frontend, then serve everything from :8000.

.EXAMPLE
    .\start.ps1 -Stop
    Shut the dashboard down.
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('dev', 'prod')]
    [string]$Mode = 'dev',

    [int]$ApiPort = 8000,
    [int]$WebPort = 5173,
    [switch]$NoBrowser,
    [switch]$Force,
    [switch]$Stop
)

$ErrorActionPreference = 'Stop'

$Root     = $PSScriptRoot
$Backend  = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$Python   = Join-Path $Backend '.venv\Scripts\python.exe'
$DistIndex = Join-Path $Frontend 'dist\index.html'

# Ancestors of a listening process are only killed when their command line
# looks like part of a dashboard launch -- so `-Stop` never takes out the
# terminal you happen to have started things from.
$OursPattern = 'uvicorn|vite|npm|stocks-backend|stocks-frontend|stocks-app'


# ---------------------------------------------------------------- output ----

function Write-Check {
    param([string]$Tag, [string]$Label, [string]$Result, [string]$Color = 'Green')
    Write-Host ("  [{0}] {1,-28} " -f $Tag, $Label) -NoNewline
    Write-Host $Result -ForegroundColor $Color
}

function Write-Note {
    param([string]$Message, [string]$Color = 'DarkGray')
    Write-Host "  $Message" -ForegroundColor $Color
}

function Fail {
    param([string]$Message, [string[]]$Hints = @())
    Write-Host ''
    Write-Host "  error  $Message" -ForegroundColor Red
    foreach ($h in $Hints) { Write-Host "         $h" -ForegroundColor DarkGray }
    Write-Host ''
    exit 1
}

function Confirm-Action {
    param([string]$Question, [bool]$DefaultYes = $true)
    if ($Force) { return $true }
    if ($DefaultYes) { $suffix = '(Y/n)' } else { $suffix = '(y/N)' }
    $answer = Read-Host "  $Question $suffix"
    if ([string]::IsNullOrWhiteSpace($answer)) { return $DefaultYes }
    return ($answer.Trim().ToLower() -in @('y', 'yes'))
}


# ----------------------------------------------------------------- ports ----

function Get-PortPids {
    param([int]$Port)
    $found = @()
    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        try {
            $found = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
                       Select-Object -ExpandProperty OwningProcess)
        } catch {
            $found = @()
        }
    }
    if ($found.Count -eq 0) {
        # Fallback for hosts without the NetTCPIP module.
        $found = @(netstat -ano |
                   Select-String -Pattern (":{0}\s" -f $Port) |
                   Select-String -Pattern 'LISTENING' |
                   ForEach-Object { ($_.ToString().Trim() -split '\s+')[-1] })
    }
    return @($found | Where-Object { $_ -and [int]$_ -gt 4 } |
             ForEach-Object { [int]$_ } | Select-Object -Unique)
}

function Get-ServerTree {
    <#
        Listener pid plus any ancestor that is clearly part of the same launch,
        innermost first. Needed because `uvicorn --reload` runs a supervisor
        parent that would instantly respawn a child killed on its own.
    #>
    param([int]$Port)
    $ids = New-Object System.Collections.Generic.List[int]
    foreach ($listener in (Get-PortPids -Port $Port)) {
        $ids.Add($listener)
        $current = Get-CimInstance Win32_Process -Filter "ProcessId = $listener" -ErrorAction SilentlyContinue
        $hops = 0
        while ($current -and $current.ParentProcessId -and $hops -lt 6) {
            $hops++
            $parentId = [int]$current.ParentProcessId
            if ($parentId -le 4) { break }
            $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId" -ErrorAction SilentlyContinue
            if (-not $parent) { break }
            if ([string]$parent.CommandLine -notmatch $OursPattern) { break }
            $ids.Add($parentId)
            $current = $parent
        }
    }
    return @($ids | Select-Object -Unique)
}

function Stop-Servers {
    <#
        Kill everything serving $Port, outermost-first, and keep going until the
        port is actually free. Repeated passes matter: the uvicorn reload child
        can outlive its supervisor by a few seconds and stays bound the whole
        time, so a single pass would report success on a still-busy port.
        Returns the number of distinct processes killed.
    #>
    param([int]$Port, [int]$TimeoutSeconds = 15)
    $killed = New-Object System.Collections.Generic.HashSet[int]
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ($true) {
        $tree = Get-ServerTree -Port $Port
        if ($tree.Count -eq 0) { break }
        for ($i = $tree.Count - 1; $i -ge 0; $i--) {
            if (Get-Process -Id $tree[$i] -ErrorAction SilentlyContinue) {
                Stop-Process -Id $tree[$i] -Force -ErrorAction SilentlyContinue
                [void]$killed.Add($tree[$i])
            }
        }
        Start-Sleep -Milliseconds 600
        if ((Get-PortPids -Port $Port).Count -eq 0) { break }
        if ((Get-Date) -ge $deadline) { break }
    }
    return $killed.Count
}

function Assert-PortFree {
    param([int]$Port, [string]$Label)
    $owners = Get-PortPids -Port $Port
    if ($owners.Count -eq 0) {
        Write-Check 'preflight' "port $Port" 'free'
        return
    }
    $names = @($owners | ForEach-Object {
        $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
        if ($p) { "$($p.ProcessName) (pid $_)" } else { "pid $_" }
    })
    Write-Check 'preflight' "port $Port" ("in use by " + ($names -join ', ')) 'Yellow'
    if (-not (Confirm-Action "Stop it and continue?" $false)) {
        Fail "$Label port $Port is occupied." @(
            "Free it yourself, re-run with -Force, or pick another port:",
            "  .\start.ps1 $Mode -ApiPort <n> -WebPort <n>"
        )
    }
    $killed = Stop-Servers -Port $Port
    if ((Get-PortPids -Port $Port).Count -gt 0) {
        Fail "Could not free port $Port (killed $killed process(es); something is still listening)."
    }
    Write-Check 'preflight' "port $Port" 'freed'
}


# ------------------------------------------------------------- preflight ----

function Test-PythonImports {
    <#
        Quiet, window-less probe that the venv actually has the deps. The
        argument list is one pre-quoted string on purpose: Windows PowerShell
        joins an -ArgumentList array with spaces without quoting, which would
        hand python a bare `-c import`.
    #>
    $probe = Start-Process -FilePath $Python -WindowStyle Hidden -Wait -PassThru `
                           -ArgumentList '-c "import fastapi, uvicorn, apscheduler"'
    return ($probe.ExitCode -eq 0)
}

function Initialize-Backend {
    if (-not (Test-Path $Python)) {
        Write-Check 'preflight' 'backend venv' 'missing' 'Yellow'
        if (-not (Confirm-Action "Create backend\.venv and install requirements now?")) {
            Fail 'Backend venv is required.' @(
                'cd backend',
                'python -m venv .venv',
                '.venv\Scripts\python.exe -m pip install -r requirements.txt'
            )
        }
        $sysPython = Get-Command python -ErrorAction SilentlyContinue
        if (-not $sysPython) { $sysPython = Get-Command py -ErrorAction SilentlyContinue }
        if (-not $sysPython) { Fail 'No system Python on PATH (need 3.11+).' }

        Push-Location $Backend
        try {
            & $sysPython.Source -m venv .venv
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path $Python)) { Fail 'Creating backend\.venv failed.' }
            & $Python -m pip install -r requirements.txt
            if ($LASTEXITCODE -ne 0) { Fail 'pip install -r requirements.txt failed.' }
        } finally {
            Pop-Location
        }
        Write-Check 'preflight' 'backend venv' 'created'
    } else {
        Write-Check 'preflight' 'backend venv' 'ok'
    }

    if (Test-PythonImports) {
        Write-Check 'preflight' 'backend deps' 'ok'
        return
    }
    Write-Check 'preflight' 'backend deps' 'incomplete' 'Yellow'
    if (-not (Confirm-Action "Install backend\requirements.txt now?")) {
        Fail 'Backend dependencies are missing.' @(
            'cd backend && .venv\Scripts\python.exe -m pip install -r requirements.txt'
        )
    }
    Push-Location $Backend
    try {
        & $Python -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) { Fail 'pip install -r requirements.txt failed.' }
    } finally {
        Pop-Location
    }
    if (-not (Test-PythonImports)) { Fail 'Backend deps still not importable after install.' }
    Write-Check 'preflight' 'backend deps' 'installed'
}

function Initialize-Frontend {
    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        Fail 'npm not found on PATH.' @('Install Node.js (which ships npm) and re-run.')
    }
    if (Test-Path (Join-Path $Frontend 'node_modules')) {
        Write-Check 'preflight' 'frontend node_modules' 'ok'
        return
    }
    Write-Check 'preflight' 'frontend node_modules' 'missing' 'Yellow'
    if (-not (Confirm-Action "Run npm install in frontend\ now?")) {
        Fail 'Frontend dependencies are required.' @('cd frontend && npm install')
    }
    Push-Location $Frontend
    try {
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' }
    } finally {
        Pop-Location
    }
    Write-Check 'preflight' 'frontend node_modules' 'installed'
}


# ----------------------------------------------------------------- launch ----

function Start-ServerWindow {
    <# Detached, minimized, titled console window. Survives this terminal. #>
    param([string]$Title, [string]$WorkDir, [string]$Command)
    $spec = @{
        FilePath         = 'cmd.exe'
        ArgumentList     = "/c title $Title & $Command"
        WorkingDirectory = $WorkDir
        WindowStyle      = 'Minimized'
        PassThru         = $true
    }
    return Start-Process @spec
}

function Wait-Health {
    param([int]$Port, [int]$TimeoutSeconds = 60)
    $url = "http://127.0.0.1:$Port/api/health"
    $started = Get-Date
    $deadline = $started.AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 3
            if ($response.StatusCode -eq 200) {
                return [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
            }
        } catch {
            # Not up yet -- keep polling until the deadline.
        }
        Start-Sleep -Milliseconds 700
    }
    return -1
}


# ------------------------------------------------------------------- main ----

Write-Host ''

if ($Stop) {
    Write-Host '  Stock Signal Dashboard - stop' -ForegroundColor Cyan
    Write-Host ''
    $total = 0
    $stuck = 0
    foreach ($port in @($ApiPort, $WebPort)) {
        $killed = Stop-Servers -Port $port
        $total += $killed
        if ((Get-PortPids -Port $port).Count -gt 0) {
            $stuck++
            Write-Check 'stop' "port $port" 'still bound - kill it manually' 'Red'
        } elseif ($killed -gt 0) {
            Write-Check 'stop' "port $port" "stopped $killed process(es)" 'Yellow'
        } else {
            Write-Check 'stop' "port $port" 'nothing listening'
        }
    }
    Write-Host ''
    if ($stuck -gt 0) { exit 1 }
    if ($total -eq 0) { Write-Note 'Dashboard was not running.' }
    Write-Host ''
    exit 0
}

Write-Host "  Stock Signal Dashboard - $Mode" -ForegroundColor Cyan
Write-Host ''

Initialize-Backend
Initialize-Frontend

if ($Mode -eq 'dev') {
    Assert-PortFree -Port $ApiPort -Label 'Backend'
    Assert-PortFree -Port $WebPort -Label 'Frontend'
} else {
    Assert-PortFree -Port $ApiPort -Label 'App'
}

# The session cookie rides on credentialed requests, so the backend needs the
# Vite origin explicitly allowlisted whenever it isn't the built-in default.
if ($Mode -eq 'dev' -and $WebPort -ne 5173) {
    $env:STOCKS_CORS_ORIGINS = "http://localhost:$WebPort"
    Write-Check 'preflight' 'CORS origin' "http://localhost:$WebPort"
}

Write-Host ''

if ($Mode -eq 'prod') {
    Write-Check 'build' 'frontend (vite build)' 'running...' 'DarkGray'
    Push-Location $Frontend
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { Fail 'npm run build failed -- see the output above.' }
    } finally {
        Pop-Location
    }
    if (-not (Test-Path $DistIndex)) { Fail "Build finished but $DistIndex is missing." }
    Write-Check 'build' 'frontend dist' 'ok'

    $cmd = ".venv\Scripts\python.exe -m uvicorn app.main:app --port $ApiPort"
    $app = Start-ServerWindow -Title 'stocks-app' -WorkDir $Backend -Command $cmd
    Write-Check 'start' 'app (api + spa)' "pid $($app.Id)"
    $openUrl = "http://localhost:$ApiPort"
} else {
    if ($ApiPort -ne 8000) {
        Write-Note "note: vite.config.js proxies /api to :8000, not :$ApiPort -- update it or the UI can't reach the API." 'Yellow'
    }

    $backendCmd = ".venv\Scripts\python.exe -m uvicorn app.main:app --reload --reload-dir app --port $ApiPort"
    $api = Start-ServerWindow -Title 'stocks-backend' -WorkDir $Backend -Command $backendCmd
    Write-Check 'start' 'backend (uvicorn reload)' "pid $($api.Id)"

    $frontendCmd = "npm.cmd run dev -- --port $WebPort --strictPort"
    $web = Start-ServerWindow -Title 'stocks-frontend' -WorkDir $Frontend -Command $frontendCmd
    Write-Check 'start' 'frontend (vite)' "pid $($web.Id)"

    $openUrl = "http://localhost:$WebPort"
}

$elapsed = Wait-Health -Port $ApiPort
if ($elapsed -lt 0) {
    Write-Check 'wait' 'api /api/health' 'no response' 'Red'
    Write-Host ''
    Write-Note 'The backend window is minimized -- restore it to read the traceback.' 'Yellow'
    Write-Note "Then: .\start.ps1 -Stop" 'Yellow'
    Write-Host ''
    exit 1
}
Write-Check 'wait' 'api /api/health' "ok (${elapsed}s)"

Write-Host ''
if ($Mode -eq 'prod') {
    Write-Host "  App       http://localhost:$ApiPort" -ForegroundColor White -NoNewline
    Write-Host '   (window "stocks-app", api + built UI)' -ForegroundColor DarkGray
} else {
    Write-Host "  Frontend  http://localhost:$WebPort" -ForegroundColor White -NoNewline
    Write-Host '   (window "stocks-frontend", hot reload)' -ForegroundColor DarkGray
    Write-Host "  Backend   http://localhost:$ApiPort" -ForegroundColor White -NoNewline
    Write-Host '   (window "stocks-backend", api only)' -ForegroundColor DarkGray
    if (Test-Path $DistIndex) {
        Write-Note "heads up: :$ApiPort also serves the last frontend build -- use :$WebPort for live code."
    }
}
Write-Host ''
Write-Note 'Stop with:  .\start.ps1 -Stop   (or stop.bat)'
Write-Host ''

if (-not $NoBrowser) { Start-Process $openUrl | Out-Null }

exit 0
