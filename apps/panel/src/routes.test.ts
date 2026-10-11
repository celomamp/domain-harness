import { describe, expect, it } from "vitest";
import routes from "./routes.ts";

interface Entry {
  readonly path?: string;
  readonly index?: boolean;
  readonly file: string;
  readonly children?: readonly Entry[];
}

const entries = routes as readonly Entry[];

describe("route wiring", () => {
  it("nests Inventory, Standards and a Module's Standards under the session-guarded panel layout", () => {
    const layout = entries.find((e) => e.file === "routes/panel-layout.tsx");
    expect(layout?.path).toBeUndefined();
    expect(layout?.children?.map((c) => [c.path, c.file])).toEqual([
      ["inventory", "routes/inventory.tsx"],
      ["standards", "routes/standards.tsx"],
      ["standards/:moduleId", "routes/module-standards.tsx"],
    ]);
  });

  it("serves no panel surface from a top-level entry", () => {
    for (const entry of entries) {
      expect(["inventory", "standards", "standards/:moduleId"]).not.toContain(entry.path);
      expect(["routes/inventory.tsx", "routes/standards.tsx", "routes/module-standards.tsx"]).not.toContain(entry.file);
    }
  });

  it("maps sign-in and the emailed link's verify path", () => {
    expect(entries.find((e) => e.path === "sign-in")?.file).toBe("routes/sign-in.tsx");
    expect(entries.find((e) => e.path === "sign-in/verify")?.file).toBe("routes/sign-in-verify.ts");
    expect(entries.find((e) => e.index === true)?.file).toBe("routes/home.tsx");
  });
});
