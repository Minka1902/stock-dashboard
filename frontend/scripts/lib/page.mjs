import { installProbe } from "./probe.mjs";

// Driving one page: open a context, visit a view, wait until it has settled,
// capture it at full height.
const QUIET_MS = 500;
const SETTLE_TIMEOUT_MS = 20000;
const SKELETON_TIMEOUT_MS = 5000;
const MAX_CAPTURE_HEIGHT = 8000;
const TRACKED = /^\/api\/(?!stream)/;
const SKELETON = '[class*="_skeleton_"]';

const tracked = (request) => TRACKED.test(new URL(request.url()).pathname);

/**
 * A browser context for one width. With reduced motion (the default) every
 * transition is instant, so nothing is captured mid-animation, and the clock
 * is pinned to the fixture's recording time so "updated 5m ago" reads the same
 * on every run. With motion the clock runs: the count-up animations time
 * themselves with Date.now and would never finish on a frozen one.
 */
export async function newContext(browser, { viewport, mobile, storageState, fixture, motion }) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    storageState,
    locale: "en-US",
    timezoneId: "America/New_York",
    reducedMotion: motion ? "no-preference" : "reduce",
  });
  await context.addInitScript(installProbe);
  if (fixture) {
    await fixture.attach(context);
    if (!motion) await context.clock.setFixedTime(new Date(fixture.recordedAt));
  }
  return context;
}

export async function openPage(context) {
  const page = await context.newPage();
  const state = { inflight: 0, lastChange: Date.now(), errors: [] };
  const change = (delta) => (request) => {
    if (!tracked(request)) return;
    state.inflight += delta;
    state.lastChange = Date.now();
  };
  page.on("request", change(1));
  page.on("requestfinished", change(-1));
  page.on("requestfailed", change(-1));
  page.on("pageerror", (err) => state.errors.push(String(err.message || err).split("\n")[0]));
  return { page, state };
}

async function quiet({ page, state }) {
  const deadline = Date.now() + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline && (state.inflight > 0 || Date.now() - state.lastChange < QUIET_MS)) {
    await page.waitForTimeout(100);
  }
}

/** Network quiet, fonts loaded, skeletons gone, two frames painted. */
export async function settle(target) {
  const { page } = target;
  await quiet(target);
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.waitForFunction((sel) => !document.querySelector(sel), SKELETON, { timeout: SKELETON_TIMEOUT_MS })
    .catch(() => {});
  await quiet(target);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
}

export async function visit(target, base, view, accounts) {
  const { page, state } = target;
  if (view.anon) await page.context().clearCookies();
  state.errors.length = 0;
  await page.goto(new URL(view.path, base).href, { waitUntil: "domcontentloaded" });
  await settle(target);
  if (view.tab) {
    await page.getByRole("tab", { name: view.tab }).click();
    await settle(target);
  }
  if (view.signIn) {
    const { email, password } = accounts[view.signIn];
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Continue" }).click();
    // A refused sign-in (rate limit, unknown account) keeps the form up with
    // its error; that is captured as-is rather than failing the run.
    await page.getByLabel("Email").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
    await settle(target);
  }
}

/**
 * Full-height capture without a scrolling document: grow the viewport by
 * whatever the page scroller still hides, until nothing is hidden (content
 * sized in viewport units can grow with it, hence the loop and the cap).
 */
export async function captureFullHeight(page, path) {
  const viewport = page.viewportSize();
  let height = viewport.height;
  for (let i = 0; i < 4 && height < MAX_CAPTURE_HEIGHT; i++) {
    const hidden = await page.evaluate(() => {
      const s = window.__shotsProbe.scroller();
      return s.scrollHeight - s.clientHeight;
    });
    if (hidden <= 1) break;
    height = Math.min(height + hidden, MAX_CAPTURE_HEIGHT);
    await page.setViewportSize({ width: viewport.width, height });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  }
  await page.screenshot({ path, animations: "disabled", caret: "hide" });
  await page.setViewportSize(viewport);
  return { height, truncated: height >= MAX_CAPTURE_HEIGHT };
}
