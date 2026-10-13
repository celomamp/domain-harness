import { describe, expect, it } from "vitest";
import { parseIdentificationFile } from "@domain-harness/contract";
import { mintUuidV7 } from "../ids.ts";
import type { BoilerplatePlan } from "./plan.ts";
import {
  renderBoilerplateFiles,
  renderClaudeMcpJson,
  renderClaudeMd,
  renderClaudeSkill,
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
    { category: "language", name: "TypeScript", versionConstraint: "~5.6", pin: { packageName: "typescript", version: "~5.6", dev: true } },
    { category: "library", name: "React", versionConstraint: "^19", pin: { packageName: "react", version: "^19", dev: false } },
  ],
  approved: [{ category: "library", name: "zod", versionConstraint: "^3" }],
  prohibited: [{ category: "library", name: "lodash", versionConstraint: null }],
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

  it("tells the agent to make an initial commit before calling Guidance, in CLAUDE.md and the skill", () => {
    for (const text of [renderClaudeMd(APP, plan), renderClaudeSkill()]) {
      expect(text.toLowerCase()).toContain("make an initial commit before calling guidance");
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
