import React from 'react';

import type { PublishedNight } from '@/data/nightsClient';
import { notifyNightFeedSafetyChange } from '@/feed/feedSafetySignal';

import NightDetailScreen from '../NightDetailScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockShowToast = jest.fn();
const mockFetchNightDetail = jest.fn();
const mockFetchNightComments = jest.fn();
const mockCreateNightComment = jest.fn();
const mockDeleteNightComment = jest.fn();
const mockUnpublishNight = jest.fn();
const mockReportProfileContent = jest.fn();
const mockReactToNight = jest.fn();
const mockClearNightReaction = jest.fn();
const mockEnqueueNightOp = jest.fn();
const mockShowDialog = jest.fn();
const mockMarkUnpublished = jest.fn();
let mockAccountId = 'viewer-a';

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'night-1' }),
  useRouter: () => ({ back: mockBack, push: mockPush }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/AppDialog', () => ({
  showAppDialog: (...args: unknown[]) => mockShowDialog(...args),
}));
jest.mock('@/components/shared/GlassIconButton', () => ({
  GlassIconButton: (props: Record<string, unknown>) => {

    const ReactModule = jest.requireActual('react');
    return ReactModule.createElement('GlassIconButton', props, props.children);
  },
}));
jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronLeftIcon: () => null,
  MenuIcon: () => null,
  Trash2Icon: () => null,
}));
jest.mock('@/components/shared/KeyboardAwareScrollView', () => ({
  KeyboardAwareScrollView: (props: Record<string, unknown>) => {

    const ReactModule = jest.requireActual('react');
    return ReactModule.createElement('KeyboardAwareScrollView', props, props.children);
  },
}));
jest.mock('@/data/account', () => ({
  generateUuidV4: () => '11111111-1111-4111-8111-111111111111',
}));
jest.mock('@/data/auth', () => ({
  reportProfileContent: (...args: unknown[]) => mockReportProfileContent(...args),
}));
jest.mock('@/data/nightsClient', () => ({
  clearNightReaction: (...args: unknown[]) => mockClearNightReaction(...args),
  createNightComment: (...args: unknown[]) => mockCreateNightComment(...args),
  deleteNightComment: (...args: unknown[]) => mockDeleteNightComment(...args),
  fetchNightComments: (...args: unknown[]) => mockFetchNightComments(...args),
  fetchNightDetail: (...args: unknown[]) => mockFetchNightDetail(...args),
  isRetriableNightError: (result: { code?: string }) => result.code === 'network',
  reactToNight: (...args: unknown[]) => mockReactToNight(...args),
  unpublishNight: (...args: unknown[]) => mockUnpublishNight(...args),
}));
jest.mock('@/data/nightsQueue', () => ({
  enqueueNightOp: (...args: unknown[]) => mockEnqueueNightOp(...args),
}));
jest.mock('@/feed/feedCache', () => ({
  removeAccountFromNightFeedCaches: jest.fn(async () => undefined),
}));
jest.mock('@/feed/FeedScreen', () => ({
  FeedCard: (props: Record<string, unknown>) => {

    const ReactModule = jest.requireActual('react');
    return ReactModule.createElement('FeedCard', props);
  },
}));
jest.mock('@/friends/SkeletonBlock', () => ({ __esModule: true, default: () => null }));
jest.mock('@/profile/Avatar', () => ({
  Avatar: (props: Record<string, unknown>) => {

    const ReactModule = jest.requireActual('react');
    return ReactModule.createElement('Avatar', props);
  },
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof mockShowToast }) => unknown) =>
    selector({ show: mockShowToast }),
}));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (
    selector: (state: { session: { accountId: string } | null }) => unknown,
  ) => selector({ session: mockAccountId ? { accountId: mockAccountId } : null }),
}));
jest.mock('@/stores/vycepStore', () => ({
  useVycepStore: (
    selector: (state: { markUnpublished: typeof mockMarkUnpublished }) => unknown,
  ) => selector({ markUnpublished: mockMarkUnpublished }),
}));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));


const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

const night: PublishedNight = {
  id: 'night-1',
  author: {
    id: 'author-1',
    nickname: 'honza',
    displayName: 'Honza',
    avatarUrl: null,
    isPublic: true,
  },
  drinkingDay: '2026-08-05',
  startedAt: '2026-08-05T19:00:00Z',
  endedAt: '2026-08-05T22:00:00Z',
  beerCount: 4,
  wineCount: 0,
  softDrinkCount: 0,
  shotCount: 0,
  pubNames: ['U Tygra'],
  city: 'Praha',
  durationMinutes: 180,
  title: 'Čtyři kousky a domů',
  roastLine: '',
  roastBasis: '',
  participants: [],
  heroPhotos: [],
  heroGames: [],
  visibility: 'friends',
  createdAt: '2026-08-05T22:05:00Z',
  rounds: 0,
  myRound: false,
  isMine: false,
  commentCount: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAccountId = 'viewer-a';
  mockFetchNightDetail.mockResolvedValue({ ok: true, night });
  mockFetchNightComments.mockResolvedValue({ ok: true, comments: [] });
  mockDeleteNightComment.mockResolvedValue({ ok: true });
  mockUnpublishNight.mockResolvedValue({ ok: true });
  mockReportProfileContent.mockResolvedValue({ ok: true });
  mockReactToNight.mockResolvedValue({ ok: true, rounds: 1, myRound: true });
  mockClearNightReaction.mockResolvedValue({ ok: true, rounds: 0, myRound: false });
  mockEnqueueNightOp.mockResolvedValue(true);
});

