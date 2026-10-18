import * as Notifications from 'expo-notifications';

import {
  beerOnTapPub,
  consumeInitialBeerOnTapTap,
  subscribeBeerOnTapTap,
} from '../beerWatchPush';

jest.mock('expo-notifications', () => ({
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponseAsync: jest.fn(async () => null),
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3 },
}));

function response(identifier: string, data: Record<string, unknown>): Notifications.NotificationResponse {
  return {
    notification: { request: { identifier, content: { data } } },
  } as unknown as Notifications.NotificationResponse;
}

const PUB = { key: 'u2fkbbbb', name: 'U Hrocha', lat: 50.0884, lng: 14.4041 };
const beerPush = (id: string) => response(id, { kind: 'beer_on_tap', ...PUB });

function liveListener(): (r: Notifications.NotificationResponse) => void {
  const calls = jest.mocked(Notifications.addNotificationResponseReceivedListener).mock.calls;
  return calls.at(-1)![0];
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('beerOnTapPub', () => {
  it('reads the pub of a beer_on_tap push', () => {
    expect(beerOnTapPub(beerPush('a'))).toEqual(PUB);
  });

  it('ignores friend pushes and other kinds', () => {
    for (const kind of ['friend_at_pub', 'friend_tour_invite', 'pub_reminder', undefined]) {
      expect(beerOnTapPub(response('x', { ...PUB, kind }))).toBeNull();
    }
  });

  it('rejects a malformed payload', () => {
    expect(beerOnTapPub(response('x', { kind: 'beer_on_tap', ...PUB, key: '../../etc' }))).toBeNull();
    expect(beerOnTapPub(response('x', { kind: 'beer_on_tap', ...PUB, lat: 'abc' }))).toBeNull();
    expect(beerOnTapPub(response('x', { kind: 'beer_on_tap', ...PUB, lng: 200 }))).toBeNull();
    expect(beerOnTapPub(null)).toBeNull();
  });
});

describe('tap routing', () => {
  it('opens the pub on a live tap, once per notification', () => {
    const onTap = jest.fn();
    subscribeBeerOnTapTap(onTap);
    liveListener()(beerPush('live-1'));
    liveListener()(beerPush('live-1'));
    liveListener()(response('friend', { kind: 'friend_cheers' }));
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap).toHaveBeenCalledWith(PUB);
  });

  it('opens the pub on a cold start and clears the launch response', async () => {
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValueOnce(beerPush('cold-1'));
    const onTap = jest.fn();
    await consumeInitialBeerOnTapTap(onTap);
    expect(onTap).toHaveBeenCalledWith(PUB);
    expect(Notifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
  });

  it('does not open the pub twice when the launch tap also arrives live', async () => {
    const onTap = jest.fn();
    subscribeBeerOnTapTap(onTap);
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValueOnce(beerPush('cold-2'));
    await consumeInitialBeerOnTapTap(onTap);
    liveListener()(beerPush('cold-2'));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it('leaves a launch response of another kind for its own handler', async () => {
    jest.mocked(Notifications.getLastNotificationResponseAsync).mockResolvedValueOnce(
      response('friend', { kind: 'friend_request' }),
    );
    const onTap = jest.fn();
    await consumeInitialBeerOnTapTap(onTap);
    expect(onTap).not.toHaveBeenCalled();
    expect(Notifications.clearLastNotificationResponseAsync).not.toHaveBeenCalled();
  });
});
