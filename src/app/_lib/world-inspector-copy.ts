const ERROR_BOUNDARY = /(?:\s+\[\s*[{[]|\s+[{]\s*["']|[.!?。！？])\s*/u;

/**
 * Returns the amount of failure text that is useful in a collection row.
 * The original message remains available to the selected record detail.
 */
export function formatInspectorFailureSummary(message: string | undefined, maxLength = 180): string {
  const normalized = message?.replace(/\s+/gu, " ").trim() ?? "";
  if (!normalized) return "";
  const boundary = normalized.search(ERROR_BOUNDARY);
  const firstClause = boundary > 0 ? normalized.slice(0, boundary).trim() : normalized;
  if (firstClause.length <= maxLength) return firstClause;
  return `${firstClause.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
