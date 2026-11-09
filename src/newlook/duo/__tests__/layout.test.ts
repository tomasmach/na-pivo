import { isBook, railSideFor } from '../layout';

jest.mock('react-native-safe-area-context', () => {
  const { createContext } = jest.requireActual('react');
  return {
    SafeAreaInsetsContext: createContext(null),
    useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
  };
});

// Measured on the iPhone Duo simulator (iOS 27.1): folded 466×678 and open 951×669, both with an 84 pt column on the right.
describe('railSideFor', () => {
  it('keeps the bar along the bottom on a phone', () => {
    expect(railSideFor({ left: 0, right: 0 }, 'ios')).toBeNull();
  });

  it('stands the bar up in the Duo column, on whichever side it is', () => {
    expect(railSideFor({ left: 0, right: 84 }, 'ios')).toBe('right');
    expect(railSideFor({ left: 84, right: 0 }, 'ios')).toBe('left');
  });

  it('keeps Android on the phone layout', () => {
    expect(railSideFor({ left: 0, right: 84 }, 'android')).toBeNull();
  });
});

describe('isBook', () => {
  it('splits only the open Duo held as a book', () => {
    expect(isBook(951, 669, 'ios')).toBe(true);
    expect(isBook(466, 678, 'ios')).toBe(false);
    expect(isBook(669, 951, 'ios')).toBe(false);
  });

  it('never splits a phone on its side or Android', () => {
    expect(isBook(932, 430, 'ios')).toBe(false);
    expect(isBook(951, 669, 'android')).toBe(false);
  });
});
