/**
 * The join code, both ends (src/data/joinCode.ts).
 *
 * A join code is heard across a loud pub before it is typed, so what somebody
 * types is not always what was said. The filter has to match the server's
 * alphabet exactly — a character it lets through that the server rejects turns
 * into a failed join with no explanation.
 */

import { cleanJoinCode as clean, generateJoinCode } from '@/data/joinCode';

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

  it('drops the characters the server has no letter for', () => {
    // Heard as "O", "I" and "S" — the code alphabet has none of them.
    expect(clean('AOBICS')).toBe('ABC');
  });

  it('stops at six, however much gets pasted', () => {
    expect(clean('ABCDEFGHJK')).toHaveLength(6);
  });

  it('survives a paste with spaces and dashes in it', () => {
    expect(clean('AB-CD EF')).toBe('ABCDEF');
  });
});
