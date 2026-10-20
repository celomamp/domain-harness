import { useEffect, useRef, useState } from "react";
import { Form, Link } from "react-router";
import { MODULE_KIND_LABELS, MODULE_KINDS } from "@domain-harness/contract";
import type { AccountRef, ModuleInfo, ModuleList } from "@domain-harness/contract";
import { formatDate } from "../format.ts";
import { Badge } from "./badge.tsx";
import { Button } from "./button.tsx";
import { EmptyState } from "./empty-state.tsx";
import { SideSheet } from "./side-sheet.tsx";
import { Stat } from "./stat.tsx";
import { Status } from "./status.tsx";
import { Toolbar } from "./toolbar.tsx";

export const MODULES_COPY = {
  empty: "No Module yet.",
  noOwner: "No owner",
  unavailable: "Modules are unavailable right now. Try again in a few minutes.",
  actionUnavailable: "Modules are unavailable right now, so nothing could be saved. Try again in a few minutes.",
  roleDenied: "Only the Buyer can create a Module or assign its Standard owner. Nothing was changed.",
  notFound: "That Module was not found. Nothing was changed.",
  kindError: "Choose a kind: code stack or design system.",
  nameError: "Enter a Module name of 1 to 120 characters.",
  nameTaken: "Another Module already has this name. Enter a different name.",
  ownerError: "Choose a Standard owner account.",
  choosePlaceholder: "Choose a Standard owner",
  created: (name: string) => `Module created: ${name}.`,
  assigned: (owner: string, module: string) => `Standard owner of ${module}: ${owner}.`,
  createHeading: "Create a Module",
  ownerHeading: "Standard owner",
  changeOwner: "Change owner",
  assignOwner: "Assign owner",
  assignSubmit: "Assign Standard owner",
  searchLabel: "Search Modules",
  kindFilterLabel: "Kind",
  kindFilterAll: "All kinds",
  ownerFilterLabel: "Standard owner",
  ownerFilterAll: "All owners",
  ownerFilterNone: "No owner",
  summary: {
    modules: "Modules",
    codeStacks: "Code stacks",
    designSystems: "Design systems",
    withoutOwner: "Without an owner",
  },
} as const;

/** What the Standards action reports back to the Modules section. */
export interface ModulesActionData {
  readonly intent: "create-module" | "assign-owner" | null;
  /** A status line (notice) or a refusal (denial), announced in the status region. */
  readonly status: { readonly tone: "denial" | "notice"; readonly message: string } | null;
  /** Ink text under the named field. */
  readonly fieldErrors: { readonly kind?: string; readonly name?: string; readonly accountId?: string };
  /** The submitted values, kept in the fields on a refused submit. */
  readonly values: { readonly kind?: string; readonly name?: string; readonly moduleId?: string; readonly accountId?: string };
  /** Set after a successful create, so the create form starts empty again. */
  readonly createdId?: string;
}

export interface ModulesSectionProps {
  /** `null` when the registry could not be reached. */
  readonly list: ModuleList | null;
  readonly actionData: ModulesActionData | undefined;
}

/** The summary of a Module list: totals by kind and ownership. */
export function modulesSummary(list: ModuleList): {
  modules: number;
  codeStacks: number;
  designSystems: number;
  withoutOwner: number;
} {
  return {
    modules: list.modules.length,
    codeStacks: list.modules.filter((module) => module.kind === "code-stack").length,
    designSystems: list.modules.filter((module) => module.kind === "design-system").length,
    withoutOwner: list.modules.filter((module) => module.owner === null).length,
  };
}

const ALL_KINDS = "all";
const NO_OWNER = "none";

/**
 * The Modules section of Standards: a summary row, a toolbar (search, kind and
 * owner filters), and a table of Modules with their kind badge, current
 * Standard owner and a row action that opens the owner form in a side sheet.
 * Every control is shown to every role; the registry decides, and a refusal is
 * announced as a denial. `Status` remains the single live region.
 */
