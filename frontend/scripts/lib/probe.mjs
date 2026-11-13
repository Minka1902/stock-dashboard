/**
 * The in-page half of the harness. Playwright serializes this function into
 * every page (context.addInitScript), so it must not reference anything
 * outside itself. It installs `window.__shotsProbe` with:
 *
 * - `audit({ minHit, firstScreen })`: the phone gates (page overflow, clipped
 *   text, small hit boxes, what must be in the first screen), the sideways
 *   scrollers and the page height in screens;
 * - `textNodes()`: every visible text node's font size and box, for the
 *   desktop baseline;
 * - `scroller()`: the element the page scrolls in (the app's inner `.scroll`
 *   pane, or the document on the auth screens).
 *
 * Elements are named by a short selector: tag, id and up to two CSS-module
 * class names with the build hash and line number stripped (`_tab_x1y2z_40`
 * becomes `.tab`), for the element and up to two named ancestors.
 */
export function installProbe() {
  const MODULE_CLASS = /^_(.+)_[\w-]{5}_\d+$/;
  const GENERATED_ID = /[«»:]|^_r_|^_R_/;
  const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "OPTION", "OPTGROUP", "TITLE"]);
  const INTERACTIVE = [
    "a[href]", "button", "input:not([type=hidden])", "select", "textarea", "summary",
    ...["button", "tab", "link", "checkbox", "switch", "menuitem", "menuitemcheckbox",
      "menuitemradio", "option", "radio", "slider", "combobox", "spinbutton"].map((r) => `[role=${r}]`),
  ].join(", ");
  const CONTROL_PARENT = "button, a[href], summary";
  const TAPE = '[aria-label="Live quotes"]';
  const SCROLLS = /auto|scroll/;
  const CLIPS = /hidden|clip/;

  const style = (el, pseudo) => getComputedStyle(el, pseudo);
  const round = (n) => Math.round(n * 10) / 10;
  const visible = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
  const ownText = (el) => [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim());
  const squash = (s) => (s || "").replace(/\s+/g, " ").trim();

  function name(el) {
    const id = el.id && !GENERATED_ID.test(el.id) ? `#${el.id}` : "";
    const classes = [...el.classList].slice(0, 2).map((c) => `.${MODULE_CLASS.exec(c)?.[1] || c}`).join("");
    return `${el.tagName.toLowerCase()}${id}${classes}`;
  }

  function selector(el) {
    const parts = [name(el)];
    for (let p = el.parentElement; p && p !== document.body && parts.length < 3; p = p.parentElement) {
      if (p.id || p.classList.length) parts.unshift(name(p));
    }
    return parts.join(" ");
  }

  function sample(el) {
    const own = squash(ownText(el).map((n) => n.textContent).join(" "));
    return (own || squash(el.innerText) || el.getAttribute("aria-label") || el.getAttribute("title") || "").slice(0, 40);
  }

  function union(rects) {
    const live = rects.filter((r) => r && (r.width || r.height));
    if (!live.length) return null;
    const left = Math.min(...live.map((r) => r.left));
    const top = Math.min(...live.map((r) => r.top));
    const right = Math.max(...live.map((r) => r.right));
    const bottom = Math.max(...live.map((r) => r.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }

  function textBox(nodes) {
    const range = document.createRange();
    return union(nodes.flatMap((n) => {
      range.selectNodeContents(n);
      return [...range.getClientRects()];
    }));
  }

  function scroller() {
    const main = [...document.querySelectorAll("main > *")].find((el) => SCROLLS.test(style(el).overflowY));
    return main || document.scrollingElement;
  }

  function containingBlock(el) {
    for (let p = el; p; p = p.parentElement) {
      const cs = style(p);
      if (cs.position !== "static" || cs.transform !== "none") return p;
    }
    return document.documentElement;
  }

  // The `::after` hit-area extension: an absolutely positioned pseudo-element,
  // resolved against its containing block (translate/scale applied).
  function afterBox(el) {
    const ps = style(el, "::after");
    if (ps.content === "none" || ps.content === "normal" || ps.display === "none") return null;
    if (ps.position !== "absolute") return null;
    const cb = containingBlock(el);
    const r = cb.getBoundingClientRect();
    const m = ps.transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(ps.transform);
    const width = parseFloat(ps.width) * m.a;
    const height = parseFloat(ps.height) * m.d;
    const left = r.left + cb.clientLeft + parseFloat(ps.left) + m.e;
    const top = r.top + cb.clientTop + parseFloat(ps.top) + m.f;
    if (![left, top, width, height].every(Number.isFinite)) return null;
    return { left, top, right: left + width, bottom: top + height, width, height };
  }

  function hitBox(el) {
    const labels = el.labels ? [...el.labels].filter(visible).map((l) => l.getBoundingClientRect()) : [];
    return union([el.getBoundingClientRect(), ...labels, afterBox(el)]);
  }

  function isInlineTextLink(el) {
    return el.tagName === "A" && style(el).display === "inline"
      && el.parentElement && ownText(el.parentElement).length > 0;
  }

  // How far `box` sticks out of the nearest overflow:hidden/clip ancestor, per
  // axis, stopping at a scroller (its content is reachable) and skipping
  // deliberate truncation (text-overflow: ellipsis, line-clamp) and
  // visually-hidden text (a clip box of 2px or less).
  function clipping(el, box) {
    let truncates = false;
    const open = { x: true, y: true };
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) {
      const cs = style(a);
      if (cs.textOverflow === "ellipsis" || cs.webkitLineClamp !== "none") truncates = true;
      for (const axis of ["x", "y"]) {
        if (!open[axis]) continue;
        const overflow = axis === "x" ? cs.overflowX : cs.overflowY;
        if (SCROLLS.test(overflow)) {
          open[axis] = false;
          continue;
        }
        if (!CLIPS.test(overflow)) continue;
        if (a.clientWidth <= 2 || a.clientHeight <= 2) return null;
        const r = a.getBoundingClientRect();
        const start = axis === "x" ? r.left + a.clientLeft : r.top + a.clientTop;
        const end = start + (axis === "x" ? a.clientWidth : a.clientHeight);
        const over = axis === "x"
          ? Math.max(start - box.left, box.right - end)
          : Math.max(start - box.top, box.bottom - end);
        if (over > 1) return truncates ? null : { by: a, px: over };
      }
      if (!open.x && !open.y) return null;
    }
    return null;
  }

  function contained(el, root) {
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
      if (style(p).overflowX !== "visible" || style(p).position === "fixed") return true;
    }
    return false;
  }

  // Outermost visible elements sticking out of the page scroller sideways:
  // what makes the whole page drag left and right on a phone.
  function pageOverflow(root) {
    if (root.scrollWidth <= root.clientWidth + 1) return [];
    const r = root === document.scrollingElement ? { left: 0 } : root.getBoundingClientRect();
    const edge = r.left + root.clientWidth;
    const sticksOut = (el) => {
      if (!visible(el) || style(el).position === "fixed" || contained(el, root)) return 0;
      const b = el.getBoundingClientRect();
      return Math.max(b.right - edge, r.left - b.left);
    };
    const found = [];
    for (const el of root.querySelectorAll("*")) {
      const px = sticksOut(el);
      if (px > 1 && !(el.parentElement && el.parentElement !== root && sticksOut(el.parentElement) > 1)) {
        found.push({ gate: "overflow", element: selector(el), sample: sample(el), px: round(px) });
      }
    }
    return found.length ? found : [{
      gate: "overflow", element: selector(root), sample: "", px: round(root.scrollWidth - root.clientWidth),
    }];
  }

  // The scroller pads its bottom by exactly the chrome over it (the tab bar),
  // so the first screen ends that far above its bottom edge.
  function firstScreen(root, checks) {
    const top = root === document.scrollingElement ? 0 : root.getBoundingClientRect().top;
    const fold = top + root.clientHeight - parseFloat(style(root).paddingBottom);
    return checks.flatMap(({ name, selector, whole }) => {
      const el = [...document.querySelectorAll(selector)].find(visible);
      if (!el) return [{ gate: "first", element: name, sample: selector, px: 0 }];
      const box = el.getBoundingClientRect();
      const below = (whole ? box.bottom : box.top) - fold;
      return below > 0 ? [{ gate: "first", element: name, sample: sample(el), px: round(below) }] : [];
    });
  }

  function audit({ minHit, firstScreen: checks = [] }) {
    const root = scroller();
    const violations = [...pageOverflow(root), ...firstScreen(root, checks)];
    const sideways = [];
    const targets = new Set(document.querySelectorAll(INTERACTIVE));
    for (const el of document.body.querySelectorAll("*")) {
      if (SKIP_TAGS.has(el.tagName) || !visible(el)) continue;
      const cs = style(el);
      if (cs.cursor === "pointer" && el.parentElement && style(el.parentElement).cursor !== "pointer") targets.add(el);
      if (el.closest(TAPE)) continue;
      if (el !== root && SCROLLS.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1) {
        sideways.push({ element: selector(el), px: el.scrollWidth, box: el.clientWidth });
      }
      const text = ownText(el);
      const box = text.length && textBox(text);
      const clip = box && clipping(el, box);
      if (clip) {
        violations.push({ gate: "clip", element: selector(el), sample: sample(el), px: round(clip.px), by: selector(clip.by) });
      }
    }
    for (const el of targets) {
      if (!visible(el) || el.disabled || el.getAttribute("aria-disabled") === "true") continue;
      if (el.parentElement?.closest(CONTROL_PARENT) || isInlineTextLink(el)) continue;
      if ([...(el.labels || [])].some((l) => targets.has(l) && l.contains(el))) continue;
      const box = hitBox(el);
      if (!box || (box.width >= minHit && box.height >= minHit)) continue;
      violations.push({
        gate: "hit", element: selector(el), sample: sample(el),
        px: round(minHit - Math.min(box.width, box.height)),
        size: `${Math.round(box.width)}x${Math.round(box.height)}`,
      });
    }
    const app = document.getElementById("root");
    return {
      violations,
      sideways,
      blank: !app || squash(app.innerText).length < 20,
      contentHeight: root.scrollHeight,
      screens: round(root.scrollHeight / root.clientHeight),
    };
  }

  function textNodes() {
    const rows = [];
    const seen = new Map();
    const range = document.createRange();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      const text = squash(n.textContent);
      if (!text || !el || SKIP_TAGS.has(el.tagName) || el.closest(TAPE) || !visible(el)) continue;
      range.selectNodeContents(n);
      const r = range.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const base = `${selector(el)} "${text.replace(/\d/g, "#").slice(0, 40)}"`;
      const nth = (seen.get(base) || 0) + 1;
      seen.set(base, nth);
      rows.push([nth > 1 ? `${base} ${nth}` : base, parseFloat(style(el).fontSize),
        round(r.left), round(r.top), round(r.width), round(r.height)]);
    }
    return rows;
  }

  window.__shotsProbe = { audit, textNodes, scroller };
}
