import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import {
  entrySlotKind,
  entrySlotName,
  isUuidV7,
  MODULE_HAS_NO_OWNER,
  MODULE_NOT_FOUND,
  NOT_MODULE_OWNER,
  PROJECT_NOT_FOUND,
  STANDARD_NOT_FOUND,
} from "@domain-harness/contract";
import type { SessionInfo, StandardInfo, StandardList, StandardVersionList, UuidV7 } from "@domain-harness/contract";
import { entrySlot, validatePublication } from "@domain-harness/core";
import type { SlotHolder } from "@domain-harness/core";
import { EnvelopeError } from "../errors.ts";
import { mintUuidV7 } from "../ids.ts";
import type { RegistryDb, RegistryTx } from "../db/client.ts";
import { moduleOwnerAssignments, modules, projects, standards, standardVersions } from "../db/schema.ts";
import { withTenant } from "../db/tenant-scope.ts";
import { accountNames, accountRef, ownerOf, toId, toModuleInfo } from "../modules/service.ts";
import type { ModuleRow } from "../modules/service.ts";
import { validatePublishBody } from "./validate.ts";

type StandardRow = typeof standards.$inferSelect;
type VersionRow = typeof standardVersions.$inferSelect;
type ProjectRow = typeof projects.$inferSelect;

const moduleNotFound = (): EnvelopeError =>
  new EnvelopeError({ code: MODULE_NOT_FOUND, message: "no such Module in this Company", subject: "moduleId" });

const standardNotFound = (): EnvelopeError =>
  new EnvelopeError({ code: STANDARD_NOT_FOUND, message: "no such Standard in this Company", subject: "standardId" });

/** What a publish targets: a Module (a new Standard) or an existing Standard (its next version). */
type PublishTarget = { readonly moduleId: unknown } | { readonly standardId: unknown };

/** Every Standard of a Module at its live (highest) version, oldest Standard first. Open to every role. */
export async function listStandards(db: RegistryDb, session: SessionInfo, moduleId: unknown): Promise<StandardList> {
  if (!isUuidV7(moduleId)) throw moduleNotFound();
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    const module = await findModule(tx, tenantId, moduleId);
    if (module === undefined) throw moduleNotFound();
    const names = await accountNames(tx, tenantId);
    const owner = await currentOwner(tx, tenantId, moduleId);
    const projectRows = await projectsById(tx, tenantId);

    const rows = await tx
      .selectDistinctOn([standardVersions.standardId], { version: standardVersions, standard: standards })
      .from(standardVersions)
      .innerJoin(
        standards,
        and(eq(standards.tenantId, standardVersions.tenantId), eq(standards.id, standardVersions.standardId)),
      )
      .where(and(eq(standardVersions.tenantId, tenantId), eq(standards.moduleId, moduleId)))
      .orderBy(standardVersions.standardId, desc(standardVersions.version));
    rows.sort(
      (a, b) =>
        a.standard.createdAt.getTime() - b.standard.createdAt.getTime() || a.standard.id.localeCompare(b.standard.id),
    );

    return {
      module: toModuleInfo(module, owner === undefined ? null : ownerOf(owner, names)),
      standards: rows.map((row) => toStandardInfo(row.version, row.standard, module, projectRows, names)),
    };
  });
}

/** Every version of one Standard, oldest first; earlier versions exactly as published. Open to every role. */
export async function listStandardVersions(
  db: RegistryDb,
  session: SessionInfo,
  standardId: unknown,
): Promise<StandardVersionList> {
  if (!isUuidV7(standardId)) throw standardNotFound();
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    const standard = await findStandard(tx, tenantId, standardId);
    if (standard === undefined) throw standardNotFound();
    const module = await findModule(tx, tenantId, standard.moduleId);
    if (module === undefined) throw new Error("a Standard's Module is missing");
    const names = await accountNames(tx, tenantId);
    const projectRows = await projectsById(tx, tenantId);
    const versions = await tx
      .select()
      .from(standardVersions)
      .where(and(eq(standardVersions.tenantId, tenantId), eq(standardVersions.standardId, standardId)))
      .orderBy(asc(standardVersions.version));
    return {
      standardId: toId(standard.id),
      versions: versions.map((row) => toStandardInfo(row, standard, module, projectRows, names)),
    };
  });
}

/**
 * Publish version 1 of a new Standard into a Module. `body` is
 * `{ entry, projectId? }`; `projectId` sets the Standard's Project scope for
 * its whole life (missing means the root Project).
 */
export function publishStandard(
  db: RegistryDb,
  session: SessionInfo,
  moduleId: unknown,
  body: unknown,
): Promise<StandardInfo> {
  return publish(db, session, { moduleId }, body);
}

/**
 * Publish the next version of an existing Standard (the entry may move to a
 * new slot; it is re-validated). `body` is exactly `{ entry }`: the version
 * keeps the Standard's Project scope.
 */
