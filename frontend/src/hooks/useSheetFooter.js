import { createContext, useContext } from "react";

/**
 * The footer element of the form sheet around a component (a Dialog with
 * `form`, on a phone), or null anywhere else. SheetActions portals a form's
 * buttons into it, so the primary action is pinned at the sheet's bottom.
 */
export const SheetFooterContext = createContext(null);

export function useSheetFooter() {
  return useContext(SheetFooterContext);
}