export function ModulesSection({ list, actionData }: ModulesSectionProps) {
  const status =
    actionData?.status ?? (list === null ? { tone: "denial" as const, message: MODULES_COPY.unavailable } : null);
  const assignData = actionData?.intent === "assign-owner" ? actionData : undefined;

  const [ownerModuleId, setOwnerModuleId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>(ALL_KINDS);
  const [ownerFilter, setOwnerFilter] = useState<string>("all");

  // A successful assignment closes the owner sheet; a refusal keeps it open.
  const previousAction = useRef<ModulesActionData | undefined>(undefined);
  useEffect(() => {
    if (actionData === previousAction.current) return;
    previousAction.current = actionData;
    if (assignData?.status?.tone === "notice") setOwnerModuleId(null);
  }, [actionData, assignData]);

  const modules = list?.modules ?? [];
  const visible = modules.filter((module) => {
    if (search !== "" && !module.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (kindFilter !== ALL_KINDS && module.kind !== kindFilter) return false;
    if (ownerFilter === NO_OWNER && module.owner !== null) return false;
    if (ownerFilter !== "all" && ownerFilter !== NO_OWNER && module.owner?.accountId !== ownerFilter) return false;
    return true;
  });

  const ownerModule = modules.find((module) => module.id === ownerModuleId) ?? null;

  return (
    <>
      <Status tone={status?.tone ?? "notice"} message={status?.message} />
      {list === null ? null : (
        <>
          <div className="standards-summary">
            {summaryStats(list)}
          </div>
          <Toolbar
            searchLabel={MODULES_COPY.searchLabel}
            searchValue={search}
            onSearch={setSearch}
            filters={
              <>
                <label className="standards-filter">
                  <span>{MODULES_COPY.kindFilterLabel}</span>
                  <select
                    value={kindFilter}
                    onChange={(event) => {
                      setKindFilter(event.target.value);
                    }}
                  >
                    <option value={ALL_KINDS}>{MODULES_COPY.kindFilterAll}</option>
                    {MODULE_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {MODULE_KIND_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="standards-filter">
                  <span>{MODULES_COPY.ownerFilterLabel}</span>
                  <select
                    value={ownerFilter}
                    onChange={(event) => {
                      setOwnerFilter(event.target.value);
                    }}
                  >
                    <option value="all">{MODULES_COPY.ownerFilterAll}</option>
                    <option value={NO_OWNER}>{MODULES_COPY.ownerFilterNone}</option>
                    {list.standardOwners.map((account) => (
                      <option key={account.accountId} value={account.accountId}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            }
            count={`${String(visible.length)} of ${String(modules.length)} Modules`}
          />
          {modules.length === 0 ? (
            <EmptyState icon="standards" title={MODULES_COPY.empty} description="Create a Module to start governing its Standards." />
          ) : visible.length === 0 ? (
            <EmptyState icon="standards" title={MODULES_COPY.empty} description="No Module matches the filters." />
          ) : (
            <ModulesTable modules={visible} onOpenOwner={setOwnerModuleId} />
          )}
        </>
      )}
      <OwnerSheet
        module={ownerModule}
        standardOwners={list?.standardOwners ?? []}
        submitted={ownerModule !== null && assignData?.values.moduleId === ownerModule.id ? assignData : undefined}
        onClose={() => {
          setOwnerModuleId(null);
        }}
      />
    </>
  );
}

function summaryStats(list: ModuleList) {
  const summary = modulesSummary(list);
  return (
    <>
      <Stat label={MODULES_COPY.summary.modules} value={String(summary.modules)} />
      <Stat label={MODULES_COPY.summary.codeStacks} value={String(summary.codeStacks)} />
      <Stat label={MODULES_COPY.summary.designSystems} value={String(summary.designSystems)} />
      <Stat label={MODULES_COPY.summary.withoutOwner} value={String(summary.withoutOwner)} />
    </>
  );
}

function ModulesTable({
  modules,
  onOpenOwner,
}: {
  readonly modules: readonly ModuleInfo[];
  readonly onOpenOwner: (moduleId: string) => void;
}) {
  return (
    <div className="table-scroll">
      <table className="standards-table">
        <caption className="type-label">Modules in the Company</caption>
        <thead>
          <tr>
            <th scope="col">Module</th>
            <th scope="col">Kind</th>
            <th scope="col">Standard owner</th>
            <th scope="col">Assigned date</th>
            <th scope="col">
              <span className="visually-hidden">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {modules.map((module) => (
            <ModuleRow key={module.id} module={module} onOpenOwner={onOpenOwner} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleRow({
  module,
  onOpenOwner,
}: {
  readonly module: ModuleInfo;
  readonly onOpenOwner: (moduleId: string) => void;
}) {
  return (
    <tr>
      <th scope="row">
        <Link className="module-name" to={`/standards/${encodeURIComponent(module.id)}`}>
          {module.name}
        </Link>
      </th>
      <td>
        <Badge tone="neutral">{MODULE_KIND_LABELS[module.kind]}</Badge>
      </td>
      <td className="owner-cell">
        {module.owner === null ? (
          <Badge tone="neutral">{MODULES_COPY.noOwner}</Badge>
        ) : (
          <p>{module.owner.name}</p>
        )}
      </td>
      <td>
        {module.owner === null ? (
          MODULES_COPY.noOwner
        ) : (
          <time dateTime={module.owner.assignedAt}>{formatDate(module.owner.assignedAt)}</time>
        )}
      </td>
      <td>
        <Button
          variant="ghost"
          onClick={() => {
            onOpenOwner(module.id);
          }}
        >
          {module.owner === null ? MODULES_COPY.assignOwner : MODULES_COPY.changeOwner}
        </Button>
      </td>
    </tr>
  );
}

function OwnerSheet({
  module,
  standardOwners,
  submitted,
  onClose,
}: {
  readonly module: ModuleInfo | null;
  readonly standardOwners: readonly AccountRef[];
  readonly submitted: ModulesActionData | undefined;
  readonly onClose: () => void;
}) {
  if (module === null) return null;
  return (
    <SideSheet open onClose={onClose} title={MODULES_COPY.ownerHeading} description={module.name}>
      <OwnerForm module={module} standardOwners={standardOwners} submitted={submitted} />
    </SideSheet>
  );
}

function OwnerForm({
  module,
  standardOwners,
  submitted,
}: {
  readonly module: ModuleInfo;
  readonly standardOwners: readonly AccountRef[];
  readonly submitted: ModulesActionData | undefined;
}) {
  const selectId = `owner-${module.id}`;
  const errorId = `owner-error-${module.id}`;
  const error = submitted?.fieldErrors.accountId;
  const selected = error !== undefined ? (submitted?.values.accountId ?? "") : (module.owner?.accountId ?? "");
  return (
    <Form method="post" className="standard-form" noValidate>
      <input type="hidden" name="intent" value="assign-owner" />
      <input type="hidden" name="moduleId" value={module.id} />
      <label htmlFor={selectId} className="type-label">
        Standard owner for {module.name}
      </label>
      <select
        id={selectId}
        name="accountId"
        defaultValue={selected}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? undefined : errorId}
      >
        <option value="">{MODULES_COPY.choosePlaceholder}</option>
        {standardOwners.map((account) => (
          <option key={account.accountId} value={account.accountId}>
            {account.name}
          </option>
        ))}
      </select>
      {error === undefined ? null : (
        <p id={errorId} className="field-error">
          {error}
        </p>
      )}
      <Button variant="primary" type="submit">
        {MODULES_COPY.assignSubmit}
      </Button>
    </Form>
  );
}

export interface CreateModuleSheetProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** A refused create's values and field errors, kept in the fields. */
  readonly submitted: ModulesActionData | undefined;
}

/** The Create Module form in a side sheet, opened from the page header action. */
export function CreateModuleSheet({ open, onClose, submitted }: CreateModuleSheetProps) {
  const kindError = submitted?.fieldErrors.kind;
  const nameError = submitted?.fieldErrors.name;
  const kind = submitted?.values.kind;
  return (
    <SideSheet open={open} onClose={onClose} title={MODULES_COPY.createHeading}>
      <Form method="post" className="standard-form" noValidate>
        <input type="hidden" name="intent" value="create-module" />
        <label htmlFor="module-name" className="type-label">
          Module name
        </label>
        <input
          id="module-name"
          name="name"
          type="text"
          autoComplete="off"
          defaultValue={submitted?.values.name ?? ""}
          aria-invalid={nameError === undefined ? undefined : true}
          aria-describedby={nameError === undefined ? undefined : "module-name-error"}
        />
        {nameError === undefined ? null : (
          <p id="module-name-error" className="field-error">
            {nameError}
          </p>
        )}
        <label htmlFor="module-kind" className="type-label">
          Kind
        </label>
        <select
          id="module-kind"
          name="kind"
          defaultValue={kind !== undefined && (MODULE_KINDS as readonly string[]).includes(kind) ? kind : MODULE_KINDS[0]}
          aria-invalid={kindError === undefined ? undefined : true}
          aria-describedby={kindError === undefined ? undefined : "module-kind-error"}
        >
          {MODULE_KINDS.map((value) => (
            <option key={value} value={value}>
              {MODULE_KIND_LABELS[value]}
            </option>
          ))}
        </select>
        {kindError === undefined ? null : (
          <p id="module-kind-error" className="field-error">
            {kindError}
          </p>
        )}
        <Button variant="primary" type="submit">
          Create
        </Button>
      </Form>
    </SideSheet>
  );
}
