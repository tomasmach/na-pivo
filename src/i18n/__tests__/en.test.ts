import { cs } from '../cs';
import { en } from '../en';
import { intlLocaleFor, resolveLocale } from '../locale';

type Tree = Record<string, unknown>;

function walk(node: unknown, path: string, visit: (path: string, value: unknown) => void) {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node as Tree)) walk(value, path ? `${path}.${key}` : key, visit);
    return;
  }
  visit(path, node);
}

function leaves(tree: unknown): Map<string, unknown> {
  const out = new Map<string, unknown>();
  walk(tree, '', (path, value) => out.set(path, value));
  return out;
}

// Proper nouns, the currency symbol and one quoted pub term keep their
// diacritics in English on purpose.
const KEEP_CZECH = ['Kč', 'Tomáš', 'Vinohradská', 'Mělník', 'Žatec', 'Plzeň', 'Rakovník', 'šnyt'];
const CZECH = /[ěščřžýáíéúůňťď]/i;
const stripCurrency = (text: string) =>
  KEEP_CZECH.reduce((acc, word) => acc.split(word).join(''), text);
const DASHES = /[–—]/;

function sample(fn: (...args: never[]) => unknown, arity: number): unknown[] {
  const args = Array.from({ length: arity }, (_, i) => (i === 0 ? 3 : 'x')) as never[];
  const out = [fn(...args)];
  try {
    out.push(fn(...(Array.from({ length: arity }, () => 1) as never[])));
  } catch {
    // Some functions take typed unions; the first sample is enough for them.
  }
  return out;
}

describe('English strings mirror the Czech source', () => {
  const csLeaves = leaves(cs);
  const enLeaves = leaves(en);

  it('has exactly the same keys', () => {
    expect([...enLeaves.keys()].sort()).toEqual([...csLeaves.keys()].sort());
  });

  it('keeps value kinds and function arity', () => {
    for (const [path, value] of csLeaves) {
      const other = enLeaves.get(path);
      expect([path, typeof other]).toEqual([path, typeof value]);
      if (typeof value === 'function') {
        expect([path, (other as (...a: unknown[]) => unknown).length]).toEqual([path, value.length]);
      }
      if (Array.isArray(value)) expect([path, (other as unknown[]).length]).toEqual([path, value.length]);
    }
  });

  it('contains no Czech diacritics and no em or en dashes', () => {
    const offenders: string[] = [];
    for (const [path, value] of enLeaves) {
      const texts = typeof value === 'string' ? [value] : Array.isArray(value) ? value : [];
      for (const text of texts) {
        if (typeof text !== 'string') continue;
        if (CZECH.test(stripCurrency(text)) || DASHES.test(text)) offenders.push(`${path}: ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('renders function values without Czech or dashes', () => {
    const offenders: string[] = [];
    for (const [path, value] of enLeaves) {
      if (typeof value !== 'function') continue;
      let outputs: unknown[] = [];
      try {
        outputs = sample(value as never, value.length);
      } catch {
        continue; // typed-union parameters, covered by typecheck instead
      }
      for (const text of outputs) {
        if (typeof text === 'string' && (CZECH.test(stripCurrency(text)) || DASHES.test(text)))
          offenders.push(`${path}: ${text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the Czech source free of em and en dashes too', () => {
    const offenders: string[] = [];
    for (const [path, value] of csLeaves) {
      if (typeof value === 'string' && DASHES.test(value)) offenders.push(`${path}: ${value}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('resolveLocale', () => {
  it('maps Czech and Slovak to cs, everything else to en', () => {
    expect(resolveLocale(['cs'])).toBe('cs');
    expect(resolveLocale(['sk-SK'])).toBe('cs');
    expect(resolveLocale(['en-US'])).toBe('en');
    expect(resolveLocale(['de-DE', 'cs-CZ'])).toBe('cs');
    expect(resolveLocale(['de-DE'])).toBe('en');
    expect(resolveLocale([null, undefined, ''])).toBe('en');
  });

  it('pairs each locale with an Intl tag', () => {
    expect(intlLocaleFor('cs')).toBe('cs-CZ');
    expect(intlLocaleFor('en')).toBe('en-GB');
  });
});
