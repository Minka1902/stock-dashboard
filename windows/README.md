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
  ms-playwright\            headless Chromium for the margin-debt fetch
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
`STOCKS_OAUTH_REDIRECT_BASE`, `PLAYWRIGHT_BROWSERS_PATH`.

## Headless browser (margin debt)

FINRA's Cloudflare front refuses plain HTTP clients (the Query API answers 401,
the statistics page 403), so the `margin_debt` source's last tier loads the page
in a real headless Chromium via Playwright and downloads the workbook through
the same browser context. It runs weekly, so it costs one Chromium launch a
week, about 15 seconds.

Playwright's default browser cache is `%LOCALAPPDATA%\ms-playwright` of
whoever ran `playwright install`, and **LocalSystem never looks there**. So
the installer:

1. runs `python -m playwright install chromium` with
   `PLAYWRIGHT_BROWSERS_PATH=C:\ProgramData\SignalDashboard\ms-playwright`, and
2. sets that same `PLAYWRIGHT_BROWSERS_PATH` in the service's environment block.

This step warns rather than failing the install, because only that one tier
depends on it. Skip it with `-SkipBrowserInstall`. If the browser is missing, the
source status on the Server page reads `headless browser not installed — run: …`
and names the path. To install it later, elevated:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = 'C:\ProgramData\SignalDashboard\ms-playwright'
.\backend\.venv\Scripts\python.exe -m playwright install chromium
.\windows\service-control.ps1 -Restart
```

After upgrading the `playwright` package in `requirements.txt`, re-run the
installer (or the commands above). Each Playwright release pins its own browser
build, and until you do, the tier reports it as not installed.

A dev instance (`start.ps1`) uses the per-user cache instead. There, run
`.venv\Scripts\python.exe -m playwright install chromium` once from `backend\`.

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

## Reaching it from the internet

The service stays bound to `127.0.0.1`. A tunnel dials loopback, so nothing about
the bind changes — there is no firewall rule, no port-forward, and the dashboard
is never on your LAN.

[Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel) gives a
stable `https://<machine>.<tailnet>.ts.net` on the free plan, with a cert issued
for you:

```powershell
winget install --id Tailscale.Tailscale -e
tailscale up                       # authenticates this machine
tailscale serve --bg 8000          # tailnet-only first — verify before going public
tailscale funnel --bg 8000         # public 443 -> http://127.0.0.1:8000
tailscale funnel status            # prints the public URL
```

Then re-run the installer with that URL (re-running is the normal upgrade path):

```powershell
.\windows\install-service.ps1 -PublicOrigin https://<machine>.<tailnet>.ts.net
```

`-PublicOrigin` derives everything that has to agree with it: `STOCKS_CORS_ORIGINS`
(public origin **first**, `127.0.0.1` kept second for the desktop shell),
`STOCKS_OAUTH_REDIRECT_BASE`, `STOCKS_COOKIE_SECURE=1`, `STOCKS_HSTS_SECONDS`, and
`STOCKS_TRUSTED_PROXY_IPS`. It also generates an invite code into `service.env` and
prints it once. **Set the origin with this flag, not by hand in `service.env`** —
the ordering rule below is invisible and breaks OAuth silently when violated.

Two things that will quietly kill the tunnel months later:

- **Node key expiry** (default ~180 days). Disable it for this machine in the
  Tailscale admin console, or the URL simply stops resolving one day.
- **The PC sleeping.** Set the power plan to never sleep.

Off switch: `tailscale funnel --https=443 off`.

Once a public origin is set, account creation needs the invite code — the login
page being reachable is not the same as signups being open. This covers the OAuth
callback too, which is a second, equally public account factory: with a code
configured, social login links to accounts that already exist but never creates
one. See `backend/app/registration.py`.

## Why it's configured the way it is

| Setting | Why |
|---|---|
| `Start = SERVICE_DELAYED_AUTO_START` + `DependOnService Tcpip Dnscache` | Still well before any human logs in, but doesn't race DHCP/DNS on a cold boot and mark every source errored on the first cycle. |
| `AppParameters ... --no-supervise` | Runs uvicorn **in-process**. `run_server.py`'s own restart loop is bypassed because NSSM already restarts on crash, and two supervisors would fight over the port. |
| `AppNoConsole 0`, `AppStopMethodSkip 0`, `AppStopMethodConsole 20000` | These three are what make a graceful stop work. `app/main.py`'s lifespan ends with `PRAGMA wal_checkpoint(TRUNCATE)`; without the Ctrl-C path every stop becomes a `TerminateProcess` and the WAL is left uncheckpointed. `AppNoConsole 1` silently disables it. |
| `AppExit Default Restart`, `AppRestartDelay 5000`, `AppThrottle 10000` | Restart on crash, with backoff for a process that dies immediately (almost always misconfiguration). |
| Bound to `127.0.0.1` | A LocalSystem service on `0.0.0.0` would expose the dashboard to the LAN. Loopback needs no firewall rule — and it stays loopback even when the app is public, because the tunnel dials it from this machine. |
| `STOCKS_CORS_ORIGINS` app origin **first** | `routes_oauth.py::_frontend_origin()` reuses `CORS_ORIGINS[0]` as the post-login redirect target. If it isn't first, a completed OAuth login redirects to a different host — a different cookie jar — and the session appears to vanish. **Don't reorder it.** |
| `127.0.0.1`, never `localhost` | uvicorn binds IPv4 only, and Windows resolves `localhost` to `::1` first. They're also separate cookie jars. |
| `ObjectName LocalSystem` | Simplest thing that works. Note this process fetches and parses untrusted remote content (RSS, SEC filings, a FINRA XLS via `xlrd`/`openpyxl`) — see the hardening note below. |

## Troubleshooting

**Service starts, then stops immediately.** Read `logs\service-stderr.log`
first. Import-time failures never reach `backend.log` — the commonest is a bad
`STOCKS_CORS_ORIGINS` (a `*` entry raises `ValueError` at import, by design).
The other is `STOCKS_REGISTRATION=invite` with no `STOCKS_INVITE_CODE`, which
also raises at import: an empty code would compare equal to an empty submission
and open registration to anyone with the URL.

**"I can't create a second account."** That's the invite gate, not a bug — a
public origin sets `STOCKS_REGISTRATION=invite`. The code is in
`windows\service.env`. To reopen signups entirely, delete both
`STOCKS_REGISTRATION` and `STOCKS_INVITE_CODE` from that file and restart.

**Public URL stopped working after months.** Almost certainly Tailscale node key
expiry. `tailscale status` will say so; disable key expiry for this machine in
the admin console.

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

The margin-debt tier adds to this. Once a week it runs a headless Chromium that
executes finra.org's JavaScript under the service account, and Playwright launches
Chromium without its sandbox by default. That's one more reason to prefer
`LocalService`. The browser directory is under the same data root, so the grant
above already covers it.

Also worth knowing: `service.env` is plaintext and readable by any local
administrator. That is the same trust level as the service itself, so it's
proportionate here, but the ACL is not a boundary against local admins.
