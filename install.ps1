<#
.SYNOPSIS
    Install (or repair) the Signal stock dashboard on Windows.
.DESCRIPTION
    This script only gets the prerequisites and the code, then hands over to
    deploy\manage.py, which does the rest (see deploy\README.md):

      1. git and Python, machine-wide, installed through winget if missing
      2. clone (or fast-forward) main into <InstallDir>\repo, unless this
         script is being run from inside a checkout, which is then used as is
      3. python deploy\manage.py install <everything else you passed>

    Machine-wide matters for both prerequisites. The service and the in-app
    updater run as LocalSystem, which sees neither a user PATH (git) nor a
    per-user Python under %LOCALAPPDATA% -- and the virtualenv's python.exe
    redirects to its base interpreter at every start.

    Re-running it is the repair / upgrade path.
.PARAMETER InstallDir
    Where the app goes when it is cloned; the checkout is its repo\ subfolder.
.PARAMETER NssmExe
    A checksum-verified nssm.exe to use (SignalSetup.exe bundles one).
.PARAMETER PauseOnError
    Keep the console open on failure so the error can be read.
.EXAMPLE
    irm https://raw.githubusercontent.com/Minka1902/stock-dashboard/main/install.ps1 | iex
.EXAMPLE
    .\install.ps1 --public-origin https://pc.tailnet.ts.net --without desktop
#>
[CmdletBinding()]
param(
    [string]$InstallDir,
    [string]$NssmExe,
    [switch]$PauseOnError,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$ManageArgs = @()
)

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoUrl   = 'https://github.com/Minka1902/stock-dashboard.git'
$Branch    = 'main'
$MinPython = [version]'3.11'
$ProgramData = if ($env:ProgramData) { $env:ProgramData } else { 'C:\ProgramData' }
$LogDir    = Join-Path $ProgramData 'SignalDashboard\logs'
$LogFile   = Join-Path $LogDir 'setup.log'
$WingetArgs = @('--exact', '--silent', '--accept-source-agreements', '--accept-package-agreements')

$InPlace = (-not $InstallDir) -and $PSScriptRoot -and
           (Test-Path (Join-Path $PSScriptRoot 'deploy\manage.py'))
if (-not $InstallDir) { $InstallDir = Join-Path $env:ProgramFiles 'SignalDashboard' }
$Repo = if ($InPlace) { $PSScriptRoot } else { Join-Path $InstallDir 'repo' }
$SafeDir = "safe.directory=$($Repo -replace '\\', '/')"


function Write-Step {
    param([string]$Label, [string]$Value, [string]$Color = 'Green')
    Write-Host ('  {0,-14}' -f $Label) -NoNewline -ForegroundColor DarkGray
    Write-Host $Value -ForegroundColor $Color
}

function Fail {
    param([string]$Message, [string[]]$Hints = @())
    Write-Host ''
    Write-Host "ERROR: $Message" -ForegroundColor Red
    foreach ($h in $Hints) { Write-Host "  $h" -ForegroundColor Yellow }
    Write-Host ''
    Write-Host "  Full log: $LogFile" -ForegroundColor DarkGray
    try { Stop-Transcript | Out-Null } catch { }
    if ($PauseOnError) { Read-Host '  Press Enter to close' | Out-Null }
    exit 1
}

function Update-SessionPath {
    # winget installers write the registry PATH; this process started before.
    $env:Path = @(
        [Environment]::GetEnvironmentVariable('Path', 'Machine'),
        [Environment]::GetEnvironmentVariable('Path', 'User')
    ) -join ';'
}

function Find-MachineCommand {
    <# Resolve against the MACHINE PATH only -- the one LocalSystem sees. #>
    param([string]$Name)
    foreach ($dir in ([Environment]::GetEnvironmentVariable('Path', 'Machine') -split ';')) {
        if (-not $dir) { continue }
        try {
            $candidate = [IO.Path]::Combine([Environment]::ExpandEnvironmentVariables($dir), $Name)
        } catch { continue }
        if (Test-Path -LiteralPath $candidate -PathType Leaf) { return $candidate }
    }
    return $null
}

