"""One driver per service manager. Each module answers the same calls
(deploy/commands/install.py lists them in order); `current()` picks the one
for this host."""
from app import host


def current():
    if host.KIND == host.WINDOWS:
        from deploy.platforms import windows
        return windows
    from deploy.platforms import systemd
    return systemd
