// The helper under test is pure, but importing the module pulls Reanimated in,
// and Reanimated is not transformed for this project's test runner.
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: jest.fn((value: unknown) => ({ value })),
  useAnimatedStyle: jest.fn((factory: () => unknown) => factory()),
  useReducedMotion: jest.fn(() => true),
  withSequence: jest.fn(),
  withTiming: jest.fn(),
}));

import { countNumeralSize } from '@/counter/CoasterCard';

/**
 * The counter card is one big number, so the number's size is the whole design.
 * These pin the two failure modes it can have: silently shrinking on a tall
 * phone (because `adjustsFontSizeToFit` picked the size instead of us), and
 * running off the card once the night hits three digits.
 */
describe('countNumeralSize', () => {
  it('falls back to the display step before the card is measured', () => {
    expect(countNumeralSize(3, 0, 0)).toBe(88);
  });

  it('grows into a tall card but never past the cap', () => {
    // A 400pt body could carry a ~311pt line box; the cap wins.
    expect(countNumeralSize(3, 300, 400)).toBe(132);
  });

  it('fits the numeral into the height it actually has', () => {
    // (140 - 14) / 1.24 = 101.6
    expect(countNumeralSize(3, 300, 140)).toBe(102);
  });

  it('shrinks for three digits so the card never has to clip', () => {
    // 279 / (3 * 0.62) = 150 -> capped by width, not by the 132 ceiling.
    expect(countNumeralSize(128, 279, 400)).toBe(132);
    // On an iPhone SE the same count has to give way.
    expect(countNumeralSize(128, 200, 400)).toBe(108);
  });

  it('keeps a display-sized numeral even in a cramped card', () => {
    expect(countNumeralSize(7, 120, 40)).toBe(44);
  });
});
