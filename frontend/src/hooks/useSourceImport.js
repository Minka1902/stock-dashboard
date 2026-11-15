import { useRef, useState } from "react";
import { importSourceFile } from "../api";

/**
 * Manual import of a provider's file for a source (SourceImport, and the
 * Server page's row menu on a phone). `pick(source)` opens the file picker
 * of the hidden input spread from `inputProps`; the chosen file is uploaded
 * for that source. Returns `{ inputProps, pick, source, busy, result,
 * error }`, the last four about the latest import.
 */
export function useSourceImport(onImported) {
  const inputRef = useRef(null);
  const target = useRef(null);
  const [state, setState] = useState({ source: null, busy: false, result: null, error: null });

  const upload = async (e) => {
    const file = e.target.files?.[0];
    const source = target.current;
    e.target.value = ""; // so choosing the same file again still fires change
    if (!file || !source) return;
    setState({ source, busy: true, result: null, error: null });
    try {
      const r = await importSourceFile(source, file);
      setState({
        source, busy: false, error: null,
        result: r.queued ? "Read — stored as soon as the refresh thread is free" : r.status,
      });
      onImported?.();
    } catch (err) {
      setState({ source, busy: false, result: null, error: err.fields?.file || err.message });
    }
  };

  const pick = (source) => {
    target.current = source;
    inputRef.current?.click();
  };

  return { inputProps: { ref: inputRef, type: "file", hidden: true, onChange: upload }, pick, ...state };
}
