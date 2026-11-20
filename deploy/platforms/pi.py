"""What only a Raspberry Pi needs to run unattended: the hardware watchdog,
compressed swap instead of SD-card swap, a capped journal, and a clock that is
right before the service starts (a Pi 3 has no real-time clock)."""
import platform
from pathlib import Path

from deploy.lib import proc

CONFIG_TXT = (Path("/boot/firmware/config.txt"), Path("/boot/config.txt"))
WATCHDOG_LINE = "dtparam=watchdog=on"
SYSTEMD_WATCHDOG = Path("/etc/systemd/system.conf.d/stocks-watchdog.conf")
JOURNAL_CAP = Path("/etc/systemd/journald.conf.d/stocks.conf")
ZRAM_CONF = Path("/etc/default/zramswap")


def preflight() -> None:
    if platform.machine() != "aarch64":
        proc.warn(f"{platform.machine()} is not 64-bit ARM; the Pi target is Raspberry Pi OS 64-bit")


def tune() -> bool:
    """Returns True when a reboot is needed (the watchdog was just enabled)."""
    reboot = False
    config = next((p for p in CONFIG_TXT if p.is_file()), None)
    if config and WATCHDOG_LINE not in config.read_text(encoding="utf-8").splitlines():
        proc.write(config, config.read_text(encoding="utf-8").rstrip("\n") + f"\n{WATCHDOG_LINE}\n")
        reboot = True
    proc.write(SYSTEMD_WATCHDOG, "[Manager]\nRuntimeWatchdogSec=15s\n")
    proc.write(JOURNAL_CAP, "[Journal]\nSystemMaxUse=64M\n")
    if "zram" not in proc.query("swapon", "--show=NAME", "--noheadings").stdout:
        proc.run("apt-get", "install", "-y", "-qq", "zram-tools", env={"DEBIAN_FRONTEND": "noninteractive"})
        proc.write(ZRAM_CONF, "ALGO=zstd\nPERCENT=50\n")
        proc.run("systemctl", "restart", "zramswap.service")
        proc.run("systemctl", "disable", "--now", "dphys-swapfile.service", check=False, capture=True)
    if proc.query("systemctl", "is-active", "--quiet", "systemd-timesyncd.service").returncode == 0:
        proc.run("systemctl", "enable", "systemd-time-wait-sync.service")
    else:
        proc.warn("systemd-timesyncd is not the NTP client; make sure the clock is synced "
                  "before the service starts")
    proc.run("systemctl", "daemon-reexec")
    proc.run("systemctl", "restart", "systemd-journald")
    return reboot
