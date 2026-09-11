import { amenityVoteNeedsUgcConsent } from '../amenityVoteConsent';
import { clearUgcConsentStateForTests, holdUgcPublishing } from '@/data/ugcConsent';
import { useAccountStore } from '@/stores/accountStore';

jest.mock('@/stores/accountStore', () => ({
  useAccountStore: { getState: jest.fn() },
}));

const getState = useAccountStore.getState as unknown as jest.Mock;

function state(over: {
  accountId?: string | null;
  accepted?: boolean;
}): void {
  getState.mockReturnValue({
    session: over.accountId === null ? null : { accountId: over.accountId ?? 'acc-1' },
    profile: over.accepted === undefined ? undefined : { ugcConsent: { accepted: over.accepted } },
  });
}

beforeEach(() => {
  clearUgcConsentStateForTests();
  getState.mockReset();
});

describe('amenityVoteNeedsUgcConsent', () => {
  it('is false for an account whose profile accepted the policy', () => {
    state({ accepted: true });
    expect(amenityVoteNeedsUgcConsent()).toBe(false);
  });

  it('is true when the loaded profile says the policy is not accepted', () => {
    state({ accepted: false });
    expect(amenityVoteNeedsUgcConsent()).toBe(true);
  });

  it('is true from a remembered 428 even before the profile lands', () => {
    state({});
    holdUgcPublishing('acc-1');
    expect(amenityVoteNeedsUgcConsent()).toBe(true);
  });

  it('is false when nothing is known yet', () => {
    state({});
    expect(amenityVoteNeedsUgcConsent()).toBe(false);
  });

  it('is false without a session to hold', () => {
    state({ accountId: null });
    holdUgcPublishing('acc-1');
    expect(amenityVoteNeedsUgcConsent()).toBe(false);
  });
});
