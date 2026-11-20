"""Windows: the backend as a boot-start LocalSystem service under NSSM, a
Scheduled Task that restarts it when its health check keeps failing, and the
Electron desktop app.

NSSM is the ONLY supervisor: the service runs `run_server.py --no-supervise`,
uvicorn in-process, so NSSM's Ctrl-C reaches it and the lifespan's WAL
checkpoint runs on every stop.
"""
import ctypes
import hashlib
import os
import shutil
import sqlite3
import subprocess
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

from app import host
from deploy.lib import paths as paths_lib
from deploy.lib import proc

SERVICE = host.WINDOWS_SERVICE
DISPLAY_NAME = "Signal Stock Dashboard"
DESCRIPTION = ("Aggregates public stock signals and serves the dashboard on http://127.0.0.1:{port}. "
               "Runs the ingest scheduler continuously, including before any user logs in.")
TASK_NAME = "SignalDashboard Health"
COMMAND = "signal"

# nssm 2.24, the last stable release (2017). NSSM_SHA256 pins the zip the repo
# owner downloaded from NSSM_URL themselves on 2026-09-29. This is a binary we
# hand SYSTEM-level process control to, so the installer and the SignalSetup.exe
# build (.github/workflows/installer.yml) both refuse any download that doesn't
# match. A mismatch means the file changed: verify the new one by hand before
# re-pinning, never override it. --nssm PATH uses a copy you already trust.
NSSM_URL = "https://nssm.cc/release/nssm-2.24.zip"
NSSM_SHA256 = "727D1E42275C605E0F04ABA98095C38A8E1E46DEF453CDFFCE42869428AA6743"
NSSM_MEMBER = "nssm-2.24/win64/nssm.exe"

# Well-known SIDs, so the ACLs don't depend on the Windows display language.
SID_SYSTEM, SID_ADMINS, SID_USERS = "*S-1-5-18", "*S-1-5-32-544", "*S-1-5-32-545"
ENV_KEY = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
NODE_WINGET_ID = "OpenJS.NodeJS.LTS"
STOP_WAIT_SECONDS = 60
DELETE_WAIT_SECONDS = 30
SHORTCUT_SCRIPT = paths_lib.REPO / "deploy" / "windows" / "shortcut.ps1"


def preflight(opts) -> None:
    if not proc.DRY_RUN and not ctypes.windll.shell32.IsUserAnAdmin():
        raise proc.Failed("run this from an elevated PowerShell (Run as administrator): "
                          "controlling a Windows service needs it")
    if not shutil.which("git"):
        raise proc.Failed("git is not on the PATH: install it for all users, or run install.ps1")


def packages(opts) -> None:
    """git and Python are here already (this tool is running). Node is only
    for the desktop app."""
    if _wants_desktop(opts) and not shutil.which("npm"):
        proc.run("winget", "install", "--id", NODE_WINGET_ID, "--exact", "--silent", "--scope", "machine",
                 "--accept-source-agreements", "--accept-package-agreements", check=False)
        os.environ["PATH"] = _machine_path() + os.pathsep + os.environ.get("PATH", "")


def _wants_desktop(opts) -> bool:
    return "desktop" not in opts.without and (paths_lib.REPO / "desktop").is_dir()


