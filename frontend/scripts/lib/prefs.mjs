import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Display variants: the theme and the reading settings a run starts with,
// stored in localStorage exactly where useTheme ("theme") and useSettings
// ("settings", merged over its defaults) read them. The valid values are
// read from those hooks, so a new theme or text size is covered without
// touching the harness.
const THEME_SOURCE = fileURLToPath(new URL("../../src/hooks/useTheme.js", import.meta.url));
const SETTINGS_SOURCE = fileURLToPath(new URL("../../src/hooks/useSettings.js", import.meta.url));

function valuesOf(path, list, field) {
  const block = new RegExp(`export const ${list} = \\[([\\s\\S]*?)\\n\\];`).exec(readFileSync(path, "utf8"));
  const values = block ? [...block[1].matchAll(new RegExp(`${field}: "([\\w-]+)"`, "g"))].map((m) => m[1]) : [];
  if (!values.length) throw new Error(`could not read ${list} from ${path}`);
  return values;
}

export const THEME_KEYS = valuesOf(THEME_SOURCE, "THEMES", "key");
export const TEXT_SCALE_VALUES = valuesOf(SETTINGS_SOURCE, "TEXT_SCALES", "value");

/** The variant named by the options: its label ("" = defaults) and its localStorage entries, or a misuse message. */
export function displayVariant({ theme, dyslexia, "reduced-motion": reducedMotion, "text-scale": textScale }) {
  if (theme && !THEME_KEYS.includes(theme)) return { misuse: `unknown theme ${theme}; known: ${THEME_KEYS.join(", ")}` };
  if (textScale && !TEXT_SCALE_VALUES.includes(textScale)) {
    return { misuse: `unknown text scale ${textScale}; known: ${TEXT_SCALE_VALUES.join(", ")}` };
  }
  const settings = {
    ...(dyslexia && { dyslexia: true }),
    ...(reducedMotion && { reducedMotion: true }),
    ...(textScale && { textScale }),
  };
  const storage = [
    ...(theme ? [{ name: "theme", value: theme }] : []),
    ...(Object.keys(settings).length ? [{ name: "settings", value: JSON.stringify(settings) }] : []),
  ];
  const label = [theme, dyslexia && "dyslexia", reducedMotion && "reduced-motion", textScale && `text-${textScale}`]
    .filter(Boolean).join("+");
  return { label, storage };
}

/** A Playwright storage state that also holds the variant's localStorage on the app's origin. */
export function withVariant(state, base, variant) {
  if (!variant.storage.length) return state;
  const origin = new URL(base).origin;
  const others = (state?.origins || []).filter((o) => o.origin !== origin);
  return { cookies: state?.cookies || [], origins: [...others, { origin, localStorage: variant.storage }] };
}
