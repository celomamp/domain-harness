import { describe, expect, it } from "vitest";
import { parseIdentificationFile } from "@domain-harness/contract";
import { mintUuidV7 } from "../ids.ts";
import type { BoilerplatePlan } from "./plan.ts";
import {
  renderAgentsMd,
  renderBoilerplateFiles,
  renderClaudeMcpJson,
  renderClaudeMd,
  renderClaudeSkill,
  renderCursorMcpJson,
  renderCursorSkill,
  renderDesignSystem,
  renderPackageJson,
  renderSharedFiles,
} from "./render.ts";

const APP = mintUuidV7();
const PROJECT = mintUuidV7();
const URL = "https://g.acme.example/v1";

const plan: BoilerplatePlan = {
  project: { id: PROJECT, name: "Web" },
  dependencies: { react: "^19" },
  devDependencies: { typescript: "~5.6" },
  required: [
    { category: "language", name: "TypeScript", versionConstraint: "~5.6", correctionInstruction: null, pin: { packageName: "typescript", version: "~5.6", dev: true } },
    { category: "library", name: "React", versionConstraint: "^19", correctionInstruction: "Use React,\n  not Preact.", pin: { packageName: "react", version: "^19", dev: false } },
  ],
  approved: [{ category: "library", name: "zod", versionConstraint: "^3", correctionInstruction: "Stay on zod 3." }],
  prohibited: [
    { category: "library", name: "lodash", versionConstraint: null, correctionInstruction: null },
    {
      category: "library",
      name: "moment",
      versionConstraint: null,
      correctionInstruction: "Use date-fns instead of moment.\nReplace moment() with new Date().",
    },
  ],
  designSystem: {
    requiredImports: ["@acme/ui"],
    prohibitedImports: [],
    requiredTokens: ["color.brand"],
    prohibitedTokens: [],
    components: [{ name: "Button", usageRule: "Use for\nactions", tokens: ["color.brand"] }],
  },
};

const input = { applicationId: APP, projectId: PROJECT, guidanceUrl: URL, plan };

describe("Boilerplate renderers", () => {
  it("renders the six Claude Code files in a fixed order, each ending in a newline", () => {
    const files = renderBoilerplateFiles("claude-code", input);
    expect(files.map((f) => [f.kind, f.path])).toEqual([
      ["identification-file", ".domain-harness.json"],
      ["dependency-pins", "package.json"],
      ["design-system-references", "design-system.json"],
      ["mcp-configuration", ".mcp.json"],
      ["instructions", "CLAUDE.md"],
      ["skills", ".claude/skills/domain-harness-guidance/SKILL.md"],
    ]);
    for (const file of files) expect(file.content.endsWith("\n")).toBe(true);
    expect(renderBoilerplateFiles("claude-code", input)).toEqual(files);
  });

  it("starts with the target-independent files", () => {
    expect(renderBoilerplateFiles("claude-code", input).slice(0, 3)).toEqual(renderSharedFiles(input));
  });

  it("writes an identification file that parses to the Application and its Project", () => {
    const [id] = renderSharedFiles(input);
    expect(parseIdentificationFile(id?.content ?? null)).toEqual({
      kind: "parsed",
      file: { version: "1.0.0", applicationId: APP, projectId: PROJECT },
    });
  });

  it("pins only the required entries in package.json", () => {
    const text = renderPackageJson(APP, plan);
    expect(text).toBe(
      `${JSON.stringify(
        {
          name: `application-${APP}`,
          private: true,
          type: "module",
          dependencies: { react: "^19" },
          devDependencies: { typescript: "~5.6" },
        },
        null,
        2,
      )}\n`,
    );
    expect(text).not.toContain("zod");
    expect(text).not.toContain("lodash");
  });

  it("lists the design-system references", () => {
    expect(JSON.parse(renderDesignSystem(plan))).toEqual({
      requiredImports: ["@acme/ui"],
      prohibitedImports: [],
      requiredTokens: ["color.brand"],
      prohibitedTokens: [],
      components: [{ name: "Button", usageRule: "Use for\nactions", tokens: ["color.brand"] }],
    });
  });

  it("declares the bridge through npx with the URL as its last argument", () => {
    expect(JSON.parse(renderClaudeMcpJson(URL))).toEqual({
      mcpServers: { "domain-harness": { command: "npx", args: ["-y", "@domain-harness/mcp-bridge", URL] } },
    });
  });

  it("has npx install a configured bridge tarball instead of the npm package, in both targets", () => {
    const tarball = "https://github.com/acme/domain-harness/releases/download/pilot-0.1/mcp-bridge.tgz";
    expect(JSON.parse(renderClaudeMcpJson(URL, tarball))).toEqual({
      mcpServers: { "domain-harness": { command: "npx", args: ["-y", tarball, URL] } },
    });
    expect(JSON.parse(renderCursorMcpJson(URL, tarball))).toEqual({
      mcpServers: { "domain-harness": { type: "stdio", command: "npx", args: ["-y", tarball, URL] } },
    });
  });

  it("tells the agent to make an initial commit before calling Guidance, in CLAUDE.md and the skill", () => {
    for (const text of [renderClaudeMd(APP, plan), renderClaudeSkill()]) {
      expect(text.toLowerCase()).toContain("make an initial commit before calling guidance");
    }
  });

  it("names DH_GUIDANCE_TOKEN for a token-protected endpoint, in CLAUDE.md and the skill, never a token value", () => {
    for (const text of [renderClaudeMd(APP, plan), renderClaudeSkill()]) {
      expect(text).toContain("`DH_GUIDANCE_TOKEN`");
    }
  });

  it("lists the Project and the pinned, approved and prohibited stack in CLAUDE.md", () => {
    const text = renderClaudeMd(APP, plan);
    expect(text).toContain(APP);
    expect(text).toContain("Web");
    expect(text).toContain('library React (^19): dependencies.react = "^19"');
    expect(text).toContain("- library zod (^3)");
    expect(text).toContain("- library lodash");
    expect(text).toContain("- Button: Use for actions");
  });

  it("renders each correction instruction as one indented line under its stack item", () => {
    const text = renderClaudeMd(APP, plan);
    expect(text).toContain(
      "- library moment\n  Correction: Use date-fns instead of moment. Replace moment() with new Date().\n",
    );
    expect(text).toContain('- library React (^19): dependencies.react = "^19"\n  Correction: Use React, not Preact.\n');
    expect(text).toContain("- library zod (^3)\n  Correction: Stay on zod 3.\n");
  });

  it("adds no Correction line to an entry without one", () => {
    const text = renderClaudeMd(APP, plan);
    expect(text).toContain("- library lodash\n- library moment");
    expect(text).toContain('- language TypeScript (~5.6): devDependencies.typescript = "~5.6"\n- library React');
    expect(text.match(/Correction:/g)).toHaveLength(3);
  });

  it("starts the skill with name and description frontmatter", () => {
    expect(renderClaudeSkill()).toMatch(/^---\nname: domain-harness-guidance\ndescription: .+\n---\n/);
  });

  it("holds no hook configuration and no settings file", () => {
    for (const file of renderBoilerplateFiles("claude-code", input)) {
      expect(file.path).not.toContain("settings");
      expect(file.content).not.toContain('"hooks"');
    }
  });
});

