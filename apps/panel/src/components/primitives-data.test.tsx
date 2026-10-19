// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable, sortRows } from "./data-table.tsx";
import { Toolbar } from "./toolbar.tsx";

const rows = [{ id: "b", name: "Beta", count: 2 }, { id: "a", name: "Alpha", count: 10 }];
const emptyRows: typeof rows = [];

afterEach(cleanup);

describe("data primitives", () => {
  it("sorts rows without mutating the input", () => {
    const sorted = sortRows(rows, { column: "name", direction: "asc" }, (row, column) => row[column as "name"]);
    expect(sorted.map((row) => row.id)).toEqual(["a", "b"]);
    expect(rows.map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("sorts numbers numerically", () => {
    const sorted = sortRows(rows, { column: "count", direction: "desc" }, (row, column) => row[column as "count"]);
    expect(sorted.map((row) => row.count)).toEqual([10, 2]);
  });

  it("renders a caption, headers, rows, and an empty state", () => {
    const { rerender } = render(
      <DataTable
        caption="Applications"
        columns={[{ id: "name", header: "Application" }]}
        rows={rows}
        rowKey={(row) => row.id}
      />,
    );
    expect(screen.getByRole("table", { name: "Applications" })).toBeTruthy();
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Application"]);
    expect(screen.getAllByRole("row")).toHaveLength(3);

    rerender(
      <DataTable
        caption="Applications"
        columns={[{ id: "name", header: "Application" }]}
        rows={emptyRows}
        rowKey={(row) => row.id}
        empty={<p>No Application yet.</p>}
      />,
    );
    expect(screen.getByText("No Application yet.")).toBeTruthy();
  });

  it("exposes a labelled search and the result count", () => {
    const onSearch = vi.fn();
    render(<Toolbar searchLabel="Search applications" searchValue="" onSearch={onSearch} count="3 Applications" />);
    fireEvent.change(screen.getByLabelText("Search applications"), { target: { value: "checkout" } });
    expect(onSearch).toHaveBeenCalledWith("checkout");
    expect(screen.getByText("3 Applications")).toBeTruthy();
  });
});
