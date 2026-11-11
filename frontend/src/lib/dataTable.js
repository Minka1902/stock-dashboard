/**
 * Column helpers shared by DataTable (the table) and DataCards (the same rows
 * as a phone list), so a column means the same thing in both.
 */

export const cx = (...names) => names.filter(Boolean).join(" ");

/** Where a column goes on a phone card; anything unmarked is revealed on tap. */
export const phoneRole = (col) => col.phone || "meta";

/** The column's name as text: its `caption`, else a string label, else its key. */
export const columnCaption = (col) => col.caption ?? (typeof col.label === "string" ? col.label : col.key);

export const cellContent = (col, row, index) => (col.render ? col.render(row, index) : row[col.key]);

export const cardContent = (col, row, index) =>
  (col.phoneRender ? col.phoneRender(row, index) : cellContent(col, row, index));

/** Rows split by `groupBy(row)`, groups in order of first appearance. */
export function groupRows(rows, groupBy) {
  if (!groupBy) return [{ key: null, rows }];
  const groups = new Map();
  for (const row of rows) {
    const key = groupBy(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, list]) => ({ key, rows: list }));
}

/**
 * A sort picker's options: each sortable column both ways, plus the input
 * order when the table starts unsorted. Values are "key:dir".
 */
export function sortOptions(columns, unsorted) {
  return [
    ...(unsorted ? [{ value: "", label: "Default order" }] : []),
    ...columns.filter((c) => c.sort).flatMap((c) => [
      { value: `${c.key}:asc`, label: `${columnCaption(c)} (ascending)` },
      { value: `${c.key}:desc`, label: `${columnCaption(c)} (descending)` },
    ]),
  ];
}

export const sortValue = (sort) => (sort ? `${sort.key}:${sort.dir}` : "");

export function parseSort(value) {
  if (!value) return null;
  const at = value.lastIndexOf(":");
  return { key: value.slice(0, at), dir: value.slice(at + 1) };
}
