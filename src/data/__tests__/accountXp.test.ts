import { accountXpProgress, FALLBACK_ACCOUNT_LEVELS } from '../accountXp';
import type { AccountMapper, AccountPivar } from '../auth';

const mapper = (xp: number): AccountMapper => ({
  xp,
  level: 1,
  title: 'Nováček',
  xpIntoLevel: xp,
  xpForNextLevel: 300,
  amenityVotesCount: 0,
  distinctMappedPubs: 0,
  firstMapperCount: 0,
  completedPubsCount: 0,
  levels: [],
  xpRules: { firstFact: 15, firstMapperBonus: 25, confirm: 5, pubCompleteBonus: 30 },
});

const pivar = (xp: number): AccountPivar => ({
  xp,
  level: 1,
  title: 'Zelenáč',
  xpIntoLevel: xp,
  xpForNextLevel: 150,
  levels: [...FALLBACK_ACCOUNT_LEVELS],
});

describe('accountXpProgress', () => {
  it('uses one total for drinking and mapping XP', () => {
    expect(accountXpProgress(mapper(380), pivar(120))).toEqual({
      xp: 500,
      level: 3,
      title: 'Pivní tovaryš',
      xpIntoLevel: 0,
      xpForNextLevel: 1000,
    });
  });

  it('falls back to the account ladder for older profiles without Pivař', () => {
    expect(accountXpProgress(mapper(580), undefined)).toMatchObject({
      xp: 580,
      level: 3,
      xpIntoLevel: 80,
      xpForNextLevel: 1000,
    });
  });

  it('returns no fake progress when neither server block exists', () => {
    expect(accountXpProgress(undefined, undefined)).toBeNull();
  });
});