def prepare(paths, opts) -> None:
    proc.makedirs(paths.data, paths.db.parent, paths.backups, paths.logs, paths.bin)
    # Lock the tree down: the DB holds password hashes and TOTP secrets, and
    # the settings file holds API keys in plaintext. Inherited ProgramData ACLs
    # let ordinary users read; these do not.
    proc.run("icacls", paths.data, "/inheritance:r", "/grant:r",
             f"{SID_SYSTEM}:(OI)(CI)F", f"{SID_ADMINS}:(OI)(CI)F", capture=True)
    # ...except the `signal` command, which anyone may run (`signal status`).
    proc.run("icacls", paths.bin, "/grant", f"{SID_USERS}:(OI)(CI)RX", capture=True)
    # Where the old PowerShell installer kept the settings.
    legacy = paths.app / "windows" / "service.env"
    if legacy.exists() and not paths.settings.exists():
        proc.copy(legacy, paths.settings)
    dev_db = paths.app / "backend" / "stocks.db"
    if dev_db.exists() and not paths.db.exists():
        if opts.import_existing_db:
            # The online backup folds the -wal in and yields one consistent
            # file; copying stocks.db alone would lose every transaction that
            # is committed but not yet checkpointed.
            proc.say(f"importing {dev_db}")
            if not proc.DRY_RUN:
                source, dest = sqlite3.connect(dev_db), sqlite3.connect(paths.db)
                try:
                    source.backup(dest)
                finally:
                    dest.close()
                    source.close()
        else:
            proc.warn(f"a development database exists at {dev_db}. The service starts with a "
                      "SEPARATE, EMPTY database; re-run with --import-existing-db to copy it across")


def service_user() -> None:
    return None


def user_env(paths) -> dict:
    return {}


def checkout(paths, opts, backup_first) -> None:
    """In place: on Windows the service runs from the checkout this tool is in
    (install.ps1 clones it under Program Files first)."""


def origin(opts) -> str | None:
    return opts.public_origin


def extra_env(paths) -> dict:
    return {
        "PYTHONUNBUFFERED": "1",
        "STOCKS_STATIC_DIR": paths.app / "frontend" / "dist",
        # Playwright's default cache is %LOCALAPPDATA% of whoever installed the
        # browser: a profile LocalSystem never looks in.
        "PLAYWRIGHT_BROWSERS_PATH": paths.data / "ms-playwright",
    }


def protect(paths) -> None:
    """Nothing to do: the settings live under the locked data directory."""


def tune(paths, opts) -> None:
    if "browser" in opts.without:
        return
    # Only the margin-debt source's headless tier needs it; without it that
    # tier reports "headless browser not installed" in the source status.
    result = proc.run(paths_lib.venv_python(paths.app), "-m", "playwright", "install", "chromium",
                      env={"PLAYWRIGHT_BROWSERS_PATH": str(paths.data / "ms-playwright")}, check=False)
    if result.returncode != 0:
        proc.warn("the headless browser did not install; the margin-debt browser tier will say so")


# ---------- NSSM ----------

def nssm_path(paths) -> Path:
    return paths.bin / "nssm.exe"


def _download_nssm(target: Path) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "nssm.zip"
        try:
            urllib.request.urlretrieve(NSSM_URL, archive)
        except OSError as exc:
            raise proc.Failed(
                f"could not download NSSM from {NSSM_URL} ({exc}). Fetch it yourself, check it, "
                "and pass --nssm C:\\path\\to\\nssm.exe") from exc
        actual = hashlib.sha256(archive.read_bytes()).hexdigest().upper()
        if actual != NSSM_SHA256:
            raise proc.Failed(
                "the NSSM download failed its checksum; refusing to install it.\n"
                f"  expected {NSSM_SHA256}\n  got      {actual}\n"
                "This binary gets SYSTEM-level process control, so a mismatch is never worth "
                "ignoring. Verify by hand, or pass --nssm.")
        with zipfile.ZipFile(archive) as zf:
            target.write_bytes(zf.read(NSSM_MEMBER))


def ensure_nssm(paths, opts) -> Path:
    """nssm.exe in the install's bin directory: the copy that is there, the
    one from --nssm, the one an earlier install kept in the checkout, or a
    checksum-verified download — in that order. An existing copy is never
    replaced: on a repair it is the running service host, and locked."""
    target = nssm_path(paths)
    if target.exists():
        return target
    source = Path(opts.nssm) if opts.nssm else paths.app / "windows" / "nssm" / "nssm.exe"
    if opts.nssm and not source.exists():
        raise proc.Failed(f"--nssm points at nothing: {source}")
    if source.exists():
        proc.copy(source, target)
    elif proc.DRY_RUN:
        proc.say(f"would download {NSSM_URL} and verify sha256 {NSSM_SHA256}")
    else:
        proc.say("downloading NSSM (checksum-pinned)")
        _download_nssm(target)
    return target


