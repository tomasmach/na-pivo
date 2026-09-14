import { inviteClaimState } from '../friendInviteLink';

/**
 * Pure claim-state decision for the invite confirmation screen (RED phase).
 *
 * The screen currently decides 'self' vs 'valid' inline while hydrating the
 * account, which flashes 'valid' for your own code when the account id is not
 * known yet. The decision must live in a pure function: a resolved inviter
 * stays 'loading' until the own account id is hydrated, then collapses to
 * exactly one of 'self' (same id) or 'valid' (different id).
 */

const MY_ID = 'account-me';
const FRIEND_ID = 'account-friend';

describe('inviteClaimState', () => {
  it("stays 'loading' while a resolved inviter exists but the own account id is unknown", () => {
    expect(inviteClaimState(FRIEND_ID, null)).toBe('loading');
  });

  it("becomes 'self' once the hydrated account id equals the inviter id", () => {
    expect(inviteClaimState(MY_ID, MY_ID)).toBe('self');
  });

  it("becomes 'valid' only when the hydrated account id differs from the inviter id", () => {
    expect(inviteClaimState(FRIEND_ID, MY_ID)).toBe('valid');
    expect(inviteClaimState(MY_ID, FRIEND_ID)).toBe('valid');
  });
});