describe("Cursor renderers", () => {
  it("renders the six Cursor files in a fixed order, each ending in a newline", () => {
    const files = renderBoilerplateFiles("cursor", input);
    expect(files.map((f) => [f.kind, f.path])).toEqual([
      ["identification-file", ".domain-harness.json"],
      ["dependency-pins", "package.json"],
      ["design-system-references", "design-system.json"],
      ["mcp-configuration", ".cursor/mcp.json"],
      ["instructions", "AGENTS.md"],
      ["skills", ".cursor/skills/domain-harness-guidance/SKILL.md"],
    ]);
    for (const file of files) expect(file.content.endsWith("\n")).toBe(true);
    expect(renderBoilerplateFiles("cursor", input)).toEqual(files);
  });

  it("ships the shared files byte for byte the same as Claude Code", () => {
    const claude = renderBoilerplateFiles("claude-code", input);
    const cursor = renderBoilerplateFiles("cursor", input);
    expect(cursor.slice(0, 3)).toEqual(claude.slice(0, 3));
    expect(cursor.slice(0, 3)).toEqual(renderSharedFiles(input));
  });

  it("declares the same bridge as .mcp.json plus Cursor's type field", () => {
    expect(JSON.parse(renderCursorMcpJson(URL))).toEqual({
      mcpServers: { "domain-harness": { type: "stdio", command: "npx", args: ["-y", "@domain-harness/mcp-bridge", URL] } },
    });
    const claude = JSON.parse(renderClaudeMcpJson(URL)) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    const cursor = JSON.parse(renderCursorMcpJson(URL)) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    for (const key of ["command", "args"]) {
      expect(cursor.mcpServers["domain-harness"]?.[key]).toEqual(claude.mcpServers["domain-harness"]?.[key]);
    }
  });

  it("renders AGENTS.md as the exact CLAUDE.md content with the one path reference swapped", () => {
    const claude = renderClaudeMd(APP, plan);
    const agents = renderAgentsMd(APP, plan);
    expect(claude).toContain("declared in `.mcp.json`");
    expect(agents).toBe(claude.replace("declared in `.mcp.json`", "declared in `.cursor/mcp.json`"));
    expect(agents).not.toContain("`.mcp.json`");
  });

  it("renders the Cursor skill as the exact Claude skill content with the same one path swap", () => {
    const claude = renderClaudeSkill();
    const cursor = renderCursorSkill();
    expect(claude).toContain("declared in `.mcp.json`");
    expect(cursor).toBe(claude.replace("declared in `.mcp.json`", "declared in `.cursor/mcp.json`"));
    expect(cursor).not.toContain("`.mcp.json`");
  });

  it("tells the agent to make an initial commit before calling Guidance, in AGENTS.md and the skill", () => {
    for (const text of [renderAgentsMd(APP, plan), renderCursorSkill()]) {
      expect(text.toLowerCase()).toContain("make an initial commit before calling guidance");
    }
  });

  it("lists the Project and the pinned, approved and prohibited stack in AGENTS.md", () => {
    const text = renderAgentsMd(APP, plan);
    expect(text).toContain(APP);
    expect(text).toContain("Web");
    expect(text).toContain('library React (^19): dependencies.react = "^19"');
    expect(text).toContain("- library zod (^3)");
    expect(text).toContain("- library lodash");
    expect(text).toContain("- library moment\n  Correction: Use date-fns instead of moment. Replace moment() with new Date().");
  });

  it("starts the Cursor skill with the same name and description frontmatter", () => {
    expect(renderCursorSkill()).toMatch(/^---\nname: domain-harness-guidance\ndescription: .+\n---\n/);
  });

  it("holds no hook configuration and no settings file", () => {
    for (const file of renderBoilerplateFiles("cursor", input)) {
      expect(file.path).not.toContain("settings");
      expect(file.content).not.toContain('"hooks"');
    }
  });
});
