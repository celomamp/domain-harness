import { describe, expect, it } from "vitest";
import { action } from "./sign-out.ts";

describe("sign-out", () => {
  it("clears the session cookie and redirects", () => {
    const response = action({ request: new Request("http://localhost/sign-out", { method: "POST" }) } as never);
    expect(response.headers.get("location")).toBe("/sign-in");
    expect(response.headers.get("set-cookie")).toMatch(/dh_session=; Max-Age=0/);
  });
});
