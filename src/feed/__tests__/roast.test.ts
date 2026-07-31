import { buildRoast, type RoastInput } from '@/feed/roast';

/** A night that comfortably clears every guard, so each test can bend one axis. */
const BASE: RoastInput = {
  beers: 6,
  duration: 180,
  pubs: 1,
  people: 3,
  photos: 4,
  games: 0,
  gamesWon: 0,
  usualPerHour: 2,
  visitsToSamePub: 1,
};

describe('buildRoast — when it must stay quiet', () => {
  it('says nothing when you drank alone', () => {
    // The voice is the table talking back; there is no table.
    expect(buildRoast({ ...BASE, people: 1 })).toBeNull();
  });

  it('says nothing on a first night', () => {
    // No baseline to be funny about, and a bad first impression.
    expect(buildRoast({ ...BASE, usualPerHour: null })).toBeNull();
  });

  it('says nothing when barely anything happened', () => {
    expect(buildRoast({ ...BASE, beers: 1 })).toBeNull();
    expect(buildRoast({ ...BASE, duration: 10 })).toBeNull();
  });

  it('says nothing rather than forcing a joke', () => {
    // An ordinary night at an ordinary pace matches no rule.
    expect(buildRoast(BASE)).toBeNull();
  });
});

describe('buildRoast — what it is allowed to be rude about', () => {
  it('leads with pubs visited and no photos taken', () => {
    const roast = buildRoast({ ...BASE, pubs: 3, photos: 0 });
    expect(roast?.line).toContain('3 hospody');
    expect(roast?.line).toContain('ani jedna fotka');
  });

  it('mocks losing every game', () => {
    const roast = buildRoast({ ...BASE, games: 2, gamesWon: 0 });
    expect(roast?.line).toContain('ani jedna výhra');
  });

  it('compares pace against your own normal, not an absolute', () => {
    const roast = buildRoast({ ...BASE, beers: 8, duration: 60, usualPerHour: 2 });
    expect(roast?.basis).toContain('rychlejší než obvykle');
  });

  it('never roasts the quantity itself', () => {
    // A big night at a normal pace, with photos and no games lost: the volume
    // alone must not trigger anything. Punching at how much someone drank is
    // where the app would start reading as a dare.
    expect(buildRoast({ ...BASE, beers: 14, duration: 420, usualPerHour: 2 })).toBeNull();
  });
});
