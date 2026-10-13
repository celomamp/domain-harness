/**
 * The Boilerplate file renderers (Story 3.3). Pure functions: equal inputs
 * give byte-identical files, each ending in "\n"; JSON uses two-space
 * indentation, with keys sorted where they come from data.
 *
 * The identification file, `package.json` and `design-system.json` are
 * target-independent, so every target ships them byte for byte the same.
 * Only the MCP configuration and the instruction files differ per target.
 * No file holds hook configuration of any kind.
 */
import { formatIdentificationFile, IDENTIFICATION_FILE_NAME, MCP_BRIDGE_PACKAGE } from "@domain-harness/contract";
import type { BoilerplateArtifactKind, BoilerplateTarget, UuidV7 } from "@domain-harness/contract";
import type { BoilerplatePlan, StackItem } from "./plan.ts";

/** One rendered file of the archive. */
export interface BoilerplateFile {
  readonly kind: BoilerplateArtifactKind;
  readonly path: string;
  readonly content: string;
}

/** The name of the MCP server every Boilerplate declares. */
export const MCP_SERVER_NAME = "domain-harness";
/** The Claude Code skill directory name. */
export const GUIDANCE_SKILL_NAME = "domain-harness-guidance";

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** One line of free text: newlines and runs of whitespace collapse to one space. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** `.domain-harness.json`: the contract's only serializer. */
export function renderIdentificationFile(applicationId: UuidV7, projectId: UuidV7): string {
  return formatIdentificationFile(applicationId, projectId);
}

/** `package.json`: the required entries as pins; approved and prohibited entries are never pinned. */
export function renderPackageJson(applicationId: UuidV7, plan: BoilerplatePlan): string {
  return json({
    name: `application-${applicationId}`,
    private: true,
    type: "module",
    dependencies: plan.dependencies,
    devDependencies: plan.devDependencies,
  });
}

/** `design-system.json`: required and prohibited imports and tokens, and components, in core order. */
export function renderDesignSystem(plan: BoilerplatePlan): string {
  const ds = plan.designSystem;
  return json({
    requiredImports: ds.requiredImports,
    prohibitedImports: ds.prohibitedImports,
    requiredTokens: ds.requiredTokens,
    prohibitedTokens: ds.prohibitedTokens,
    components: ds.components.map((component) => ({
      name: component.name,
      usageRule: component.usageRule,
      tokens: component.tokens,
    })),
  });
}

/** `.mcp.json`: the stdio bridge, run through npx with the Guidance endpoint URL as its argument. */
export function renderClaudeMcpJson(guidanceUrl: string): string {
  return json({
    mcpServers: { [MCP_SERVER_NAME]: { command: "npx", args: ["-y", MCP_BRIDGE_PACKAGE, guidanceUrl] } },
  });
}

const INITIAL_COMMIT_RULE =
  "Make an initial commit before calling Guidance: the Domain Harness bridge identifies this repository by its root commit, so Guidance cannot answer before one exists.";

const stackLine = (item: StackItem): string =>
  `- ${item.category} ${oneLine(item.name)}${item.versionConstraint === null ? "" : ` (${oneLine(item.versionConstraint)})`}`;

const bullets = (lines: readonly string[], none: string): string => (lines.length === 0 ? `- ${none}` : lines.join("\n"));

const code = (text: string): string => `\`${oneLine(text).replace(/`/g, "'")}\``;

