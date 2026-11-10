#!/usr/bin/env node
/**
 * Phone screenshot and regression harness (STC-96), plus the desktop
 * "unchanged" baseline.
 *
 * Needs the app on a running backend: `npm run build`, then uvicorn on
 * 127.0.0.1:8000 (any database; a fresh one makes the harness account the
 * admin, so the Server page is covered too). The harness registers a
 * throwaway account (TOTP enrolled with RFC 6238, marked onboarded so no
 * tour), seeds watchlists, holdings and cash, and remembers the account in
 * .mobile-shots/account.json for the next run.
 *
 *   npm run shots:mobile                     captures + gates at 360/390/430
 *   npm run shots:mobile -- --gestures       touch swipes on every view (STC-107)
 *   npm run shots:mobile -- --baseline-known record today's violations as known
 *   npm run shots:desktop                    record text geometry at 1440x900
 *   npm run shots:desktop -- --check         diff against desktop-baseline.json
 *   npm run shots:desktop -- --update        rewrite desktop-baseline.json
 *
 * Determinism: every GET under /api (sign-in steps aside) is answered from
 * .mobile-shots/api-fixture.json (recorded from the backend on the first run,
 * and for any request it lacks), the page clock is pinned to the recording
 * time, motion is reduced, and the live-quote tape is left out of the desktop
 * record. Two runs, or two phases of the redesign, therefore see the same
 * prices, headlines, account and "updated 5m ago" text, even on another
 * database: what differs is the code. `--record` re-records the fixture,
 * `--live` bypasses it.
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { openSessions } from "./lib/account.mjs";
import { loadAllowlist, staleEntries, writeKnownBaseline } from "./lib/allowlist.mjs";
import { DESKTOP_VIEWPORT, recordDesktop } from "./lib/desktop.mjs";
import { readJson, writeJson, writeRows } from "./lib/files.mjs";
import { openFixture } from "./lib/fixture.mjs";
import { PHONE_HEIGHTS, shootPhone, swipePhone } from "./lib/phone.mjs";
import { launchChromium, loadPlaywright } from "./lib/playwright.mjs";
import { countSummary, flatten, printSummary, worstOffenders } from "./lib/report.mjs";
import { seed } from "./lib/seed.mjs";
import { diffBaseline } from "./lib/textDiff.mjs";
import { allViews } from "./lib/views.mjs";

const OUT = fileURLToPath(new URL("../.mobile-shots/", import.meta.url));
const ALLOWLIST = fileURLToPath(new URL("./mobile-shots.allow.json", import.meta.url));
const DESKTOP_BASELINE = fileURLToPath(new URL("./desktop-baseline.json", import.meta.url));
const PHONE_WIDTHS = Object.keys(PHONE_HEIGHTS).map(Number);
const OPTIONS = {
  desktop: { type: "boolean" },
  check: { type: "boolean" },
  update: { type: "boolean" },
  gestures: { type: "boolean" },
  "baseline-known": { type: "boolean" },
  record: { type: "boolean" },
  live: { type: "boolean" },
  motion: { type: "boolean" },
  "seed-only": { type: "boolean" },
  widths: { type: "string" },
  views: { type: "string" },
  base: { type: "string", default: "http://127.0.0.1:8000" },
  help: { type: "boolean", short: "h" },
};
const USAGE = `usage: node scripts/mobile-shots.mjs [options]

  --desktop          text-node geometry at 1440x900 (shots:desktop)
    --check          diff against scripts/desktop-baseline.json, exit 1 on any difference
    --update         rewrite scripts/desktop-baseline.json
  --gestures         touch swipes on every view instead of captures, exit 1 on a page error
  --baseline-known   write the current violations into scripts/mobile-shots.allow.json
  --widths 360,390   phone widths (default ${PHONE_WIDTHS.join(",")})
  --views a,b        only views whose id starts with one of these (e.g. watchlist,trading-bot)
  --base URL         backend origin (default http://127.0.0.1:8000)
  --record           re-record the API fixture from the backend
  --live             no fixture and a running clock: whatever the backend says now
  --motion           full motion (default: reduced, so nothing is captured mid-transition)
  --seed-only        create and seed the harness account, then exit

Output: frontend/.mobile-shots/ (gitignored): phone/, desktop/, gestures/,
report.json, gestures.json, desktop-current.json, desktop-diff.json.
Exit codes: 0 clean, 1 new violations / differences / gesture failures, 2 setup problem.`;

function parseOptions() {
  const { values } = parseArgs({ options: OPTIONS });
  const misuse = [
    (values.check || values.update) && !values.desktop && "--check/--update need --desktop",
    values.desktop && (values.gestures || values["baseline-known"]) && "--gestures/--baseline-known are phone options",
    values.check && values.update && "--check and --update are exclusive",
    values.live && values.record && "--live and --record are exclusive",
  ].find(Boolean);
  if (values.help || misuse) {
    console[misuse ? "error" : "log"](`${misuse ? `${misuse}\n\n` : ""}${USAGE}`);
    process.exit(misuse ? 2 : 0);
  }
  const widths = values.widths ? values.widths.split(",").map(Number) : PHONE_WIDTHS;
  const unknown = widths.filter((w) => !PHONE_HEIGHTS[w]);
  if (unknown.length) {
    console.error(`unknown width ${unknown.join(", ")}; known: ${PHONE_WIDTHS.join(", ")}`);
    process.exit(2);
  }
  return { ...values, widths };
}

function selectViews(filter) {
  const views = allViews();
  if (!filter) return views;
  const prefixes = filter.split(",").map((s) => s.trim()).filter(Boolean);
  const picked = views.filter((v) => prefixes.some((p) => v.id.startsWith(p)));
  if (!picked.length) {
    console.error(`no view matches ${filter}; views: ${views.map((v) => v.id).join(" ")}`);
    process.exit(2);
  }
  return picked;
}

async function preflight(base) {
  const hint = `Start it from backend/ (on a scratch database), e.g.
  STOCKS_DB_PATH=/tmp/shots.db STOCKS_SCHEDULER_STARTUP_DELAY_SECONDS=3600 python -m uvicorn app.main:app --port 8000`;
  const health = await fetch(new URL("/api/health", base)).catch(() => null);
  if (!health?.ok) {
    console.error(`No backend at ${base}. ${hint}`);
    process.exit(2);
  }
  const html = await (await fetch(base)).text();
  if (!html.includes('id="root"')) {
    console.error(`${base} serves the API but not the app: run \`npm run build\` in frontend/ first.`);
    process.exit(2);
  }
}

async function phoneRun(browser, run, opts) {
  const order = new Map(run.views.map((v, i) => [v.id, i]));
  const results = (await Promise.all(opts.widths.map((w) => shootPhone(browser, run, w)))).flat()
    .sort((a, b) => order.get(a.view) - order.get(b.view) || a.width - b.width);
  const allow = loadAllowlist(ALLOWLIST);
  const isNew = opts["baseline-known"] ? () => false : (r, v) => !allow.isKnown(r.view, v, r.width);
  const fresh = flatten(results, isNew);
  const stale = opts["baseline-known"] ? [] : staleEntries(allow, results);
  const summary = countSummary(results, isNew);
  const worst = worstOffenders(results);
  writeJson(`${OUT}report.json`, {
    generatedAt: new Date().toISOString(), base: run.base, fixture: run.mode, motion: run.motion,
    summary, worst, newViolations: fresh, staleAllowances: stale, results,
  });
  if (opts["baseline-known"]) {
    const { gates, screens } = summary;
    writeKnownBaseline(ALLOWLIST, allow, results, { recordedAt: new Date().toISOString(), gates, screens },
      `pre-existing before the mobile redesign (baseline ${new Date().toISOString().slice(0, 10)})`);
  }
  printSummary({
    summary, worst, fresh, stale,
    header: `phone: ${run.views.length} views x ${opts.widths.join("/")} (${run.mode}, `
      + `${run.motion ? "full" : "reduced"} motion) -> ${OUT}report.json`
      + (opts["baseline-known"] ? `\nknown violations written to ${ALLOWLIST}` : ""),
  });
  return fresh.length ? 1 : 0;
}

async function gestureRun(browser, run, opts) {
  const results = (await Promise.all(opts.widths.map((w) => swipePhone(browser, run, w)))).flat();
  const failures = results.filter((r) => !r.ok);
  writeJson(`${OUT}gestures.json`, { generatedAt: new Date().toISOString(), base: run.base, failures, results });
  console.log(`\ngestures: ${results.length} view/width runs, ${failures.length} failed -> ${OUT}gestures.json`);
  for (const f of failures) {
    console.log(`  ${f.view} @${f.width}: ${f.blank ? "blank #root; " : ""}${f.errors.join(" | ")}`);
  }
  return failures.length ? 1 : 0;
}

async function desktopRun(browser, run, opts) {
  const { views, errors } = await recordDesktop(browser, run);
  const header = {
    viewport: `${DESKTOP_VIEWPORT.width}x${DESKTOP_VIEWPORT.height}`,
    recordedAt: run.fixture?.recordedAt || null,
    rows: "[selector \"text, digits as #\", font-size px, x, y, width, height]",
  };
  writeRows(`${OUT}desktop-current.json`, header, views);
  for (const [view, list] of Object.entries(errors)) console.log(`  page errors on ${view}: ${list.join(" | ")}`);
  const baseline = readJson(DESKTOP_BASELINE);
  if (opts.update) {
    const merged = Object.fromEntries(allViews().map((v) => [v.id, views[v.id] || baseline?.views[v.id]])
      .filter(([, rows]) => rows));
    writeRows(DESKTOP_BASELINE, header, merged);
    console.log(`\ndesktop baseline written: ${DESKTOP_BASELINE}`);
    return 0;
  }
  if (!opts.check) {
    console.log(`\ndesktop: ${Object.keys(views).length} views recorded -> ${OUT}desktop-current.json`);
    return 0;
  }
  if (!baseline) {
    console.error(`no baseline at ${DESKTOP_BASELINE}; create it with --update`);
    return 2;
  }
  const diff = diffBaseline(baseline.views, views);
  const verdict = diff.changed
    ? `desktop: ${diff.changed} of ${Object.keys(views).length} views differ from the baseline\n${diff.text}`
    : `desktop: no differences in ${Object.keys(views).length} views`;
  writeJson(`${OUT}desktop-diff.json`, { changed: diff.changed, text: diff.text });
  console.log(`\n${verdict}`);
  return diff.changed ? 1 : 0;
}

async function main() {
  const opts = parseOptions();
  await preflight(opts.base);
  const pw = loadPlaywright();
  const browser = await launchChromium(pw);
  let sessions = null;
  try {
    sessions = await openSessions(pw, opts.base, `${OUT}account.json`);
    await seed(sessions.api);
    if (opts["seed-only"]) {
      console.log(`seeded ${sessions.accounts.main.email} on ${opts.base}`);
      return 0;
    }
    const fixture = opts.live ? null : openFixture(`${OUT}api-fixture.json`, { fresh: opts.record });
    if (!sessions.user.is_admin && !fixture?.replaying) {
      console.warn("note: the harness account is not an admin here, so /server shows its admin-only notice"
        + " (on a fresh database the harness account is the first, and so the admin)");
    }
    const run = {
      base: opts.base,
      out: OUT,
      views: selectViews(opts.views),
      fixture,
      sessions,
      motion: Boolean(opts.motion),
      mode: !fixture ? "live API" : fixture.replaying ? "frozen API" : "recording API",
      log: (line) => console.log(`  ${line}`),
    };
    const started = Date.now();
    const pass = opts.desktop ? desktopRun : opts.gestures ? gestureRun : phoneRun;
    const code = await pass(browser, run, opts);
    if (fixture) {
      fixture.save();
      const { missed, writes } = fixture.stats();
      if (fixture.replaying && missed.length) console.log(`fixture: ${missed.length} new responses recorded`);
      if (writes.length) console.log(`fixture: writes passed through live: ${writes.join(", ")}`);
    }
    console.log(`done in ${Math.round((Date.now() - started) / 1000)}s`);
    return code;
  } finally {
    await sessions?.api.dispose();
    await browser.close();
  }
}

main().then((code) => { process.exitCode = code; }, (err) => {
  console.error(err.stack || err);
  process.exitCode = 2;
});
