import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import { cs } from '@/i18n/cs';
import CommunityEventsScreen from '../community-events';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockFetchCommunityEvents = jest.fn();
const mockCreateCommunityEvent = jest.fn();
const mockRequestCommunityEventJoin = jest.fn();
const mockCancelCommunityEvent = jest.fn();
const mockDecideCommunityJoinRequest = jest.fn();
const mockShowToast = jest.fn();
const mockGetCurrentPositionAsync = jest.fn();
const mockEnsureLocationPermission = jest.fn();
const mockGenerateUuidV4 = jest.fn(() => 'community-draft-id');
const mockShowAppDialog = jest.fn();

jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/AppDialog', () => ({
  showAppDialog: (...args: unknown[]) => mockShowAppDialog(...args),
}));
jest.mock('@/components/shared/KeyboardAwareScrollView', () => {
  const RN = jest.requireActual('react-native');
  return {
    KeyboardAwareScrollView: ({ children, ...props }: { children: React.ReactNode }) => (
      <RN.ScrollView {...props}>{children}</RN.ScrollView>
    ),
  };
});
jest.mock('@/components/shared/IconGlyph', () => ({
  CheckIcon: () => null,
  ChevronLeftIcon: () => null,
  FlagIcon: () => null,
  HouseIcon: () => null,
  MapPinIcon: () => null,
  MinusIcon: () => null,
  PlusIcon: () => null,
  UsersIcon: () => null,
  XIcon: () => null,
}));
jest.mock('@/compass/permissions', () => ({
  ensureLocationPermission: () => mockEnsureLocationPermission(),
  openSystemSettings: jest.fn(),
}));
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getCurrentPositionAsync: (options: unknown) => mockGetCurrentPositionAsync(options),
}));
jest.mock('@/data/account', () => ({
  generateUuidV4: () => mockGenerateUuidV4(),
}));
jest.mock('@/data/communityEventsClient', () => ({
  fetchCommunityEvents: (coords?: unknown) => mockFetchCommunityEvents(coords),
  createCommunityEvent: (input: unknown) => mockCreateCommunityEvent(input),
  requestCommunityEventJoin: (eventId: string, message: string) =>
    mockRequestCommunityEventJoin(eventId, message),
  cancelCommunityEvent: (...args: unknown[]) => mockCancelCommunityEvent(...args),
  decideCommunityJoinRequest: (...args: unknown[]) => mockDecideCommunityJoinRequest(...args),
  leaveCommunityEvent: jest.fn(),
  reportCommunityEvent: jest.fn(),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: (message: string) => void }) => unknown) =>
    selector({ show: mockShowToast }),
}));

const emptyDashboard = { nearby: [], hosted: [], joined: [] };

function event(id: string, title: string) {
  return {
    id,
    host: { id: `host-${id}`, nickname: `host${id}`, displayName: '', avatarUrl: null },
    title,
    description: '',
    city: 'Praha',
    areaLabel: 'Vinohrady',
    startsAt: '2026-07-22T18:00:00.000Z',
    endsAt: '2026-07-22T22:00:00.000Z',
    capacity: 6,
    availableSpots: 4,
    adultsOnly: true as const,
    status: 'upcoming' as const,
    distanceBand: 'under_1_km' as const,
    isHost: false,
    membershipStatus: null,
    exactAddress: null,
    joinRequests: [],
  };
}

