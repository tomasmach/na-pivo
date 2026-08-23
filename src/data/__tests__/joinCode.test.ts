/**
 * The join code, both ends (src/data/joinCode.ts).
 *
 * A join code is heard across a loud pub before it is typed, so what somebody
 * types is not always what was said. The filter has to match the server's
 * alphabet exactly — a character it lets through that the server rejects turns
 * into a failed join with no explanation.
 */

import {
  cleanJoinCode as clean,
  generateJoinCode,
  JOIN_CODE_ACCEPTED_ALPHABET,
  JOIN_CODE_GENERATOR_ALPHABET,
} from '@/data/joinCode';

describe('join code field', () => {
  it('upper-cases what you type', () => {
    expect(clean('abcdef')).toBe('ABCDEF');
  });

  it('accepts exactly what the generator produces', () => {
    // The one property that matters: a code this app made must survive the
    // field this app offers for typing it in.
    for (let index = 0; index < 100; index += 1) {
      const code = generateJoinCode();
      expect(clean(code)).toBe(code);
      expect(code).toMatch(/^[A-Z2-9]{6}$/);
    }
  });

  it('accepts every character allowed by shipped clients and the server', () => {
    expect(JOIN_CODE_ACCEPTED_ALPHABET).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ23456789');
    for (const character of JOIN_CODE_ACCEPTED_ALPHABET) {
      expect(clean(`${character}ABCDE`)[0]).toBe(character);
    }
    expect(clean('pivo25')).toBe('PIVO25');
  });

  it('keeps newly generated codes on the unambiguous alphabet', () => {
    expect(JOIN_CODE_GENERATOR_ALPHABET).not.toMatch(/[OILSZ5]/);
    for (let index = 0; index < JOIN_CODE_GENERATOR_ALPHABET.length; index += 1) {
      const random = () => (index + 0.1) / JOIN_CODE_GENERATOR_ALPHABET.length;
      expect(generateJoinCode(random)).toBe(JOIN_CODE_GENERATOR_ALPHABET[index].repeat(6));
    }
  });

  it('filters characters the server rejects without deleting valid legacy letters', () => {
    expect(clean('P0I1V-O25')).toBe('PIVO25');
  });

  it('stops at six, however much gets pasted', () => {
    expect(clean('ABCDEFGHJK')).toHaveLength(6);
  });

  it('survives a paste with spaces and dashes in it', () => {
    expect(clean('AB-CD EF')).toBe('ABCDEF');
  });
});
