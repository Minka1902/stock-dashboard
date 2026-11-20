#!/usr/bin/env bash
# Install (or repair) the Stock Signal Dashboard on a Raspberry Pi or any
# systemd Linux. This script only makes sure git and Python are there and
# hands over to deploy/manage.py, which does the rest (see deploy/README.md).
#
#   curl -fsSL https://raw.githubusercontent.com/Minka1902/stock-dashboard/main/install.sh \
#     | sudo bash -s -- --admin-email you@example.com
#
#   sudo ./install.sh --admin-email you@example.com     # from a checkout
#
# Safe to re-run: it never overwrites your settings, your database or local
# changes to the code.
set -euo pipefail

REPO_URL=https://github.com/Minka1902/stock-dashboard.git
BRANCH=main
PYTHON_MIN="(3, 11)"

die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

(($(id -u) == 0)) || die "run it with sudo"

missing=()
command -v git >/dev/null || missing+=(git)
command -v python3 >/dev/null || missing+=(python3)
if ((${#missing[@]})); then
	if command -v apt-get >/dev/null; then
		apt-get update -qq
		DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${missing[@]}"
	elif command -v dnf >/dev/null; then
		dnf install -y -q "${missing[@]}"
	else
		die "install ${missing[*]} first"
	fi
fi
python3 -c "import sys; sys.exit(sys.version_info < $PYTHON_MIN)" ||
	die "Python 3.11 or newer is needed (this is $(python3 -V 2>&1))"

HERE=$(dirname "$(readlink -f "${BASH_SOURCE[0]:-$0}")")
if [[ -f $HERE/deploy/manage.py ]]; then
	exec python3 "$HERE/deploy/manage.py" install "$@"
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git clone --quiet --depth 1 --branch "$BRANCH" "$REPO_URL" "$TMP/repo"
python3 "$TMP/repo/deploy/manage.py" install "$@"
