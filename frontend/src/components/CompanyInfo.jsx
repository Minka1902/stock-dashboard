import { useState } from "react";
import { formatCount, formatCurrencyCompact } from "../lib/format";
import styles from "./CompanyInfo.module.css";

const SUMMARY_CLAMP = 320;

function pct(v, digits = 1) {
  return v == null ? "—" : `${(v * 100).toFixed(digits)}%`;
}

function num(v, digits = 2) {
  return v == null ? "—" : Number(v).toFixed(digits);
}

function Row({ label, value, title }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={styles.rowValue} title={title}>{value}</span>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className={styles.section}>
      <h4 className={styles.sectionTitle}>{title}</h4>
      {children}
    </div>
  );
}

/**
 * Who this company is: identity, business summary, valuation, the people who
 * run it and the institutions that own it. Every field is optional — anything
 * the fundamentals source hasn't returned renders as "—" rather than being
 * guessed at. Which sections appear is a user preference (Settings → Company
 * information).
 */
export default function CompanyInfo({ company, ticker, show = {} }) {
  const [expanded, setExpanded] = useState(false);

  const profile = company?.profile || null;
  const officers = company?.officers || [];
  const holders = company?.holders || [];
  const name = company?.name || null;

  const wants = {
    profile: show.profile !== false,
    valuation: show.valuation !== false,
    officers: show.officers !== false,
    holders: show.holders !== false,
  };

  // Nothing stored yet for this ticker — say so instead of rendering empty rows.
  if (!profile && !name && !officers.length && !holders.length) {
    return (
      <p className={styles.empty}>
        No company profile stored for {ticker} yet. It fills in the next time the
        fundamentals source runs for a watched or held ticker.
      </p>
    );
  }

  const summary = profile?.summary || "";
  const long = summary.length > SUMMARY_CLAMP;
  const shown = expanded || !long ? summary : `${summary.slice(0, SUMMARY_CLAMP).trimEnd()}…`;

  const location = [profile?.city, profile?.country].filter(Boolean).join(", ");

  return (
    <div className={styles.wrap}>
      {wants.profile && (
        <Section title="Profile">
          <div className={styles.identity}>
            <span className={styles.name}>{name || ticker}</span>
            {(profile?.sector || profile?.industry) && (
              <span className={styles.tags}>
                {[profile?.sector, profile?.industry].filter(Boolean).join(" · ")}
              </span>
            )}
          </div>
          {summary && (
            <p className={styles.summary}>
              {shown}
              {long && (
                <button className={styles.more} onClick={() => setExpanded((e) => !e)}>
                  {expanded ? "less" : "more"}
                </button>
              )}
            </p>
          )}
          <div className={styles.rows}>
            <Row label="Market cap" value={profile?.market_cap != null
              ? formatCurrencyCompact(profile.market_cap) : "—"} />
            <Row label="Employees" value={profile?.employees != null
              ? formatCount(profile.employees) : "—"} />
            <Row label="Headquarters" value={location || "—"} />
            <Row
              label="Website"
              value={profile?.website ? (
                <a className={styles.link} href={profile.website}
                   target="_blank" rel="noreferrer noopener">
                  {profile.website.replace(/^https?:\/\/(www\.)?/, "")}
                </a>
              ) : "—"}
            />
          </div>
        </Section>
      )}

      {wants.valuation && profile && (
        <Section title="Valuation">
          <div className={styles.rows}>
            <Row label="P/E (trailing)" value={num(profile.pe_ratio)} />
            <Row label="P/E (forward)" value={num(profile.forward_pe)} />
            <Row label="PEG" value={num(profile.peg_ratio)} />
            <Row label="Price / book" value={num(profile.pb_ratio)} />
            <Row label="Revenue growth" value={pct(profile.revenue_growth)} />
            <Row label="Profit margin" value={pct(profile.profit_margin)} />
          </div>
        </Section>
      )}

      {wants.holders && (
        <Section title="Ownership">
          <div className={styles.rows}>
            <Row label="Held by insiders" value={pct(profile?.insider_pct)} />
            <Row label="Held by institutions" value={pct(profile?.institution_pct)} />
          </div>
          {holders.length > 0 ? (
            <ul className={styles.holders}>
              {holders.map((h) => (
                <li key={h.holder} className={styles.holder}>
                  <span className={styles.holderName}>{h.holder}</span>
                  <span className={styles.holderPct}>{pct(h.pct_held, 2)}</span>
                  <span className={styles.holderMeta}>
                    {h.shares != null ? formatCount(h.shares) : "—"} sh
                    {h.reported_at ? ` · ${h.reported_at}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.none}>No institutional holders recorded.</p>
          )}
        </Section>
      )}

      {wants.officers && (
        <Section title="Leadership">
          {officers.length > 0 ? (
            <ul className={styles.officers}>
              {officers.map((o) => (
                <li key={o.name} className={styles.officer}>
                  <span className={styles.officerName}>{o.name}</span>
                  <span className={styles.officerTitle}>{o.title || "—"}</span>
                  <span className={styles.officerMeta}>
                    {o.age ? `age ${o.age}` : ""}
                    {o.pay ? `${o.age ? " · " : ""}${formatCurrencyCompact(o.pay)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.none}>No officers recorded.</p>
          )}
        </Section>
      )}
    </div>
  );
}
