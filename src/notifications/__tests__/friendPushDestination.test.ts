import { createInviteNavigationCoordinator } from '@/data/inviteNavigation';
import { claimFriendPushDestination, friendPushDestination } from '../friendPushDestination';

describe('friendPushDestination', () => {
  it('opens the request inbox for a friend request', () => {
    expect(friendPushDestination({ kind: 'friend_request', activityId: null, friendshipId: 'f 1' }))
      .toBe('/friends/parta/people?focus=requests&friendshipId=f%201');
    expect(friendPushDestination({ kind: 'friend_request', activityId: null, friendshipId: null }))
      .toBe('/friends/parta/people?focus=requests');
  });

  it('opens friends after an accepted request', () => {
    expect(friendPushDestination({ kind: 'friend_accepted', activityId: null, friendshipId: 'f1' }))
      .toBe('/friends/parta/people?focus=friends');
  });

  it('opens the matching live or plan section', () => {
    expect(friendPushDestination({ kind: 'friend_at_pub', activityId: 'a1', friendshipId: null }))
      .toBe('/friends/parta?focus=presence&activityId=a1');
    expect(friendPushDestination({ kind: 'friend_plan', activityId: 'a2', friendshipId: null }))
      .toBe('/friends/parta?focus=plans&activityId=a2');
  });

  it('falls back safely for a newer friend push kind', () => {
    expect(friendPushDestination({ kind: 'friend_new_kind', activityId: null, friendshipId: null }))
      .toBe('/friends/parta');
    expect(friendPushDestination()).toBe('/friends/parta');
  });

  it.each([null, 'friendship-1'])(
    'cold friend request beats a pending persisted invite (friendshipId=%s)',
    (friendshipId) => {
      const coordinator = createInviteNavigationCoordinator();
      const restore = coordinator.beginRestoreLookup();
      const destination = claimFriendPushDestination(coordinator, {
        kind: 'friend_request',
        activityId: null,
        friendshipId,
        notificationId: 'notification-1',
      });

      expect(destination).toBe(
        friendshipId
          ? '/friends/parta/people?focus=requests&friendshipId=friendship-1'
          : '/friends/parta/people?focus=requests',
      );
      expect(coordinator.resolveRestoreLookup(restore, 'stashed-friend-code').action).toBe('none');
    },
  );
});
