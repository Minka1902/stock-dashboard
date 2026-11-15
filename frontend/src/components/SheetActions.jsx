import { createPortal } from "react-dom";
import { useSheetFooter } from "../hooks/useSheetFooter";

/**
 * A form's action buttons. Inside a form sheet on a phone (Dialog `form`)
 * they move to the sheet's footer, pinned above the safe area; anywhere
 * else they render in place, in a `<div className>` when one is given and
 * bare otherwise, so a desktop layout keeps its own markup. A submit button
 * moved to the footer leaves its <form>, so it names it with `form={id}`.
 */
export default function SheetActions({ className, children }) {
  const footer = useSheetFooter();
  if (footer) return createPortal(children, footer);
  return className ? <div className={className}>{children}</div> : children;
}
