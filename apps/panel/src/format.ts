/**
 * Timestamp formatting for the management panel. All instants are formatted
 * in UTC with the en-GB calendar order ("13 Oct 2026") so a timestamp is a
 * stable, scannable fact rather than a locale surprise. An unparseable value
 * renders an em dash, never a broken date.
 */

const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  day: "2-digit",
  month: "short",
  year: "numeric",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  timeZone: "UTC",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function parse(iso: string): number {
  return Date.parse(iso);
}

/** `13 Oct 2026`, or `"—"` when the value cannot be parsed. */
export function formatDate(iso: string): string {
  const value = parse(iso);
  return Number.isNaN(value) ? "—" : DATE_FORMATTER.format(value);
}

/** `13 Oct 2026, 23:30 UTC`, or `"—"` when the value cannot be parsed. */
export function formatDateTime(iso: string): string {
  const value = parse(iso);
  return Number.isNaN(value) ? "—" : `${DATE_FORMATTER.format(value)}, ${TIME_FORMATTER.format(value)} UTC`;
}

const AGENT_TOOL_NAMES: Readonly<Record<string, string>> = { "claude-code": "Claude Code", cursor: "Cursor" };

/** The product name of a known agent tool ("claude-code" → "Claude Code"); any other value as given. */
export function agentToolName(tool: string): string {
  return AGENT_TOOL_NAMES[tool] ?? tool;
}
