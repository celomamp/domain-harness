// Static consistency checks for the Fly staging artifacts (offline: no
// Docker, no network, no database). These pin what `fly config validate`
// cannot see: cross-file hostname/port agreement, Dockerfile COPY/CMD
// coverage, and the panel runtime bundle containing no workspace imports.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function tomlValue(body: string, key: string): string {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m").exec(body);
  if (match?.[1] === undefined) throw new Error(`missing ${key}`);
  return match[1];
}

function tomlInt(body: string, key: string): number {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(\\d+)`, "m").exec(body);
  if (match?.[1] === undefined) throw new Error(`missing ${key}`);
  return Number.parseInt(match[1], 10);
}

const registry = read("fly.registry-staging.toml");
const panel = read("fly.panel-staging.toml");
const service = read("fly.service-staging.toml");
const guidance = read("fly.guidance-staging.toml");

describe("fly apps share one region and stay on", () => {
  for (const [name, body] of Object.entries({ registry, panel, guidance })) {
    it(`${name} targets iad with always-on Machines`, () => {
      expect(tomlValue(body, "primary_region")).toBe("iad");
      expect(body).toContain("auto_stop_machines = false");
      expect(body).toContain("min_machines_running = 1");
    });
  }

  it("service targets iad and stays on via scale count (no services to carry placement)", () => {
    expect(tomlValue(service, "primary_region")).toBe("iad");
    expect(service).not.toContain("[[services]]");
    expect(read("docs/staging.md")).toContain("fly scale count 1 --app dh-service-staging");
  });
});

describe("cross-app wiring agrees", () => {
  it("panel reaches the registry over the private network on the registry port", () => {
    const registryApp = tomlValue(registry, "app");
    const registryPort = tomlInt(registry, "internal_port");
    expect(tomlValue(panel, "PANEL_REGISTRY_URL")).toBe(`http://${registryApp}.internal:${String(registryPort)}`);
    expect(tomlInt(panel, "internal_port")).toBe(Number.parseInt(tomlValue(panel, "PORT"), 10));
  });

  it("registry listens where its toml says", () => {
    expect(tomlInt(registry, "internal_port")).toBe(Number.parseInt(tomlValue(registry, "REGISTRY_HTTP_PORT"), 10));
    expect(tomlValue(registry, "REGISTRY_HTTP_HOST")).toBe("0.0.0.0");
  });

  it("service and guidance pull from the internal registry", () => {
    const registryApp = tomlValue(registry, "app");
    const registryPort = tomlInt(registry, "internal_port");
    const expected = `http://${registryApp}.internal:${String(registryPort)}`;
    expect(tomlValue(service, "SERVICE_VENDOR_URL")).toBe(expected);
    expect(tomlValue(guidance, "SERVICE_VENDOR_URL")).toBe(expected);
  });

  it("guidance listens where its toml says", () => {
    expect(tomlInt(guidance, "internal_port")).toBe(
      Number.parseInt(tomlValue(guidance, "SERVICE_GUIDANCE_PORT"), 10),
    );
  });

  it("service daemon declares no services or checks", () => {
    expect(service).not.toContain("[[services]]");
  });

  it("registry release command runs the migrator that exists", () => {
    expect(registry).toContain("src/db/migrate-cli.ts");
    expect(existsSync(join(ROOT, "apps/registry/src/db/migrate-cli.ts"))).toBe(true);
  });
});

describe("Dockerfiles cover their runtime", () => {
  const images = [
    { dockerfile: "apps/registry/Dockerfile", entry: "apps/registry/src/http/serve-cli.ts" },
    { dockerfile: "apps/service/Dockerfile.guidance", entry: "apps/service/src/guidance/server-cli.ts" },
    { dockerfile: "apps/panel/Dockerfile", entry: "apps/panel/server.js" },
  ];

  for (const { dockerfile, entry } of images) {
    it(`${dockerfile}: every COPY source and the CMD entry exist`, () => {
      const body = read(dockerfile);
      expect(existsSync(join(ROOT, entry))).toBe(true);
      for (const line of body.split("\n")) {
        const copy = /^COPY\s+(.+)$/.exec(line.trim());
        if (copy?.[1] === undefined) continue;
        const parts = copy[1].split(/\s+/).filter((p) => !p.startsWith("--from=") && !p.startsWith("/"));
        for (const src of parts.slice(0, -1)) {
          expect(existsSync(join(ROOT, src)), src).toBe(true);
        }
      }
    });
  }

  it("each fly toml build points at a Dockerfile that exists", () => {
    for (const body of [registry, panel, service, guidance]) {
      expect(existsSync(join(ROOT, tomlValue(body, "dockerfile")))).toBe(true);
    }
  });

  it.skipIf(!existsSync(join(ROOT, "apps/panel/dist/server/index.js")))(
    "panel runtime bundle has no workspace runtime imports (slim image is complete)",
    () => {
      // Bare mentions (e.g. a comment) are fine; only real module loads count.
      const runtimeImport = /from\s+["']@domain-harness\/|require\(\s*["']@domain-harness\//;
      for (const rel of ["apps/panel/dist/server/index.js", "apps/panel/server.js"]) {
        expect(read(rel), rel).not.toMatch(runtimeImport);
      }
    },
  );
});
