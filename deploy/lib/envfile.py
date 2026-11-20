"""KEY=VALUE settings files, as systemd's EnvironmentFile reads them."""
from pathlib import Path


def read(path: Path) -> dict:
    """Missing or unreadable file -> {}. Comments and blank lines are skipped
    and one pair of matching quotes around a value is dropped."""
    pairs = {}
    try:
        lines = Path(path).read_text(encoding="utf-8-sig").splitlines()
    except OSError:
        return pairs
    for line in lines:
        line = line.strip()
        key, eq, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not eq or not key or line.startswith("#"):
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        pairs[key] = value
    return pairs


def with_key(text: str, key: str, value: str) -> str:
    """`text` with KEY set: its line replaced, else its commented-out line in
    the template (`# KEY=`) taken over, else appended."""
    lines = text.splitlines()
    for prefix in (f"{key}=", f"# {key}="):
        for i, line in enumerate(lines):
            if line.strip().startswith(prefix):
                lines[i] = f"{key}={value}"
                return "\n".join(lines) + "\n"
    return "\n".join([*lines, f"{key}={value}"]) + "\n"


def render(pairs: dict, header: str) -> str:
    return "".join([f"# {header}\n", *(f"{k}={v}\n" for k, v in pairs.items())])