it('drops retained private detail synchronously when the signed-in account changes', async () => {
  mockFetchNightDetail
    .mockResolvedValueOnce({ ok: true, night })
    .mockResolvedValueOnce({ ok: false, code: 'network', detail: 'Bez signálu.' });
  mockFetchNightComments
    .mockResolvedValueOnce({ ok: true, comments: [] })
    .mockResolvedValueOnce({ ok: false, code: 'network', detail: 'Bez signálu.' });
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<NightDetailScreen />);
  });
  expect(renderer!.root.findByType('FeedCard').props.night.id).toBe('night-1');

  mockAccountId = 'viewer-b';
  act(() => renderer!.update(<NightDetailScreen />));

  expect(renderer!.root.findAllByType('FeedCard')).toHaveLength(0);
  await act(async () => flushPromises());
  expect(renderer!.root.findAllByType('FeedCard')).toHaveLength(0);
  act(() => renderer!.unmount());
});

it('leaves a retained detail immediately after its author is blocked', async () => {
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<NightDetailScreen />);
  });

  await act(async () => {
    await notifyNightFeedSafetyChange({
      viewerAccountId: 'viewer-a',
      targetAccountId: 'author-1',
      blocked: true,
    });
  });

  expect(renderer!.root.findAllByType('FeedCard')).toHaveLength(0);
  expect(mockBack).toHaveBeenCalledTimes(1);
  act(() => renderer!.unmount());
  await notifyNightFeedSafetyChange({
    viewerAccountId: 'viewer-a',
    targetAccountId: 'author-1',
    blocked: false,
  });
});

it('strips a newly blocked participant and their retained comment from detail', async () => {
  const blockedParticipant = {
    id: 'participant-1',
    nickname: 'blok',
    displayName: 'Blok',
    avatarUrl: null,
    isPublic: true,
  };
  mockFetchNightDetail.mockResolvedValueOnce({
    ok: true,
    night: { ...night, participants: [blockedParticipant], commentCount: 1 },
  });
  mockFetchNightComments.mockResolvedValueOnce({
    ok: true,
    comments: [{
      id: 'comment-blocked',
      author: blockedParticipant,
      body: 'Tohle po bloku zmizí.',
      createdAt: '2026-08-05T22:10:00Z',
      isMine: false,
      canDelete: false,
    }],
  });
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<NightDetailScreen />);
  });

  await act(async () => {
    await notifyNightFeedSafetyChange({
      viewerAccountId: 'viewer-a',
      targetAccountId: 'participant-1',
      blocked: true,
    });
  });

  expect(renderer!.root.findByType('FeedCard').props.night.participants).toEqual([]);
  expect(renderer!.root.findAllByProps({ children: 'Tohle po bloku zmizí.' })).toHaveLength(0);
  expect(mockBack).not.toHaveBeenCalled();
  act(() => renderer!.unmount());
  await notifyNightFeedSafetyChange({
    viewerAccountId: 'viewer-a',
    targetAccountId: 'participant-1',
    blocked: false,
  });
});

it('reports the concrete foreign night from the detail action menu', async () => {
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<NightDetailScreen />);
  });

  act(() => {
    renderer!.root.findByProps({ accessibilityLabel: 'Možnosti večera' }).props.onPress();
  });
  const dialog = mockShowDialog.mock.calls[0][0] as {
    buttons: { onPress?: () => void }[];
  };
  await act(async () => {
    dialog.buttons[1].onPress?.();
    await flushPromises();
  });

  expect(mockReportProfileContent).toHaveBeenCalledWith({
    targetAccountId: 'author-1',
    reason: 'spam',
    nightId: 'night-1',
  });
  expect(mockShowToast).toHaveBeenCalledWith('Díky, máme to. Mrkneme na to.');
});

