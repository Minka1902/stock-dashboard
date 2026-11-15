import { pause, swipe } from "./gestures.mjs";

// The touch explainer gate (STC-104): on a phone every explainer (InfoTip,
// Term, a status chip: any tooltip whose trigger is not itself a control)
// must open on a tap and close on a tap outside, and a scroll must neither
// open nor close it. For one trigger of each kind on the view: swipe from
// the trigger (must stay closed), tap it (must open), swipe elsewhere (must
// stay open), tap a spot that does nothing (must close). The in-page half is
// in probe.mjs.
const TAP_SETTLE_MS = 250;
const SWIPE = { steps: 6 };
const probe = (page, fn, arg) => page.evaluate(([f, a]) => window.__shotsProbe[f](a), [fn, arg]);

const fail = (trigger, reason) => ({
  gate: "explain", element: trigger.element, sample: trigger.sample, px: 0, reason,
});

async function tap(page, point) {
  await page.touchscreen.tap(point.x, point.y);
  await pause(TAP_SETTLE_MS);
}

// A tap during a fling only stops the fling (as on a phone), so every swipe
// waits for the page to stop moving.
async function swipeStill(page, cdp, move) {
  await swipe(cdp, { ...move, ...SWIPE });
  await page.evaluate(() => new Promise((done) => {
    const s = window.__shotsProbe.scroller();
    let last = -1;
    let calm = 0;
    let frames = 0;
    const tick = () => {
      calm = s.scrollTop === last ? calm + 1 : 0;
      last = s.scrollTop;
      if (calm >= 5 || ++frames > 120) done();
      else requestAnimationFrame(tick);
    };
    tick();
  }));
}

const isOpen = async (page, id) => (await probe(page, "tipState", id)).open;

async function check(page, cdp, trigger) {
  let at = await probe(page, "aim", trigger.i);
  if (at.missing) return null;
  if (at.covered) return fail(trigger, `covered by ${at.covered}, cannot be tapped`);
  await swipeStill(page, cdp, { from: at, to: { x: at.x, y: at.y - 80 } });
  if (await isOpen(page, trigger.id)) return fail(trigger, "opened by a scroll");
  at = await probe(page, "aim", trigger.i);
  if (!at.x) return fail(trigger, "lost after a scroll");
  await tap(page, at);
  const state = await probe(page, "tipState", trigger.id);
  if (!state.open) return fail(trigger, "did not open on a tap");
  const spot = await probe(page, "neutralPoint", trigger.id);
  if (!spot) return fail(trigger, "no spot outside it to tap");
  if (!state.sheet) {
    // Up, then down from the same point, so the page returns to where `spot`
    // was found inert.
    await swipeStill(page, cdp, { from: spot, to: { x: spot.x, y: spot.y - 60 } });
    await swipeStill(page, cdp, { from: spot, to: { x: spot.x, y: spot.y + 60 } });
    if (!(await isOpen(page, trigger.id))) return fail(trigger, "closed by a scroll");
  }
  // Only a spot inert as the page stands now: a stale one may have scrolled under a control.
  const outside = await probe(page, "neutralPoint", trigger.id);
  if (!outside) return fail(trigger, "no spot outside it to tap after a scroll");
  await tap(page, outside);
  if (await isOpen(page, trigger.id)) return fail(trigger, `did not close on a tap outside${state.sheet ? " the sheet" : ""}`);
  return null;
}

/** Explainer gate violations for the page as it stands; `tapped` counts the triggers tried. */
export async function checkExplainers(page) {
  const url = page.url();
  const triggers = await probe(page, "explainers");
  const cdp = await page.context().newCDPSession(page);
  const violations = [];
  try {
    for (const trigger of triggers) {
      const v = await check(page, cdp, trigger);
      if (v) violations.push(v);
      if (await isOpen(page, trigger.id)) await page.keyboard.press("Escape");
      if (page.url() !== url) {
        violations.push(fail(trigger, `navigated to ${new URL(page.url()).pathname}`));
        break;
      }
    }
  } finally {
    await cdp.detach().catch(() => {});
  }
  return { violations, tapped: triggers.length };
}
