import { useState } from "react";
import Icon from "./Icon";
import { useProfile } from "../hooks/useProfile";
import { sendTestSuggestions } from "../api";
import styles from "./SettingsPanel.module.css";

const WINDOW_OPTIONS = [
  { key: "fwd_day", label: "Next Day", desc: "Move on the day around today's date" },
  { key: "fwd_week", label: "Next Week", desc: "Move over the ~7 days after today" },
  { key: "fwd_month", label: "Next Month", desc: "Move over the ~30 days after today" },
  { key: "cal_week", label: "This Calendar Week", desc: "Move during this calendar week" },
  { key: "cal_month", label: "This Calendar Month", desc: "Move during this calendar month" },
];

const LOOKBACK_OPTIONS = [
  { value: 5, label: "5 years" },
  { value: 10, label: "10 years" },
  { value: "all", label: "All years" },
];

const TZ_OPTIONS = [
  { value: "Asia/Jerusalem", label: "Israel (Asia/Jerusalem)" },
  { value: "America/New_York", label: "New York (America/New_York)" },
  { value: "Europe/London", label: "London (Europe/London)" },
  { value: "UTC", label: "UTC" },
];

const QUOTE_INTERVALS = [
  { value: 15, label: "15 seconds" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
];

function formatNextRun(iso, tz) {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: "short", month: "short", day: "numeric",
      hour: "2-digit", minute: "2-digit", timeZone: tz, timeZoneName: "short",
    });
  } catch {
    return iso;
  }
}

