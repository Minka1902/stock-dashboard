import { useState } from "react";
import Button from "./Button";
import Field from "./Field";
import { setGuardrails, useRiskStatus } from "../hooks/useRiskStatus";
import styles from "./GuardrailsCard.module.css";

const FIELDS = [
  { key: "max_order_notional", label: "Max per order", suffix: "base ccy", hint: "notional of one order" },
  { key: "max_notional_per_day", label: "Max per day", suffix: "base ccy", hint: "all orders placed today" },
  { key: "max_orders_per_day", label: "Max orders per day", suffix: "orders", hint: "yours and the bots'" },
  { key: "max_position_pct", label: "Max position", suffix: "% of account", hint: "after a buy" },
];

/**
 * The order guardrails every order passes — your paper tickets and every bot
 * fill — before it reaches the broker. Edits are checked server-side; a
 * refused order says which limit stopped it, in the bot log or the ticket.
 */
export default function GuardrailsCard() {
  const { data } = useRiskStatus();
  const [draft, setDraft] = useState({});
  const [errors, setErrors] = useState({});
  const [pending, setPending] = useState(false);

  const g = data?.guardrails;
  if (!g) return null;
  const value = (k) => draft[k] ?? String(g[k]);
  const outside = draft.allow_outside_hours ?? g.allow_outside_hours;
  const dirty = Object.keys(draft).length > 0;

  async function save(e) {
    e.preventDefault();
    setPending(true);
    setErrors({});
    try {
      const body = Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, typeof v === "boolean" ? v : Number(v)]));
      await setGuardrails(body);
      setDraft({});
    } catch (err) {
      setErrors(err.fields || { max_order_notional: err.message });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className={styles.card} aria-labelledby="guard-title">
      <h3 id="guard-title" className={styles.title}>Order guardrails</h3>
      <p className={styles.text}>
        Checked on every order before it's placed — your paper tickets and every bot fill. An order that breaks
        one is refused with the reason, and the refusal goes in the audit log.
      </p>
      <form className={styles.form} onSubmit={save}>
        <div className={styles.grid}>
          {FIELDS.map((f) => (
            <Field key={f.key} label={f.label} suffix={f.suffix} hint={f.hint} error={errors[f.key]}>
              {(a) => <input {...a} type="number" min="0" step="any" inputMode="decimal" value={value(f.key)}
                             onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />}
            </Field>
          ))}
        </div>
        <label className={styles.check}>
          <input type="checkbox" checked={outside}
                 onChange={(e) => setDraft({ ...draft, allow_outside_hours: e.target.checked })} />
          Allow placing orders while the market is closed (they rest until it opens)
        </label>
        <div className={styles.actions}>
          {dirty && <Button variant="quiet" size="sm" onClick={() => { setDraft({}); setErrors({}); }}>Discard</Button>}
          <Button variant="primary" size="sm" type="submit" disabled={!dirty || pending}>
            {pending ? "Saving…" : "Save guardrails"}
          </Button>
        </div>
      </form>
    </section>
  );
}
