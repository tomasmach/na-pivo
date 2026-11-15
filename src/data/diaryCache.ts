import AsyncStorage from '@react-native-async-storage/async-storage';

export const DIARY_CACHE_KEY = 'na-pivo-diary-copy-v1';
// Android reads one AsyncStorage value through a 2 MB window. A bigger diary
// stays in memory only and the next launch downloads it whole again.
const MAX_STORED_CHARS = 1_000_000;

/** One server row as last read. Rows the app cannot parse are kept too. */
export type DiaryRow = { client_id: string };

/** The account's server rows and the `since` that continues from them. */
export interface DiaryCopy {
  since: string;
  rows: DiaryRow[];
}

export interface DiaryCache {
  accountId: string;
  drinks: DiaryCopy;
  visits: DiaryCopy;
}

/** Ask for changes since `since`, valid only for the same account. */
export interface DiaryCursor {
  accountId: string;
  since: string;
}

/** A successful diary GET and the account it was made for. */
export interface DiaryRead {
  accountId: string;
  body: unknown;
}

let generation = 0;
let memory: DiaryCache | null = null;

export function isDiaryRow(value: unknown): value is DiaryRow {
  return !!value && typeof value === 'object' && typeof (value as DiaryRow).client_id === 'string';
}

function readCopy(value: unknown): DiaryCopy | null {
  const copy = value as Partial<DiaryCopy> | null;
  if (!copy || typeof copy.since !== 'string' || !Array.isArray(copy.rows)) return null;
  return { since: copy.since, rows: copy.rows.filter(isDiaryRow) };
}

export function diaryCacheGeneration(): number {
  return generation;
}

export async function loadDiaryCache(): Promise<DiaryCache | null> {
  if (memory) return memory;
  const started = generation;
  try {
    const raw = await AsyncStorage.getItem(DIARY_CACHE_KEY);
    if (!raw || started !== generation) return null;
    const parsed = JSON.parse(raw) as Partial<DiaryCache> | null;
    const drinks = readCopy(parsed?.drinks);
    const visits = readCopy(parsed?.visits);
    if (typeof parsed?.accountId !== 'string' || !drinks || !visits) return null;
    memory = { accountId: parsed.accountId, drinks, visits };
    return memory;
  } catch {
    return null;
  }
}

/** Keep the copy unless an account boundary cleared the diary since `expected`. */
export async function saveDiaryCache(cache: DiaryCache, expected: number): Promise<void> {
  if (expected !== generation) return;
  memory = cache;
  try {
    const raw = JSON.stringify(cache);
    if (raw.length > MAX_STORED_CHARS) {
      await AsyncStorage.removeItem(DIARY_CACHE_KEY);
      return;
    }
    await AsyncStorage.setItem(DIARY_CACHE_KEY, raw);
    if (expected !== generation) await AsyncStorage.removeItem(DIARY_CACHE_KEY);
  } catch {
    // The next read downloads the whole diary again.
  }
}

export async function clearDiaryCache(): Promise<void> {
  generation += 1;
  memory = null;
  try {
    await AsyncStorage.removeItem(DIARY_CACHE_KEY);
  } catch {
    // The generation check keeps a stale read from saving it again.
  }
}
