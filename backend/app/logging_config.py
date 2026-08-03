"""App-wide logging setup.

A timestamped stderr handler plus a rotating file handler on the root logger;
every module logs through ``logging.getLogger(__name__)``. Level comes from
``STOCKS_LOG_LEVEL``.

The file handler is not a nicety. uvicorn is launched detached and minimized by
``start.ps1``, so stderr goes to a console window nobody keeps — a crash there
leaves no evidence at all. Everything worth reading after the fact has to land
in ``STOCKS_LOG_DIR``.
"""
import logging
import logging.handlers
import sys
import threading

from app import config

_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"


def _install_excepthooks() -> None:
    """Route otherwise-unhandled exceptions into the log before the process dies.

    Without these, an exception escaping a non-main thread (a scheduler worker,
    say) prints to stderr and is lost with the console window.
    """
    root = logging.getLogger("app.crash")

    def sys_hook(exc_type, exc, tb):
        if issubclass(exc_type, KeyboardInterrupt):
            sys.__excepthook__(exc_type, exc, tb)
            return
        root.critical("unhandled exception", exc_info=(exc_type, exc, tb))

    def thread_hook(args):
        if issubclass(args.exc_type, SystemExit):
            return
        root.critical(
            "unhandled exception in thread %s",
            getattr(args.thread, "name", "?"),
            exc_info=(args.exc_type, args.exc_value, args.exc_traceback),
        )

    sys.excepthook = sys_hook
    threading.excepthook = thread_hook


def setup_logging(level: str | None = None) -> None:
    """Configure the root logger once; safe to call repeatedly (tests re-import)."""
    root = logging.getLogger()
    resolved = (level or config.LOG_LEVEL).upper()
    root.setLevel(resolved)
    formatter = logging.Formatter(_FORMAT, datefmt="%Y-%m-%d %H:%M:%S")

    if not any(
        isinstance(h, logging.StreamHandler)
        and not isinstance(h, logging.handlers.RotatingFileHandler)
        for h in root.handlers
    ):
        handler = logging.StreamHandler()
        handler.setFormatter(formatter)
        root.addHandler(handler)

    if not any(isinstance(h, logging.handlers.RotatingFileHandler) for h in root.handlers):
        try:
            config.LOG_DIR.mkdir(parents=True, exist_ok=True)
            file_handler = logging.handlers.RotatingFileHandler(
                config.LOG_DIR / "backend.log",
                maxBytes=config.LOG_MAX_BYTES,
                backupCount=config.LOG_BACKUP_COUNT,
                encoding="utf-8",
            )
            file_handler.setFormatter(formatter)
            root.addHandler(file_handler)
        except OSError as exc:
            # A read-only or missing log dir must not stop the app from booting;
            # say so on stderr and carry on with console logging only.
            root.warning("file logging disabled (%s): %s", config.LOG_DIR, exc)

    # Uvicorn's access log is chatty at INFO; keep it but quiet noisy libraries.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
    # ...except the executor, which is the only thing that reports a job being
    # skipped for a missed deadline or a still-running previous instance.
    logging.getLogger("apscheduler.executors").setLevel(logging.INFO)

    _install_excepthooks()
