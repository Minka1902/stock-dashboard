import { settle, visit } from "./page.mjs";
import { FORMS } from "./views.mjs";

// The number keyboard check (STC-104): a field that takes a number must say
// so with `inputmode`, or a phone brings up the full keyboard. Read on the
// view as it loads, then in each form FORMS opens from it (a fresh visit per
// form). The in-page half is probe.mjs `numberFields`.
const DIALOG = '[role="dialog"]';

const MAX_PRESSES = 40;

async function firstShown(page, step) {
  const named = (role) => page.getByRole(role, { name: step, exact: typeof step === "string" });
  for (const el of await named("button").or(named("menuitem")).all()) if (await el.isVisible()) return el;
  return null;
}

// A pattern is pressed until nothing visible matches any more (each press
// renames its button, "Expand X" to "Collapse X"), so it is looked up again
// after every press.
async function press(page, step) {
  let el = await firstShown(page, step);
  if (!el) throw new Error(`no button "${step}"`);
  for (let n = 0; el && n < MAX_PRESSES; n++) {
    await el.click();
    el = typeof step === "string" ? null : await firstShown(page, step);
  }
}

async function readForm(target, steps) {
  for (const step of steps) {
    await press(target.page, step);
    await settle(target);
  }
  const scope = await target.page.locator(DIALOG).count() ? DIALOG : null;
  return target.page.evaluate((s) => window.__shotsProbe.numberFields(s), scope);
}

const describe = (steps) => steps.map(String).join(" > ");

/** `input` gate violations for the view and the forms it opens. */
export async function checkNumberFields(target, run, view) {
  const found = [{ where: "the page", fields: await target.page.evaluate(() => window.__shotsProbe.numberFields(null)) }];
  for (const steps of FORMS[view.id] || []) {
    await visit(target, run.base, view, run.sessions.accounts);
    const fields = await readForm(target, steps).catch((err) => [{
      element: describe(steps), sample: "", type: `cannot open: ${err.message.split("\n")[0]}`,
    }]);
    found.push({ where: describe(steps), fields });
  }
  return found.flatMap(({ where, fields }) => fields.map((f) => ({
    gate: "input", element: f.element, sample: f.sample, px: 0,
    reason: f.type.startsWith("cannot open") ? f.type : `type=${f.type}, no inputmode (${where})`,
  })));
}