export default function SettingsPanel({ settings, setSetting, onNavigate, appSettingsApi }) {
  const activeWindows = settings.seasonalityWindows;
  const lookback = settings.seasonalityLookback;

  const { profile, update, save } = useProfile();
  const [saveState, setSaveState] = useState(null); // null | "saving" | "saved" | error string
  const [testState, setTestState] = useState(null); // null | "sending" | results[]

  const { appSettings, update: updateApp, save: saveApp } = appSettingsApi;
  const [schedState, setSchedState] = useState(null); // null | "saving" | "saved" | error string

  async function saveSchedule() {
    setSchedState("saving");
    try {
      await saveApp({
        analysis_time: appSettings.analysis_time,
        analysis_tz: appSettings.analysis_tz,
        quotes_refresh_seconds: appSettings.quotes_refresh_seconds,
      });
      setSchedState("saved");
    } catch (err) {
      setSchedState(err.message || "could not save");
    }
  }

  const nextRun = formatNextRun(appSettings.next_analysis_run, appSettings.analysis_tz);
  const tzOptions = TZ_OPTIONS.some((o) => o.value === appSettings.analysis_tz)
    ? TZ_OPTIONS
    : [{ value: appSettings.analysis_tz, label: appSettings.analysis_tz }, ...TZ_OPTIONS];

  const toggleWindow = (key) => {
    const next = activeWindows.includes(key)
      ? activeWindows.filter((k) => k !== key)
      : [...activeWindows, key];
    setSetting("seasonalityWindows", next);
  };

  async function saveProfile() {
    setSaveState("saving");
    try {
      await save(profile);
      setSaveState("saved");
    } catch (err) {
      setSaveState(err.message || "could not save");
    }
  }

  async function sendTest() {
    setTestState("sending");
    try {
      const { results } = await sendTestSuggestions();
      setTestState(results);
    } catch (err) {
      setTestState([{ channel: "error", status: err.message || "failed" }]);
    }
  }

  return (
    <section className={styles.panel} id="settings">
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>Settings</h2>
          <p className={styles.subtitle}>
            Personalize the seasonality view and reading comfort. Changes apply instantly and are
            saved on this device.
          </p>
        </div>
      </header>

      <div className={styles.body}>
        {/* Analysis schedule + data refresh (server-side; drives the cron job) */}
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Analysis schedule &amp; data refresh</legend>
          <p className={styles.groupHint}>
            Every weekday at this time, the dashboard force-refreshes all sources, recomputes every
            holding&apos;s analysis and Boom Scores, and sends the daily digest. Live prices poll on
            their own faster cadence.
          </p>
          <div className={styles.contact}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="analysis-time">Daily analysis time</label>
              <input
                id="analysis-time"
                className={styles.input}
                type="time"
                value={appSettings.analysis_time}
                onChange={(e) => updateApp({ analysis_time: e.target.value })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="analysis-tz">Timezone</label>
              <select
                id="analysis-tz"
                className={styles.input}
                value={appSettings.analysis_tz}
                onChange={(e) => updateApp({ analysis_tz: e.target.value })}
              >
                {tzOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="quote-interval">Live price refresh</label>
              <select
                id="quote-interval"
                className={styles.input}
                value={appSettings.quotes_refresh_seconds}
                onChange={(e) => updateApp({ quotes_refresh_seconds: Number(e.target.value) })}
              >
                {QUOTE_INTERVALS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={saveSchedule} disabled={schedState === "saving"}>
              {schedState === "saving" ? "Saving…" : "Save schedule"}
            </button>
            {schedState === "saved" && <span className={styles.ok}>Saved ✓</span>}
            {schedState && schedState !== "saving" && schedState !== "saved" && (
              <span className={styles.err}>{schedState}</span>
            )}
          </div>
          {nextRun && (
            <p className={styles.note}>
              <Icon name="spark" size={14} />
              Next scheduled analysis run: <strong>{nextRun}</strong>
            </p>
          )}
        </fieldset>

        {/* Onboarding: the in-app Info page + guided tours */}
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Learn the dashboard</legend>
          <p className={styles.groupHint}>
            New here? The <strong>Info</strong> page explains what every panel shows, how it feeds the
            Boom Score, and lists every data source and whether it last responded. (Data sources have
            moved to the Info page.) Each view also has a guided tour (the <strong>?</strong> button in
            the top bar) that runs automatically on first visit.
          </p>
          <button type="button" className={styles.primaryBtn} onClick={() => onNavigate?.("info")}>
            Open the Info page
          </button>{" "}
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => setSetting("toursSeen", {})}
            title="Guided tours will auto-run again the next time you visit each view"
          >
            Replay all tours
          </button>
        </fieldset>

        {/* Trading & risk: position sizing for each holding's analysis */}
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Trading &amp; risk</legend>
          <p className={styles.groupHint}>
            Sizes positions in each holding's analysis: shares = (risk&nbsp;% × account) ÷ risk-per-share.
            Risk is capped at 10% per trade.
          </p>
          <div className={styles.contact}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="acct-size">Account size ($)</label>
              <input
                id="acct-size"
                className={styles.input}
                type="number"
                min="0"
                step="any"
                placeholder="50000"
                value={profile.account_size ?? ""}
                onChange={(e) => update({ account_size: e.target.value === "" ? null : Number(e.target.value) })}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="risk-pct">Risk per trade (%)</label>
              <input
                id="risk-pct"
                className={styles.input}
                type="number"
                min="0.1"
                max="10"
                step="0.1"
                value={profile.risk_pct ?? 1}
                onChange={(e) => update({ risk_pct: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={saveProfile} disabled={saveState === "saving"}>
              {saveState === "saving" ? "Saving…" : "Save trading settings"}
            </button>
            {profile.account_size ? (
              <span className={styles.ok}>
                Risking ${Math.round((profile.account_size * (profile.risk_pct || 1)) / 100).toLocaleString()} per trade
              </span>
            ) : null}
          </div>
        </fieldset>

        {/* Notifications: email + phone for the daily suggestion digest */}
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Daily suggestions — email &amp; phone</legend>
          <p className={styles.groupHint}>
            Get a few tailored ideas for the next trading day, based on your portfolio and watchlist.
            Sent pre-market on trading days. Delivery is off until you add SMTP/Twilio keys on the
            server, but you can save your contact info and preview the digest now.
          </p>

          <div className={styles.contact}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="notify-email">Email address</label>
              <input
                id="notify-email"
                className={styles.input}
                type="email"
                placeholder="you@example.com"
                value={profile.email}
                onChange={(e) => update({ email: e.target.value })}
              />
            </div>
            <label className={styles.miniSwitch}>
              <input
                type="checkbox"
                checked={profile.email_enabled}
                onChange={(e) => update({ email_enabled: e.target.checked })}
              />
              Email me
            </label>
          </div>

          <div className={styles.contact}>
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="notify-phone">Phone (E.164)</label>
              <input
                id="notify-phone"
                className={styles.input}
                type="tel"
                placeholder="+14155551234"
                value={profile.phone}
                onChange={(e) => update({ phone: e.target.value })}
              />
            </div>
            <label className={styles.miniSwitch}>
              <input
                type="checkbox"
                checked={profile.sms_enabled}
                onChange={(e) => update({ sms_enabled: e.target.checked })}
              />
              Text me
            </label>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.primaryBtn} onClick={saveProfile} disabled={saveState === "saving"}>
              {saveState === "saving" ? "Saving…" : "Save contact info"}
            </button>
            <button type="button" className={styles.ghostBtn} onClick={sendTest} disabled={testState === "sending"}>
              {testState === "sending" ? "Sending…" : "Send test now"}
            </button>
            {saveState === "saved" && <span className={styles.ok}>Saved ✓</span>}
            {saveState && saveState !== "saving" && saveState !== "saved" && (
              <span className={styles.err}>{saveState}</span>
            )}
          </div>

          {Array.isArray(testState) && (
            <ul className={styles.testResults}>
              {testState.map((r) => (
                <li key={r.channel}>
                  <strong>{r.channel}:</strong>{" "}
                  <span data-ok={r.status === "sent" ? "yes" : "no"}>{r.status}</span>
                </li>
              ))}
            </ul>
          )}

          <p className={styles.note}>
            <Icon name="spark" size={14} />
            Add the holdings the suggestions should account for in the{" "}
            <button type="button" className={styles.link} onClick={() => onNavigate?.("portfolio")}>
              Portfolio
            </button>{" "}
            tab, and preview the exact digest in the{" "}
            <button type="button" className={styles.link} onClick={() => onNavigate?.("suggestions")}>
              Suggestions
            </button>{" "}
            tab.
          </p>
        </fieldset>

        {/* Seasonality windows */}
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Seasonality windows</legend>
          <p className={styles.groupHint}>Which "this time of year" windows to show in the Seasonality panel.</p>
          <div className={styles.checks}>
            {WINDOW_OPTIONS.map((opt) => (
              <label key={opt.key} className={styles.check}>
                <input
                  type="checkbox"
                  checked={activeWindows.includes(opt.key)}
                  onChange={() => toggleWindow(opt.key)}
                />
                <span className={styles.checkText}>
                  <span className={styles.checkLabel}>{opt.label}</span>
                  <span className={styles.checkDesc}>{opt.desc}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Lookback */}
        <fieldset className={styles.group}>
          <legend className={styles.legend}>History lookback</legend>
          <p className={styles.groupHint}>How many past years feed the averages and win-rate.</p>
          <div className={styles.segmented} role="group" aria-label="History lookback">
            {LOOKBACK_OPTIONS.map((opt) => (
              <button
                key={String(opt.value)}
                type="button"
                className={styles.segBtn}
                data-active={lookback === opt.value ? "yes" : "no"}
                aria-pressed={lookback === opt.value}
                onClick={() => setSetting("seasonalityLookback", opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Reading & focus */}
        <fieldset className={styles.group}>
          <legend className={styles.legend}>Reading &amp; focus</legend>
          <label className={styles.switchRow}>
            <span className={styles.switchText}>
              <span className={styles.checkLabel}>Dyslexia-friendly mode</span>
              <span className={styles.checkDesc}>
                Switches to the Atkinson Hyperlegible typeface with larger text and extra letter,
                word, and line spacing.
              </span>
            </span>
            <button
              type="button"
              className={styles.switch}
              role="switch"
              aria-checked={settings.dyslexia}
              data-on={settings.dyslexia ? "yes" : "no"}
              onClick={() => setSetting("dyslexia", !settings.dyslexia)}
            >
              <span className={styles.knob} />
            </button>
          </label>

          <label className={styles.switchRow}>
            <span className={styles.switchText}>
              <span className={styles.checkLabel}>Reduce motion</span>
              <span className={styles.checkDesc}>
                Turns off chart and panel animations for a calmer, steadier screen.
              </span>
            </span>
            <button
              type="button"
              className={styles.switch}
              role="switch"
              aria-checked={settings.reducedMotion}
              data-on={settings.reducedMotion ? "yes" : "no"}
              onClick={() => setSetting("reducedMotion", !settings.reducedMotion)}
            >
              <span className={styles.knob} />
            </button>
          </label>

          <label className={styles.switchRow}>
            <span className={styles.switchText}>
              <span className={styles.checkLabel}>Focus mode (one thing at a time)</span>
              <span className={styles.checkDesc}>
                On the Overview, keep a single section open at once. Opening one closes the rest.
              </span>
            </span>
            <button
              type="button"
              className={styles.switch}
              role="switch"
              aria-checked={settings.focusMode}
              data-on={settings.focusMode ? "yes" : "no"}
              onClick={() => setSetting("focusMode", !settings.focusMode)}
            >
              <span className={styles.knob} />
            </button>
          </label>

          <p className={styles.note}>
            <Icon name="spark" size={14} />
            ADHD-friendly defaults — calm motion, clear focus outlines, generous spacing, and
            row striping — are always on for everyone.
          </p>
        </fieldset>
      </div>
    </section>
  );
}
