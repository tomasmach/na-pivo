import { isBeerOverrideCurrent, type CommunityOverride } from '@/stores/communityStore';

const override: CommunityOverride = {
  beerMenuRotates: true,
  updatedAt: Date.parse('2026-07-22T12:00:00.000Z'),
};

describe('isBeerOverrideCurrent', () => {
  it('keeps a newer optimistic edit over an older backend snapshot', () => {
    expect(isBeerOverrideCurrent(override, '2026-07-22T11:59:59.000Z')).toBe(true);
  });

  it('lets a newer confirmed backend snapshot replace the persisted override', () => {
    expect(isBeerOverrideCurrent(override, '2026-07-22T12:00:01.000Z')).toBe(false);
  });

  it('keeps the override when no comparable backend timestamp exists', () => {
    expect(isBeerOverrideCurrent(override, null)).toBe(true);
    expect(isBeerOverrideCurrent(override, 'not-a-date')).toBe(true);
  });
});
