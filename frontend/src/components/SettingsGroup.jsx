import Clamp from "./Clamp";
import PhoneFold from "./PhoneFold";
import { useCollapsedSections } from "../hooks/useCollapsedSections";
import { PHONE, useMediaQuery } from "../hooks/useMediaQuery";
import styles from "./SettingsGroup.module.css";

// Where the Settings page keeps which of its groups are folded.
export const SETTINGS_SECTIONS = "settings:";

/**
 * One group of the Settings page: a ruled fieldset under its `legend` on a
 * desktop, a folded section on a phone, named by `caption` (default the
 * legend) and anchored at `id` for the page's SectionIndex. `hint` is the
 * group's explainer, cut to two lines on a phone.
 */
export default function SettingsGroup({ id, legend, caption = legend, hint, children }) {
  const phone = useMediaQuery(PHONE);
  const sections = useCollapsedSections(SETTINGS_SECTIONS);
  return (
    <PhoneFold
      id={id}
      caption={caption}
      sections={sections}
      frame={(body) => (
        <fieldset className={styles.group} data-card>
          <legend className={styles.legend}>{legend}</legend>
          {body}
        </fieldset>
      )}
    >
      {hint && <p className={styles.groupHint}><Clamp active={phone} label={caption}>{hint}</Clamp></p>}
      {children}
    </PhoneFold>
  );
}