export function publishStandardVersion(
  db: RegistryDb,
  session: SessionInfo,
  standardId: unknown,
  body: unknown,
): Promise<StandardInfo> {
  return publish(db, session, { standardId }, body);
}

/**
 * The one publish path. Checks, first failure wins and nothing is written:
 * the Module or Standard exists in the tenant (404) → the Module has an owner
 * (409 `module_has_no_owner`) → the session is that owner (403
 * `not_module_owner`) → the body and entry are valid for the Module's kind
 * (400; a code-stack Module takes code-stack entries, a design-system Module
 * takes components, tokens and imports; `projectId`'s type is checked after
 * the entry) → a new Standard's Project scope exists in this tenant (404
 * `project_not_found`, subject `projectId`; missing means the root Project, a
 * new version keeps its Standard's scope) → the core Conflict slot rule over
 * the whole proposed live set of every scope, so a slot is unique per
 * (slot, Project scope) (409 `slot_conflict`).
 *
 * Publishes in one tenant serialise on a transaction-scoped advisory lock
 * keyed by the root Project id, taken before anything is read, so two
 * concurrent publishes into one slot cannot both pass the slot rule, and
 * version numbers are max + 1 without gaps or duplicates.
 */
async function publish(db: RegistryDb, session: SessionInfo, target: PublishTarget, body: unknown): Promise<StandardInfo> {
  if ("moduleId" in target ? !isUuidV7(target.moduleId) : !isUuidV7(target.standardId)) {
    throw "moduleId" in target ? moduleNotFound() : standardNotFound();
  }
  const { tenantId } = session;
  return withTenant(db, tenantId, async (tx) => {
    const root = await lockBundle(tx, tenantId);

    let existing: StandardRow | undefined;
    let moduleId: string;
    if ("standardId" in target) {
      existing = await findStandard(tx, tenantId, target.standardId as string);
      if (existing === undefined) throw standardNotFound();
      moduleId = existing.moduleId;
    } else {
      moduleId = target.moduleId as string;
    }
    const module = await findModule(tx, tenantId, moduleId);
    if (module === undefined) throw moduleNotFound();

    const owner = await currentOwner(tx, tenantId, module.id);
    if (owner === undefined) {
      throw new EnvelopeError({
        code: MODULE_HAS_NO_OWNER,
        message: "this Module has no Standard owner, so nothing can be published into it; nothing was published",
        subject: "moduleId",
      });
    }
    if (owner.ownerAccountId !== session.accountId) {
      throw new EnvelopeError({
        code: NOT_MODULE_OWNER,
        message: "only the Standard owner of this Module can publish into it; nothing was published",
        subject: "role",
      });
    }

    const { entry, projectId: requestedScope } = validatePublishBody(body, module.kind, {
      allowProjectId: existing === undefined,
    });

    const standardId = existing?.id ?? mintUuidV7();
    const projectId = existing?.projectId ?? (await resolveScope(tx, tenantId, requestedScope, root));
    // The whole live set of every scope: the pair check covers every scope,
    // and `conflicts()` only pairs holders at the same Project scope.
    const live = await liveSet(tx, tenantId);
    const verdict = validatePublication(live, { standardId, projectId, slot: entrySlot(entry) });
    if (!verdict.ok) throw new EnvelopeError(verdict.error);

    let standard = existing;
    if (standard === undefined) {
      [standard] = await tx
        .insert(standards)
        .values({ id: standardId, tenantId, moduleId: module.id, projectId, createdBy: session.accountId })
        .returning();
      if (standard === undefined) throw new Error("insert returned no row");
    }
    const [latest] = await tx
      .select({ version: standardVersions.version })
      .from(standardVersions)
      .where(and(eq(standardVersions.tenantId, tenantId), eq(standardVersions.standardId, standardId)))
      .orderBy(desc(standardVersions.version))
      .limit(1);
    const [row] = await tx
      .insert(standardVersions)
      .values({
        id: mintUuidV7(),
        tenantId,
        standardId,
        version: (latest?.version ?? 0) + 1,
        // The slot kind and slot name, mirrored from the entry.
        category: entrySlotKind(entry),
        name: entrySlotName(entry),
        entry,
        publishedBy: session.accountId,
      })
      .returning();
    if (row === undefined) throw new Error("insert returned no row");
    return toStandardInfo(row, standard, module, await projectsById(tx, tenantId), await accountNames(tx, tenantId));
  });
}

/**
 * Every Standard's live version across all Modules of the tenant, as the core
 * slot rule sees it, at every Project scope (the Standards part of the whole
 * bundle input).
 */
