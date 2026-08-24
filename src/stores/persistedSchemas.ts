/** Narrow persisted containers before Zustand merges untrusted AsyncStorage JSON. */
export function persistedArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function persistedRecord<T>(value: unknown): Record<string, T> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, T>
    : {};
}

export function persistedObject(value: unknown): Record<string, unknown> {
  return persistedRecord<unknown>(value);
}
