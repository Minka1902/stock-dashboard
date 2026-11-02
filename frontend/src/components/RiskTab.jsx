import DrawdownSwitch from "./DrawdownSwitch";
import ExitRulesTable from "./ExitRulesTable";

/**
 * The Risk tab of the Trading Bot page: the switches that pause new entries
 * and the exit rules on your holdings.
 */
export default function RiskTab() {
  return (
    <div>
      <DrawdownSwitch />
      <ExitRulesTable account="manual" title="Exit rules · Portfolio" />
    </div>
  );
}
