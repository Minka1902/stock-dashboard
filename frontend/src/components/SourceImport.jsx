import { useRef, useState } from "react";
import { importSourceFile } from "../api";
import { SOURCE_META } from "../lib/sources";
import Button from "./Button";
import Field from "./Field";
import styles from "./SourceImport.module.css";

/**
 * Manual import for a source whose provider refuses automated fetches: the
 * admin downloads the file from the provider's page and hands it over here.
 * It sits inside a clickable table row, so clicks stop at its root.
 */
export default function SourceImport({ source, onImported }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const meta = SOURCE_META[source];

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still fires change
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await importSourceFile(source, file);
      setResult(r.queued ? "Read — stored as soon as the refresh thread is free" : r.status);
      onImported?.();
    } catch (err) {
      setError(err.fields?.file || err.message);
    } finally {
      setBusy(false);
    }
  };

  // The label belongs to the (hidden) file input, so the button keeps its own
  // visible text as its accessible name.
  return (
    <div className={styles.wrap} onClick={(e) => e.stopPropagation()}>
      <Field
        inline
        className={styles.field}
        label="Manual import"
        hint={result}
        error={error}
        suffix={meta?.url && (
          <a className={styles.link} href={meta.url} target="_blank" rel="noreferrer">
            {meta.provider} page ↗
          </a>
        )}
      >
        {({ id, "aria-describedby": describedBy }) => (
          <>
            <input ref={input} id={id} type="file" hidden onChange={upload} />
            <Button size="sm" disabled={busy} aria-describedby={describedBy}
                    onClick={() => input.current?.click()}>
              {busy ? "Importing…" : "Import file"}
            </Button>
          </>
        )}
      </Field>
    </div>
  );
}
