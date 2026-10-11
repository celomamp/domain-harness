const UNIQUE_VIOLATION = "23505";

/** Walk the cause chain (Drizzle wraps driver errors) for a unique violation on `constraint`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === UNIQUE_VIOLATION && candidate.constraint === constraint) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
