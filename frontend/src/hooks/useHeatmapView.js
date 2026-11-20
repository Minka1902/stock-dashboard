import { useCallback } from "react";
import { useSettingsContext } from "./useSettingsContext";

const TABLE = "table";

/**
 * Table or heatmap, and what the heatmap is coloured by, for one page,
 * remembered in settings (`heatmapViews[page]`). `metrics` are the page's
 * colour options; an unknown saved one falls back to the first.
 */
export function useHeatmapView(page, metrics) {
  const { settings, setSetting } = useSettingsContext();
  const saved = settings.heatmapViews?.[page] || {};
  const view = saved.view === "heatmap" ? "heatmap" : TABLE;
  const metric = metrics.some((m) => m.value === saved.metric) ? saved.metric : metrics[0].value;

  const save = useCallback((patch) => {
    setSetting("heatmapViews", { ...settings.heatmapViews, [page]: { view, metric, ...patch } });
  }, [setSetting, settings.heatmapViews, page, view, metric]);

  return {
    view,
    metric,
    setView: useCallback((next) => save({ view: next }), [save]),
    setMetric: useCallback((next) => save({ metric: next }), [save]),
  };
}
