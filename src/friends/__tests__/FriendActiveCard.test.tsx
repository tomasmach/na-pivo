import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import type { FriendPresence, FriendPubActivity } from '@/data/friendsClient';
import { t } from '@/i18n';
import FriendActiveCard from '../FriendActiveCard';
import { focusPubFromActivity } from '../focusPubHandoff';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({ CompassIcon: () => null, MapPinIcon: () => null }));
jest.mock('../CheersPill', () => () => null);
jest.mock('../GoingRoster', () => () => null);
jest.mock('../LiveDot', () => () => null);
jest.mock('../RsvpControl', () => () => null);
jest.mock('../friendSafety', () => ({ useFriendSafety: () => jest.fn() }));
jest.mock('../focusPubHandoff', () => ({ focusPubFromActivity: jest.fn() }));
jest.mock('../useNowTick', () => ({ useNowTick: () => 0, formatRelative: () => '' }));

const account = { id: 'friend', nickname: 'KarelQA', displayName: '', avatarUrl: null, isPublic: true };
const activity: FriendPubActivity = {
  id: 'invite', account, cacheKey: 'pub-one', name: 'Testovací hospoda', city: '', externalId: '',
  message: '', startedAt: '', expiresAt: '', active: true, createdAt: '', updatedAt: '',
  responses: { going: 0, maybe: 0, cant: 0, goingProfiles: [] }, myResponse: null,
  kind: 'live', scheduledFor: null, reactions: { cheers: 0 }, myReaction: null,
};
const presence: FriendPresence = {
  account, cacheKey: activity.cacheKey, pubName: activity.name, pubCity: '', lat: null, lng: null,
  since: '', lastSeenAt: '', beers: 4, lastDrinkName: '', activityId: activity.id,
};

describe('live friend invite drink count', () => {
  it('opens the explicit compass route after focusing a friend pub', () => {
    jest.mocked(focusPubFromActivity).mockReturnValue(true);
    const screen = render(<FriendActiveCard activity={activity} onResponded={jest.fn()} />);
    fireEvent.press(screen.getByLabelText(t.friends.showOnCompass));
    expect(focusPubFromActivity).toHaveBeenCalledWith(activity);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/', params: { view: 'compass' } });
  });
  it('keeps the count when a sitting friend sends an invite and refreshes it', () => {
    const props = { activity, presence, onResponded: jest.fn() };
    const screen = render(<FriendActiveCard {...props} />);
    expect(screen.getByText(t.friends.presenceBeers(4))).toBeTruthy();
    screen.rerender(<FriendActiveCard {...{ ...props, presence: { ...presence, beers: 5 } }} />);
    expect(screen.getByText(t.friends.presenceBeers(5))).toBeTruthy();
    expect(screen.queryByText(t.friends.presenceBeers(4))).toBeNull();
  });

  it.each([
    undefined,
    { ...presence, cacheKey: 'different-pub' },
    { ...presence, account: { ...account, id: 'other-friend' } },
  ])('does not invent a count without a matching shared visit', (sharedPresence) => {
    const props = { activity, presence: sharedPresence, onResponded: jest.fn() };
    const screen = render(<FriendActiveCard {...props} />);
    expect(screen.queryByText(t.friends.presenceBeers(4))).toBeNull();
    expect(screen.queryByText(t.friends.presenceBeers(0))).toBeNull();
  });
});
