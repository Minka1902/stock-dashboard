import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "settings";

// Forward-safe defaults. New keys merge over whatever is persisted so older
// saved blobs keep working after an upgrade.
const DEFAULTS = {
  // Which seasonality window keys to display (see SeasonalityPanel WINDOW_META).
  seasonalityWindows: ["fwd_week", "fwd_month", "cal_month"],
  // How many years of history to include in the aggregates: 5 | 10 | "all".
  seasonalityLookback: 10,
  // Opt-in dyslexia-friendly reading mode (Atkinson Hyperlegible + extra spacing).
  dyslexia: false,
  // Opt-in: disable non-essential animation/transitions for calmer motion.
  reducedMotion: false,
  // Focus mode: Overview shows one section at a time (accordion).
  focusMode: false,
  // Map of Overview section key -> true when the user has collapsed it.
  collapsed: {},
  // Map of view key -> true once its guided tour has run (auto-runs once per view).
  toursSeen: {},
};

function initialSettings() {
  if (typeof localStorage !== "undefined") {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return { ...DEFAULTS, ...saved };
    } catch {
      // corrupt blob — fall back to defaults
    }
  }
  return { ...DEFAULTS };
}

/**
 * User settings persisted to localStorage. ADHD-friendly styling is always on
 * in CSS and is NOT a setting; only the dyslexia mode is toggled here (applied
 * to <html data-dyslexia>). Returns { settings, setSetting }.
 */
export function useSettings() {
  const [settings, setSettings] = useState(initialSettings);

  useEffect(() => {
    document.documentElement.dataset.dyslexia = settings.dyslexia ? "on" : "off";
    document.documentElement.dataset.reducedMotion = settings.reducedMotion ? "on" : "off";
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // localStorage unavailable (private mode etc.) — non-fatal
    }
  }, [settings]);

  const setSetting = useCallback((key, value) => {
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  return { settings, setSetting };
}
