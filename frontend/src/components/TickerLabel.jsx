import { useSettingsContext } from "../hooks/useSettingsContext";
import styles from "./TickerLabel.module.css";

/**
 * Renders a ticker as either its symbol or the company name, per the user's
 * "Ticker labels" setting. Falls back to the symbol whenever no name is
 * stored, and always exposes the symbol via `title` so it stays discoverable.
 *
 * Company names are much longer than symbols, so the name variant is width-
 * capped and ellipsised rather than being allowed to blow up table layouts.
 */
export default function TickerLabel({ ticker, className = "", as: Tag = "span" }) {
  const { labelFor, wantsNames } = useSettingsContext();
  if (!ticker) return null;
  const label = labelFor(ticker);
  const showingName = wantsNames && label !== ticker;
  return (
    <Tag
      className={`${styles.label} ${className}`.trim()}
      data-name={showingName ? "yes" : "no"}
      title={showingName ? `${ticker} — ${label}` : ticker}
    >
      {label}
    </Tag>
  );
}
