# Installing and running the dashboard

One tool installs, updates, backs up, restores and controls the dashboard on
**Windows**, a **Raspberry Pi** and any **systemd Linux**. It works out which
machine it is on and uses that machine's service manager. The commands are the
same everywhere:

```
signal install      install or repair (safe to re-run)
signal status       service, health, where things are, last backup
signal update       pull the latest version, restart, roll back on failure
signal backup       write a verified archive of the database and settings
signal restore F    put a backup back
signal restart      apply an edited settings file
signal start | stop | logs
signal uninstall    remove the service; your data stays unless --purge-data
```

On Linux run them with `sudo`; on Windows from an elevated PowerShell (`signal
status` and `signal logs` need neither). `signal <command> --help` lists the
options, and `signal install --dry-run` prints every step an install would take
on this machine without changing anything.

Everything is in `deploy/` (standard-library Python, so it runs before the
app's virtualenv exists and when it is broken). `install.sh` and `install.ps1`
only make sure git and Python are there and hand over to `deploy/manage.py`.

## What each machine gets

| | Windows | Raspberry Pi | Linux |
|---|---|---|---|
| Service | `SignalDashboard` under NSSM, LocalSystem, delayed auto-start | `stocks-dashboard` (systemd), user `stocks` | same as the Pi |
| Restart after a hang | Scheduled Task `SignalDashboard Health`, every 2 min | `stocks-healthcheck.timer`, every 2 min | same as the Pi |
| Updates run as | a detached process | `stocks-update.service` (allowed by a polkit rule) | same as the Pi |
| Code | `C:\Program Files\SignalDashboard\repo` (or the checkout you ran it from) | `/opt/stocks-dashboard` | same as the Pi |
| Database, backups | `C:\ProgramData\SignalDashboard\db`, `\backups` | `/var/lib/stocks-dashboard/db`, `/backups` | same as the Pi |
| Logs | `C:\ProgramData\SignalDashboard\logs` | `/var/log/stocks-dashboard` + the journal | same as the Pi |
| Your settings | `C:\ProgramData\SignalDashboard\settings.env` | `/etc/stocks-dashboard/stocks.env` | same as the Pi |
| Reached on | `http://127.0.0.1:8000` (plus `--public-origin`) | `https://<pi>.<tailnet>.ts.net` via `tailscale serve` | `http://127.0.0.1:8000` (plus `--tailscale` or `--public-origin`) |
| Who may sign up | anyone; an invite code once it is public | approval queue, `--admin-email` required | as Windows |
| Also installed | the desktop app and its shortcuts, Playwright's Chromium | hardware watchdog, zram swap, 64 MB journal cap, wait for the clock | — |
| Packages | git, Python (winget, machine-wide); Node only for the desktop app | apt: git, python3-venv, poppler-utils, chromium, polkitd | apt or dnf: the same |

The service always binds `127.0.0.1`. A tunnel (Tailscale) dials loopback from
the same machine, so the dashboard is never on your LAN and needs no firewall
rule.

The web app is not built on the machine: CI builds every commit of `main` and
publishes it on the `web-dist` branch, and the installer and updater download
the one for the commit they install. A commit whose tests or build failed never
gets a web app, so it can't be installed. If Node is installed and no build is
published (a development branch), it is built locally instead.

## Install

### Raspberry Pi

1. Flash **Raspberry Pi OS Lite (64-bit)** with Raspberry Pi Imager (set a
   hostname, your user, and enable SSH). A Pi 3 B/B+ works; a Pi 4 or 5 gives
   the headless browser comfortable room. Use the official power supply:
   under-voltage is the commonest cause of crashes and SD corruption, and the
   Server page shows it.
2. Install Tailscale and log in, then in the Tailscale admin console → DNS turn
   on **MagicDNS** and **HTTPS certificates**:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   ```

   ```bash
   sudo tailscale up
   ```

3. Install:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/Minka1902/stock-dashboard/main/install.sh | sudo bash -s -- --admin-email you@example.com
   ```

4. Reboot once if it says so (that turns the hardware watchdog on). Open the
   address it printed on a device in your tailnet and **create the account
   with the admin email**. That account is approved and admin; anyone else who
   signs up waits on the Server page until you approve them.

### Linux

```bash
curl -fsSL https://raw.githubusercontent.com/Minka1902/stock-dashboard/main/install.sh | sudo bash
```

Add `--tailscale` to serve it on the machine's tailnet name like a Pi, or
`--admin-email` for the approval queue.

### Windows

From an elevated PowerShell:

```powershell
irm https://raw.githubusercontent.com/Minka1902/stock-dashboard/main/install.ps1 | iex
```

Or download `SignalSetup.exe` from the latest release, which runs the same
script. It installs git and Python machine-wide through winget when they are
missing (the service runs as LocalSystem, which sees neither a per-user Python
nor your user PATH), clones `main` into `C:\Program Files\SignalDashboard\repo`
and installs from there. Run `.\install.ps1` from a checkout to install that
checkout instead. Pass options after it, for example
`.\install.ps1 --without desktop`.

To seed the service from a development database (`backend\stocks.db`, used by
`start.ps1`), add `--import-existing-db` on the first install. That uses
SQLite's online backup, so nothing committed-but-uncheckpointed is lost.
Otherwise the two are separate: separate accounts, separate TOTP.

**NSSM** is downloaded from nssm.cc and checked against the SHA-256 pinned in
`deploy/platforms/windows.py`. A mismatch stops the install: it is a binary
that gets SYSTEM-level process control. Verify a new download by hand before
changing the pin, or pass `--nssm C:\path\to\nssm.exe`.

## Settings and keys

Every setting is an environment variable in the settings file (SEC user agent,
Telegram, SMTP, Alpaca, OAuth, API keys…); `deploy/env.example` is its
annotated template and the install copies it once. Edit it, then:

```bash
sudo signal restart
```

Nothing in the app reads a `.env` file: the service manager hands this file to
the service. `install.env` next to it holds what the installer derives (paths,
the public address, secure cookies, trusted proxies) and is rewritten on every
install; a line in your settings file wins over it.

## How it stays up

| Failure | What handles it |
|---|---|
| The app crashes | NSSM / systemd restart it within 5 s, with no limit |
| The app hangs, or a fetch hangs the refresh thread | the health check restarts it after 3 non-ok `/api/health` answers in a row (never during an update) |
| The kernel hangs (Pi) | the hardware watchdog reboots the Pi |
| Power cut | WAL with `synchronous=NORMAL`: the last moments can be lost, never the database |
| No network | sources record `deferred: network offline` once and the minute jobs wait; within 30 s of the network returning every deferred source runs |
| Boot without a synced clock (a Pi 3 has no RTC) | the service waits for NTP, because TOTP and every schedule need the right time |
| The disk or SD card dies | a verified backup every night; keep the backup directory on another disk |

Every scheduled job is on the Server page with its next run, and its machine
card shows memory, disk, last backup, whether the machine is online and, on a
Pi, power and temperature.

## Updating

**Info → Updates** compares the install with `origin/main` every 6 hours; **Update
now** (admins only) and `signal update` run the same steps:

1. `git pull --ff-only origin main`
2. `pip install -r requirements.txt` (on Windows, if a loaded extension blocks
   pip, the service is stopped and pip retried)
3. the web app CI built for that commit
4. restart, and wait for `/api/health` to report the new commit

Any failure after the pull rolls everything back: the previous commit, its
packages, its web app, restart. It is refused (409) unless the checkout is on
`main`, has no tracked local changes and can fast-forward. Progress is in
`update-status.json` and the full transcript in `update.log`, both in the log
directory. Protect `main` on GitHub: whatever lands there is what every install
updates to.

A development server (`uvicorn --reload`, `start.ps1`) can update too: instead
of a restart it nudges the reloader and asks you to reload the page. Whether it
is the service is detected (NSSM is the process's ancestor, or it runs in the
systemd unit's cgroup); `STOCKS_UPDATE_MODE=service|dev` overrides that.

## Backups and restore

At 03:47 every night (`STOCKS_BACKUP_HOUR` / `_MINUTE`) the service writes
`stocks-<UTC time>.zip` to the backup directory and keeps the newest 7
(`STOCKS_BACKUP_KEEP`). `signal backup` writes one now (`--to DIR` puts it
somewhere else, and prunes nothing there). Each archive holds:

- `stocks.db`, an online snapshot that passed `PRAGMA integrity_check`. All the
  accounts are in it: password hashes, TOTP enrolments, recovery codes,
  watchlists, portfolios, the ledger and every signal collected.
- `settings.env`, your settings file (API keys, admin email).
- `manifest.json`: app version, commit, machine, the snapshot's SHA-256 and how
  many accounts it holds.

The archive holds secrets, so it is written owner-only. Keep a copy off the
machine.

```bash
sudo signal restore /var/lib/stocks-dashboard/backups/stocks-20261117T034700Z.zip
```

The archive is checked (checksum and integrity) before anything is touched. The
service is stopped, the current database is kept beside the new one as
`stocks.db.before-restore-<time>`, and the service started; if it does not come
back healthy, the previous database is put back. `--with-settings` restores the
settings file too (the current one is kept the same way). Archives can be
restored onto another machine, including from Windows to a Pi. Nightly `.db`
copies made by the old Pi installer restore the same way.

## Reaching it from the internet

On a Pi the installer already serves it on the tailnet. To make any install
public, use [Tailscale Funnel](https://tailscale.com/docs/features/tailscale-funnel):

```bash
tailscale funnel --bg 8000
```

Then re-install with the address it prints, so every setting that must agree
with it is derived together:

```bash
sudo signal install --public-origin https://<machine>.<tailnet>.ts.net
```

That sets `STOCKS_CORS_ORIGINS` with the public address **first** (it is also
where an OAuth sign-in returns to; anything else in front breaks sign-in
silently) and `127.0.0.1` second for the desktop app, `STOCKS_OAUTH_REDIRECT_BASE`,
secure cookies, HSTS and the trusted proxy. Unless a sign-up mode is already
set, it also turns on invite codes and prints the code once. Two things that
quietly end a tunnel months later: Tailscale node key expiry (turn it off for
this machine in the admin console) and the machine going to sleep.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `signal status` says the service is running but health doesn't answer | `signal logs`. On Windows, import-time failures are only in `service-stderr.log`: a `*` in `STOCKS_CORS_ORIGINS`, or `STOCKS_REGISTRATION=invite` without a code |
| "no web app built for …" | CI hasn't published that commit of `main` yet (still running, or red). Check the **ci** workflow on GitHub, then run the install or update again |
| "Tailscale is not logged in" / "tailscale serve failed" | `sudo tailscale up`; turn on HTTPS certificates for the tailnet |
| The service doesn't start after boot (Pi) | `journalctl -b -u stocks-dashboard`. Waiting on time sync means no network for NTP |
| `margin_debt`: "headless browser not installed" | Linux: `sudo apt install chromium`. Windows: run `signal install` again |
| `margin_debt` times out on a Pi 3 | Raise `STOCKS_MARGIN_DEBT_BROWSER_TIMEOUT_SECONDS`, or use **Import file** on the Server page |
| Sources sit in "deferred: network offline" | The machine can't reach `STOCKS_NETCHECK_HOSTS` (1.1.1.1:443, 8.8.8.8:53); set hosts your network allows |
| Someone signed up and sees nothing | Approve them on the Server page |
| "I can't create a second account" | Invite mode: the code is in the settings file. Delete `STOCKS_REGISTRATION` and `STOCKS_INVITE_CODE` to reopen |
| Update refused with 409 | The checkout isn't on `main`, has local changes, or can't fast-forward |
| Port 8000 busy when running `start.ps1` | The service owns it: `.\start.bat dev -ApiPort 8001`, or `signal stop` first |

## Moving an existing install to this tool

- **Raspberry Pi installed from `stock-dashboard-PI`:** run the Pi install
  command above. It takes a backup, refuses if the code in `/opt/stocks-dashboard`
  was edited, points the checkout at this repository and installs. The database,
  backups and `stocks.env` are kept.
- **Windows installed with `windows\install-service.ps1`:** press Update once in
  the app (or wait for it), then run `install.ps1` once, elevated. It moves
  `windows\service.env` to `C:\ProgramData\SignalDashboard\settings.env`, keeps
  the same service name, database and logs, and adds the health check task and
  the `signal` command.

## Uninstall

```bash
sudo signal uninstall
```

The database, backups, logs and settings stay. `--purge-data` removes them too
(and the `stocks` user on Linux); it asks you to type DELETE unless `--yes`.
The settings that made a Pi run unattended (watchdog, zram, journal size) are
kept.

## Hardening note (Windows)

LocalSystem is a lot of authority for a process that parses untrusted input
from the internet, and a few times a month it runs a headless Chromium on
finra.org's JavaScript. `NT AUTHORITY\LocalService` has the outbound network
access the app needs with far less local authority, for one extra ACL grant:

```powershell
nssm set SignalDashboard ObjectName "NT AUTHORITY\LocalService"
```

```powershell
icacls C:\ProgramData\SignalDashboard /grant "NT AUTHORITY\LocalService:(OI)(CI)M"
```

(`nssm.exe` is in `C:\ProgramData\SignalDashboard\bin`.) The settings file is
plaintext and readable by any local administrator: the same trust level as the
service itself, so the ACL is not a boundary against local admins.
