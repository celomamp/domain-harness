/**
 * The Boilerplate plan (Story 3.3): the pure step between the Effective
 * Standard set and the rendered files. It checks the pilot's ecosystem limit
 * (TypeScript/npm), derives the dependency pins from the required code-stack
 * entries, checks them against the prohibited ones, and gathers the
 * design-system references. No I/O; equal inputs give equal plans.
 */
import { BOILERPLATE_CONFLICT, UNSUPPORTED_ECOSYSTEM } from "@domain-harness/contract";
import type {
  CodeStackCategory,
  CodeStackEntry,
  EffectiveStandardSet,
  ErrorEnvelope,
  ProjectRef,
} from "@domain-harness/contract";

/** The required languages the pilot supports (lowercased). */
export const SUPPORTED_LANGUAGES = ["typescript", "javascript"] as const;

/** A valid npm package name, lowercase, optionally scoped. */
const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
const NPM_NAME_MAX = 214;

/** True when `name` (already lowercased) is a valid npm package name. */
export function isNpmPackageName(name: string): boolean {
  return name.length <= NPM_NAME_MAX && NPM_NAME.test(name);
}

/** One code-stack entry as the instructions list it. */
export interface StackItem {
  readonly category: CodeStackCategory;
  /** Trimmed, in the Standard owner's spelling. */
  readonly name: string;
  readonly versionConstraint: string | null;
  /** The Standard owner's correction instruction, as authored; `null` when none. */
  readonly correctionInstruction: string | null;
}

/** One required entry and the pin it became (`null` for a language with no package, e.g. JavaScript). */
export interface PinnedItem extends StackItem {
  readonly pin: { readonly packageName: string; readonly version: string; readonly dev: boolean } | null;
}

/** A design-system component as the references list it. */
export interface ComponentReference {
  readonly name: string;
  readonly usageRule: string;
  readonly tokens: readonly string[];
  /** The Standard owner's correction instruction, as authored; `null` when none. */
  readonly correctionInstruction: string | null;
}

/** The design-system references of the set, in core order. */
export interface DesignSystemReferences {
  readonly requiredImports: readonly string[];
  readonly prohibitedImports: readonly string[];
  readonly requiredTokens: readonly string[];
  readonly prohibitedTokens: readonly string[];
  readonly components: readonly ComponentReference[];
}

/** Everything the renderers need, target-independent. */
export interface BoilerplatePlan {
  readonly project: ProjectRef;
  /** Package name → version, keys sorted. */
  readonly dependencies: Readonly<Record<string, string>>;
  /** Package name → version, keys sorted. */
  readonly devDependencies: Readonly<Record<string, string>>;
  /** The required entries in core order, with their pins. */
  readonly required: readonly PinnedItem[];
  /** Never pinned; listed with their constraints. */
  readonly approved: readonly StackItem[];
  /** Never pinned; listed as prohibited. */
  readonly prohibited: readonly StackItem[];
  readonly designSystem: DesignSystemReferences;
}

export type BoilerplatePlanResult =
  | { readonly ok: true; readonly plan: BoilerplatePlan }
  | { readonly ok: false; readonly error: ErrorEnvelope };

const label = (item: StackItem): string => `${item.category} ${item.name}`;