it('confirms and deletes the owner publication while keeping the private diary', async () => {
  mockFetchNightDetail.mockResolvedValue({
    ok: true,
    night: { ...night, isMine: true, clientId: 'client-night-1' },
  });
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<NightDetailScreen />);
  });

  act(() => {
    renderer!.root.findByProps({ accessibilityLabel: 'Možnosti večera' }).props.onPress();
  });
  const dialog = mockShowDialog.mock.calls[0][0] as {
    message: string;
    buttons: { onPress?: () => void }[];
  };
  expect(dialog.message).toBe('Večer zmizí z Kocovin i profilů. V deníčku ti zůstane.');
  await act(async () => {
    dialog.buttons[1].onPress?.();
    await flushPromises();
  });

  expect(mockUnpublishNight).toHaveBeenCalledWith('client-night-1');
  expect(mockMarkUnpublished).toHaveBeenCalledWith('client-night-1');
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('keeps one idempotency key when a comment retry follows a network failure', async () => {
  mockCreateNightComment
    .mockResolvedValueOnce({ ok: false, code: 'network', detail: 'Bez signálu.' })
    .mockResolvedValueOnce({
      ok: true,
      comment: {
        id: 'comment-1',
        author: night.author,
        body: 'To mělo říz.',
        createdAt: '2026-08-05T22:10:00Z',
        isMine: true,
        canDelete: true,
      },
    });
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<NightDetailScreen />);
  });

  const input = renderer!.root.findByProps({ accessibilityLabel: 'Komentář k večeru' });
  await act(async () => input.props.onChangeText('  To mělo říz.  '));
  const send = renderer!.root.findByProps({ accessibilityLabel: 'Poslat komentář' });
  await act(async () => send.props.onPress());
  await act(async () => send.props.onPress());

  expect(mockCreateNightComment).toHaveBeenNthCalledWith(
    1,
    'night-1',
    'To mělo říz.',
    '11111111-1111-4111-8111-111111111111',
  );
  expect(mockCreateNightComment).toHaveBeenNthCalledWith(
    2,
    'night-1',
    'To mělo říz.',
    '11111111-1111-4111-8111-111111111111',
  );
  expect(mockShowToast).toHaveBeenCalledWith('Bez signálu.');
  expect(renderer!.root.findByProps({ children: 'To mělo říz.' })).toBeTruthy();
  expect(renderer!.root.findByType('FeedCard').props.night.commentCount).toBe(1);
});

it('lets the night owner or comment author delete a server-provided comment', async () => {
  mockFetchNightComments.mockResolvedValue({
    ok: true,
    comments: [
      {
        id: 'comment-1',
        author: night.author,
        body: 'Na zdraví.',
        createdAt: '2026-08-05T22:10:00Z',
        isMine: true,
        canDelete: true,
      },
    ],
  });
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<NightDetailScreen />);
  });

  const remove = renderer!.root.findByProps({ accessibilityLabel: 'Smazat komentář' });
  act(() => remove.props.onPress());

  expect(mockDeleteNightComment).not.toHaveBeenCalled();
  const dialog = mockShowDialog.mock.calls.at(-1)?.[0] as {
    buttons: { style?: string; onPress?: () => void }[];
  };
  await act(async () => {
    dialog.buttons.find((button) => button.style === 'destructive')?.onPress?.();
    await flushPromises();
  });

  expect(mockDeleteNightComment).toHaveBeenCalledWith('night-1', 'comment-1');
  expect(renderer!.root.findAllByProps({ children: 'Na zdraví.' })).toHaveLength(0);
});

it('wires Cheers in detail to the authoritative reaction response', async () => {
  mockReactToNight.mockResolvedValue({ ok: true, rounds: 4, myRound: true });
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<NightDetailScreen />);
  });

  const card = renderer!.root.findByType('FeedCard');
  await act(async () => card.props.onToggleReaction(card.props.night));

  expect(mockReactToNight).toHaveBeenCalledWith('night-1');
  expect(renderer!.root.findByType('FeedCard').props.night).toEqual(
    expect.objectContaining({ rounds: 4, myRound: true }),
  );
});

it('reverts an offline reaction when the durable queue cannot persist it', async () => {
  mockReactToNight.mockResolvedValue({
    ok: false,
    code: 'network',
    detail: 'Bez signálu.',
  });
  mockEnqueueNightOp.mockResolvedValue(false);
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<NightDetailScreen />);
  });

  const card = renderer!.root.findByType('FeedCard');
  await act(async () => {
    card.props.onToggleReaction(card.props.night);
    await flushPromises();
  });

  expect(mockEnqueueNightOp).toHaveBeenCalledWith({ op: 'round', nightId: 'night-1' });
  expect(renderer!.root.findByType('FeedCard').props.night).toEqual(
    expect.objectContaining({ rounds: 0, myRound: false }),
  );
  expect(mockShowToast).toHaveBeenCalledWith('Runda nedošla. Zkus to za chvíli.');
  expect(mockShowToast).not.toHaveBeenCalledWith('Rundu pošlu, až chytím signál.');
});
