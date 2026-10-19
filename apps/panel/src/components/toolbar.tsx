import type { ReactNode } from "react";
import type { SortState } from "./data-table.tsx";

export interface ToolbarProps {
  readonly searchLabel: string;
  readonly searchValue: string;
  readonly onSearch: (value: string) => void;
  readonly filters?: ReactNode;
  readonly count: string;
  readonly sort?: SortState | null;
  readonly onSort?: (sort: SortState) => void;
  readonly groupBy?: ReactNode;
  readonly onGroupBy?: (value: string) => void;
}

export function Toolbar({
  searchLabel,
  searchValue,
  onSearch,
  filters,
  count,
  sort,
  onSort,
  groupBy,
  onGroupBy,
}: ToolbarProps) {
  const nextDirection = sort?.direction === "asc" ? "desc" : "asc";

  return (
    <div className="toolbar">
      <label className="toolbar__search">
        <span>{searchLabel}</span>
        <input
          type="search"
          value={searchValue}
          onChange={(event) => {
            onSearch(event.currentTarget.value);
          }}
        />
      </label>
      {filters ? <div className="toolbar__filters">{filters}</div> : null}
      {groupBy ? (
        <div
          className="toolbar__group-by"
          onChange={
            onGroupBy
              ? (event) => {
                  const target = event.target;
                  if (
                    target instanceof HTMLInputElement ||
                    target instanceof HTMLSelectElement ||
                    target instanceof HTMLTextAreaElement
                  ) {
                    onGroupBy(target.value);
                  }
                }
              : undefined
          }
        >
          {groupBy}
        </div>
      ) : null}
      {sort && onSort ? (
        <button
          aria-label={`Sort ${sort.column} ${nextDirection === "asc" ? "ascending" : "descending"}`}
          className="toolbar__sort"
          onClick={() => {
            onSort({ column: sort.column, direction: nextDirection });
          }}
          type="button"
        >
          Sort: {sort.column} ({sort.direction === "asc" ? "ascending" : "descending"})
        </button>
      ) : null}
      <p className="toolbar__count" aria-live="polite">
        {count}
      </p>
    </div>
  );
}
