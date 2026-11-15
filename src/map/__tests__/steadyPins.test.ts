import { steadyPins } from '../steadyPins';

const pin = (id: string, beers = 0) => ({ id, lat: 50, lng: 14, beers });

describe('steadyPins', () => {
  it('returns the previous list when a reload brings the same pubs in another order', () => {
    const previous = steadyPins([], [pin('b'), pin('a')]);
    expect(previous.map((p) => p.id)).toEqual(['a', 'b']);
    expect(steadyPins(previous, [pin('a'), pin('b')])).toBe(previous);
  });

  it('keeps unchanged pins as they were and takes the changed and the new ones', () => {
    const previous = steadyPins([], [pin('a'), pin('b')]);
    const changed = pin('b', 3);
    const added = pin('c');
    const next = steadyPins(previous, [added, changed, pin('a')]);
    expect(next[0]).toBe(previous[0]);
    expect(next[1]).toBe(changed);
    expect(next[2]).toBe(added);
  });
});
