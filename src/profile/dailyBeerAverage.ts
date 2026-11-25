

/** Return the earliest valid ISO timestamp, ignoring absent or malformed data. */
export function earliestTimestamp(values: (string | null | undefined)[]): string | null {
  let earliestMs: number | null = null;
  let earliestValue: string | null = null;

  for (const value of values) {
    if (!value) continue;
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) continue;
    if (earliestMs == null || parsed < earliestMs) {
      earliestMs = parsed;
      earliestValue = value;
    }
  }

  return earliestValue;
}
