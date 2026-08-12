# Windows service

Runs the dashboard backend as a Windows service so it collects data
continuously — from boot, before anyone logs in, and restarting itself on crash.

Without this, the scheduler only runs while someone has `start.bat` open and
stays logged in, so the 3-minute ingest cycle, the pre-market digest and the
nightly jobs simply don't happen.

## Install

From an **elevated** PowerShell, in the repo root:

```powershell
.\start.bat -Install          # create the venv, if you haven't already
cd frontend; npm run build; cd ..
.\windows\install-service.ps1
```

That registers `SignalDashboard`, starts it, and waits for `/api/health`.
Open <http://127.0.0.1:8000>.

Re-running `install-service.ps1` is the upgrade path — it removes and
re-registers the service, so it's safe to run repeatedly.

### NSSM

The service is hosted by [NSSM](https://nssm.cc). The repo carries no binaries,
so the installer fetches it — but **not from an unverified download by default**,
because NSSM ends up with SYSTEM-level process control. You have three options:

```powershell
# 1. Verify it yourself, then pin it (recommended)
#    Download https://nssm.cc/release/nssm-2.24.zip, then:
Get-FileHash .\nssm-2.24.zip -Algorithm SHA256
.\windows\install-service.ps1 -NssmSha256 <hash>
#    Put that hash in $script:NssmSha256 in windows\Common.ps1 and every
#    later install is checked automatically.

# 2. Use a copy you already trust
.\windows\install-service.ps1 -NssmPath C:\tools\nssm.exe

# 3. Accept the risk for one run (prints the hash so you can pin it)
.\windows\install-service.ps1 -TrustNssmDownload
```

## Day to day

```powershell
.\windows\service-control.ps1 -Status     # no elevation needed
.\windows\service-control.ps1 -Restart    # after editing service.env
.\windows\service-control.ps1 -Stop
.\windows\service-control.ps1 -Logs       # follow backend.log
```

## Where things live

```
C:\ProgramData\SignalDashboard\
  db\stocks.db              accounts, TOTP secrets, all collected signals
  logs\backend.log(.1-.5)   the app's own rotating log
  logs\service-stdout.log   uvicorn stdout, rotated by NSSM
  logs\service-stderr.log   import-time tracebacks  <- read this one first
```

ACL'd to SYSTEM + Administrators by the installer. Secrets live in
`windows\service.env` (gitignored; created from `service.env.example` on first
install).

The **code** stays in this repo — only data moves to ProgramData. That means
moving or renaming the repo folder breaks the service, and checking out a broken
branch takes down the always-on backend at its next restart.
`service-control.ps1 -Status` warns if the path has gone missing.

## Configuration and secrets

The backend has no `.env` loader — `app/config.py` reads `os.environ` once at
import — and a LocalSystem service inherits nothing from your shell. So
`windows\service.env` is the only way secrets (SMTP, Twilio, API keys, OAuth)
reach it. The installer bakes every `KEY=VALUE` line into the service's
environment block; edit the file and `-Restart` to apply.

These are set by the installer and must **not** be duplicated in `service.env`:
`STOCKS_DB_PATH`, `STOCKS_LOG_DIR`, `STOCKS_STATIC_DIR`, `STOCKS_CORS_ORIGINS`,
`STOCKS_OAUTH_REDIRECT_BASE`.

## Two databases

The service uses `C:\ProgramData\SignalDashboard\db\stocks.db`. A dev instance
started with `start.bat` uses `backend\stocks.db`. **They are separate** —
separate accounts, separate TOTP enrolments, separate data. That's deliberate
(restarting a dev server must not disturb live collection) but it does surprise
people.

To seed the service from an existing dev database, on first install:

```powershell
.\windows\install-service.ps1 -ImportExistingDb
```

That uses SQLite's online backup API, which folds the `-wal` in and produces one
consistent file — copying `stocks.db` on its own would lose every
committed-but-uncheckpointed transaction. The source is never deleted. There is
no merge path back afterwards.

## Running dev alongside the service

The service owns port 8000, and it restarts itself, so `start.ps1 -Kill` cannot
free that port — `Assert-PortFree` now detects this and says so. Use a different
port instead:

```powershell
.\start.bat dev -ApiPort 8001
```

The Vite proxy follows `-ApiPort` automatically. Or stop the service first with
`.\windows\service-control.ps1 -Stop`.

## Why it's configured the way it is

| Setting | Why |
|---|---|
| `Start = SERVICE_DELAYED_AUTO_START` + `DependOnService Tcpip Dnscache` | Still well before any human logs in, but doesn't race DHCP/DNS on a cold boot and mark every source errored on the first cycle. |
| `AppParameters ... --no-supervise` | Runs uvicorn **in-process**. `run_server.py`'s own restart loop is bypassed because NSSM already restarts on crash, and two supervisors would fight over the port. |
| `AppNoConsole 0`, `AppStopMethodSkip 0`, `AppStopMethodConsole 20000` | These three are what make a graceful stop work. `app/main.py`'s lifespan ends with `PRAGMA wal_checkpoint(TRUNCATE)`; without the Ctrl-C path every stop becomes a `TerminateProcess` and the WAL is left uncheckpointed. `AppNoConsole 1` silently disables it. |
| `AppExit Default Restart`, `AppRestartDelay 5000`, `AppThrottle 10000` | Restart on crash, with backoff for a process that dies immediately (almost always misconfiguration). |
| Bound to `127.0.0.1` | A LocalSystem service on `0.0.0.0` would expose the dashboard to the LAN. Loopback needs no firewall rule. |
| `STOCKS_CORS_ORIGINS` app origin **first** | `routes_oauth.py::_frontend_origin()` reuses `CORS_ORIGINS[0]` as the post-login redirect target. If it isn't first, a completed OAuth login redirects to a different host — a different cookie jar — and the session appears to vanish. **Don't reorder it.** |
| `127.0.0.1`, never `localhost` | uvicorn binds IPv4 only, and Windows resolves `localhost` to `::1` first. They're also separate cookie jars. |
| `ObjectName LocalSystem` | Simplest thing that works. Note this process fetches and parses untrusted remote content (RSS, SEC filings, a FINRA XLS via `xlrd`/`openpyxl`) — see the hardening note below. |

## Troubleshooting

**Service starts, then stops immediately.** Read `logs\service-stderr.log`
first. Import-time failures never reach `backend.log` — the commonest is a bad
`STOCKS_CORS_ORIGINS` (a `*` entry raises `ValueError` at import, by design).

**Dashboard loads but the page is blank.** The SPA mount is a silent no-op when
`frontend\dist\index.html` is missing. Rebuild the frontend and restart.

**WAL file keeps growing.** The graceful-stop settings above aren't taking
effect. Check `AppNoConsole` is `0` (`nssm edit SignalDashboard`).

**Uninstall.**

```powershell
.\windows\uninstall-service.ps1              # keeps your data
.\windows\uninstall-service.ps1 -PurgeData   # deletes the database too
```

## Hardening note

`ObjectName LocalSystem` is a lot of authority for a process that parses hostile
input from the internet. `NT AUTHORITY\LocalService` still has outbound network
access — all this app needs — with far less local authority. It costs one extra
ACL grant on the data directory:

```powershell
nssm set SignalDashboard ObjectName "NT AUTHORITY\LocalService"
icacls C:\ProgramData\SignalDashboard /grant "NT AUTHORITY\LocalService:(OI)(CI)M"
```

Also worth knowing: `service.env` is plaintext and readable by any local
administrator. That is the same trust level as the service itself, so it's
proportionate here, but the ACL is not a boundary against local admins.
