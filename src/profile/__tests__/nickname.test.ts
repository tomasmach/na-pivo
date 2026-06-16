import { checkNicknameLocal } from '../nickname';

describe('checkNicknameLocal', () => {
  it('accepts a plain valid handle', () => {
    expect(checkNicknameLocal('beerfan')).toEqual({ valid: true });
    expect(checkNicknameLocal('Beer_Fan.42')).toEqual({ valid: true });
    expect(checkNicknameLocal('abc')).toEqual({ valid: true });
    expect(checkNicknameLocal('a'.repeat(20))).toEqual({ valid: true });
  });

  it('trims surrounding whitespace before validating', () => {
    expect(checkNicknameLocal('  beerfan  ')).toEqual({ valid: true });
  });

  it('rejects too-short and too-long handles (length before charset)', () => {
    expect(checkNicknameLocal('ab')).toEqual({ valid: false, reason: 'too_short' });
    expect(checkNicknameLocal('')).toEqual({ valid: false, reason: 'too_short' });
    expect(checkNicknameLocal('a'.repeat(21))).toEqual({ valid: false, reason: 'too_long' });
  });

  it('rejects characters outside [a-zA-Z0-9_.]', () => {
    expect(checkNicknameLocal('beer fan')).toEqual({ valid: false, reason: 'invalid' });
    expect(checkNicknameLocal('beer-fan')).toEqual({ valid: false, reason: 'invalid' });
    // No diacritics — mirrors the backend charset.
    expect(checkNicknameLocal('přízdvíka')).toEqual({ valid: false, reason: 'invalid' });
    expect(checkNicknameLocal('beer@fan')).toEqual({ valid: false, reason: 'invalid' });
  });

  it('rejects consecutive dots and leading/trailing dots', () => {
    expect(checkNicknameLocal('beer..fan')).toEqual({ valid: false, reason: 'invalid' });
    expect(checkNicknameLocal('.beerfan')).toEqual({ valid: false, reason: 'invalid' });
    expect(checkNicknameLocal('beerfan.')).toEqual({ valid: false, reason: 'invalid' });
  });

  it('rejects reserved names case-insensitively (after charset/length pass)', () => {
    expect(checkNicknameLocal('admin')).toEqual({ valid: false, reason: 'reserved' });
    expect(checkNicknameLocal('Admin')).toEqual({ valid: false, reason: 'reserved' });
    expect(checkNicknameLocal('NAPIVO')).toEqual({ valid: false, reason: 'reserved' });
    expect(checkNicknameLocal('pivo')).toEqual({ valid: false, reason: 'reserved' });
    expect(checkNicknameLocal('beer')).toEqual({ valid: false, reason: 'reserved' });
  });

  it('does not reject a reserved word embedded in a longer handle', () => {
    expect(checkNicknameLocal('admin_42')).toEqual({ valid: true });
    expect(checkNicknameLocal('beerlover')).toEqual({ valid: true });
  });
});
