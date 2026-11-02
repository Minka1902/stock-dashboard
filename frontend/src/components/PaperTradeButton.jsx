import { useState } from "react";
import OrderTicket from "./OrderTicket";
import Tooltip from "./Tooltip";

/**
 * A "Paper trade" trigger that opens the order ticket in place, for any page
 * that shows a ticker (a suggestion, the stock page). Props: ticker, side
 * ("BUY"), suggestionForDate, className (style the trigger like its
 * neighbours), label ("Paper trade"), onPlaced.
 */
export default function PaperTradeButton({ ticker, side = "BUY", suggestionForDate = null,
  className, label = "Paper trade", onPlaced }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip content={`Simulated ${side === "BUY" ? "buy" : "sell"} of ${ticker} in your paper account — no real order`}>
        <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      </Tooltip>
      {open && (
        <OrderTicket ticker={ticker} side={side} suggestionForDate={suggestionForDate}
                     onPlaced={onPlaced} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
