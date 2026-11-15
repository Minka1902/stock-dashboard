import { useEffect, useState } from "react";
import Button from "./Button";
import { copyText } from "../lib/clipboard";
import styles from "./CopyButton.module.css";

const COPIED_MS = 2000;

/**
 * Copies `text`. Where the page may not write to the clipboard, it selects
 * the `target` element (a ref to where the text is shown) instead and says
 * so, so the device's own Copy still works.
 */
export default function CopyButton({ text, target, label = "Copy" }) {
  const [state, setState] = useState(null);

  useEffect(() => {
    if (state !== "copied") return undefined;
    const id = setTimeout(() => setState(null), COPIED_MS);
    return () => clearTimeout(id);
  }, [state]);

  const copy = async () => {
    if (await copyText(text)) {
      setState("copied");
      return;
    }
    if (target?.current) window.getSelection()?.selectAllChildren(target.current);
    setState("selected");
  };

  return (
    <span className={styles.wrap}>
      <Button size="sm" onClick={copy}>{state === "copied" ? "Copied" : label}</Button>
      <span className={styles.status} role="status">
        {state === "selected" ? "No clipboard access here: it is selected, copy it from your device's menu." : ""}
      </span>
    </span>
  );
}
