import { randomBytes } from "node:crypto";
import { readJson, writeJson } from "./files.mjs";
import { totp } from "./totp.mjs";

// Throwaway accounts, remembered per backend origin so repeated runs reuse the
// same data and session instead of registering or signing in again
// (registration is limited per hour, sign-in per minute per email, and only the
// first account on a database is an admin).

export async function call(api, method, path, data) {
  const res = await api.fetch(path, { method, data });
  if (!res.ok()) {
    throw new Error(`${method} ${path} -> ${res.status()} ${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

async function resume(pw, base, saved) {
  if (!saved?.state) return null;
  const api = await pw.request.newContext({ baseURL: base, storageState: saved.state });
  if ((await api.get("/api/auth/me")).ok()) return api;
  await api.dispose();
  return null;
}

async function signIn(pw, base, saved) {
  if (!saved?.secret) return null;
  const api = await pw.request.newContext({ baseURL: base });
  const res = await api.post("/api/auth/login", { data: { email: saved.email, password: saved.password } });
  if (res.ok() && (await res.json()).status === "totp_required") {
    await call(api, "POST", "/api/auth/totp/verify", { code: totp(saved.secret) });
    return api;
  }
  await api.dispose();
  return null;
}

async function register(pw, base, tag) {
  const creds = {
    email: `shots-${tag}-${Date.now().toString(36)}@example.com`,
    password: randomBytes(12).toString("base64url"),
  };
  const api = await pw.request.newContext({ baseURL: base });
  await call(api, "POST", "/api/auth/register", creds);
  return { api, creds };
}

async function enrol(api, creds) {
  const { secret } = await call(api, "GET", "/api/auth/totp/setup");
  await call(api, "POST", "/api/auth/totp/enable", { code: totp(secret) });
  return { ...creds, secret };
}

/**
 * The harness account, signed in and onboarded (so the guided tour never
 * covers a capture), plus a second account left half-registered so the
 * enrolment screen can be shown. Returns the API context (for seeding), the
 * user, the browser cookie jar and both sets of credentials.
 */
export async function openSessions(pw, base, storePath) {
  const store = readJson(storePath, {});
  const saved = store[base] || {};
  let api = await resume(pw, base, saved.main) || await signIn(pw, base, saved.main);
  let main = saved.main;
  let setup = saved.setup;
  if (!api) {
    const fresh = await register(pw, base, "main");
    api = fresh.api;
    main = await enrol(api, fresh.creds);
    setup = null;
  }
  if (!setup) {
    const half = await register(pw, base, "setup");
    setup = half.creds;
    await half.api.dispose();
  }
  const user = await call(api, "POST", "/api/auth/onboarded");
  const state = await api.storageState();
  store[base] = { main: { ...main, state }, setup };
  writeJson(storePath, store);
  return { api, user, authed: state, accounts: { main, setup } };
}
