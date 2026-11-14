import { Component, createRef } from "react";
import Button from "./Button";
import { copyText } from "../lib/clipboard";
import styles from "./ErrorBoundary.module.css";

const COPIED_MS = 2500;
const COPY_STATUS = {
  copied: "Details copied.",
  selected: "No clipboard access here: the details are selected below, copy them by hand.",
};

function sameKeys(a = [], b = []) {
  return a.length === b.length && a.every((key, i) => Object.is(key, b[i]));
}

function errorMessage(error) {
  return error?.message || String(error) || "Unknown error";
}

function detailsText(label, error, componentStack) {
  return [
    `${label || "View"}: ${errorMessage(error)}`,
    `URL: ${window.location.href}`,
    `Time: ${new Date().toISOString()}`,
    "",
    error?.stack || "",
    componentStack ? `\nComponent stack:${componentStack}` : "",
  ].join("\n").trim();
}

/**
 * Keeps a render error inside the part of the page that threw it.
 *
 * React requires a class for this. Props:
 * - `label`: what failed ("Watchlist", "AAPL analysis"), shown and copied.
 * - `resetKeys`: when any key changes (e.g. the route), the error clears and
 *   the children render again.
 * - `fallback`: a node, or `({ error, reset }) => node`, instead of the
 *   default pane.
 * - `onError(error, info)`: called once per caught error.
 * - `compact`: a tighter pane for errors inside a section or dialog body.
 *
 * The error is logged once with the component stack, never swallowed.
 */
export default class ErrorBoundary extends Component {
  state = { error: null, componentStack: "", copy: null };

  stackRef = createRef();

  copyTimer = null;

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error(`${this.props.label || "A view"} hit a render error:`, error, info.componentStack);
    this.setState({ componentStack: info.componentStack || "" });
    this.props.onError?.(error, info);
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && !sameKeys(prevProps.resetKeys, this.props.resetKeys)) this.reset();
  }

  componentWillUnmount() {
    clearTimeout(this.copyTimer);
  }

  reset = () => {
    clearTimeout(this.copyTimer);
    this.setState({ error: null, componentStack: "", copy: null });
  };

  copyDetails = async () => {
    const { error, componentStack } = this.state;
    clearTimeout(this.copyTimer);
    if (await copyText(detailsText(this.props.label, error, componentStack))) {
      this.setState({ copy: "copied" });
      this.copyTimer = setTimeout(() => this.setState({ copy: null }), COPIED_MS);
      return;
    }
    const details = this.stackRef.current;
    if (details) {
      details.open = true;
      window.getSelection()?.selectAllChildren(details.querySelector("pre"));
    }
    this.setState({ copy: "selected" });
  };

  render() {
    const { error, componentStack, copy } = this.state;
    const { children, fallback, label, compact = false } = this.props;
    if (!error) return children;
    if (fallback !== undefined) {
      return typeof fallback === "function" ? fallback({ error, reset: this.reset }) : fallback;
    }
    const size = compact ? "sm" : "md";
    return (
      <section className={styles.pane} data-compact={compact ? "yes" : "no"} role="alert">
        <header className={styles.head}>
          <span className="caption">This view hit an error</span>
          {label && <span className={styles.label}>{label}</span>}
        </header>
        <p className={styles.message}>{errorMessage(error)}</p>
        <details ref={this.stackRef} className={styles.stack}>
          <summary>Stack trace</summary>
          <pre>{detailsText(label, error, componentStack)}</pre>
        </details>
        <div className={styles.actions}>
          <Button variant="primary" size={size} onClick={this.reset}>Try again</Button>
          <Button size={size} onClick={this.copyDetails}>Copy details</Button>
          <Button variant="quiet" size={size} onClick={() => window.location.reload()}>Reload</Button>
          <span className={styles.status} role="status">{copy ? COPY_STATUS[copy] : ""}</span>
        </div>
      </section>
    );
  }
}