describe('CommunityEventsScreen', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGenerateUuidV4.mockReset();
    mockGenerateUuidV4
      .mockReturnValueOnce('community-draft-id')
      .mockReturnValueOnce('community-next-id')
      .mockReturnValue('community-extra-id');
    mockEnsureLocationPermission.mockResolvedValue('granted');
    mockGetCurrentPositionAsync.mockResolvedValue({
      coords: { latitude: 50.075, longitude: 14.44 },
    });
    mockFetchCommunityEvents.mockResolvedValue({ ok: true, dashboard: emptyDashboard });
    mockCreateCommunityEvent.mockResolvedValue({
      ok: false,
      code: 'network',
      detail: 'Zkus to znovu.',
    });
    mockRequestCommunityEventJoin.mockResolvedValue({ ok: true });
    mockCancelCommunityEvent.mockResolvedValue({ ok: true });
    mockDecideCommunityJoinRequest.mockResolvedValue({ ok: true });
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = undefined;
    jest.useRealTimers();
  });

  async function renderScreen() {
    act(() => {
      renderer = TestRenderer.create(<CommunityEventsScreen />);
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });
    await act(async () => {
      await Promise.resolve();
    });
    return renderer!;
  }

  it('does not refetch the unlocated dashboard after obtaining location', async () => {
    mockFetchCommunityEvents
      .mockResolvedValueOnce({ ok: true, dashboard: emptyDashboard })
      .mockResolvedValueOnce({
        ok: true,
        dashboard: { nearby: [event('nearby', 'Večer za rohem')], hosted: [], joined: [] },
      });
    await renderScreen();

    const locateButton = renderer!.root.findByProps({ accessibilityLabel: cs.communityEvents.locate });
    await act(async () => {
      await locateButton.props.onPress();
    });
    act(() => jest.runOnlyPendingTimers());

    expect(mockFetchCommunityEvents).toHaveBeenCalledTimes(2);
    expect(mockFetchCommunityEvents).toHaveBeenNthCalledWith(1, undefined);
    expect(mockFetchCommunityEvents).toHaveBeenNthCalledWith(2, { lat: 50.075, lng: 14.44 });
    expect(renderer!.root.findByProps({ children: 'Večer za rohem' })).toBeTruthy();
  });

  it('keeps the join message local to its event card', async () => {
    mockFetchCommunityEvents.mockResolvedValueOnce({
      ok: true,
      dashboard: {
        nearby: [event('one', 'První večer'), event('two', 'Druhý večer')],
        hosted: [],
        joined: [],
      },
    });
    await renderScreen();

    const inputs = renderer!.root.findAll(
      (node) =>
        node.props.placeholder === cs.communityEvents.requestPlaceholder &&
        typeof node.props.onChangeText === 'function' &&
        typeof node.type === 'string',
    );
    expect(inputs).toHaveLength(2);
    act(() => inputs[0].props.onChangeText('Ahoj z první karty'));

    const updatedInputs = renderer!.root.findAll(
      (node) =>
        node.props.placeholder === cs.communityEvents.requestPlaceholder &&
        typeof node.props.onChangeText === 'function' &&
        typeof node.type === 'string',
    );
    expect(updatedInputs[0].props.value).toBe('Ahoj z první karty');
    expect(updatedInputs[1].props.value).toBe('');
  });

  it('routes report confirmation through the coordinated app dialog', async () => {
    mockFetchCommunityEvents.mockResolvedValueOnce({
      ok: true,
      dashboard: { nearby: [event('one', 'Večer za rohem')], hosted: [], joined: [] },
    });
    await renderScreen();

    const reportLabel = renderer!.root.findByProps({ children: cs.communityEvents.report });
    act(() => reportLabel.parent!.props.onPress());

    expect(mockShowAppDialog).toHaveBeenCalledWith(expect.objectContaining({
      title: cs.communityEvents.reportTitle,
      message: 'Večer za rohem',
      buttons: expect.arrayContaining([
        expect.objectContaining({ text: cs.communityEvents.report, style: 'destructive' }),
      ]),
    }));
  });

  it('reuses one client id for retries and rotates it only after confirmed success', async () => {
    mockCreateCommunityEvent
      .mockResolvedValueOnce({ ok: false, code: 'network', detail: 'Zkus to znovu.' })
      .mockResolvedValueOnce({ ok: true, event: event('created', 'Pivo na zahradě') })
      .mockResolvedValueOnce({ ok: false, code: 'network', detail: 'Zkus to znovu.' });
    await renderScreen();
    const createTabLabel = renderer!.root.findByProps({ children: cs.communityEvents.create });
    act(() => createTabLabel.parent!.props.onPress());

    const titleInput = renderer!.root.findByProps({ placeholder: cs.communityEvents.formTitlePlaceholder });
    const cityInput = renderer!.root.findByProps({ placeholder: cs.communityEvents.cityPlaceholder });
    const addressInput = renderer!.root.findByProps({ placeholder: cs.communityEvents.exactAddressPlaceholder });
    act(() => {
      titleInput.props.onChangeText('Pivo na zahradě');
      cityInput.props.onChangeText('Praha');
      addressInput.props.onChangeText('Vinohradská 12');
    });

    const locationButton = renderer!.root.findByProps({ accessibilityLabel: cs.communityEvents.useLocation });
    await act(async () => {
      await locationButton.props.onPress();
    });
    const adultLabel = renderer!.root.findByProps({ children: cs.communityEvents.adultsConfirm });
    act(() => adultLabel.parent!.props.onPress());

    const publish = renderer!.root.findByProps({ accessibilityLabel: cs.communityEvents.publish });
    await act(async () => {
      await publish.props.onPress();
    });
    await act(async () => {
      await publish.props.onPress();
    });

    expect(mockCreateCommunityEvent).toHaveBeenCalledTimes(2);
    expect(mockCreateCommunityEvent.mock.calls[0][0].clientId).toBe('community-draft-id');
    expect(mockCreateCommunityEvent.mock.calls[1][0].clientId).toBe('community-draft-id');

    const nextCreateTabLabel = renderer!.root.findByProps({ children: cs.communityEvents.create });
    act(() => nextCreateTabLabel.parent!.props.onPress());
    act(() => {
      renderer!.root.findByProps({ placeholder: cs.communityEvents.formTitlePlaceholder }).props.onChangeText('Druhý večer');
      renderer!.root.findByProps({ placeholder: cs.communityEvents.cityPlaceholder }).props.onChangeText('Brno');
      renderer!.root.findByProps({ placeholder: cs.communityEvents.exactAddressPlaceholder }).props.onChangeText('Česká 1');
    });
    await act(async () => {
      await renderer!.root.findByProps({ accessibilityLabel: cs.communityEvents.useLocation }).props.onPress();
    });
    act(() => renderer!.root.findByProps({ children: cs.communityEvents.adultsConfirm }).parent!.props.onPress());
    const nextPublish = renderer!.root.findByProps({ accessibilityLabel: cs.communityEvents.publish });
    await act(async () => {
      await nextPublish.props.onPress();
    });

    expect(mockCreateCommunityEvent).toHaveBeenCalledTimes(3);
    expect(mockCreateCommunityEvent.mock.calls[2][0].clientId).toBe('community-next-id');
    expect(mockGenerateUuidV4).toHaveBeenCalledTimes(2);
  });

  it('shows a retry state when loading fails instead of pretending the list is empty', async () => {
    mockFetchCommunityEvents
      .mockResolvedValueOnce({ ok: false, code: 'network', detail: 'Síť spadla.' })
      .mockResolvedValueOnce({ ok: true, dashboard: emptyDashboard });

    await renderScreen();
    expect(renderer!.root.findByProps({ children: 'Síť spadla.' })).toBeTruthy();

    const retry = renderer!.root.findByProps({ accessibilityLabel: cs.communityEvents.retry });
    await act(async () => {
      await retry.props.onPress();
    });

    expect(mockFetchCommunityEvents).toHaveBeenCalledTimes(2);
    expect(renderer!.root.findByProps({ children: cs.communityEvents.noNearby })).toBeTruthy();
  });

  it('confirms cancellation and ignores a duplicate destructive press', async () => {
    let finishCancel: ((value: { ok: true }) => void) | undefined;
    mockCancelCommunityEvent.mockReturnValueOnce(new Promise((resolve) => {
      finishCancel = resolve;
    }));
    mockFetchCommunityEvents.mockResolvedValueOnce({
      ok: true,
      dashboard: {
        nearby: [],
        hosted: [{ ...event('hosted', 'Můj stůl'), isHost: true }],
        joined: [],
      },
    });
    await renderScreen();
    act(() => renderer!.root.findByProps({ children: cs.communityEvents.mine }).parent!.props.onPress());

    act(() => renderer!.root.findByProps({ children: cs.communityEvents.cancelEvent }).parent!.props.onPress());
    const destructive = mockShowAppDialog.mock.calls[0][0].buttons.find(
      (button: { style?: string }) => button.style === 'destructive',
    );
    act(() => {
      destructive.onPress();
      destructive.onPress();
    });
    expect(mockCancelCommunityEvent).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishCancel?.({ ok: true });
      await Promise.resolve();
    });
  });

  it('rolls the default start into tomorrow late at night', async () => {
    const now = new Date('2026-08-21T23:30:00+02:00');
    jest.setSystemTime(now);
    await renderScreen();
    act(() => renderer!.root.findByProps({ children: cs.communityEvents.create }).parent!.props.onPress());
    act(() => {
      renderer!.root.findByProps({ placeholder: cs.communityEvents.formTitlePlaceholder }).props.onChangeText('Noční stůl');
      renderer!.root.findByProps({ placeholder: cs.communityEvents.cityPlaceholder }).props.onChangeText('Praha');
      renderer!.root.findByProps({ placeholder: cs.communityEvents.exactAddressPlaceholder }).props.onChangeText('Dlouhá 1');
    });
    await act(async () => {
      await renderer!.root.findByProps({ accessibilityLabel: cs.communityEvents.useLocation }).props.onPress();
    });
    act(() => renderer!.root.findByProps({ children: cs.communityEvents.adultsConfirm }).parent!.props.onPress());

    await act(async () => {
      await renderer!.root.findByProps({ accessibilityLabel: cs.communityEvents.publish }).props.onPress();
    });

    const startsAt = new Date(mockCreateCommunityEvent.mock.calls[0][0].startsAt);
    expect(startsAt.getTime()).toBeGreaterThan(now.getTime());
    expect(startsAt.getDate()).toBe(22);
    expect(startsAt.getHours()).toBe(1);
  });
});