def nssm_settings(paths, port: int, env: dict) -> list[list[str]]:
    """Every `nssm set SignalDashboard …` an install makes, in order."""
    logs = paths.logs
    return [
        # The script goes in by bare name, resolved against AppDirectory: an
        # absolute path would need embedded quotes under "C:\Program Files".
        ["AppParameters", f"run_server.py --host 127.0.0.1 --port {port} --no-supervise"],
        ["AppDirectory", str(paths.app / "backend")],
        ["DisplayName", DISPLAY_NAME],
        ["Description", DESCRIPTION.format(port=port)],
        ["ObjectName", "LocalSystem"],
        # Delayed auto-start: still long before any human logs in, but it stops
        # the first refresh cycle from racing DHCP/DNS on a cold boot.
        ["Start", "SERVICE_DELAYED_AUTO_START"],
        ["DependOnService", "Tcpip", "Dnscache"],
        # NSSM restarts it; run_server.py's own restart loop is bypassed.
        ["AppExit", "Default", "Restart"],
        ["AppRestartDelay", "5000"],
        ["AppThrottle", "10000"],
        # Graceful stop: these protect the WAL checkpoint the app runs on
        # shutdown. AppNoConsole 1 would silently disable the Ctrl-C path and
        # turn every stop into a TerminateProcess.
        ["AppNoConsole", "0"],
        ["AppStopMethodSkip", "0"],
        ["AppStopMethodConsole", "20000"],
        ["AppStopMethodWindow", "5000"],
        ["AppStopMethodThreads", "5000"],
        ["AppStdout", str(logs / "service-stdout.log")],
        ["AppStderr", str(logs / "service-stderr.log")],
        ["AppRotateFiles", "1"],
        ["AppRotateOnline", "1"],
        ["AppRotateBytes", "10485760"],
        ["AppEnvironmentExtra", *(f"{key}={value}" for key, value in env.items())],
    ]


def _nssm(paths, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    return proc.run(nssm_path(paths), *args, check=check, capture=True)


def _remove_service(paths) -> None:
    if state() == "absent":
        return
    stop(paths)
    if nssm_path(paths).exists():
        _nssm(paths, "remove", SERVICE, "confirm")
    else:
        # nssm.exe is gone; the registration is an ordinary service to Windows.
        proc.run("sc", "delete", SERVICE, capture=True)
    # Deletion completes only once every open handle is closed; registering the
    # same name before that fails with "marked for deletion".
    deadline = time.monotonic() + DELETE_WAIT_SECONDS
    while not proc.DRY_RUN and state() != "absent":
        if time.monotonic() >= deadline:
            raise proc.Failed(f"Windows has not finished deleting the old {SERVICE} service. Close "
                              "the Services window or Task Manager (or restart the PC), then run "
                              "this again.")
        time.sleep(0.5)


def register(paths, env: dict, port: int, opts) -> None:
    ensure_nssm(paths, opts)
    _remove_service(paths)
    _nssm(paths, "install", SERVICE, str(paths_lib.venv_python(paths.app)))
    for setting in nssm_settings(paths, port, env):
        _nssm(paths, "set", SERVICE, *setting)
    manage = paths.app / "deploy" / "manage.py"
    python = paths_lib.venv_python(paths.app)
    proc.run("schtasks", "/Create", "/TN", TASK_NAME, "/SC", "MINUTE", "/MO", "2", "/RU", "SYSTEM",
             "/RL", "HIGHEST", "/F", "/TR", f'"{python}" "{manage}" healthcheck', capture=True)
    proc.write(paths.bin / f"{COMMAND}.cmd", f'@"{python}" "{manage}" %*\r\n')
    _edit_machine_path(add=paths.bin)


def start(paths) -> None:
    proc.run("net", "start", SERVICE, check=False, capture=True)


def expose(port: int, opts) -> None:
    """Nothing to set up: a public origin is your own tunnel (Tailscale Funnel)."""


def finish(paths, opts) -> None:
    proc.note("settings", f"{paths.settings}, then (elevated): {COMMAND} restart")
    if not _wants_desktop(opts):
        return
    npm = shutil.which("npm")
    if not npm:
        proc.warn("Node is not installed, so the desktop app was skipped; install Node for all "
                  f"users and run `{COMMAND} install` again")
        return
    proc.say("desktop app")
    # `npm ci`: `npm install` could rewrite package-lock.json, a tracked change
    # that would block every later update.
    proc.run(npm, "ci", cwd=paths.app / "desktop")
    proc.run("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SHORTCUT_SCRIPT,
             "-Desktop", paths.app / "desktop")


# ---------- machine PATH ----------

def _machine_path() -> str:
    import winreg
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, ENV_KEY) as key:
        return winreg.ExpandEnvironmentStrings(winreg.QueryValueEx(key, "Path")[0])


