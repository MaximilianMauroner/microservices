export function uptimePercentage(checks: ReadonlyArray<{ success: boolean }>): number | null {
  if (!checks.length) return null;
  return Math.round((checks.filter((check) => check.success).length / checks.length) * 10_000) / 100;
}
