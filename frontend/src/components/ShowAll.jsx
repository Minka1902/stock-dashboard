import styles from "./ShowAll.module.css";

/**
 * The foot of a list cut short on a phone (usePhoneLimit): "Show all N
 * <noun>", then "Show fewer".
 */
export default function ShowAll({ total, open, onToggle, noun }) {
  return (
    <div className={styles.foot}>
      <button type="button" className={styles.btn} aria-expanded={open} onClick={onToggle}>
        {open ? "Show fewer" : `Show all ${total} ${noun}`}
      </button>
    </div>
  );
}
