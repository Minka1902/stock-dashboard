import GLOSSARY from "../lib/glossary";
import InfoTip from "./InfoTip";
import { PHONE, useMediaQuery } from "../hooks/useMediaQuery";

/**
 * A panel title's info control. Wider than a phone it is the glossary `term`'s
 * InfoTip (nothing without one), beside a blurb the panel shows under its
 * title. On a phone the panel hides that blurb (its `.subtitle`), so the
 * control carries it, followed by the term's definition. It brings its own
 * leading space on a phone; a title that had a glossary tip keeps the space
 * it already wrote before it (`Title <PanelInfo term … />`).
 */
export default function PanelInfo({ label, blurb, term }) {
  const phone = useMediaQuery(PHONE);
  if (!phone) return term ? <InfoTip term={term} /> : null;
  const short = [blurb, GLOSSARY[term]?.short].filter(Boolean).join(" ");
  return <>{" "}<InfoTip tip={{ label, short }} size={14} side="bottom" /></>;
}
