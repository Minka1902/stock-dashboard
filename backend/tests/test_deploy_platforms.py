"""The deploy tool's platform layer: what an install registers, without
touching a real service manager."""
import subprocess
import sys
from pathlib import Path

import pytest

from app import host
from deploy.commands import install
from deploy.lib import envfile, proc
from deploy.lib import paths as paths_lib
from deploy.platforms import systemd, windows

REPO = Path(__file__).resolve().parents[2]


def _win_paths():
    return paths_lib.installed(host.WINDOWS)._replace(app=Path(r"C:\Program Files\SignalDashboard\repo"))


def test_the_nssm_settings_keep_every_load_bearing_value():
    paths = _win_paths()
    settings = {row[0]: row[1:] for row in windows.nssm_settings(paths, 8123, {"A": "1", "B": "2"})}
    assert settings["AppParameters"] == ["run_server.py --host 127.0.0.1 --port 8123 --no-supervise"]
    assert settings["AppDirectory"] == [str(paths.app / "backend")]
    assert settings["ObjectName"] == ["LocalSystem"]
    assert settings["Start"] == ["SERVICE_DELAYED_AUTO_START"]
    assert settings["DependOnService"] == ["Tcpip", "Dnscache"]
    assert settings["AppExit"] == ["Default", "Restart"]
    # The graceful stop that protects the WAL checkpoint.
    assert settings["AppNoConsole"] == ["0"] and settings["AppStopMethodSkip"] == ["0"]
    assert settings["AppStopMethodConsole"] == ["20000"]
    assert settings["AppEnvironmentExtra"] == ["A=1", "B=2"]
    assert "8123" in settings["Description"][0]


def test_the_generated_env_puts_the_public_origin_first():
    paths = paths_lib.installed(host.LINUX)
    env = install.generated_env(paths, systemd, 8000, "https://pi.tail.ts.net")
    # CORS_ORIGINS[0] is where an OAuth sign-in returns to.
    assert env["STOCKS_CORS_ORIGINS"] == "https://pi.tail.ts.net,http://127.0.0.1:8000"
    assert env["STOCKS_OAUTH_REDIRECT_BASE"] == "https://pi.tail.ts.net"
    assert env["STOCKS_COOKIE_SECURE"] == "1" and env["STOCKS_TRUSTED_PROXY_IPS"] == "127.0.0.1,::1"
    assert env["STOCKS_DB_PATH"] == "/var/lib/stocks-dashboard/db/stocks.db"
    assert env["STOCKS_SETTINGS_FILE"] == "/etc/stocks-dashboard/stocks.env"

    local = install.generated_env(paths, systemd, 8000, None)
    assert local["STOCKS_CORS_ORIGINS"] == "http://127.0.0.1:8000"
    assert "STOCKS_COOKIE_SECURE" not in local


def test_windows_env_points_playwright_at_the_machine_wide_browser():
    env = install.generated_env(_win_paths(), windows, 8000, None)
    assert env["PLAYWRIGHT_BROWSERS_PATH"].endswith("ms-playwright")
    assert env["STOCKS_STATIC_DIR"].endswith("dist")


def test_rendered_units_have_no_placeholders_left():
    paths = paths_lib.installed(host.PI)
    for template in (*systemd.UNITS, systemd.POLKIT_RULE):
        text = systemd.render(template, paths, 8000)
        assert "@" not in text.replace("@example", ""), template
    unit = systemd.render(systemd.UNIT, paths, 8000)
    assert "--port 8000" in unit and "User=stocks" in unit
    assert "ReadWritePaths=/var/lib/stocks-dashboard /var/log/stocks-dashboard" in unit
    # The settings file comes last so it wins over install.env.
    assert unit.index("install.env") < unit.index("stocks.env")


