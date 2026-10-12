import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import { Form } from "react-router";
import { MODULE_KIND_LABELS } from "@domain-harness/contract";
import type { EffectiveSlot, EffectiveStandardSet, ProjectInfo, ProjectTree } from "@domain-harness/contract";
import { Button } from "./button.tsx";

/** The fields of the two Project tree forms. */
export type ProjectFormField = "name" | "levelName" | "parentId";

/** How a node reads after its name: the root (no parent) says so; a missing level name says so. */
const levelText = (project: ProjectInfo): string => {
  const level = project.levelName === null ? "no level name" : `level ${project.levelName}`;
  return project.parentId === null ? `root Project, ${level}` : level;
};

const nodeName = (project: ProjectInfo): string => `${project.name}, ${levelText(project)}`;

export const PROJECT_TREE_COPY = {
  heading: "Project tree",
  loading: "Loading the Project tree…",
  empty: "No Project yet beyond the root Project.",
  unavailable: "The Project tree is unavailable right now. Try again in a few minutes.",
  actionUnavailable: "The Project tree is unavailable right now, so nothing was changed. Try again in a few minutes.",
  sessionEnded: "Your session has ended, so the Project tree cannot be shown.",
  signInAgain: "Sign in again",
  roleDenial: "Only the Buyer can change the Project tree. Nothing was changed.",
  projectNotFound: "That Project was not found. Nothing was changed.",
  rootFixed: "The root Project has no parent, and its parent cannot be changed. Nothing was changed.",
  createHeading: "Create a Project",
  create: "Create Project",
  changeHeading: (name: string) => `Change the parent of ${name}`,
  change: "Change parent",
  option: (project: ProjectInfo) =>
    project.parentId === null
      ? `${project.name} (root Project)`
      : project.levelName === null
        ? `${project.name} (no level name)`
        : `${project.name} (level ${project.levelName})`,
  nodeName,
  labels: { name: "Name", levelName: "Level name", parentId: "Parent" } satisfies Record<ProjectFormField, string>,
  fieldErrors: {
    name: "Enter a name of 1 to 200 characters.",
    levelName: "Enter a level name of 1 to 200 characters that is not only spaces.",
    parentId: "Choose a parent Project of this Company.",
  } satisfies Record<ProjectFormField, string>,
  /** A cycle refusal naming the parent that closes it. */
  cycle: (parentName: string, projectName: string, self: boolean) =>
    self
      ? `Nothing was changed. ${projectName} cannot be its own parent. Choose another parent.`
      : `Nothing was changed. ${parentName} is a descendant of ${projectName}, so it cannot be its parent. Choose another parent.`,
  created: (project: ProjectInfo, parentName: string) =>
    `Created ${project.name}, level "${project.levelName ?? ""}", under ${parentName}.`,
  moved: (project: ProjectInfo, parentName: string) =>
    `${project.name}, level "${project.levelName ?? ""}", now has the parent ${parentName}.`,
  effective: {
    heading: (name: string) => `Effective Standard set for ${name}`,
    loading: "Loading the Effective Standard set…",
    empty: (name: string) => `No Standard applies to ${name} yet.`,
    unavailable: "The Effective Standard set is unavailable right now. Try again in a few minutes.",
    headers: ["Conflict slot", "Status", "Version", "Source Project"],
    none: "None",
    thisProject: (name: string) => `${name} (this Project)`,
    /** A Conflict slot as the panel writes it, for example `(code stack, library, "React")`. */
    slot: (slot: EffectiveSlot) => `(${MODULE_KIND_LABELS[slot.moduleKind]}, ${slot.slotKind}, "${slot.name.trim()}")`,
  },
} as const;

/** What the Project tree action reports back to the page. */
export interface ProjectTreeActionData {
  /** The submitted form: `create`, `parent`, or "" for an unknown intent. */
  readonly intent: "create" | "parent" | "";
  /** A status line (notice) or a refusal (denial), announced in the status region. */
  readonly status: { readonly tone: "denial" | "notice"; readonly message: string } | null;
  /** Ink text under the named field of the submitted form. */
  readonly fieldErrors: Readonly<Partial<Record<ProjectFormField, string>>>;
  /** The submitted values, kept in the fields on a refused submit. */
  readonly values: Readonly<Partial<Record<ProjectFormField | "projectId", string>>>;
  /** The Project just created or moved. */
  readonly changed?: ProjectInfo;
}

export interface ProjectTreeViewProps {
  readonly tree: ProjectTree;
  readonly selectedId: string;
  /** Selecting a node (Enter, Space or a click). */
  readonly onSelect: (projectId: string) => void;
}

