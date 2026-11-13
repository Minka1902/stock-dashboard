import { useState } from "react";
import Button from "./Button";
import Dialog from "./Dialog";
import Field from "./Field";
import SelectMenu from "./SelectMenu";
import styles from "./EditHoldingDialog.module.css";

const AUTO = "auto";

/**
 * Correct a holding's shares, average cost, currency and theme in one sheet:
 * the phone's form for what the Portfolio table edits inline on a desktop.
 * The theme applies on pick, as the table's theme menu does; the rest is
 * recorded as one adjustment on Save.
 *
 * Props: holding {ticker, shares, avg_cost, currency, category,
 * category_source}, currencies and themes offered, onSave(shares, cost,
 * currency | null when unchanged), onSetCategory(ticker, theme | null for
 * auto), onClose.
 */
export default function EditHoldingDialog({ holding, currencies, themes, onSave, onSetCategory, onClose }) {
  const ccy = holding.currency || "USD";
  const [shares, setShares] = useState(String(holding.shares));
  const [cost, setCost] = useState(String(holding.avg_cost));
  const [currency, setCurrency] = useState(ccy);
  const manual = holding.category_source === "manual";
  const [theme, setTheme] = useState(manual ? holding.category : AUTO);
  const [error, setError] = useState(null);
  const [pending, setPending] = useState(false);

  const pickTheme = (next) => {
    setTheme(next);
    onSetCategory(holding.ticker, next === AUTO ? null : next);
  };

  async function submit(e) {
    e.preventDefault();
    const sh = parseFloat(shares);
    const ac = parseFloat(cost);
    if (!(sh > 0) || !(ac >= 0)) {
      setError("Enter positive shares and a non-negative average cost.");
      return;
    }
    setPending(true);
    try {
      await onSave(sh, ac, currency !== ccy ? currency : null);
      onClose();
    } catch (err) {
      setError(err.message);
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      size="sm"
      caption="Recorded as an adjustment"
      title={`Edit ${holding.ticker}`}
      onClose={onClose}
      footer={(
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="edit-holding-form" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      )}
    >
      <form id="edit-holding-form" className={styles.form} onSubmit={submit}>
        <Field label="Shares">
          {(a) => <input {...a} type="number" min="0" step="any" inputMode="decimal" value={shares}
                         onChange={(e) => setShares(e.target.value)} />}
        </Field>
        <Field label={`Average cost (${currency})`}>
          {(a) => <input {...a} type="number" min="0" step="any" inputMode="decimal" value={cost}
                         onChange={(e) => setCost(e.target.value)} />}
        </Field>
        <div className={styles.pickers}>
          <SelectMenu label="Currency" value={currency} onChange={setCurrency}
                      options={currencies.map((c) => ({ value: c, label: c }))} />
          <SelectMenu label="Theme" value={theme} onChange={pickTheme}
                      options={[{ value: AUTO, label: manual ? "Auto" : `Auto · ${holding.category || "Other"}` },
                        ...themes.map((t) => ({ value: t, label: t }))]} />
        </div>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
