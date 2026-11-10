import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export function readJson(path, fallback = null) {
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback;
}

/** Pretty JSON, with objects and arrays that hold no others kept on one line. */
export function writeJson(path, value) {
  const text = JSON.stringify(value, null, 2).replace(/([[{])\n\s+([^[\]{}]*?)\n\s*([\]}])/g,
    (_, open, body, close) => `${open}${body.replace(/\n\s+/g, " ")}${close}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${text}\n`);
}

/** One array per line: a large table that still diffs readably in git. */
export function writeRows(path, header, rowsByGroup) {
  const groups = Object.entries(rowsByGroup).map(([name, rows]) =>
    `    ${JSON.stringify(name)}: [\n${rows.map((r) => `      ${JSON.stringify(r)}`).join(",\n")}\n    ]`);
  const head = Object.entries(header).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `{\n${head.join("\n")}\n  "views": {\n${groups.join(",\n")}\n  }\n}\n`);
}