/**
 * project-node tree: `role="tree"` with nested `role="group"` lists and one
 * `role="treeitem"` per Project, each announcing its name and level name.
 * Roving tabindex: one node is in the tab order; Up/Down/Home/End move focus
 * in depth-first order and Enter/Space select.
 */
export function ProjectTreeView({ tree, selectedId, onSelect }: ProjectTreeViewProps) {
  const [focusedId, setFocusedId] = useState(selectedId);
  const nodes = useRef(new Map<string, HTMLLIElement>());
  const moved = useRef(false);
  const order: readonly string[] = tree.projects.map((project) => project.id);
  const focused = order.includes(focusedId) ? focusedId : selectedId;

  useEffect(() => {
    setFocusedId(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    nodes.current.get(focused)?.focus();
  }, [focused]);

  const children = new Map<string, ProjectInfo[]>();
  for (const project of tree.projects) {
    if (project.parentId === null) continue;
    children.set(project.parentId, [...(children.get(project.parentId) ?? []), project]);
  }

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const index = order.indexOf(focused);
    let next: string | undefined;
    switch (event.key) {
      case "ArrowDown":
        next = order[Math.min(index + 1, order.length - 1)];
        break;
      case "ArrowUp":
        next = order[Math.max(index - 1, 0)];
        break;
      case "Home":
        next = order[0];
        break;
      case "End":
        next = order.at(-1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        onSelect(focused);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (next === undefined) return;
    moved.current = true;
    setFocusedId(next);
    // Focus at once when the id does not change (the first or last node).
    if (next === focused) nodes.current.get(next)?.focus();
  };

  const renderNode = (project: ProjectInfo, level: number) => {
    const kids = children.get(project.id) ?? [];
    const selected = project.id === selectedId;
    const onClick = (event: MouseEvent<HTMLLIElement>) => {
      event.stopPropagation();
      setFocusedId(project.id);
      onSelect(project.id);
    };
    return (
      <li
        key={project.id}
        id={`project-node-${project.id}`}
        ref={(element) => {
          if (element === null) nodes.current.delete(project.id);
          else nodes.current.set(project.id, element);
        }}
        role="treeitem"
        aria-level={level}
        aria-selected={selected}
        aria-label={nodeName(project)}
        tabIndex={project.id === focused ? 0 : -1}
        className="project-node"
        onClick={onClick}
      >
        <span className="project-node__label">
          <span className="project-node__name">{project.name}</span>{" "}
          <span className="project-node__level type-label">
            {levelText(project)}
          </span>
        </span>
        {kids.length === 0 ? null : <ul role="group">{kids.map((kid) => renderNode(kid, level + 1))}</ul>}
      </li>
    );
  };

  const root = tree.projects.find((project) => project.id === tree.rootId);
  return (
    <ul role="tree" aria-label={PROJECT_TREE_COPY.heading} className="project-tree" onKeyDown={onKeyDown}>
      {root === undefined ? null : renderNode(root, 1)}
    </ul>
  );
}

interface FieldProps {
  readonly form: "create" | "parent";
  readonly field: ProjectFormField;
  readonly errors: Readonly<Partial<Record<ProjectFormField, string>>>;
}

const fieldId = (form: string, field: ProjectFormField) => `project-${form}-${field}`;

function Label({ form, field }: Omit<FieldProps, "errors">) {
  return (
    <label htmlFor={fieldId(form, field)} className="type-label">
      {PROJECT_TREE_COPY.labels[field]}
    </label>
  );
}

function FieldError({ form, field, errors }: FieldProps) {
  return errors[field] === undefined ? null : (
    <p id={`${fieldId(form, field)}-error`} className="field-error">
      {errors[field]}
    </p>
  );
}

const described = ({ form, field, errors }: FieldProps) =>
  errors[field] === undefined
    ? {}
    : { "aria-invalid": true as const, "aria-describedby": `${fieldId(form, field)}-error` };

function ParentSelect({ form, errors, tree, value }: Omit<FieldProps, "field"> & { tree: ProjectTree; value: string }) {
  const props = { form, field: "parentId" as const, errors };
  return (
    <>
      <Label {...props} />
      <select id={fieldId(form, "parentId")} name="parentId" defaultValue={value} {...described(props)}>
        {tree.projects.map((project) => (
          <option key={project.id} value={project.id}>
            {PROJECT_TREE_COPY.option(project)}
          </option>
        ))}
      </select>
      <FieldError {...props} />
    </>
  );
}

export interface ProjectFormProps {
  readonly tree: ProjectTree;
  readonly selected: ProjectInfo;
  /** A refused submit of this form: its values and field errors, kept in the fields. */
  readonly submitted: ProjectTreeActionData | undefined;
}

/** standard-form "Create a Project": Name, Level name, Parent (default: the selected Project), then the gold button. */
export function CreateProjectForm({ tree, selected, submitted }: ProjectFormProps) {
  const errors = submitted?.fieldErrors ?? {};
  const values = submitted?.values ?? {};
  const text = (field: "name" | "levelName") => {
    const props = { form: "create" as const, field, errors };
    return (
      <>
        <Label {...props} />
        <input
          id={fieldId("create", field)}
          name={field}
          type="text"
          autoComplete="off"
          defaultValue={values[field] ?? ""}
          {...described(props)}
        />
        <FieldError {...props} />
      </>
    );
  };
  return (
    <Form method="post" className="standard-form" aria-labelledby="project-create-heading" noValidate>
      <h2 id="project-create-heading" className="type-title-sm">
        {PROJECT_TREE_COPY.createHeading}
      </h2>
      <input type="hidden" name="intent" value="create" />
      {text("name")}
      {text("levelName")}
      <ParentSelect form="create" errors={errors} tree={tree} value={values.parentId ?? selected.id} />
      <Button variant="primary" type="submit">
        {PROJECT_TREE_COPY.create}
      </Button>
    </Form>
  );
}

/** "Change the parent of <selected>": a Parent select (default: the current parent) and the inverse button. */
export function ChangeParentForm({ tree, selected, submitted }: ProjectFormProps) {
  const errors = submitted?.fieldErrors ?? {};
  const kept = submitted?.values.parentId;
  return (
    <Form method="post" className="standard-form" aria-labelledby="project-parent-heading" noValidate>
      <h2 id="project-parent-heading" className="type-title-sm">
        {PROJECT_TREE_COPY.changeHeading(selected.name)}
      </h2>
      <input type="hidden" name="intent" value="parent" />
      <input type="hidden" name="projectId" value={selected.id} />
      <ParentSelect form="parent" errors={errors} tree={tree} value={kept ?? selected.parentId ?? ""} />
      <Button variant="inverse" type="submit">
        {PROJECT_TREE_COPY.change}
      </Button>
    </Form>
  );
}

export interface EffectiveSetSectionProps {
  /** The selected Project's name, for the heading. */
  readonly projectName: string;
  /** True while the set is pending. */
  readonly busy?: boolean;
  readonly children: ReactNode;
}

/** The section under the Project tree holding the selected Project's Effective Standard set. */
export function EffectiveSetSection({ projectName, busy = false, children }: EffectiveSetSectionProps) {
  return (
    <section
      className="effective-set"
      aria-labelledby="effective-set-heading"
      {...(busy ? { "aria-busy": true as const } : {})}
    >
      <h2 id="effective-set-heading" className="type-title-sm">
        {PROJECT_TREE_COPY.effective.heading(projectName)}
      </h2>
      {children}
    </section>
  );
}

/** The pending set: the header cells and one busy loading row. */
export function EffectiveSetLoading() {
  const copy = PROJECT_TREE_COPY.effective;
  return (
    <div className="table-scroll">
      <table className="standards-table">
        <thead>
          <tr>
            {copy.headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody aria-busy="true">
          <tr aria-busy="true">
            <td colSpan={copy.headers.length}>{copy.loading}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export interface EffectiveSetTableProps {
  readonly set: EffectiveStandardSet;
}

/**
 * The Effective Standard set as a table with header cells: one row per
 * Conflict slot, in the registry's (core's) order, never re-sorted. The
 * source Project reads "(this Project)" when the Standard is scoped to the
 * selected Project.
 */
export function EffectiveSetTable({ set }: EffectiveSetTableProps) {
  const copy = PROJECT_TREE_COPY.effective;
  if (set.standards.length === 0) return <p>{copy.empty(set.project.name)}</p>;
  return (
    <div className="table-scroll">
      <table className="standards-table">
        <thead>
          <tr>
            {copy.headers.map((header) => (
              <th key={header} scope="col">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {set.standards.map((entry) => (
            <tr key={entry.standard.id}>
              <th scope="row">{copy.slot(entry.slot)}</th>
              <td>{entry.status ?? copy.none}</td>
              <td>{entry.standard.version}</td>
              <td>
                {entry.sourceProject.id === set.project.id
                  ? copy.thisProject(entry.sourceProject.name)
                  : entry.sourceProject.name}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
