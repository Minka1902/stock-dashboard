// Tray icon, menu and unread indicator.

import { Menu, Tray, nativeImage } from "electron";

import { TRAY_ICON } from "./config.js";
import { badgeText } from "./alerts/seen.js";

// Mirrors the navigation entries of the Ctrl/Cmd+K command palette
// (`commandItems` in frontend/src/App.jsx), in its order. Keep in sync.
//
// Deliberately omitted: Server (admin-only, and the tray does not know the
// user's role), and the palette's actions: kill switch and paper trade open
// in-app dialogs, "Refresh all sources" has no bulk route (only
// POST /api/refresh/{source}), and the theme/dyslexia toggles live in the
// app's localStorage settings with no main-process representation. All of
// them are one Ctrl+K away in the app itself.
const NAV_ITEMS = [
  ["Market Sentiment", "/"],
  ["Suggestions", "/suggestions"],
  ["Portfolio", "/portfolio"],
  ["Trading Bot", "/trading-bot"],
  ["Trades", "/trades"],
  ["News", "/news"],
  ["Watchlist", "/watchlist"],
  ["Economic Calendar", "/econ-calendar"],
  ["X Watch", "/x"],
  ["Info", "/info"],
  ["Settings", "/settings"],
];

export class AppTray {
  constructor(handlers) {
    this.handlers = handlers;
    this.state = { unread: 0, reachable: false, health: null, service: "unknown" };
    this.tray = new Tray(nativeImage.createFromPath(TRAY_ICON));
    this.tray.on("click", () => this.handlers.onToggleWindow());
    this.render();
  }

  update(patch) {
    this.state = { ...this.state, ...patch };
    this.render();
  }

  render() {
    const { unread, reachable, health, service } = this.state;

    const badge = badgeText(unread);
    this.tray.setToolTip(
      !reachable ? "Signal — backend unreachable"
        : badge ? `Signal — ${badge} unread`
          : "Signal");

    const backendLabel = !reachable
      ? `Backend: unreachable (service ${service})`
      : `Backend: ${health?.status ?? "ok"} · up ${formatUptime(health?.uptime_seconds)}`;

    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open Signal", click: () => this.handlers.onShowWindow() },
      { type: "separator" },
      ...NAV_ITEMS.map(([label, path]) => ({
        label, click: () => this.handlers.onNavigate(path),
      })),
      { type: "separator" },
      { label: unread ? `Alerts: ${unread} unread` : "Alerts: none unread", enabled: false },
      { label: "Mark all read", enabled: unread > 0, click: () => this.handlers.onMarkAllRead() },
      { type: "separator" },
      { label: backendLabel, enabled: false },
      { label: "Restart backend service…", click: () => this.handlers.onRestartService() },
      { label: "Open logs folder", click: () => this.handlers.onOpenLogs() },
      { type: "separator" },
      {
        label: "Start Signal at login",
        type: "checkbox",
        checked: this.handlers.getOpenAtLogin(),
        click: (item) => this.handlers.onSetOpenAtLogin(item.checked),
      },
      { label: "Quit Signal", click: () => this.handlers.onQuit() },
    ]));
  }

  destroy() {
    this.tray?.destroy();
  }
}

function formatUptime(seconds) {
  const s = Number(seconds) || 0;
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}