/** `CLAUDE.md`: the Project, the stack, the design-system rules and the initial-commit rule. */
export function renderClaudeMd(applicationId: UuidV7, plan: BoilerplatePlan): string {
  const ds = plan.designSystem;
  const pinned = plan.required.map((item) => {
    const where = item.pin === null ? "no package" : `${item.pin.dev ? "devDependencies" : "dependencies"}.${oneLine(item.pin.packageName)} = "${oneLine(item.pin.version)}"`;
    return `${stackLine(item)}: ${where}`;
  });
  const components = ds.components.map(
    (component) =>
      `- ${oneLine(component.name)}: ${oneLine(component.usageRule)}${
        component.tokens.length === 0 ? "" : ` (tokens: ${component.tokens.map(code).join(", ")})`
      }`,
  );
  const sections = [
    "# Domain Harness",
    "",
    `This repository is the Application \`${applicationId}\`, placed on the Project ${oneLine(plan.project.name)} (\`${plan.project.id}\`). Its Project identification file is \`${IDENTIFICATION_FILE_NAME}\`; do not edit or delete it.`,
    "",
    "## Before you start",
    "",
    INITIAL_COMMIT_RULE,
    "",
    `Then request Guidance through the \`${MCP_SERVER_NAME}\` MCP server (declared in \`.mcp.json\`) before you add a dependency, a component or a design token.`,
    "",
    "## Code stack",
    "",
    "Required (pinned in `package.json`):",
    "",
    bullets(pinned, "none"),
    "",
    "Approved (not pinned; you may add them within their constraints):",
    "",
    bullets(plan.approved.map(stackLine), "none"),
    "",
    "Prohibited (never add them):",
    "",
    bullets(plan.prohibited.map(stackLine), "none"),
    "",
    "## Design system",
    "",
    "The full references are in `design-system.json`.",
    "",
    "Required imports:",
    "",
    bullets(ds.requiredImports.map((item) => `- ${code(item)}`), "none"),
    "",
    "Prohibited imports:",
    "",
    bullets(ds.prohibitedImports.map((item) => `- ${code(item)}`), "none"),
    "",
    "Required tokens:",
    "",
    bullets(ds.requiredTokens.map((item) => `- ${code(item)}`), "none"),
    "",
    "Prohibited tokens:",
    "",
    bullets(ds.prohibitedTokens.map((item) => `- ${code(item)}`), "none"),
    "",
    "Components:",
    "",
    bullets(components, "none"),
  ];
  return `${sections.join("\n")}\n`;
}

/** `.claude/skills/domain-harness-guidance/SKILL.md`: how to request Guidance, and the initial-commit rule. */
export function renderClaudeSkill(): string {
  return `${[
    "---",
    `name: ${GUIDANCE_SKILL_NAME}`,
    "description: Request Company Guidance from Domain Harness before adding a dependency, a component or a design token to this Application.",
    "---",
    "",
    "# Domain Harness Guidance",
    "",
    INITIAL_COMMIT_RULE,
    "",
    "## How to request Guidance",
    "",
    `1. Use the tools of the \`${MCP_SERVER_NAME}\` MCP server. It is declared in \`.mcp.json\` and needs no manual setup.`,
    "2. Describe what you are about to add or change, and follow the Guidance it returns.",
    `3. Keep \`${IDENTIFICATION_FILE_NAME}\` at the repository root; Guidance finds this Application through it.`,
    "",
    "The Standards this Application must follow are summarised in `CLAUDE.md`, `package.json` and `design-system.json`.",
  ].join("\n")}\n`;
}

/** The inputs every renderer reads. */
export interface RenderInput {
  readonly applicationId: UuidV7;
  readonly projectId: UuidV7;
  readonly guidanceUrl: string;
  readonly plan: BoilerplatePlan;
}

/** The target-independent files, in archive order. */
export function renderSharedFiles(input: RenderInput): BoilerplateFile[] {
  return [
    {
      kind: "identification-file",
      path: IDENTIFICATION_FILE_NAME,
      content: renderIdentificationFile(input.applicationId, input.projectId),
    },
    { kind: "dependency-pins", path: "package.json", content: renderPackageJson(input.applicationId, input.plan) },
    { kind: "design-system-references", path: "design-system.json", content: renderDesignSystem(input.plan) },
  ];
}

/** The target-specific files of each target, in archive order (after the shared ones). */
const TARGET_FILES: Readonly<Record<BoilerplateTarget, (input: RenderInput) => BoilerplateFile[]>> = {
  "claude-code": (input) => [
    { kind: "mcp-configuration", path: ".mcp.json", content: renderClaudeMcpJson(input.guidanceUrl) },
    { kind: "instructions", path: "CLAUDE.md", content: renderClaudeMd(input.applicationId, input.plan) },
    { kind: "skills", path: `.claude/skills/${GUIDANCE_SKILL_NAME}/SKILL.md`, content: renderClaudeSkill() },
  ],
};

/** Every file of one target's Boilerplate, in archive order: the shared files, then the target's own. */
export function renderBoilerplateFiles(target: BoilerplateTarget, input: RenderInput): BoilerplateFile[] {
  return [...renderSharedFiles(input), ...TARGET_FILES[target](input)];
}
