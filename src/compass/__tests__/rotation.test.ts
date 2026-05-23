import { compassArrowRotation, shortestRotationTarget } from '../rotation';

describe('shortestRotationTarget', () => {
  it.each([
    { current: 350, target: 10, expected: 370 },
    { current: 10, target: 350, expected: -10 },
    { current: 90, target: 180, expected: 180 },
    { current: 180, target: 0, expected: 0 },
    { current: -10, target: 10, expected: 10 },
    { current: 370, target: 350, expected: 350 },
  ])('maps $target from $current to $expected', ({ current, target, expected }) => {
    expect(shortestRotationTarget(current, target)).toBe(expected);
  });
});

describe('compassArrowRotation', () => {
  it.each([
    { bearing: 30, heading: 10, expected: 20 },
    { bearing: 10, heading: 350, expected: 20 },
    { bearing: 350, heading: 10, expected: 340 },
  ])('returns $expected for bearing $bearing and heading $heading', ({ bearing, heading, expected }) => {
    expect(compassArrowRotation(bearing, heading)).toBe(expected);
  });
});
