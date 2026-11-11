import DataCard from "./DataCard";
import SelectMenu from "./SelectMenu";
import Skeleton from "./Skeleton";
import { columnCaption, parseSort, sortOptions, sortValue } from "../lib/dataTable";
import styles from "./DataCards.module.css";

const SKELETON_CARDS = 4;

/** Caption/value pairs for a group header or the footer (first column excluded). */
function entryList(columns, entries, className) {
  const shown = columns.slice(1).filter((c) => ![undefined, null, false, ""].includes(entries[c.key]));
  if (!shown.length) return null;
  return (
    <dl className={className}>
      {shown.map((c) => (
        <div key={c.key}>
          <dt>{columnCaption(c)}</dt>
          <dd>{entries[c.key]}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * DataTable's phone layout: a sort picker (when any column sorts), then each
 * group as a list of DataCards under a sticky group header, then the footer
 * as a totals block. Same rows, columns and props as the table.
 */
export default function DataCards({
  columns, groups, rowKey, rowLabel, onRowClick, rowActions, rowProps, rowAfter, expanded,
  sort, onSort, unsorted, loading, skeletonRows, label, groupBy, groupHeader, footer,
}) {
  const options = sortOptions(columns, unsorted);
  const rowCount = groups.reduce((n, g) => n + g.rows.length, 0);
  const first = columns[0];

  return (
    <div className={styles.root}>
      {options.length > 1 && rowCount > 1 && (
        <div className={styles.sortBar}>
          <span className="caption" aria-hidden="true">Sort</span>
          <SelectMenu label="Sort" value={sortValue(sort)} options={options}
                      onChange={(v) => onSort(parseSort(v))} className={styles.sort} />
        </div>
      )}
      {loading ? (
        <ul className={styles.list} aria-label={label} aria-busy="true">
          {Array.from({ length: Math.min(skeletonRows, SKELETON_CARDS) }, (_, i) => (
            <li key={i} className={styles.skeleton}><Skeleton w="45%" /><Skeleton w="25%" /></li>
          ))}
        </ul>
      ) : groups.map((g) => {
        const entries = groupBy && groupHeader ? groupHeader(g.key, g.rows) : {};
        return (
          <div key={g.key ?? "rows"} className={styles.group}>
            {groupBy && (
              <div className={styles.groupHead}>
                <span className={styles.groupLabel}>{entries[first.key] ?? g.key}</span>
                {entryList(columns, entries, styles.groupValues)}
              </div>
            )}
            <ul className={styles.list} aria-label={groupBy ? String(g.key) : label}>
              {g.rows.map((row, i) => {
                const key = rowKey(row);
                return (
                  <DataCard
                    key={key}
                    row={row}
                    index={i}
                    columns={columns}
                    label={rowLabel ? rowLabel(row) : String(key)}
                    onClick={onRowClick}
                    actions={rowActions && ((close) => rowActions(row, close))}
                    attrs={rowProps?.(row)}
                    after={rowAfter?.(row, "cards")}
                    held={expanded?.(row)}
                  />
                );
              })}
            </ul>
          </div>
        );
      })}
      {footer && !loading && (
        <div className={styles.foot}>
          <span className={styles.footLabel}>{footer[first.key]}</span>
          {entryList(columns, footer, styles.footValues)}
        </div>
      )}
    </div>
  );
}
