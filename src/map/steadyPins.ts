function sameContent<P extends object>(a: P, b: P): boolean {
  const keys = Object.keys(a) as (keyof P)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * `next` in a fixed order, each pin kept as the object it was in `previous` while its content
 * stays, and `previous` itself when nothing changed. A reload that brings the same pubs then
 * regroups and redraws nothing.
 */
export function steadyPins<P extends { id: string }>(previous: P[], next: readonly P[]): P[] {
  const before = new Map(previous.map((pin) => [pin.id, pin]));
  const list = [...next]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((pin) => {
      const old = before.get(pin.id);
      return old && sameContent(old, pin) ? old : pin;
    });
  return list.length === previous.length && list.every((pin, i) => pin === previous[i]) ? previous : list;
}
