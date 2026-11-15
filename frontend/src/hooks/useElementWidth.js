import { useCallback, useEffect, useState } from "react";

/**
 * `[ref, width]`: attach `ref` to an element and get its content width,
 * kept current by a ResizeObserver (null until measured).
 */
export function useElementWidth() {
  const [node, setNode] = useState(null);
  const [width, setWidth] = useState(null);
  const ref = useCallback((el) => setNode(el), []);

  useEffect(() => {
    if (!node) return undefined;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);

  return [ref, width];
}
