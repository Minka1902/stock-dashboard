import { useEffect, useState } from "react";
import ScrollHint from "./ScrollHint";
import { PHONE, useMediaQuery } from "../hooks/useMediaQuery";
import { findSection, scrollToSection } from "../lib/sections";
import styles from "./SectionIndex.module.css";

/**
 * A phone's table of contents for a page of CollapsibleSections: a sticky
 * row of chips, one per section, that scrolls sideways. A chip opens its
 * section (`onJump(id)`) and scrolls to it; the chip of the section at the
 * top of the screen is marked current. Renders nothing above 640px.
 * Props: sections [{ id, label }] (each CollapsibleSection has `anchor={id}`,
 * or the section is the element with that id), onJump(id), label.
 */
export default function SectionIndex({ sections, onJump, label = "Sections on this page" }) {
  const phone = useMediaQuery(PHONE);
  const [current, setCurrent] = useState(null);
  const ids = sections.map((s) => s.id).join(" ");

  useEffect(() => {
    if (!phone) return undefined;
    const els = ids.split(" ").map(findSection).filter(Boolean);
    const observer = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setCurrent(els.indexOf(top.target));
    }, { rootMargin: "-15% 0px -70% 0px" });
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [phone, ids]);

  if (!phone || sections.length < 2) return null;

  const jump = (id) => {
    onJump(id);
    requestAnimationFrame(() => scrollToSection(id));
  };

  return (
    <nav className={styles.index} aria-label={label}>
      <ScrollHint className={styles.scroller}>
        <ul className={styles.chips}>
          {sections.map((s, i) => (
            <li key={s.id}>
              <button type="button" className={styles.chip} aria-current={i === current ? "location" : undefined}
                      onClick={() => jump(s.id)}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      </ScrollHint>
    </nav>
  );
}
