import { useState } from "react";
import { PHONE, useMediaQuery } from "./useMediaQuery";

/**
 * A long list cut to its first `max` rows on a phone, until the user asks
 * for the rest. `limit` is the row count to show (undefined: all of them);
 * `showAll` is the props for ShowAll, or null when nothing is cut (wider
 * than a phone, or a list no longer than `max`).
 */
export function usePhoneLimit(total, max) {
  const phone = useMediaQuery(PHONE);
  const [open, setOpen] = useState(false);
  const cuts = phone && total > max;
  return {
    limit: cuts && !open ? max : undefined,
    showAll: cuts ? { total, open, onToggle: () => setOpen((o) => !o) } : null,
  };
}