def _edit_machine_path(add: Path | None = None, drop: Path | None = None) -> None:
    if proc.DRY_RUN:
        proc.say(f"would {'add' if add else 'remove'} {add or drop} "
                 f"{'to' if add else 'from'} the machine PATH")
        return
    import winreg
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, ENV_KEY, 0,
                        winreg.KEY_READ | winreg.KEY_WRITE) as key:
        value, kind = winreg.QueryValueEx(key, "Path")
        target = str(add or drop).lower()
        parts = [p for p in value.split(";") if p and p.lower() != target]
        if add:
            parts.append(str(add))
        if ";".join(parts) != value.strip(";"):
            winreg.SetValueEx(key, "Path", 0, kind, ";".join(parts))
    # Tell running shells (Explorer) the environment changed.
    ctypes.windll.user32.SendMessageTimeoutW(0xFFFF, 0x001A, 0, "Environment", 0x0002, 5000, None)


# ---------- day to day ----------

def state() -> str:
    result = proc.query("sc", "query", SERVICE)
    if result.returncode != 0:
        return "absent"
    return "running" if "RUNNING" in result.stdout else "stopped"


def stop(paths) -> None:
    proc.run("net", "stop", SERVICE, check=False, capture=True)
    deadline = time.monotonic() + STOP_WAIT_SECONDS
    while not proc.DRY_RUN and state() == "running":
        if time.monotonic() >= deadline:
            raise proc.Failed(f"the {SERVICE} service did not stop within {STOP_WAIT_SECONDS}s")
        time.sleep(1)


def restart(paths) -> None:
    """Stop, re-read the settings file into the service's environment, start.
    An install made by the old PowerShell scripts has no install.env; its
    environment is left exactly as they registered it."""
    stop(paths)
    if paths.generated.exists() and nssm_path(paths).exists():
        _nssm(paths, "set", SERVICE, "AppEnvironmentExtra",
              *(f"{key}={value}" for key, value in paths_lib.service_env(paths).items()))
    result = proc.run("net", "start", SERVICE, check=False, capture=True)
    if result.returncode != 0 and state() != "running":
        raise proc.Failed(f"could not start {SERVICE}: {(result.stderr or result.stdout).strip()}")


def logs(paths, lines: int) -> None:
    for name in ("service-stderr.log", "backend.log"):
        path = paths.logs / name
        if path.exists():
            print(f"--- last {lines} lines of {path} ---")
            print("\n".join(path.read_text(encoding="utf-8", errors="replace").splitlines()[-lines:]))


def unregister(paths, purge: bool) -> None:
    _remove_service(paths)
    proc.run("schtasks", "/Delete", "/TN", TASK_NAME, "/F", check=False, capture=True)
    _edit_machine_path(drop=paths.bin)
    proc.remove(paths.bin / f"{COMMAND}.cmd")
    proc.run("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SHORTCUT_SCRIPT,
             "-Remove", check=False, capture=True)
    if purge:
        proc.remove(paths.data)
    else:
        proc.note("code", f"left in place: {paths.app}")
