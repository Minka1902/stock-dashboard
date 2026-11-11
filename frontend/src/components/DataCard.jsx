import { useId, useState } from "react";
import MenuButton from "./MenuButton";
import { cardContent, columnCaption, phoneRole } from "../lib/dataTable";
import styles from "./DataCard.module.css";

const GLYPH = { pos: "▲", neg: "▼" };

/** Only `data-*` attributes reach a card; handlers belong to the table row. */
function dataAttrs(attrs) {
  return Object.fromEntries(Object.entries(attrs || {}).filter(([k]) => k.startsWith("data-")));
}

/**
 * One row of a DataTable on a phone: title and subtitle on the left, the
 * value(s) on the right, the "⋯" row menu, and every other column as a
 * caption/value grid revealed on tap. The whole card is one button
 * (stretched under the row's own links and buttons): it opens the row
 * (`onClick`) or, without one, shows and hides the details.
 */
export default function DataCard({ row, index, columns, label, onClick, actions, attrs, after, held }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const of = (role) => columns.filter((c) => phoneRole(c) === role);
  const meta = of("meta");
  const subtitles = of("subtitle");
  const values = of("value");
  const hasDetails = meta.length > 0 || Boolean(after);
  const shown = held || open;
  const toggle = () => setOpen((o) => !o);

  return (
    <li className={styles.card} data-open={shown ? "yes" : "no"} {...dataAttrs(attrs)}>
      {(onClick || hasDetails) && (
        <button
          type="button"
          className={styles.hit}
          aria-label={onClick ? label : `${label}: details`}
          aria-expanded={onClick ? undefined : shown}
          aria-controls={onClick ? undefined : detailsId}
          onClick={onClick ? () => onClick(row) : toggle}
        />
      )}
      <div className={styles.main}>
        <div className={styles.ident}>
          <div className={styles.title}>
            {of("title").map((c) => <span key={c.key}>{cardContent(c, row, index)}</span>)}
          </div>
          {subtitles.length > 0 && (
            <div className={styles.subtitle}>
              {subtitles.map((c) => <span key={c.key}>{cardContent(c, row, index)}</span>)}
            </div>
          )}
        </div>
        {values.length > 0 && (
          <div className={styles.values}>
            {values.map((c) => {
              const tone = c.tone?.(row);
              return (
                <span key={c.key} className={styles.value} data-tone={tone || undefined}>
                  {GLYPH[tone] && <span className={styles.glyph} aria-hidden="true">{GLYPH[tone]}</span>}
                  {cardContent(c, row, index)}
                </span>
              );
            })}
          </div>
        )}
        {onClick && hasDetails && (
          <button type="button" className={styles.more} aria-label={`${label}: details`}
                  aria-expanded={shown} aria-controls={detailsId} onClick={toggle}>▾</button>
        )}
        {!onClick && hasDetails && <span className={styles.chevron} aria-hidden="true">▾</span>}
        {actions && <MenuButton label={`Actions for ${label}`} className={styles.menu}>{actions}</MenuButton>}
      </div>
      {hasDetails && (
        <div id={detailsId} className={styles.details} hidden={!shown}>
          {meta.length > 0 && (
            <dl className={styles.meta}>
              {meta.map((c) => (
                <div key={c.key} className={styles.field}>
                  <dt>{columnCaption(c)}</dt>
                  <dd>{cardContent(c, row, index)}</dd>
                </div>
              ))}
            </dl>
          )}
          {after}
        </div>
      )}
    </li>
  );
}
