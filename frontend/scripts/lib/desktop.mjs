import { join } from "node:path";
import { captureFullHeight, newContext, openPage, visit } from "./page.mjs";
import { fileStem } from "./views.mjs";

// The desktop record: every visible text node's computed font size and box at
// 1440×900, per view. Always reduced motion and the pinned clock, so nothing
// is measured mid-transition and relative times read the same on every run.
export const DESKTOP_VIEWPORT = { width: 1440, height: 900 };

export async function recordDesktop(browser, run) {
  const options = { viewport: DESKTOP_VIEWPORT, mobile: false, fixture: run.fixture, motion: false };
  const authed = await openPage(await newContext(browser, { ...options, storageState: run.sessions.authed }));
  const anon = await openPage(await newContext(browser, options));
  const views = {};
  const errors = {};
  for (const view of run.views) {
    const target = view.anon ? anon : authed;
    try {
      await visit(target, run.base, view, run.sessions.accounts);
      views[view.id] = await target.page.evaluate(() => window.__shotsProbe.textNodes());
      await captureFullHeight(target.page, join(run.out, "desktop", `${fileStem(view.id)}.png`));
    } catch (err) {
      target.state.errors.push(`harness: ${err.message.split("\n")[0]}`);
    }
    if (target.state.errors.length) errors[view.id] = [...target.state.errors];
    run.log(`1440  ${view.id}  ${views[view.id]?.length ?? 0} text nodes`);
  }
  await Promise.all([authed.page.context().close(), anon.page.context().close()]);
  return { views, errors };
}
