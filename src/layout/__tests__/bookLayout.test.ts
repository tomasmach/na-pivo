import { bookModeFor } from '@/layout/bookLayout';

describe('bookModeFor', () => {
  it.each([
    ['iPhone 17', 402, 874, 'phone'],
    ['iPhone 17 Pro Max', 440, 956, 'phone'],
    ['folded iPhone Duo', 466, 678, 'phone'],
    ['split view on the open Duo', 634, 951, 'phone'],
    ['open Duo on its side', 951, 669, 'book'],
    ['open Duo upright on a table', 669, 951, 'tabletop'],
  ] as const)('%s (%i×%i) is %s on iOS', (_name, width, height, mode) => {
    expect(bookModeFor(width, height, 'ios')).toBe(mode);
  });

  it.each([
    [951, 669],
    [669, 951],
  ])('keeps Android on the phone layout at %i×%i', (width, height) => {
    expect(bookModeFor(width, height, 'android')).toBe('phone');
  });

  it.each([
    [874, 402],
    [956, 440],
    [678, 466],
  ])('never splits a phone on its side (%i×%i)', (width, height) => {
    expect(bookModeFor(width, height, 'ios')).toBe('phone');
  });
});
