/* eslint-disable @typescript-eslint/no-require-imports */
import { resolvePalette } from '../palette';

type Colors = typeof import('../colors').Colors;

/** Colors as a fresh launch would bind them with `stored` in the secure store. */
function colorsWithStored(stored: string | null): Colors {
  let colors: Colors | undefined;
  jest.isolateModules(() => {
    if (stored !== null) require('expo-secure-store').setItem('na-pivo-palette', stored);
    colors = require('../colors').Colors;
  });
  return colors!;
}

describe('palette', () => {
  it('falls back to gray for anything but brown', () => {
    expect(resolvePalette('brown')).toBe('brown');
    expect(resolvePalette(null)).toBe('gray');
    expect(resolvePalette('purple')).toBe('gray');
  });

  it('paints the ground from the stored choice', () => {
    expect(colorsWithStored(null).stout).toBe('#15120F');
    expect(colorsWithStored('brown').stout).toBe('#1F1308');
    expect(colorsWithStored('brown').amber).toBe('#E8A317');
    expect(colorsWithStored('{"broken"').stout).toBe('#15120F');
  });
});
