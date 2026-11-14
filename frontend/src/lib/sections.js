import { prefersReducedMotion } from "./motionConfig";

/** A page section by its SectionIndex anchor (data-anchor), else by its id. */
export const findSection = (id) =>
  document.querySelector(`[data-anchor="${CSS.escape(id)}"]`) || document.getElementById(id);

/** Scroll a page section to the top of the screen (instantly under reduced motion). */
export function scrollToSection(id) {
  findSection(id)?.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
}
