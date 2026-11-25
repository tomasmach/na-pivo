/**
 * Last answers of read-only screen loads, kept in memory so reopening a screen
 * shows them at once while a fresh copy loads. Cleared with private account data.
 */
const LIMIT = 50;
const entries = new Map<string, unknown>();
let generation = 0;

export function readScreenCache<T>(key: string): T | undefined {
  return entries.get(key) as T | undefined;
}

export function screenCacheGeneration(): number {
  return generation;
}

/** `since` is the generation the load started in; a load from before a clear is dropped. */
export function writeScreenCache(key: string, value: unknown, since: number): void {
  if (since !== generation) return;
  entries.delete(key);
  entries.set(key, value);
  if (entries.size > LIMIT) entries.delete(entries.keys().next().value as string);
}

export function clearScreenCache(): void {
  entries.clear();
  generation += 1;
}
