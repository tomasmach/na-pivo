import {
  AMENITIES,
  RESERVED_AMENITIES,
  AMENITY_SECTIONS,
  AMENITY_RULES,
  CURRENT_TAXONOMY_VERSION,
  isKnownAmenityKey,
  getAmenityDef,
  type AmenityKey,
} from '../amenities';

/** Source of truth cross-check — must match the backend seed (spec §2 table). */
const EXPECTED: { key: AmenityKey; group: string; icon: string; order: number }[] = [
  { key: 'payment_card', group: 'payment', icon: 'CreditCardIcon', order: 10 },
  { key: 'payment_cash_only', group: 'payment', icon: 'BanknoteIcon', order: 20 },
  { key: 'seating_garden', group: 'seating', icon: 'TreePineIcon', order: 30 },
  { key: 'seating_barrier_free', group: 'seating', icon: 'AccessibilityIcon', order: 40 },
  { key: 'seating_kids_corner', group: 'seating', icon: 'BabyIcon', order: 50 },
  { key: 'game_darts', group: 'games', icon: 'TargetIcon', order: 60 },
  { key: 'game_billiards', group: 'games', icon: 'DicesIcon', order: 70 },
  { key: 'game_foosball', group: 'games', icon: 'Gamepad2Icon', order: 80 },
  { key: 'game_jukebox', group: 'games', icon: 'RadioIcon', order: 90 },
  { key: 'atmosphere_live_music', group: 'atmosphere', icon: 'MicIcon', order: 100 },
  { key: 'atmosphere_sports_tv', group: 'atmosphere', icon: 'TvIcon', order: 110 },
  { key: 'atmosphere_dogs_welcome', group: 'atmosphere', icon: 'DogIcon', order: 120 },
  { key: 'atmosphere_smoking', group: 'atmosphere', icon: 'CigaretteIcon', order: 130 },
  { key: 'practical_wifi', group: 'practical', icon: 'WifiIcon', order: 140 },
  { key: 'practical_parking', group: 'practical', icon: 'SquareParkingIcon', order: 150 },
  { key: 'practical_food', group: 'practical', icon: 'UtensilsIcon', order: 160 },
];

describe('amenity catalogue integrity', () => {
  it('ships exactly 16 active amenities', () => {
    expect(AMENITIES).toHaveLength(16);
  });

  it('matches the canonical key/group/icon/order table from the spec', () => {
    expect(AMENITIES.map((a) => ({ key: a.key, group: a.group, icon: a.icon, order: a.order }))).toEqual(
      EXPECTED,
    );
  });

  it('is sorted by ascending order', () => {
    const orders = AMENITIES.map((a) => a.order);
    expect(orders).toEqual([...orders].sort((x, y) => x - y));
  });

  it('uses the locked group asymmetry (game_ prefix → games group)', () => {
    for (const a of AMENITIES) {
      const prefix = a.key.split('_')[0];
      const expectedGroup = prefix === 'game' ? 'games' : prefix;
      expect(a.group).toBe(expectedGroup);
    }
  });

  it('lists the five groups in the locked display order', () => {
    expect(AMENITY_SECTIONS).toEqual(['payment', 'seating', 'games', 'atmosphere', 'practical']);
  });

  it('has a non-empty cs label + shortLabel for every active amenity', () => {
    for (const a of AMENITIES) {
      expect(a.label.length).toBeGreaterThan(0);
      expect(a.shortLabel.length).toBeGreaterThan(0);
    }
  });

  it('keeps the two reserved keys out of the active set', () => {
    const reservedKeys = RESERVED_AMENITIES.map((r) => r.key).sort();
    expect(reservedKeys).toEqual(['practical_outdoor_tap', 'practical_tank_beer']);
    for (const key of reservedKeys) {
      expect(isKnownAmenityKey(key)).toBe(false);
    }
    // practical_outdoor_tap must NOT reuse BeerIcon — it has no glyph yet.
    const outdoorTap = RESERVED_AMENITIES.find((r) => r.key === 'practical_outdoor_tap');
    expect(outdoorTap?.icon).toBeUndefined();
  });

  it('pins the taxonomy version to 1', () => {
    expect(CURRENT_TAXONOMY_VERSION).toBe(1);
  });
});

describe('AMENITY_RULES.softExclusive', () => {
  it('pairs payment_card with payment_cash_only', () => {
    expect(AMENITY_RULES.softExclusive).toEqual([['payment_card', 'payment_cash_only']]);
  });
});

describe('isKnownAmenityKey', () => {
  it('accepts every active key', () => {
    for (const a of AMENITIES) {
      expect(isKnownAmenityKey(a.key)).toBe(true);
    }
  });

  it('rejects unknown / reserved keys and non-strings', () => {
    expect(isKnownAmenityKey('totally_made_up')).toBe(false);
    expect(isKnownAmenityKey('practical_tank_beer')).toBe(false);
    expect(isKnownAmenityKey(42)).toBe(false);
    expect(isKnownAmenityKey(undefined)).toBe(false);
  });
});

describe('getAmenityDef', () => {
  it('resolves an active def and returns undefined for unknown/reserved keys', () => {
    expect(getAmenityDef('game_darts')?.label).toBe('Šipky');
    expect(getAmenityDef('practical_tank_beer')).toBeUndefined();
    expect(getAmenityDef('nope')).toBeUndefined();
  });
});