function Find-MachinePython {
    <#
        PEP 514: an all-users install registers under HKLM, a per-user one under
        HKCU -- so HKLM is exactly "an interpreter LocalSystem can run".
        Returns the newest python.exe >= $MinPython, or $null.
    #>
    $found = foreach ($root in 'HKLM:\SOFTWARE\Python\PythonCore', 'HKLM:\SOFTWARE\WOW6432Node\Python\PythonCore') {
        foreach ($key in (Get-ChildItem -Path $root -ErrorAction SilentlyContinue)) {
            $v = $null
            if (-not [version]::TryParse(($key.PSChildName -replace '-.*$', ''), [ref]$v)) { continue }
            if ($v -lt $MinPython) { continue }
            $install = Get-ItemProperty -Path (Join-Path $key.PSPath 'InstallPath') -ErrorAction SilentlyContinue
            if (-not $install) { continue }
            $exe = if ($install.PSObject.Properties['ExecutablePath']) { $install.ExecutablePath }
                   elseif ($install.PSObject.Properties['(default)']) { Join-Path $install.'(default)' 'python.exe' }
            if ($exe -and (Test-Path -LiteralPath $exe)) { [pscustomobject]@{ Version = $v; Exe = $exe } }
        }
    }
    $best = $found | Sort-Object Version -Descending | Select-Object -First 1
    if ($best) { return $best.Exe }
    return $null
}

function Install-WithWinget {
    param([string]$Id, [string[]]$Extra = @())
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        Fail 'winget is not available, so the prerequisites cannot be installed automatically.' @(
            'Install them machine-wide ("for all users"), then run this again:',
            '  Git      https://git-scm.com/download/win',
            '  Python   https://www.python.org/downloads/windows/   (3.11+, tick "Install for all users")'
        )
    }
    Write-Step 'winget' "installing $Id ..." 'DarkGray'
    & $winget.Source install --id $Id @WingetArgs @Extra
    Write-Step 'winget' "$Id finished (exit $LASTEXITCODE)" 'DarkGray'
    Update-SessionPath
}

function Resolve-Git {
    $git = Find-MachineCommand 'git.exe'
    if (-not $git) {
        Install-WithWinget 'Git.Git' @('--scope', 'machine')
        $git = Find-MachineCommand 'git.exe'
    }
    if (-not $git) { Fail 'git is still not on the machine PATH after installing it.' }
    return $git
}

function Resolve-Python {
    $python = Find-MachinePython
    if (-not $python) {
        # --override replaces winget's own installer switches, so the all-users
        # install has to be spelled out; --scope alone is not enough for this
        # package to land in Program Files.
        Install-WithWinget 'Python.Python.3.12' @(
            '--scope', 'machine', '--override', '/quiet InstallAllUsers=1 PrependPath=1')
        $python = Find-MachinePython
    }
    if (-not $python) {
        Fail "No all-users Python $MinPython+ found." @(
            'A per-user Python cannot be used: the service runs as LocalSystem.',
            'Install Python for all users from https://www.python.org, then run this again.')
    }
    return $python
}

function Sync-Repo {
    param([string]$Git)
    if (Test-Path (Join-Path $Repo '.git')) {
        & $Git -c $SafeDir -C $Repo pull --ff-only origin $Branch
        if ($LASTEXITCODE -ne 0) {
            Write-Step 'repo' 'could not fast-forward -- keeping the current code' 'Yellow'
            return
        }
        Write-Step 'repo' "up to date with origin/$Branch"
        return
    }
    # A leftover from an interrupted clone; the folder is this installer's own.
    if (Test-Path $Repo) { Remove-Item -LiteralPath $Repo -Recurse -Force }
    & $Git clone --branch $Branch $RepoUrl $Repo
    if ($LASTEXITCODE -ne 0) { Fail "git clone $RepoUrl failed -- see the output above." }
    Write-Step 'repo' "cloned into $Repo"
}


$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'ERROR: run this from an elevated PowerShell (Run as administrator).' -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
Start-Transcript -Path $LogFile -Append | Out-Null
# The installer's environment can predate a git install made since login.
Update-SessionPath

Write-Host ''
Write-Host '  Signal - setup' -ForegroundColor Cyan
Write-Host ''

$git = Resolve-Git
Write-Step 'git' $git
$python = Resolve-Python
Write-Step 'python' $python
if ($InPlace) { Write-Step 'repo' "$Repo (this checkout)" } else { Sync-Repo -Git $git }

if ($NssmExe) { $ManageArgs = @('--nssm', $NssmExe) + $ManageArgs }
& $python (Join-Path $Repo 'deploy\manage.py') install @ManageArgs
if ($LASTEXITCODE -ne 0) { Fail "The install did not finish (exit $LASTEXITCODE) -- see the output above." }

Write-Host ''
Write-Host '  Signal is installed. `signal status` shows it from any new terminal.' -ForegroundColor Green
Write-Host ''
Stop-Transcript | Out-Null
exit 0