/** "a", "a and b", "a, b and c". */
function listing(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1] ?? ""}`;
}

function sortedRecord(entries: ReadonlyMap<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of [...entries.keys()].sort()) out[key] = entries.get(key) ?? "*";
  return out;
}

/** The pin of a required entry, `null` for a supported language with no package, or `undefined` when unsupported. */
function pinOf(item: StackItem): PinnedItem["pin"] | undefined {
  const name = item.name.toLowerCase();
  const version = item.versionConstraint ?? "*";
  if (item.category === "language") {
    if (name === "typescript") return { packageName: "typescript", version, dev: true };
    if (name === "javascript") return null;
    return undefined;
  }
  return isNpmPackageName(name) ? { packageName: name, version, dev: false } : undefined;
}

/**
 * Plan the Boilerplate of an Effective Standard set. First failure wins:
 * any required code-stack entry outside TypeScript/npm →
 * `unsupported_ecosystem` (one sentence naming each as `<category> <name>`);
 * a pin named like a prohibited code-stack entry (case-insensitively) or two
 * required entries pinning one package to different versions →
 * `boilerplate_conflict` (one sentence naming them). Approved and prohibited
 * entries are never pinned.
 */
export function planBoilerplate(set: EffectiveStandardSet): BoilerplatePlanResult {
  const required: StackItem[] = [];
  const approved: StackItem[] = [];
  const prohibited: StackItem[] = [];
  const requiredImports: string[] = [];
  const prohibitedImports: string[] = [];
  const requiredTokens: string[] = [];
  const prohibitedTokens: string[] = [];
  const components: ComponentReference[] = [];

  for (const effective of set.standards) {
    const entry = effective.standard.entry;
    if ("category" in entry) {
      const stack: CodeStackEntry = entry;
      const item: StackItem = {
        category: stack.category,
        name: stack.name.trim(),
        versionConstraint: stack.versionConstraint,
        correctionInstruction: stack.correctionInstruction,
      };
      if (stack.status === "required") required.push(item);
      else if (stack.status === "approved") approved.push(item);
      else prohibited.push(item);
      continue;
    }
    switch (entry.kind) {
      case "import":
        (entry.status === "required" ? requiredImports : prohibitedImports).push(entry.specifier);
        break;
      case "token":
        (entry.status === "required" ? requiredTokens : prohibitedTokens).push(entry.name);
        break;
      case "component":
        components.push({
          name: entry.name,
          usageRule: entry.usageRule,
          tokens: [...entry.tokens],
          correctionInstruction: entry.correctionInstruction,
        });
        break;
    }
  }

  // Ecosystem check: every unsupported required entry, before anything is pinned or rendered.
  const pinned: PinnedItem[] = required.map((item) => ({ ...item, pin: pinOf(item) ?? null }));
  const unsupported = required.filter((item) => pinOf(item) === undefined);
  if (unsupported.length > 0) {
    return {
      ok: false,
      error: {
        code: UNSUPPORTED_ECOSYSTEM,
        message: `The Effective Standard set requires ${listing(unsupported.map(label))}, which the pilot does not support (TypeScript and npm only), so nothing was generated`,
        subject: "standards",
      },
    };
  }

  // Conflict check: a pin must never be a prohibited entry, and one package gets one version.
  const deps = new Map<string, string>();
  const devDeps = new Map<string, string>();
  const owners = new Map<string, PinnedItem>();
  const conflicts: string[] = [];
  for (const item of pinned) {
    if (item.pin === null) continue;
    const { packageName, version, dev } = item.pin;
    const earlier = owners.get(packageName);
    if (earlier !== undefined) {
      if (earlier.pin?.version !== version || earlier.pin.dev !== dev) {
        conflicts.push(
          `the required ${label(earlier)} and the required ${label(item)} pin ${packageName} to different versions`,
        );
      }
      continue;
    }
    owners.set(packageName, item);
    (dev ? devDeps : deps).set(packageName, version);
    for (const banned of prohibited) {
      if (banned.name.toLowerCase() === packageName) {
        conflicts.push(`the required ${label(item)} is the prohibited ${label(banned)}`);
      }
    }
  }
  if (conflicts.length > 0) {
    const sentence = listing(conflicts);
    return {
      ok: false,
      error: {
        code: BOILERPLATE_CONFLICT,
        message: `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}, so nothing was generated`,
        subject: "standards",
      },
    };
  }

  return {
    ok: true,
    plan: {
      project: set.project,
      dependencies: sortedRecord(deps),
      devDependencies: sortedRecord(devDeps),
      required: pinned,
      approved,
      prohibited,
      designSystem: { requiredImports, prohibitedImports, requiredTokens, prohibitedTokens, components },
    },
  };
}
