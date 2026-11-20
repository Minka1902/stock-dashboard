/**
 * Every icon the apps ship, rendered from the two source SVGs in
 * public/icons/ so the logo is drawn once:
 *
 *   frontend/public/icons/   icon-192, icon-512, maskable-512, apple-touch-icon (180), favicon-32
 *   desktop/assets/          icon-16, icon-32, icon-128 and icon.ico (16/32/48/256)
 *   extension/public/icons/  icon-16, icon-32, icon-48, icon-128
 *
 *   node scripts/make-icons.mjs
 *
 * Renders through the Chromium Playwright brings (as the phone harness does),
 * so it adds no dependency. Run it after changing logo.svg and commit the PNGs.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { launchChromium, loadPlaywright } from "./lib/playwright.mjs";

const FRONTEND = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(FRONTEND, "..");
const SOURCE = join(FRONTEND, "public", "icons", "logo.svg");
const MASKABLE = join(FRONTEND, "public", "icons", "logo-maskable.svg");
const ICO_SIZES = [16, 32, 48, 256];

const OUTPUTS = [
  { svg: SOURCE, size: 192, path: "frontend/public/icons/icon-192.png" },
  { svg: SOURCE, size: 512, path: "frontend/public/icons/icon-512.png" },
  { svg: MASKABLE, size: 512, path: "frontend/public/icons/maskable-512.png" },
  // iOS draws its own rounded corners and shows black through transparency.
  { svg: MASKABLE, size: 180, path: "frontend/public/icons/apple-touch-icon.png" },
  { svg: SOURCE, size: 32, path: "frontend/public/icons/favicon-32.png" },
  ...[16, 32, 128].map((size) => ({ svg: SOURCE, size, path: `desktop/assets/icon-${size}.png` })),
  ...[16, 32, 48, 128].map((size) => ({ svg: SOURCE, size, path: `extension/public/icons/icon-${size}.png` })),
];

async function render(page, svgPath, size) {
  const svg = readFileSync(svgPath, "utf8").replace("<svg ", `<svg width="${size}" height="${size}" `);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${svg}`);
  return page.locator("svg").screenshot({ omitBackground: true });
}

/** An .ico holding PNG images (Windows Vista and later read these). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, entry);
    header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.png)]);
}

function save(relative, data) {
  const path = join(REPO, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`${relative}  ${data.length} bytes`);
}

const pw = loadPlaywright();
const browser = await launchChromium(pw);
const page = await browser.newPage({ deviceScaleFactor: 1 });
try {
  for (const out of OUTPUTS) save(out.path, await render(page, out.svg, out.size));
  const images = [];
  for (const size of ICO_SIZES) images.push({ size, png: await render(page, SOURCE, size) });
  save("desktop/assets/icon.ico", ico(images));
} finally {
  await browser.close();
}
