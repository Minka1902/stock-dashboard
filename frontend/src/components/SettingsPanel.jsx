import Icon from "./Icon";
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

export default function SettingsPanel({ settings, setSetting }) {
  const activeWindows = settings.seasonalityWindows;
  const lookback = settings.seasonalityLookback;

  const toggleWindow = (key) => {
    const next = activeWindows.includes(key)
      ? activeWindows.filter((k) => k !== key)
      : [...activeWindows, key];
    setSetting("seasonalityWindows", next);
  };

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
