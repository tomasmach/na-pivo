import { compassArrowRotation } from '../rotation';

describe('compassArrowRotation', () => {
  it.each([
    { bearing: 30, heading: 10, expected: 20 },
    { bearing: 10, heading: 350, expected: 20 },
    { bearing: 350, heading: 10, expected: 340 },
  ])('returns $expected for bearing $bearing and heading $heading', ({ bearing, heading, expected }) => {
    expect(compassArrowRotation(bearing, heading)).toBe(expected);
  });
});
