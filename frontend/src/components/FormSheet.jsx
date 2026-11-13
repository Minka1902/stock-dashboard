import Dialog from "./Dialog";

/**
 * A form that sits in its page on a desktop and opens as a full-height sheet
 * on a phone. `sheet` picks the sheet (the caller passes its phone flag);
 * the rest are Dialog's props (`open`, `title`, `caption`, `tone`,
 * `onClose`). Its actions go in SheetActions, which pins them to the sheet's
 * footer and leaves them in place on the page.
 */
export default function FormSheet({ sheet, children, ...dialog }) {
  if (!sheet) return children;
  return <Dialog form size="md" {...dialog}>{children}</Dialog>;
}
