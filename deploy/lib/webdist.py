"""The web app: downloaded as CI built it, or built here when that isn't
published and Node is installed.

CI commits every build of main to the web-dist branch as one commit whose
message is "source: <main sha>". A host therefore never needs Node to install
or update, and a commit that failed CI never gets a web app.
"""
import shutil
import tarfile
import tempfile
import time
from pathlib import Path

from app import updatecore
from deploy.lib import proc

WEB_DIST_BRANCH = "web-dist"
WEB_DIST_DEPTH = 20
WAIT_SECONDS = 600
POLL_SECONDS = 30
GIT_TIMEOUT_SECONDS = 300

PREBUILT, BUILT = "prebuilt by CI", "built on this machine"


def dist_dir() -> Path:
    return updatecore.REPO_ROOT / "frontend" / "dist"


def find(commit: str) -> str | None:
    """The web-dist commit CI built from `commit`, or None while it doesn't exist."""
    try:
        updatecore.git(
            "fetch", "--quiet", f"--depth={WEB_DIST_DEPTH}", updatecore.REMOTE,
            f"+refs/heads/{WEB_DIST_BRANCH}:refs/remotes/{updatecore.REMOTE}/{WEB_DIST_BRANCH}",
            timeout=GIT_TIMEOUT_SECONDS)
        return updatecore.git(
            "log", f"{updatecore.REMOTE}/{WEB_DIST_BRANCH}", "--format=%H", "-n1",
            f"--grep=^source: {commit}$").strip() or None
    except updatecore.GitError:
        return None


def _swap_in(fresh: Path) -> None:
    """Make `fresh` the live build, keeping the one it replaces as dist.prev."""
    dist = dist_dir()
    previous = dist.with_name("dist.prev")
    shutil.rmtree(previous, ignore_errors=True)
    if dist.exists():
        dist.rename(previous)
    fresh.rename(dist)


def _download(built: str) -> None:
    fresh = dist_dir().with_name("dist.new")
    shutil.rmtree(fresh, ignore_errors=True)
    with tempfile.TemporaryDirectory() as tmp:
        archive = Path(tmp) / "dist.tar"
        updatecore.git("archive", f"--output={archive}", built, timeout=GIT_TIMEOUT_SECONDS)
        with tarfile.open(archive) as tar:
            try:
                tar.extractall(fresh, filter="data")
            except TypeError:  # Python < 3.11.4 has no extraction filters
                tar.extractall(fresh)
    if not (fresh / "index.html").is_file():
        shutil.rmtree(fresh, ignore_errors=True)
        raise proc.Failed(f"web-dist commit {built[:7]} has no index.html")
    _swap_in(fresh)


def _build(npm: str) -> None:
    dist = dist_dir()
    previous = dist.with_name("dist.prev")
    # Vite empties dist/ before it writes, so the live build steps aside first.
    shutil.rmtree(previous, ignore_errors=True)
    if dist.exists():
        dist.rename(previous)
    try:
        # `npm ci`, never `npm install`: a rewritten package-lock.json is a
        # tracked change, and a tracked change blocks every later update.
        proc.run(npm, "ci", cwd=dist.parent, capture=True)
        proc.run(npm, "run", "build", cwd=dist.parent, capture=True)
        if not (dist / "index.html").is_file():
            raise proc.Failed("npm run build produced no index.html")
    except proc.Failed:
        restore()
        raise


def install(commit: str, wait_seconds: int | None = None) -> str:
    """Put the web app for `commit` in frontend/dist. Returns PREBUILT or
    BUILT. With Node installed a missing CI build is built here at once;
    without it the CI build is waited for, up to `wait_seconds`."""
    npm = shutil.which("npm")
    wait_seconds = WAIT_SECONDS if wait_seconds is None else wait_seconds
    deadline = time.monotonic() + (0 if npm else wait_seconds)
    while (built := find(commit)) is None and time.monotonic() < deadline:
        time.sleep(POLL_SECONDS)
    if built:
        _download(built)
        return PREBUILT
    if npm:
        _build(npm)
        return BUILT
    raise proc.Failed(
        f"no web app built for {commit[:7]} on the {WEB_DIST_BRANCH} branch after "
        f"{wait_seconds}s, and Node is not installed to build it here — check the "
        "'ci' workflow on GitHub")


def restore() -> None:
    """Put the previous build (dist.prev) back. Only for undoing an `install`
    that returned: before that, dist.prev is an older build, not the live one."""
    dist = dist_dir()
    previous = dist.with_name("dist.prev")
    if previous.is_dir():
        shutil.rmtree(dist, ignore_errors=True)
        previous.rename(dist)
