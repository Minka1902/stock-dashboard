import { readJson, writeJson } from "./files.mjs";

// Frozen API: every GET under /api is answered from a recording, so two runs
// (or two phases of the redesign) render the same numbers, headlines and
// timestamps. Auth stays live because sessions are per browser context, except
// a signed-in page's "who am I": replaying it shows the recorded account name
// and admin flag whichever account (or database) a later run signs in with.
// The event stream gets a 204, which tells EventSource not to reconnect;
// writes pass through and are listed, since a capture should never need one.
const LIVE_ONLY = /^\/api\/auth\//;
const WHO_AM_I = "/api/auth/me";
const SESSION_COOKIE = /(^|;\s*)session=/;
const STREAM = "/api/stream";
const TEXT_TYPE = /json|text|javascript|xml/;

async function stayLive(request, url) {
  if (!LIVE_ONLY.test(url.pathname)) return false;
  if (url.pathname !== WHO_AM_I) return true;
  return !SESSION_COOKIE.test((await request.headerValue("cookie")) || "");
}

async function record(route, state, key) {
  const res = await route.fetch();
  const contentType = res.headers()["content-type"] || "";
  const raw = await res.body();
  const entry = TEXT_TYPE.test(contentType)
    ? { status: res.status(), contentType, body: raw.toString("utf8") }
    : { status: res.status(), contentType, base64: raw.toString("base64") };
  state.responses[key] = entry;
  state.missed.add(key);
  return entry;
}

async function handle(route, state) {
  const request = route.request();
  const url = new URL(request.url());
  if (await stayLive(request, url)) return route.continue();
  if (url.pathname === STREAM) return route.fulfill({ status: 204 });
  if (request.method() !== "GET") {
    state.writes.add(`${request.method()} ${url.pathname}`);
    return route.continue();
  }
  const key = url.pathname + url.search;
  const entry = state.responses[key] || await record(route, state, key);
  return route.fulfill({
    status: entry.status,
    contentType: entry.contentType,
    body: entry.base64 ? Buffer.from(entry.base64, "base64") : entry.body,
  });
}

/**
 * Open the recording at `path` (`fresh` starts an empty one). A request the
 * recording lacks is fetched live once and added, so the next run is frozen too.
 * `recordedAt` is the clock the pages are pinned to.
 */
export function openFixture(path, { fresh }) {
  const saved = fresh ? null : readJson(path);
  const state = {
    responses: saved?.responses || {},
    missed: new Set(),
    writes: new Set(),
  };
  const recordedAt = saved?.recordedAt || new Date().toISOString();
  return {
    recordedAt,
    replaying: Boolean(saved),
    // A page closed mid-request makes fulfil throw; nothing is waiting on it.
    attach: (context) => context.route("**/api/**", (route) =>
      handle(route, state).catch(() => route.abort().catch(() => {}))),
    stats: () => ({ missed: [...state.missed].sort(), writes: [...state.writes].sort() }),
    save() {
      if (state.missed.size) writeJson(path, { recordedAt, responses: state.responses });
    },
  };
}
