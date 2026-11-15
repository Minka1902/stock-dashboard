import { SOURCE_META } from "../lib/sources";
import { useSourceImport } from "../hooks/useSourceImport";
import Button from "./Button";
import Field from "./Field";
import styles from "./SourceImport.module.css";

/**
 * Manual import for a source whose provider refuses automated fetches: the
 * admin downloads the file from the provider's page and hands it over here.
 * It sits inside a clickable table row, so clicks stop at its root.
 */
export default function SourceImport({ source, onImported }) {
  const { inputProps, pick, busy, result, error } = useSourceImport(onImported);
  const meta = SOURCE_META[source];

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
            <input id={id} {...inputProps} />
            <Button size="sm" disabled={busy} aria-describedby={describedBy} onClick={() => pick(source)}>
              {busy ? "Importing…" : "Import file"}
            </Button>
          </>
        )}
      </Field>
    </div>
  );
}
