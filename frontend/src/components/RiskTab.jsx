import DrawdownSwitch from "./DrawdownSwitch";
import ExitRulesTable from "./ExitRulesTable";
import MutedSignals from "./MutedSignals";
import RegimeCard from "./RegimeCard";

/**
 * The Risk tab of the Trading Bot page: the switches that pause or downgrade
 * new entries (kill switch, market regime), the exit rules on your holdings,
 * and which signals currently count.
 */
export default function RiskTab() {
  return (
    <div>
      <DrawdownSwitch />
      <RegimeCard />
      <ExitRulesTable account="manual" title="Exit rules · Portfolio" />
      <MutedSignals />
    </div>
  );
}
