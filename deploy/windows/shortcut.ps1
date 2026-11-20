<#
.SYNOPSIS
    Create (or, with -Remove, delete) the "Signal" Start Menu and Desktop
    shortcuts for the Electron desktop app. Run by `signal install` / `signal
    uninstall`; PowerShell only because stamping the toast identity needs COM.
.DESCRIPTION
    Each shortcut gets System.AppUserModel.ID set to match
    app.setAppUserModelId() in desktop/src/main.js. That match is what makes
    Windows toast notifications work for an unpackaged Electron app: Windows
    resolves toast identity through the shortcut, and without one the
    notifications may silently never appear.
#>
[CmdletBinding()]
param([string]$Desktop, [switch]$NoDesktopShortcut, [switch]$Remove)

#Requires -Version 5.1
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$AppId = 'com.signal.dashboard'   # must match desktop/src/main.js
$startMenuLnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Signal.lnk'
# GetFolderPath rather than $HOME\Desktop: OneDrive often redirects the Desktop.
$desktopLnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Signal.lnk'

if ($Remove) {
    foreach ($lnk in @($startMenuLnk, $desktopLnk)) {
        if (Test-Path $lnk) { Remove-Item $lnk -Force }
    }
    exit 0
}

$electron = Join-Path $Desktop 'node_modules\electron\dist\electron.exe'
if (-not (Test-Path $electron)) { throw "Electron binary not found at $electron (npm ci in desktop\ first)" }
# A .lnk icon has to be an .ico (or an .exe/.dll); a .png is ignored.
$icon = Join-Path $Desktop 'assets\icon.ico'

# WScript.Shell cannot set System.AppUserModel.ID, so it is stamped through the
# shortcut's property store.
$aumidReady = $false
try {
    Add-Type -Language CSharp -ErrorAction Stop -TypeDefinition @'
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
'@ | Out-Null
    $aumidReady = $true
} catch {
    Write-Host "  (could not load the AppUserModelID helper: $($_.Exception.Message))"
}

$shell = New-Object -ComObject WScript.Shell

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
    try { [Aumid]::Set($Path, $AppId); return $true }
    catch { Write-Host "  (could not stamp AppUserModelID on ${Path}: $($_.Exception.Message))"; return $false }
}

$stamped = New-SignalShortcut $startMenuLnk
Write-Host "  shortcut      $startMenuLnk"
if ($NoDesktopShortcut) {
    if (Test-Path $desktopLnk) { Remove-Item $desktopLnk -Force }
} else {
    $null = New-SignalShortcut $desktopLnk
    Write-Host "  desktop       $desktopLnk"
}
if (-not $stamped) {
    Write-Host '  The toast identity could not be stamped on the shortcut. The app still runs;'
    Write-Host '  if desktop notifications never appear, that is the first thing to suspect.'
}
