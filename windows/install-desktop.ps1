<#
.SYNOPSIS
    Set up the Electron desktop app and create Start Menu + Desktop shortcuts.

.DESCRIPTION
    Runs `npm install` in desktop\ and creates a "Signal" shortcut in the Start
    Menu and on the Desktop, each with the AppUserModelID set to match
    app.setAppUserModelId() in desktop/src/main.js.

    That AUMID match is what makes Windows toast notifications work for an
    unpackaged Electron app: Windows resolves toast identity through the
    shortcut, and without one the notifications may silently never appear.

    No elevation needed -- this is all per-user.

.PARAMETER NoDesktopShortcut
    Only create the Start Menu shortcut, and remove a Desktop one left by an
    earlier run.

.EXAMPLE
    .\windows\install-desktop.ps1
#>
[CmdletBinding()]
param([switch]$SkipNpmInstall, [switch]$NoDesktopShortcut)

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')

$Desktop = Join-Path $RepoRoot 'desktop'
$AppId   = 'com.signal.dashboard'   # must match desktop/src/main.js

Write-Host ''
Write-Host '  Signal - set up desktop app' -ForegroundColor Cyan
Write-Host ''

if (-not (Test-Path $Desktop)) { Fail "No desktop\ directory at $Desktop" }

if (-not $SkipNpmInstall) {
    Write-Step 'npm' 'installing...' 'DarkGray'
    Push-Location $Desktop
    try {
        & npm.cmd install
        if ($LASTEXITCODE -ne 0) { Fail 'npm install failed -- see the output above.' }
    } finally { Pop-Location }
}
Write-Step 'npm' 'dependencies ok'

# ------------------------------------------------------------------ shortcut --
$electron = Join-Path $Desktop 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) {
    Fail "Electron binary not found at $electron" @(
        'Run npm install in desktop\ first, or re-run this script without',
        '-SkipNpmInstall.'
    )
}

# A .lnk icon has to be an .ico (or an .exe/.dll). A .png is ignored and the
# shortcut shows Electron's own logo. icon.ico packs the three assets PNGs.
$icon = Join-Path $Desktop 'assets\icon.ico'

# WScript.Shell cannot set System.AppUserModel.ID, so it is stamped through the
# shortcut's property store. Without this the toasts fall back to Electron's
# own identity and may not surface at all.
$aumidReady = $false
try {
    $code = @'
using System;
using System.Runtime.InteropServices;
public static class Aumid {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    static extern void SHGetPropertyStoreFromParsingName(
        [MarshalAs(UnmanagedType.LPWStr)] string path, IntPtr bc, int flags,
        ref Guid riid, [MarshalAs(UnmanagedType.Interface)] out IPropertyStore ps);

    [StructLayout(LayoutKind.Sequential)]
    public struct PropertyKey { public Guid fmtid; public int pid; }

    [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"),
     InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IPropertyStore {
        void GetCount(out uint c);
        void GetAt(uint i, out PropertyKey k);
        void GetValue(ref PropertyKey k, out PropVariant v);
        void SetValue(ref PropertyKey k, ref PropVariant v);
        void Commit();
    }

    [StructLayout(LayoutKind.Explicit)]
    public struct PropVariant {
        [FieldOffset(0)] public ushort vt;
        [FieldOffset(8)] public IntPtr p;
    }

    public static void Set(string lnkPath, string appId) {
        var iid = typeof(IPropertyStore).GUID;
        IPropertyStore store;
        SHGetPropertyStoreFromParsingName(lnkPath, IntPtr.Zero, 2, ref iid, out store);
        var key = new PropertyKey {
            fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
        var pv = new PropVariant { vt = 31 /* VT_LPWSTR */,
                                   p = Marshal.StringToCoTaskMemUni(appId) };
        store.SetValue(ref key, ref pv);
        store.Commit();
        Marshal.FreeCoTaskMem(pv.p);
        Marshal.ReleaseComObject(store);
    }
}
'@
    Add-Type -TypeDefinition $code -Language CSharp -ErrorAction Stop | Out-Null
    $aumidReady = $true
} catch {
    Write-Host "  (could not load the AppUserModelID helper: $($_.Exception.Message))" -ForegroundColor DarkGray
}

$shell = New-Object -ComObject WScript.Shell

# Creates (or overwrites) one shortcut. Returns whether its AUMID was stamped.
function New-SignalShortcut {
    param([Parameter(Mandatory = $true)][string]$Path)
    $sc = $shell.CreateShortcut($Path)
    $sc.TargetPath       = $electron
    $sc.Arguments        = "`"$Desktop`""
    $sc.WorkingDirectory = $Desktop
    $sc.IconLocation     = "$icon,0"
    $sc.Description      = 'Signal stock dashboard'
    $sc.Save()
    if (-not $aumidReady) { return $false }
    try {
        [Aumid]::Set($Path, $AppId)
        return $true
    } catch {
        Write-Host "  (could not stamp AppUserModelID on ${Path}: $($_.Exception.Message))" -ForegroundColor DarkGray
        return $false
    }
}

$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$lnk = Join-Path $startMenu 'Signal.lnk'
$stamped = New-SignalShortcut $lnk
Write-Step 'shortcut' $lnk

# GetFolderPath rather than $HOME\Desktop: OneDrive often redirects the Desktop.
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Signal.lnk'
if ($NoDesktopShortcut) {
    if (Test-Path $desktopLnk) { Remove-Item $desktopLnk -Force }
} else {
    $null = New-SignalShortcut $desktopLnk
    Write-Step 'desktop' $desktopLnk
}

Write-Step 'toast id' $(if ($stamped) { "$AppId (stamped)" } else { 'not stamped -- see below' }) `
                      $(if ($stamped) { 'Green' } else { 'Yellow' })

Write-Host ''
Write-Host '  Done.' -ForegroundColor Green
Write-Host ''
Write-Host '  Launch "Signal" from the Desktop or the Start Menu, or:' -ForegroundColor DarkGray
Write-Host '    cd desktop; npm start'
if (-not $stamped) {
    Write-Host ''
    Write-Host '  The AppUserModelID could not be stamped on the shortcut. The app' -ForegroundColor Yellow
    Write-Host '  will still run; if desktop notifications never appear, that is the' -ForegroundColor Yellow
    Write-Host '  first thing to suspect. See desktop\README.md.' -ForegroundColor Yellow
}
Write-Host ''