export async function liveSet(tx: RegistryTx, tenantId: UuidV7): Promise<SlotHolder[]> {
  const rows = await tx
    .selectDistinctOn([standardVersions.standardId], {
      standardId: standardVersions.standardId,
      category: standardVersions.category,
      name: standardVersions.name,
      projectId: standards.projectId,
      moduleKind: modules.kind,
    })
    .from(standardVersions)
    .innerJoin(
      standards,
      and(eq(standards.tenantId, standardVersions.tenantId), eq(standards.id, standardVersions.standardId)),
    )
    .innerJoin(modules, and(eq(modules.tenantId, standards.tenantId), eq(modules.id, standards.moduleId)))
    .where(eq(standardVersions.tenantId, tenantId))
    .orderBy(standardVersions.standardId, desc(standardVersions.version));
  return rows.map((row) => ({
    standardId: row.standardId,
    projectId: row.projectId,
    slot: { moduleKind: row.moduleKind, slotKind: row.category, name: row.name },
  }));
}

/**
 * Take the tenant's bundle lock: a transaction-scoped advisory lock keyed
 * `standards:<root Project id>`. Every Standards publish and every Project
 * tree change takes it before reading anything, because both feed the whole
 * bundle input, so their validations serialise per tenant. Returns the root
 * Project.
 */
export async function lockBundle(tx: RegistryTx, tenantId: UuidV7): Promise<ProjectRow> {
  const [root] = await tx
    .select()
    .from(projects)
    .where(and(eq(projects.tenantId, tenantId), isNull(projects.parentId)));
  if (root === undefined) throw new Error("the tenant has no root Project");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`standards:${root.id}`}, 0))`);
  return root;
}

/** The Project scope of a new Standard: the requested Project of this tenant, or the root when none is given. */
async function resolveScope(
  tx: RegistryTx,
  tenantId: UuidV7,
  requested: string | undefined,
  root: ProjectRow,
): Promise<string> {
  if (requested === undefined) return root.id;
  const notFound = new EnvelopeError({
    code: PROJECT_NOT_FOUND,
    message: "no such Project in this Company's Project tree; nothing was published",
    subject: "projectId",
  });
  if (!isUuidV7(requested)) throw notFound;
  const project = (await projectsById(tx, tenantId)).get(requested);
  if (project === undefined) throw notFound;
  return project.id;
}

async function findModule(tx: RegistryTx, tenantId: UuidV7, moduleId: string): Promise<ModuleRow | undefined> {
  const [row] = await tx
    .select()
    .from(modules)
    .where(and(eq(modules.tenantId, tenantId), eq(modules.id, moduleId)));
  return row;
}

async function findStandard(tx: RegistryTx, tenantId: UuidV7, standardId: string): Promise<StandardRow | undefined> {
  const [row] = await tx
    .select()
    .from(standards)
    .where(and(eq(standards.tenantId, tenantId), eq(standards.id, standardId)));
  return row;
}

/** The Module's latest owner assignment, or undefined when it has none. */
async function currentOwner(tx: RegistryTx, tenantId: UuidV7, moduleId: string) {
  const [row] = await tx
    .select()
    .from(moduleOwnerAssignments)
    .where(and(eq(moduleOwnerAssignments.tenantId, tenantId), eq(moduleOwnerAssignments.moduleId, moduleId)))
    .orderBy(desc(moduleOwnerAssignments.sequence))
    .limit(1);
  return row;
}

async function projectsById(tx: RegistryTx, tenantId: UuidV7): Promise<Map<string, ProjectRow>> {
  const rows = await tx.select().from(projects).where(eq(projects.tenantId, tenantId));
  return new Map(rows.map((row) => [row.id, row]));
}

function toStandardInfo(
  version: VersionRow,
  standard: StandardRow,
  module: ModuleRow,
  projectRows: ReadonlyMap<string, ProjectRow>,
  names: ReadonlyMap<string, string>,
): StandardInfo {
  const project = projectRows.get(standard.projectId);
  if (project === undefined) throw new Error("a Standard's Project is missing");
  return {
    id: toId(standard.id),
    version: version.version,
    module: { id: toId(module.id), kind: module.kind, name: module.name },
    project: { id: toId(project.id), name: project.name },
    // Stored normalised by the validator, so it is served exactly as stored.
    entry: version.entry,
    publishedAt: version.publishedAt.toISOString(),
    publishedBy: accountRef(version.publishedBy, names),
  };
}

/** The operations the HTTP API needs, bound to one database. */
export interface StandardService {
  listStandards(session: SessionInfo, moduleId: string): Promise<StandardList>;
  listStandardVersions(session: SessionInfo, standardId: string): Promise<StandardVersionList>;
  publishStandard(session: SessionInfo, moduleId: string, body: unknown): Promise<StandardInfo>;
  publishStandardVersion(session: SessionInfo, standardId: string, body: unknown): Promise<StandardInfo>;
}

export function createStandardService(db: RegistryDb): StandardService {
  return {
    listStandards: (session, moduleId) => listStandards(db, session, moduleId),
    listStandardVersions: (session, standardId) => listStandardVersions(db, session, standardId),
    publishStandard: (session, moduleId, body) => publishStandard(db, session, moduleId, body),
    publishStandardVersion: (session, standardId, body) => publishStandardVersion(db, session, standardId, body),
  };
}
