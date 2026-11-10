import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";

const BROWSER_HINT = `To use a Chromium you already have, set PLAYWRIGHT_CHROMIUM_PATH to its
executable; otherwise download Playwright's own with:

  npx playwright install chromium`;
const INSTALL_HINT = `Playwright is not installed, and it is deliberately not a dependency of this
project (no lockfile change). Install it globally, then run again:

  npm install -g playwright

${BROWSER_HINT}`;

function globalRoot() {
  try {
    return execFileSync("npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32" }).trim();
  } catch {
    return null;
  }
}

function tryRequire(fromFile) {
  try {
    return createRequire(fromFile)("playwright");
  } catch (err) {
    if (err.code === "MODULE_NOT_FOUND") return null;
    throw err;
  }
}

/**
 * `playwright` from the local install or NODE_PATH, else the global npm root.
 * Exits with an install hint when none has it.
 */
export function loadPlaywright() {
  const local = tryRequire(import.meta.url);
  if (local) return local;
  const root = globalRoot();
  const global = root && tryRequire(join(root, "noop.js"));
  if (global) return global;
  console.error(INSTALL_HINT);
  process.exit(2);
}

export function launchChromium(pw) {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  return pw.chromium.launch({ executablePath }).catch((err) => {
    console.error(`Could not start Chromium: ${err.message.split("\n")[0]}\n\n${BROWSER_HINT}`);
    process.exit(2);
  });
}
