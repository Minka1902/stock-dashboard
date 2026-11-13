import { Fragment, useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import DataCards from "./DataCards";
import MenuButton from "./MenuButton";
import ScrollHint from "./ScrollHint";
import Skeleton from "./Skeleton";
import SortHeader from "./SortHeader";
import Tooltip from "./Tooltip";
import { useElementWidth } from "../hooks/useElementWidth";
import { PHONE, useMediaQuery } from "../hooks/useMediaQuery";
import { useSortableRows } from "../hooks/useSortableRows";
import { cellContent, cx, groupRows, phoneRole } from "../lib/dataTable";
import { prefersReducedMotion, staggerContainer, staggerItem } from "../lib/motionConfig";
import styles from "./DataTable.module.css";

const alignClass = (col) => (col.align === "end" ? styles.num : null);
const staticClass = (col) => cx(alignClass(col), col.className) || undefined;

function rowClass(col, row) {
  const own = typeof col.cellClassName === "function" ? col.cellClassName(row) : col.cellClassName;
  return cx(alignClass(col), col.className, own) || undefined;
}

/**
 * Header-row cells for a group: the first column holds the label and spans
 * up to the first column that has an entry; each entry is its column's cell;
 * a run of columns without one is one empty cell.
 */
function groupCells(columns, entries, title) {
  const cells = [{ key: columns[0].key, span: 1, content: title, open: true }];
  for (const col of columns.slice(1)) {
    const last = cells[cells.length - 1];
    if (entries[col.key] !== undefined) {
      cells.push({ key: col.key, span: 1, content: entries[col.key], className: staticClass(col) });
    } else if (last.open) last.span += 1;
    else cells.push({ key: col.key, span: 1, open: true });
  }
  return cells;
}

/**
 * The one table. Columns describe each cell once; at 640px and below
 * (`layout="auto"`) the same rows become a list of two-line cards (see
 * DataCards), so no table scrolls sideways on a phone.
 *
 * Column: `{ key, label, render(row, i), align: "end", sort(row), phone,
 * caption, phoneRender(row, i), tone(row), className, cellClassName(row),
 * cellProps(row), headProps, hideLabel, truncate, rowHeader, skeleton }`.
 * `phone` is the column's place on a card: "title" (what the row is),
 * "subtitle" (its second identifier), "value" (the number the view is about;
 * `tone` adds ▲/▼ and colour), "meta" (the default: revealed on tap),
 * "hidden" (said elsewhere on the card) or "actions" (the table's own
 * actions column; the card uses `rowActions` instead).
 *
 * Rows: `rows`, `rowKey(row)`, `rowLabel(row)` (accessible name on a card),
 * `onRowClick(row)`, `rowActions(row, close)` (menu items; a "⋯" column
 * when no column is phone "actions"), `rowProps(row)` (attributes on the
 * row), `rowAfter(row, layout)` (rows after it in the table, content under
 * it on a card), `expanded(row)` (a card held open).
 *
 * Table: `initialSort`, `limit`, `empty`, `loading` + `skeletonRows`,
 * `dense`, `stickyHeader`, `caption`, `label`, `groupBy(row)` +
 * `groupHeader(key, rows)` ({ colKey: cell }), `footer` ({ colKey: cell }),
 * `layout` ("auto" | "table" | "cards" | "scroll"), `cardsBelow` (px: with
 * "auto", cards whenever the table's own container is that narrow, e.g. a
 * table inside a card, instead of only on a phone), `animate` (rows
 * stagger in), and `classes` ({ wrap, table, row, groupRow, groupLabel,
 * footRow }) to style the table with a module's own classes instead of the
 * defaults.
 */
export default function DataTable({
  columns, rows, rowKey, rowLabel, onRowClick, rowActions, rowProps, rowAfter, expanded,
  initialSort = null, limit, empty = null, loading = false, skeletonRows = 8,
  dense = false, stickyHeader = false, caption, label, groupBy, groupHeader, footer,
  layout = "auto", cardsBelow, animate = false, classes = {},
}) {
  const phone = useMediaQuery(PHONE);
  const [measure, width] = useElementWidth();
  const accessors = useMemo(
    () => Object.fromEntries(columns.filter((c) => c.sort).map((c) => [c.key, c.sort])),
    [columns],
  );
  const { sorted, sort, setSort, sortProps } = useSortableRows(rows, accessors, initialSort);
  const shown = limit == null ? sorted : sorted.slice(0, limit);
  const groups = groupRows(shown, groupBy);
  const reduced = prefersReducedMotion();

  if (!loading && rows.length === 0) return empty;

  const narrow = phone || (cardsBelow != null && width != null && width <= cardsBelow);
  const measured = (content) => (cardsBelow == null ? content : <div ref={measure}>{content}</div>);

  if (layout === "cards" || (layout === "auto" && narrow)) {
    return measured(
      <DataCards
        columns={columns} groups={groups} rowKey={rowKey} rowLabel={rowLabel} onRowClick={onRowClick}
        rowActions={rowActions} rowProps={rowProps} rowAfter={rowAfter} expanded={expanded}
        sort={sort} onSort={setSort} unsorted={!initialSort} loading={loading} skeletonRows={skeletonRows}
        label={label ?? (typeof caption === "string" ? caption : undefined)}
        groupBy={groupBy} groupHeader={groupHeader} footer={footer}
      />,
    );
  }

  const menuColumn = rowActions && !columns.some((c) => phoneRole(c) === "actions");
  const labelClass = classes.groupLabel ?? styles.groupLabel;

  const headCell = (col) => {
    const className = staticClass(col);
    if (col.sort) return <SortHeader key={col.key} label={col.label} className={className} {...sortProps(col.key)} />;
    return (
      <th key={col.key} scope="col" className={className} {...col.headProps}>
        {col.hideLabel ? <span className={styles.srOnly}>{col.label}</span> : col.label}
      </th>
    );
  };

  const bodyRow = (row, index) => {
    const Row = animate ? motion.tr : "tr";
    const motionProps = animate
      ? { variants: staggerItem, exit: reduced ? { opacity: 0 } : { opacity: 0, x: -12 }, layout: !reduced }
      : {};
    const clickProps = onRowClick
      ? {
        tabIndex: 0,
        "data-clickable": "yes",
        onClick: () => onRowClick(row),
        onKeyDown: (e) => { if (e.key === "Enter") onRowClick(row); },
      }
      : {};
    const key = rowKey(row);
    return (
      <Fragment key={key}>
        <Row className={classes.row} {...motionProps} {...clickProps} {...rowProps?.(row)}>
          {columns.map((col) => {
            const Cell = col.rowHeader ? "th" : "td";
            const cell = (
              <Cell key={col.key} className={rowClass(col, row)} scope={col.rowHeader ? "row" : undefined}
                    {...col.cellProps?.(row)}>
                {cellContent(col, row, index)}
              </Cell>
            );
            return col.truncate ? <Tooltip key={col.key} truncate>{cell}</Tooltip> : cell;
          })}
          {menuColumn && (
            <td className={styles.menuCell}>
              <MenuButton label={`Actions for ${rowLabel ? rowLabel(row) : key}`}>
                {(close) => rowActions(row, close)}
              </MenuButton>
            </td>
          )}
        </Row>
        {rowAfter?.(row, "table")}
      </Fragment>
    );
  };

  const groupRow = (group) => {
    const entries = groupHeader ? groupHeader(group.key, group.rows) : {};
    const first = columns[0].key;
    const title = entries[first] !== undefined ? entries[first] : <span className={labelClass}>{group.key}</span>;
    return (
      <tr className={classes.groupRow ?? styles.groupRow}>
        {groupCells(columns, entries, title).map((c) => (
          <td key={c.key} colSpan={c.span > 1 ? c.span : undefined} className={c.className}>{c.content}</td>
        ))}
        {menuColumn && <td />}
      </tr>
    );
  };

  const body = (group) => {
    const rowsMarkup = group.rows.map(bodyRow);
    const Body = animate ? motion.tbody : "tbody";
    const bodyProps = animate
      ? { variants: staggerContainer, initial: reduced ? false : "hidden", animate: "visible" }
      : {};
    return (
      <Body key={group.key ?? "rows"} {...bodyProps}>
        {groupBy && groupRow(group)}
        {animate ? <AnimatePresence initial={false}>{rowsMarkup}</AnimatePresence> : rowsMarkup}
      </Body>
    );
  };

  const table = (
    <table
      className={classes.table ?? styles.table}
      data-dense={dense ? "yes" : undefined}
      data-sticky={stickyHeader ? "yes" : undefined}
      aria-label={label}
    >
      {caption && <caption className={styles.srOnly}>{caption}</caption>}
      <thead>
        <tr>
          {columns.map(headCell)}
          {menuColumn && <th scope="col"><span className={styles.srOnly}>Actions</span></th>}
        </tr>
      </thead>
      {loading ? (
        <tbody>
          {Array.from({ length: skeletonRows }, (_, i) => (
            <tr key={i}>
              {columns.map((col) => (
                <td key={col.key} className={staticClass(col)}><Skeleton w={col.skeleton || "60%"} /></td>
              ))}
              {menuColumn && <td />}
            </tr>
          ))}
        </tbody>
      ) : groups.map(body)}
      {footer && (
        <tfoot>
          <tr className={classes.footRow}>
            {columns.map((col) => <td key={col.key} className={staticClass(col)}>{footer[col.key]}</td>)}
            {menuColumn && <td />}
          </tr>
        </tfoot>
      )}
    </table>
  );

  const wrap = classes.wrap ?? (dense ? styles.wrap : styles.tableWrap);
  return measured(layout === "table" ? <div className={wrap}>{table}</div> : <ScrollHint className={wrap}>{table}</ScrollHint>);
}
