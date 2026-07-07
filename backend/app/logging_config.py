"""App-wide logging setup.

One timestamped stderr handler on the root logger; every module logs through
``logging.getLogger(__name__)``. Level comes from ``STOCKS_LOG_LEVEL``.
"""
import logging

from app import config

_FORMAT = "%(asctime)s %(levelname)-7s %(name)s: %(message)s"


def setup_logging(level: str | None = None) -> None:
    """Configure the root logger once; safe to call repeatedly (tests re-import)."""
    root = logging.getLogger()
    resolved = (level or config.LOG_LEVEL).upper()
    root.setLevel(resolved)
    if not any(isinstance(h, logging.StreamHandler) for h in root.handlers):
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter(_FORMAT, datefmt="%Y-%m-%d %H:%M:%S"))
        root.addHandler(handler)
    # Uvicorn's access log is chatty at INFO; keep it but quiet noisy libraries.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("apscheduler").setLevel(logging.WARNING)
