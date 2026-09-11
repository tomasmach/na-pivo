import { amenityVoteUgcConsentCode } from '../amenityVoteConsent';
import {
  CURRENT_UGC_POLICY_VERSION,
  clearUgcConsentStateForTests,
  holdUgcPublishing,
  rememberUgcConsent,
} from '@/data/ugcConsent';
import { useAccountStore } from '@/stores/accountStore';

jest.mock('@/stores/accountStore', () => ({
  useAccountStore: { getState: jest.fn() },
}));

const getState = useAccountStore.getState as unknown as jest.Mock;

function state(over: {
  accountId?: string | null;
  accepted?: boolean;
  acceptedVersion?: string;
}): void {
  getState.mockReturnValue({
    session: over.accountId === null ? null : { accountId: over.accountId ?? 'acc-1' },
    profile:
      over.accepted === undefined
        ? undefined
        : {
            ugcConsent: {
              accepted: over.accepted,
              acceptedVersion: over.acceptedVersion ?? '',
              policyVersion: CURRENT_UGC_POLICY_VERSION,
              acceptedAt: null,
            },
          },
  });
}

const ACCEPTED = {
  policyVersion: CURRENT_UGC_POLICY_VERSION,
  accepted: true,
  acceptedVersion: CURRENT_UGC_POLICY_VERSION,
  acceptedAt: '2026-09-11T20:00:00Z',
};

beforeEach(() => {
  clearUgcConsentStateForTests();
  getState.mockReset();
});

describe('amenityVoteUgcConsentCode', () => {
  it('is null for an account whose profile accepted the policy', () => {
    state({ accepted: true });
    expect(amenityVoteUgcConsentCode()).toBeNull();
  });

  it('asks from scratch when the loaded profile never accepted anything', () => {
    state({ accepted: false });
    expect(amenityVoteUgcConsentCode()).toBe('ugc_consent_required');
  });

  it('says the rules changed when the profile accepted an older version', () => {
    state({ accepted: false, acceptedVersion: '2026-01-01' });
    expect(amenityVoteUgcConsentCode()).toBe('ugc_policy_update_required');
  });

  it('reports the code from a remembered 428 even before the profile lands', () => {
    state({});
    holdUgcPublishing('acc-1', 'ugc_policy_update_required');
    expect(amenityVoteUgcConsentCode()).toBe('ugc_policy_update_required');
  });

  it('is null when nothing is known yet', () => {
    state({});
    expect(amenityVoteUgcConsentCode()).toBeNull();
  });

  it('is null without a session to hold', () => {
    state({ accountId: null });
    holdUgcPublishing('acc-1');
    expect(amenityVoteUgcConsentCode()).toBeNull();
  });

  it('trusts the remembered acceptance over a stale profile snapshot', () => {
    // The profile object still carries the answer of a /account/me that was in
    // flight while the user accepted.
    state({ accepted: false });
    rememberUgcConsent('acc-1', ACCEPTED);

    expect(amenityVoteUgcConsentCode()).toBeNull();
  });
});
