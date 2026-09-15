import {
  isBeerListOverrideCurrent,
  isBeerMenuTypeOverrideCurrent,
  type CommunityOverride,
  useCommunityStore,
} from '@/stores/communityStore';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

const CELL = 'u2fkbn12';
const STALE_AT = Date.parse('2026-07-22T12:00:00.000Z');
const SERVER_AT = '2026-07-22T12:00:01.000Z';
const LOCAL_AT = Date.parse('2026-07-22T12:00:02.000Z');

function staleOverride(withFieldTimestamps = true): CommunityOverride {
  return {
    beers: [{ name: 'Staré pivo' }],
    historicalBeers: [{ name: 'Ještě starší pivo' }],
    beerMenuRotates: true,
    ...(withFieldTimestamps ? { beersOverrideUpdatedAt: STALE_AT } : {}),
    ...(withFieldTimestamps ? { beerMenuRotatesOverrideUpdatedAt: STALE_AT } : {}),
    updatedAt: STALE_AT,
  };
}

describe('community beer override precedence', () => {
  beforeEach(() => {
    useCommunityStore.setState({ overrides: { [CELL]: staleOverride() } });
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_AT);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps a newer optimistic edit over an older backend snapshot', () => {
    const override = staleOverride();
    const olderBackend = '2026-07-22T11:59:59.000Z';

    expect(isBeerListOverrideCurrent(override, olderBackend)).toBe(true);
    expect(isBeerMenuTypeOverrideCurrent(override, olderBackend)).toBe(true);
  });

  it('lets a newer confirmed backend snapshot replace persisted beer fields', () => {
    const override = staleOverride();

    expect(isBeerListOverrideCurrent(override, SERVER_AT)).toBe(false);
    expect(isBeerMenuTypeOverrideCurrent(override, SERVER_AT)).toBe(false);
  });

  it('does not revive a stale list or menu type after an hours-only patch', () => {
    useCommunityStore.setState({ overrides: { [CELL]: staleOverride(false) } });
    useCommunityStore.getState().setOverride(CELL, {
      hours: { mo: [], tu: [], we: [], th: [], fr: [], sa: [], su: [] },
    });

    const override = useCommunityStore.getState().overrides[CELL];
    expect(override.updatedAt).toBe(LOCAL_AT);
    expect(override.beersOverrideUpdatedAt).toBe(STALE_AT);
    expect(override.beerMenuRotatesOverrideUpdatedAt).toBe(STALE_AT);
    expect(isBeerListOverrideCurrent(override, SERVER_AT)).toBe(false);
    expect(isBeerMenuTypeOverrideCurrent(override, SERVER_AT)).toBe(false);
  });

  it('refreshes an edited beer list without reviving a stale menu type', () => {
    useCommunityStore.setState({ overrides: { [CELL]: staleOverride(false) } });
    useCommunityStore.getState().setOverride(CELL, { beers: [{ name: 'Nové pivo' }] });

    const override = useCommunityStore.getState().overrides[CELL];
    expect(override.beersOverrideUpdatedAt).toBe(LOCAL_AT);
    expect(override.beerMenuRotatesOverrideUpdatedAt).toBe(STALE_AT);
    expect(isBeerListOverrideCurrent(override, SERVER_AT)).toBe(true);
    expect(isBeerMenuTypeOverrideCurrent(override, SERVER_AT)).toBe(false);
  });

  it('timestamps an explicit fixed selection even though the boolean is false', () => {
    useCommunityStore.getState().setOverride(CELL, { beerMenuRotates: false });

    const override = useCommunityStore.getState().overrides[CELL];
    expect(override.beerMenuRotates).toBe(false);
    expect(override.beerMenuRotatesOverrideUpdatedAt).toBe(LOCAL_AT);
    expect(isBeerMenuTypeOverrideCurrent(override, SERVER_AT)).toBe(true);
  });
});
