/**
 * The six characters somebody reads across a table.
 *
 * One alphabet, used by both ends: the generator that makes a code and the field
 * that takes one. Kept in its own module with no dependencies so those two can
 * never drift — a field that accepts a character the generator never produces is
 * a field that accepts a typo and calls it a code.
 *
 * The server's own rule is `^[A-Z2-9]{6}$`. This is narrower on purpose: no O,
 * I, L, S or Z and no 0, 1 or 5, because those are the characters a loud pub
 * turns into each other. Being strict costs nothing and saves the "ne, béčko!"
 * round trip.
 */

export const JOIN_CODE_LENGTH = 6;

export const JOIN_CODE_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY2346789';

export function generateJoinCode(random: () => number = Math.random): string {
  let code = '';
  for (let index = 0; index < JOIN_CODE_LENGTH; index += 1) {
    code += JOIN_CODE_ALPHABET[Math.floor(random() * JOIN_CODE_ALPHABET.length)];
  }
  return code;
}

/** What somebody typed, as a code — upper-cased, filtered, and never too long. */
export function cleanJoinCode(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((character) => JOIN_CODE_ALPHABET.includes(character))
    .join('')
    .slice(0, JOIN_CODE_LENGTH);
}
