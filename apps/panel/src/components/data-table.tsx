import type { ReactNode } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState {
  readonly column: string;
  readonly direction: SortDirection;
}

/** Return a sorted copy, leaving the caller's row order untouched. */
export function sortRows<T>(
  rows: readonly T[],
  sort: SortState | null,
  value: (row: T, column: string) => string | number,
): T[] {
  const copy = [...rows];
  if (!sort) return copy;

  const direction = sort.direction === "asc" ? 1 : -1;
  return copy.sort((left, right) => {
    const leftValue = value(left, sort.column);
    const rightValue = value(right, sort.column);
    const comparison =
      typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue));
    return comparison * direction;
  });
}

export interface DataTableProps<T> {
  readonly caption: string;
  readonly columns: readonly { readonly id: string; readonly header: string; readonly align?: "start" | "end" }[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly empty?: ReactNode;
  readonly footer?: ReactNode;
}

export function DataTable<T>({ caption, columns, rows, rowKey, empty, footer }: DataTableProps<T>) {
  const columnCount = Math.max(columns.length, 1);

  return (
    <div className="data-table__scroll" tabIndex={0}>
      <table className="data-table">
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                className={column.align === "end" ? "data-table__cell--end" : undefined}
                key={column.id}
                scope="col"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0
            ? rows.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => {
                    const cell = (row as Record<string, unknown>)[column.id];
                    return (
                      <td
                        className={column.align === "end" ? "data-table__cell--end" : undefined}
                        key={column.id}
                      >
                        {typeof cell === "string" || typeof cell === "number" ? cell : null}
                      </td>
                    );
                  })}
                </tr>
              ))
            : empty ? (
                <tr>
                  <td className="data-table__empty" colSpan={columnCount}>
                    {empty}
                  </td>
                </tr>
              ) : null}
        </tbody>
        {footer ? (
          <tfoot>
            <tr>
              <td colSpan={columnCount}>{footer}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
