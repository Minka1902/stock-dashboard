import { join } from "node:path";
import { runGestures } from "./gestures.mjs";
import { captureFullHeight, newContext, openPage, visit } from "./page.mjs";
import { errorViolations } from "./report.mjs";
import { fileStem } from "./views.mjs";

// Phone passes, one width at a time: the capture + gates pass and the touch
// swipe pass. Heights are the common devices at each width (Galaxy S-class,
// iPhone 14/15, iPhone Pro Max).
export const PHONE_HEIGHTS = { 360: 740, 390: 844, 430: 932 };
const MIN_HIT = 40;

async function phoneTargets(browser, run, width, motion) {
  const viewport = { width, height: PHONE_HEIGHTS[width] || 844 };
  const options = { viewport, mobile: true, fixture: run.fixture, motion };
  const authed = await openPage(await newContext(browser, { ...options, storageState: run.sessions.authed }));
  const anon = await openPage(await newContext(browser, options));
  return {
    viewport,
    pick: (view) => (view.anon ? anon : authed),
    close: () => Promise.all([authed.page.context().close(), anon.page.context().close()]),
  };
}

function failed(view, width, target, err) {
  return {
    view: view.id, width, sideways: [], screens: null, blank: true,
    errors: [...target.state.errors, `harness: ${err.message.split("\n")[0]}`],
    violations: [],
  };
}

async function shootView(target, run, view, width) {
  await visit(target, run.base, view, run.sessions.accounts);
  const audit = await target.page.evaluate((o) => window.__shotsProbe.audit(o), { minHit: MIN_HIT });
  const file = join(run.out, "phone", `${fileStem(view.id)}@${width}.png`);
  const capture = await captureFullHeight(target.page, file);
  return { view: view.id, width, ...audit, errors: [...target.state.errors], capture: { file, ...capture } };
}

/** Captures and gates every view at one width. */
export async function shootPhone(browser, run, width) {
  const targets = await phoneTargets(browser, run, width, run.motion);
  const results = [];
  for (const view of run.views) {
    const target = targets.pick(view);
    const result = await shootView(target, run, view, width).catch((err) => failed(view, width, target, err));
    result.violations.push(...errorViolations(result));
    results.push(result);
    run.log(`${width}  ${view.id}  ${result.screens ?? "-"} screens  ${result.violations.length} violations`);
  }
  await targets.close();
  return results;
}

async function swipeView(target, run, view, viewport) {
  await visit(target, run.base, view, run.sessions.accounts);
  await runGestures(target.page, viewport);
  const blank = await target.page.evaluate(() => {
    const root = document.getElementById("root");
    return !root || root.innerText.trim().length < 20;
  });
  return { view: view.id, width: viewport.width, blank, errors: [...target.state.errors] };
}

/** Touch swipes on every view at one width, with motion on and the clock running. */
export async function swipePhone(browser, run, width) {
  const targets = await phoneTargets(browser, run, width, true);
  const results = [];
  for (const view of run.views) {
    const target = targets.pick(view);
    const result = await swipeView(target, run, view, targets.viewport)
      .catch((err) => failed(view, width, target, err));
    result.ok = !result.blank && !result.errors.length;
    if (!result.ok) {
      result.capture = join(run.out, "gestures", `${fileStem(view.id)}@${width}.png`);
      await target.page.screenshot({ path: result.capture }).catch(() => {});
    }
    results.push(result);
    run.log(`${width}  ${view.id}  ${result.ok ? "ok" : `FAILED: ${result.errors[0] || "blank #root"}`}`);
  }
  await targets.close();
  return results;
}
