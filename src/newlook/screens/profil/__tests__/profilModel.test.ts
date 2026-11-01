import { parseBadgeProgress } from '@/data/achievements';

import { buildNvBadges, nvStillLine, observeLevel } from '../profilModel';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

describe('observeLevel', () => {
  it('shows a level-up once, only for a level the account has not seen', async () => {
    await expect(observeLevel('a', 3)).resolves.toBeNull();
    await expect(observeLevel('a', 3)).resolves.toBeNull();
    const up = await observeLevel('a', 4);
    expect(up?.since).toEqual(expect.any(String));
    await expect(observeLevel('a', 4)).resolves.toBeNull();
  });

  it('starts over without a sheet when another account signs in', async () => {
    await observeLevel('a', 5);
    await expect(observeLevel('b', 6)).resolves.toBeNull();
    await expect(observeLevel('b', 7)).resolves.not.toBeNull();
  });
});

describe('buildNvBadges', () => {
  it('adds "Večer s partou" next to the crew badges, locked until five evenings', () => {
    const badges = buildNvBadges(parseBadgeProgress({ party_evenings: 3 }), new Date('2026-11-01T12:00:00Z'));
    const party = badges.find((badge) => badge.key === 'partyEvenings');
    expect(party?.group).toBe('social');
    expect(party?.state.tier).toBe(0);
    expect(party?.status).toBe('3/5');
    expect(nvStillLine(party!)).toBe('Ještě 2 večery');
  });

  it('keeps every old badge', () => {
    const badges = buildNvBadges(parseBadgeProgress({}), new Date());
    expect(badges).toHaveLength(27);
  });
});
