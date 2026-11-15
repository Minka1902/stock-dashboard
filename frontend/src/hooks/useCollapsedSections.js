import { PHONE, useMediaQuery } from "./useMediaQuery";
import { useSettingsContext } from "./useSettingsContext";

/**
 * Which of a page's CollapsibleSections are folded, kept in
 * settings[`settingKey`] (default collapsedSections) under `<prefix><id>`. A
 * section the user never toggled starts open on a desktop and folded on a
 * phone (where SectionIndex jumps between them), except the ids in
 * `openOnPhone`; once toggled, the user's choice is stored (true or false)
 * and wins on every screen.
 */
export function useCollapsedSections(prefix, openOnPhone = [], settingKey = "collapsedSections") {
  const { settings, setSetting } = useSettingsContext();
  const phone = useMediaQuery(PHONE);
  const stored = settings[settingKey] || {};
  const key = (id) => `${prefix}${id}`;

  const isCollapsed = (id) => (key(id) in stored ? Boolean(stored[key(id)]) : phone && !openOnPhone.includes(id));
  const setCollapsed = (ids, value) => {
    const next = { ...stored };
    for (const id of ids) next[key(id)] = value;
    setSetting(settingKey, next);
  };
  return { isCollapsed, setCollapsed };
}
