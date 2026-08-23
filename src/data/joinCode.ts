/**
 * The six characters somebody reads across a table.
 *
 * New codes avoid characters that are easy to mishear across a table. Input is
 * deliberately wider: shipped clients and the server accept `[A-Z2-9]{6}`, so
 * an older table containing I, O, L, S, Z or 5 must remain joinable.
 */

export const JOIN_CODE_LENGTH = 6;

export const JOIN_CODE_GENERATOR_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXY2346789';
export const JOIN_CODE_ACCEPTED_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789';

/** Backwards-compatible accepted alphabet for existing persisted-data validators. */
export const JOIN_CODE_ALPHABET = JOIN_CODE_ACCEPTED_ALPHABET;

export function generateJoinCode(random: () => number = Math.random): string {
  let code = '';
  for (let index = 0; index < JOIN_CODE_LENGTH; index += 1) {
    code += JOIN_CODE_GENERATOR_ALPHABET[
      Math.floor(random() * JOIN_CODE_GENERATOR_ALPHABET.length)
    ];
  }
  return code;
}

/** What somebody typed, as a code — upper-cased, filtered, and never too long. */
export function cleanJoinCode(input: string): string {
  return input
    .toUpperCase()
    .split('')
    .filter((character) => JOIN_CODE_ACCEPTED_ALPHABET.includes(character))
    .join('')
    .slice(0, JOIN_CODE_LENGTH);
}
