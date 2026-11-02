import Button from "./Button";
import Icon from "./Icon";
import { useRiskStatus } from "../hooks/useRiskStatus";
import { navigateTo } from "../lib/nav";
import styles from "./RiskBanner.module.css";

/**
 * App-wide, persistent notice while a risk switch has paused new entries,
 * with the way to review it (the Trading Bot page's Risk tab). Renders
 * nothing while nothing is paused.
 */
export default function RiskBanner() {
  const { data } = useRiskStatus();

  if (!data?.halted) return null;

  return (
    <div className={styles.banner} role="status">
      <Icon name="shield" size={16} />
      <p className={styles.text}>
        <strong>New entries paused.</strong> {data.reasons.join(" · ")}. Sells and exits keep running.
      </p>
      <Button size="sm" variant="primary"
              onClick={() => navigateTo({ kind: "view", view: "trading-bot", tab: "risk" })}>
        Review
      </Button>
    </div>
  );
}