def test_settings_keep_yours_and_only_change_what_was_asked(tmp_path, monkeypatch):
    paths = paths_lib.installed(host.LINUX)._replace(settings=tmp_path / "stocks.env")
    monkeypatch.setattr(proc, "DRY_RUN", False)
    monkeypatch.setattr(host, "KIND", host.LINUX)

    class Opts:
        admin_email = None

    assert install._settings(paths, Opts, None) is None
    assert envfile.read(paths.settings) == {}
    paths.settings.write_text(paths.settings.read_text() + "STOCKS_TELEGRAM_BOT_TOKEN=keep\n")

    invite = install._settings(paths, Opts, "https://x.example")
    env = envfile.read(paths.settings)
    assert env["STOCKS_REGISTRATION"] == "invite" and env["STOCKS_INVITE_CODE"] == invite
    assert env["STOCKS_TELEGRAM_BOT_TOKEN"] == "keep"
    # Re-running never mints a second code.
    assert install._settings(paths, Opts, "https://x.example") is None

    Opts.admin_email = "Me@Example.com"
    install._settings(paths, Opts, None)
    env = envfile.read(paths.settings)
    assert env["STOCKS_REGISTRATION"] == "approval" and env["STOCKS_ADMIN_EMAIL"] == "me@example.com"


def test_a_pi_needs_an_admin_email(tmp_path, monkeypatch):
    monkeypatch.setattr(host, "KIND", host.PI)
    paths = paths_lib.installed(host.PI)._replace(settings=tmp_path / "stocks.env")

    class Opts:
        admin_email = None

    with pytest.raises(proc.Failed, match="admin email"):
        install._settings(paths, Opts, None)


def test_envfile_parses_like_systemd():
    path = Path(__file__).parent / "_envfile_probe.env"
    try:
        path.write_text('# c\n\nA=1\n B = "two words" \nC=\'q\'\nnot a pair\n=x\n')
        assert envfile.read(path) == {"A": "1", "B": "two words", "C": "q"}
    finally:
        path.unlink()
    assert envfile.with_key("# K=\nX=1\n", "K", "v") == "K=v\nX=1\n"
    assert envfile.with_key("K=old\n", "K", "new") == "K=new\n"
    assert envfile.with_key("X=1", "K", "v") == "X=1\nK=v\n"


def test_the_tool_and_the_shared_modules_need_only_the_standard_library():
    """The installer runs on the system Python, before the virtualenv exists
    and when it is broken: -I -S means no site-packages at all."""
    code = ("import sys; sys.path[:0] = [sys.argv[1], sys.argv[1] + '/backend']\n"
            "import app.host, app.updatecore, app.backup\n"
            "import deploy.manage, deploy.platforms.systemd, deploy.platforms.pi\n"
            "import deploy.commands.install, deploy.commands.update, deploy.commands.restore\n"
            "assert 'pydantic' not in sys.modules and 'fastapi' not in sys.modules\n")
    done = subprocess.run([sys.executable, "-I", "-S", "-c", code, str(REPO)],
                          capture_output=True, text=True)
    assert done.returncode == 0, done.stderr


@pytest.mark.parametrize("kind", [host.PI, host.LINUX])
def test_a_dry_run_install_lists_the_steps_and_changes_nothing(kind, tmp_path):
    env = {"STOCKS_HOST_KIND": kind, "PATH": "/usr/bin:/bin", "HOME": str(tmp_path)}
    (tmp_path / "index.html").write_text("<p>built</p>")
    done = subprocess.run(
        [sys.executable, str(REPO / "deploy" / "manage.py"), "install", "--dry-run",
         "--resumed", "--admin-email", "me@example.com", "--web-dist", str(tmp_path)],
        capture_output=True, text=True, env=env)
    out = done.stdout + done.stderr
    assert "would write /etc/stocks-dashboard/install.env" in out, out
    assert "would write /etc/systemd/system/stocks-dashboard.service" in out
    assert "would run: systemctl enable stocks-dashboard.service stocks-healthcheck.timer" in out
    if kind == host.PI:
        assert "watchdog" in out or "would write /etc/systemd/system.conf.d/stocks-watchdog.conf" in out
    assert not Path("/etc/stocks-dashboard/install.env").exists()
