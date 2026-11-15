/**
 * Chart screenshot + share (Task 5).
 *
 * lightweight-charts' `chart.takeScreenshot(addTopLayer, includeCrosshair)`
 * renders the whole chart — every pane, both axes, the visible range exactly
 * as it is on screen. `addTopLayer=true` is what brings in primitives drawn on
 * the top layer (our DrawingPrimitive uses zOrder "top"); the crosshair is
 * left out so the image shows the chart, not where the mouse happened to be.
 *
 * The chart canvas is transparent, so it is composited onto the theme
 * surface under a header strip (ticker, timeframe, last price, time, the
 * active studies and the "signals, not predictions" line).
 */

const PAD_CSS_PX = 14;
// Header rows: the first baseline, the step to each next one, the space
// under the last, and the least gap between a row's left and right texts.
const FIRST_LINE_CSS_PX = 24;
const LINE_STEP_CSS_PX = 20;
const BELOW_CSS_PX = 14;
const GAP_CSS_PX = 12;

function font(weight, px, ratio, family) {
  return `${weight} ${Math.round(px * ratio)}px ${family}`;
}

/**
 * The header as rows of `{ left: runs, right: run | null }`. A wide chart
 * gets two rows, the title with the product line and the meta with the note;
 * a narrow one (a phone) wraps the meta and moves each right-hand text that
 * would collide onto a row of its own.
 */
function headerRows(ctx, info, ratio, avail) {
  const c = info.colors;
  const mono = info.monoFamily || "monospace";
  const sans = info.fontFamily || "system-ui, sans-serif";
  const run = (text, weight, px, family, color, after = 0) => ({
    text, font: font(weight, px, ratio, family), color, after: Math.round(after * ratio),
  });
  const width = (runs) => runs.reduce((w, r) => {
    ctx.font = r.font;
    return w + ctx.measureText(r.text).width + r.after;
  }, 0);
  const fits = (left, right) => width(left) + (right ? Math.round(GAP_CSS_PX * ratio) + width([right]) : 0) <= avail;

  const title = [run(info.ticker, 700, 17, sans, c.text, 10), run(info.timeframe, 600, 12, mono, c.accent, 12)];
  if (info.price != null) {
    // With its currency symbol ("₪120.50" for a TASE listing).
    title.push(run(`${info.currencySymbol || ""}${Number(info.price).toFixed(2)}`, 600, 14, mono, c.text, 8));
    if (info.changePct != null) {
      title.push(run(`${info.changePct >= 0 ? "+" : ""}${info.changePct.toFixed(2)}%`, 600, 12, mono,
        info.changePct >= 0 ? c.up : c.down));
    }
  }
  const brand = run("Signals, not predictions", 600, 11, sans, c.faint);
  const note = info.note ? run(info.note, 400, 10.5, mono, c.faint) : null;

  const meta = [[]];
  for (const part of [info.stamp, ...(info.studies || [])].filter(Boolean)) {
    const line = meta[meta.length - 1];
    const next = run(line.length ? `  ·  ${part}` : part, 400, 11, mono, c.muted);
    if (!line.length || fits([...line, next])) line.push(next);
    else meta.push([run(part, 400, 11, mono, c.muted)]);
  }

  const brandFits = fits(title, brand);
  const noteFits = !note || fits(meta[0], note);
  return [
    { left: title, right: brandFits ? brand : null },
    { left: meta[0], right: noteFits ? note : null },
    ...meta.slice(1).map((left) => ({ left, right: null })),
    ...(noteFits ? [] : [{ left: [], right: note }]),
    ...(brandFits ? [] : [{ left: [], right: brand }]),
  ];
}

/**
 * Compose the snapshot canvas.
 * @param {HTMLCanvasElement} shot  chart.takeScreenshot(true, false)
 * @param {object} info  { cssWidth, ticker, timeframe, price, changePct,
 *   studies: string[], note?: string, colors: {bg, text, muted, faint, up, down, accent, border}, fontFamily, monoFamily }
 */
export function composeSnapshot(shot, info) {
  const ratio = info.cssWidth ? shot.width / info.cssWidth : (window.devicePixelRatio || 1);
  const pad = Math.round(PAD_CSS_PX * ratio);
  const out = document.createElement("canvas");
  const rows = headerRows(out.getContext("2d"), info, ratio, shot.width - pad * 2);
  const baseline = (i) => Math.round((FIRST_LINE_CSS_PX + i * LINE_STEP_CSS_PX) * ratio);
  const header = baseline(rows.length - 1) + Math.round(BELOW_CSS_PX * ratio);
  out.width = shot.width;
  out.height = shot.height + header + pad;
  const ctx = out.getContext("2d");
  const c = info.colors;

  ctx.fillStyle = c.bg;
  ctx.fillRect(0, 0, out.width, out.height);

  ctx.textBaseline = "alphabetic";
  rows.forEach(({ left, right }, i) => {
    let x = pad;
    ctx.textAlign = "left";
    for (const r of left) {
      ctx.font = r.font;
      ctx.fillStyle = r.color;
      ctx.fillText(r.text, x, baseline(i));
      x += ctx.measureText(r.text).width + r.after;
    }
    if (!right) return;
    ctx.textAlign = "right";
    ctx.font = right.font;
    ctx.fillStyle = right.color;
    ctx.fillText(right.text, out.width - pad, baseline(i));
  });
  ctx.textAlign = "left";

  // divider
  ctx.fillStyle = c.border;
  ctx.fillRect(pad, header - Math.max(1, Math.round(ratio)), out.width - pad * 2, Math.max(1, Math.round(ratio)));

  ctx.drawImage(shot, 0, header);
  return out;
}

export function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("could not encode PNG"))), "image/png");
  });
}

export function snapshotFileName(ticker, timeframe, date = new Date()) {
  const pad2 = (n) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
  return `${ticker}-${timeframe}-${stamp}.png`.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** True when the Web Share API can take this file (mobile, Edge/Chrome on Windows). */
export function canShareFile(file) {
  try {
    return typeof navigator !== "undefined" && !!navigator.canShare && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export function canCopyImage() {
  return typeof window !== "undefined" && !!window.ClipboardItem && !!navigator.clipboard?.write;
}

export async function copyImage(blob) {
  // A promise-valued ClipboardItem keeps Safari's user-activation window open.
  await navigator.clipboard.write([new window.ClipboardItem({ "image/png": Promise.resolve(blob) })]);
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
