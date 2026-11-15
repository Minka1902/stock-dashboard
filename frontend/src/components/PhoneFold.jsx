import CollapsibleSection from "./CollapsibleSection";
import { PHONE, useMediaQuery } from "../hooks/useMediaQuery";

/**
 * One section of a long page that folds on a phone: there a
 * CollapsibleSection with the `caption` (and `right`) as its header,
 * anchored at `id` for the page's SectionIndex and folded or open as
 * `sections` (useCollapsedSections) says. Wider than a phone it is the
 * page's own section, `frame(children)` (just the children without one),
 * so the desktop layout is untouched. `bodyClassName` styles the phone
 * section's body.
 */
export default function PhoneFold({ id, caption, right, sections, frame, bodyClassName, children }) {
  const phone = useMediaQuery(PHONE);
  if (!phone) return frame ? frame(children) : children;
  const collapsed = sections.isCollapsed(id);
  return (
    <CollapsibleSection anchor={id} caption={caption} right={right} collapsed={collapsed}
                        bodyClassName={bodyClassName} onToggle={() => sections.setCollapsed([id], !collapsed)}>
      {children}
    </CollapsibleSection>
  );
}
