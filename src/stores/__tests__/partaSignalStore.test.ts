import { hasLiveFriendSignal } from '../partaSignalStore';

describe('hasLiveFriendSignal', () => {
  it('ignores the current user activity', () => {
    const liveSlice = {
      presence: [],
      activeFriends: [],
      myActiveActivity: { id: 'mine' },
    };

    expect(hasLiveFriendSignal(liveSlice)).toBe(false);
  });

  it('detects friend presence', () => {
    expect(
      hasLiveFriendSignal({
        presence: [{ userId: 'friend' }],
        activeFriends: [],
      }),
    ).toBe(true);
  });

  it('detects an active friend', () => {
    expect(
      hasLiveFriendSignal({
        presence: [],
        activeFriends: [{ userId: 'friend' }],
      }),
    ).toBe(true);
  });

  it('returns false when no friend is live', () => {
    expect(
      hasLiveFriendSignal({
        presence: [],
        activeFriends: [],
      }),
    ).toBe(false);
  });
});
