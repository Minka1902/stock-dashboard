// Touch swipes through CDP (Input.dispatchTouchEvent), the STC-107
// reproduction: real touchstart/move/end sequences, so passive listeners,
// pointer capture and drag handles see what a finger would do.
const STEP_MS = 12;
const SETTLE_MS = 150;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function swipe(cdp, { from, to, steps = 10, holdMs = 0 }) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [from] });
  if (holdMs) await pause(holdMs);
  for (let i = 1; i <= steps; i++) {
    const point = { x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps };
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
    await pause(STEP_MS);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await pause(SETTLE_MS);
}

/**
 * The swipe set for one viewport: up and down the middle, along the left edge
 * (where row drag handles sit), along the right edge (prices, sparklines,
 * row menus), a long-press drag on the left edge, fast flings to the bottom
 * and back, and a sideways swipe across the middle.
 */
function plan({ width, height }) {
  const top = Math.round(height * 0.25);
  const bottom = Math.round(height * 0.8);
  const columns = { left: 28, middle: Math.round(width / 2), right: width - 40 };
  const up = (x, extra = {}) => ({ from: { x, y: bottom }, to: { x, y: top }, ...extra });
  const down = (x, extra = {}) => ({ from: { x, y: top }, to: { x, y: bottom }, ...extra });
  return [
    up(columns.middle), up(columns.middle), down(columns.middle),
    up(columns.left), up(columns.left), down(columns.left),
    up(columns.right), down(columns.right),
    up(columns.left, { holdMs: 500, steps: 14 }),
    ...Array(4).fill(up(columns.middle, { steps: 4 })),
    ...Array(4).fill(down(columns.middle, { steps: 4 })),
    { from: { x: width - 30, y: Math.round(height / 2) }, to: { x: 30, y: Math.round(height / 2) } },
  ];
}

export async function runGestures(page, viewport) {
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const move of plan(viewport)) await swipe(cdp, move);
  } finally {
    await cdp.detach().catch(() => {});
  }
}
