-- 0005_design_system_entries: widen standard_versions so it also holds the
-- design-system entries (Story 1.6): components, tokens and imports.
--
-- `category` holds the slot kind: a code-stack category (language,
-- framework, library) or a design-system entry kind (component, token,
-- import). `name` holds the slot name: the entry's name, or an import's
-- module specifier. The entry must match its slot kind. No new table and no
-- grant change: rows stay append-only (SELECT, INSERT only).

-- 0004 declared these inline, so PostgreSQL named them: the category check is
-- standard_versions_category_check, and the entry check (which also reads
-- category and name, so it became a table check) is standard_versions_check.
ALTER TABLE standard_versions DROP CONSTRAINT standard_versions_category_check;
ALTER TABLE standard_versions DROP CONSTRAINT standard_versions_check;

ALTER TABLE standard_versions ADD CONSTRAINT standard_versions_category_check
  CHECK (category IN ('language', 'framework', 'library', 'component', 'token', 'import'));

ALTER TABLE standard_versions ADD CONSTRAINT standard_versions_entry_check CHECK (
  jsonb_typeof(entry) = 'object'
  -- coalesce: a missing key makes a comparison NULL, which a CHECK would pass.
  AND coalesce(CASE
    WHEN category IN ('language', 'framework', 'library') THEN
      entry ->> 'category' = category
      AND entry ->> 'name' = name
      AND entry ->> 'status' IN ('approved', 'prohibited', 'required')
    WHEN category = 'component' THEN
      entry ->> 'kind' = 'component'
      AND entry ->> 'name' = name
      AND jsonb_typeof(entry -> 'tokens') = 'array'
      AND jsonb_typeof(entry -> 'usageRule') = 'string'
    WHEN category = 'token' THEN
      entry ->> 'kind' = 'token'
      AND entry ->> 'name' = name
      AND entry ->> 'status' IN ('required', 'prohibited')
    WHEN category = 'import' THEN
      entry ->> 'kind' = 'import'
      AND entry ->> 'specifier' = name
      AND entry ->> 'status' IN ('required', 'prohibited')
    ELSE false
  END, false)
);
