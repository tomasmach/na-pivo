import React from 'react';

import type { PublishedNight } from '@/data/nightsClient';
import type { NightSummary } from '@/vycep/nightModel';

import { NightCard } from '../NightCard';
import { PublishNightSheet } from '../PublishNightSheet';
import RoundPill from '../RoundPill';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockShowDialog = jest.fn();
const mockShowToast = jest.fn();
const mockPublishNight = jest.fn();
const mockUnpublishNight = jest.fn();
const mockReactToNight = jest.fn();
const mockClearNightReaction = jest.fn();
const mockEnqueueNightOp = jest.fn();
const mockMarkPublished = jest.fn();
const mockMarkUnpublished = jest.fn();

jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: {
      Text: (props: Record<string, unknown>) =>
        ReactModule.createElement('AnimatedText', props, props.children),
    },
    cancelAnimation: jest.fn(),
    Easing: {
      out: (value: unknown) => value,
      quad: 'quad',
      cubic: 'cubic',
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useSharedValue: (value: unknown) => ({ value }),
    withSequence: (...values: unknown[]) => values.at(-1),
    withTiming: (value: unknown) => value,
  };
});
jest.mock('@/components/shared/AppDialog', () => ({
  showAppDialog: (...args: unknown[]) => mockShowDialog(...args),
}));
jest.mock('@/components/shared/IconGlyph', () => {
  const Icon = () => null;
  return {
    HandPlatterIcon: Icon,
    MapPinIcon: Icon,
    MenuIcon: Icon,
    XIcon: Icon,
  };
});
jest.mock('@/data/auth', () => ({ reportProfileContent: jest.fn() }));
jest.mock('@/data/nightsClient', () => ({
  clearNightReaction: (...args: unknown[]) => mockClearNightReaction(...args),
  isRetriableNightError: (result: { code?: string }) => result.code === 'network',
  publishNight: (...args: unknown[]) => mockPublishNight(...args),
  reactToNight: (...args: unknown[]) => mockReactToNight(...args),
  unpublishNight: (...args: unknown[]) => mockUnpublishNight(...args),
}));
jest.mock('@/data/nightsQueue', () => ({
  enqueueNightOp: (...args: unknown[]) => mockEnqueueNightOp(...args),
}));
jest.mock('@/data/uxTelemetry', () => ({ trackUiInteraction: jest.fn() }));
jest.mock('@/friends/SegmentedControl', () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => React.createElement('SegmentedControl', props),
}));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (selector: (state: { profile: { nickname: string } }) => unknown) =>
    selector({ profile: { nickname: 'janek' } }),
}));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ hapticEnabled: false }) },
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof mockShowToast }) => unknown) =>
    selector({ show: mockShowToast }),
}));
jest.mock('@/stores/vycepStore', () => ({
  useVycepStore: (
    selector: (state: {
      published: Record<string, never>;
      markPublished: typeof mockMarkPublished;
      markUnpublished: typeof mockMarkUnpublished;
    }) => unknown,
  ) =>
    selector({
      published: {},
      markPublished: mockMarkPublished,
      markUnpublished: mockMarkUnpublished,
    }),
}));
jest.mock('@/utils/haptics', () => ({
  fireLightImpactHaptic: jest.fn(),
  fireSuccessHaptic: jest.fn(),
}));
jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));
jest.mock('@/vycep/TallyMarks', () => ({ TallyMarks: () => null }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;

const summary: NightSummary = {
  clientKey: 'night-2026-08-06',
  drinkingDay: '2026-08-06',
  startedAt: '2026-08-06T18:00:00Z',
  endedAt: '2026-08-06T22:00:00Z',
  beerCount: 4,
  wineCount: 0,
  softDrinkCount: 0,
  shotCount: 0,
  pubNames: ['U Exportu'],
  city: 'Praha',
  durationMinutes: 240,
};

const publishedNight: PublishedNight = {
  id: 'night-id',
  clientId: summary.clientKey,
  author: {
    id: 'owner-id',
    nickname: 'janek',
    displayName: 'Janek',
    avatarUrl: null,
    isPublic: true,
  },
  drinkingDay: summary.drinkingDay,
  startedAt: summary.startedAt,
  endedAt: summary.endedAt,
  beerCount: 4,
  wineCount: 0,
  softDrinkCount: 0,
  shotCount: 0,
  pubNames: summary.pubNames,
  city: 'Praha',
  durationMinutes: 240,
  title: '',
  roastLine: '',
  roastBasis: '',
  participants: [],
  heroPhotos: [],
  heroGames: [],
  commentCount: 0,
  visibility: 'friends',
  createdAt: '2026-08-06T22:00:00Z',
  rounds: 0,
  myRound: false,
  isMine: true,
};

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPublishNight.mockResolvedValue({ ok: false, code: 'network', detail: 'Bez signálu.' });
  mockUnpublishNight.mockResolvedValue({ ok: false, code: 'network', detail: 'Bez signálu.' });
  mockReactToNight.mockResolvedValue({ ok: false, code: 'network', detail: 'Bez signálu.' });
  mockClearNightReaction.mockResolvedValue({ ok: false, code: 'network', detail: 'Bez signálu.' });
  mockEnqueueNightOp.mockResolvedValue(false);
});

it('keeps the publish sheet open when its offline payload cannot be persisted', async () => {
  const onClose = jest.fn();
  const onPublished = jest.fn();
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(
      <PublishNightSheet
        visible
        night={summary}
        onClose={onClose}
        onPublished={onPublished}
      />,
    );
  });

  await act(async () => {
    renderer!.root.findByProps({ accessibilityLabel: 'Vyvěsit noc na Výčep' }).props.onPress();
    await flushPromises();
  });

  expect(mockEnqueueNightOp).toHaveBeenCalledWith(
    expect.objectContaining({ op: 'publish' }),
  );
  expect(mockMarkPublished).not.toHaveBeenCalled();
  expect(onPublished).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(mockShowToast).toHaveBeenCalledWith(
    'Noc se nepodařilo bezpečně uložit. Zkus to znovu.',
  );
});

it('reverts an optimistic round when its offline operation cannot be persisted', async () => {
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(
      <RoundPill nightId="night-id" count={2} mine={false} ownerName="@janek" />,
    );
  });

  await act(async () => {
    renderer!.root.findByProps({ accessibilityLabel: 'Poslat rundu: @janek' }).props.onPress();
    await flushPromises();
  });

  expect(mockEnqueueNightOp).toHaveBeenCalledWith({ op: 'round', nightId: 'night-id' });
  expect(
    renderer!.root.findByProps({ accessibilityLabel: 'Poslat rundu: @janek' }).props
      .accessibilityState,
  ).toEqual({ selected: false });
  expect(mockShowToast).toHaveBeenCalledWith(
    'Runda nedošla. Zkus to za chvíli.',
    expect.any(Object),
  );

  act(() => renderer!.unmount());
});

it('keeps a night published when its offline removal cannot be persisted', async () => {
  const onRemoved = jest.fn();
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<NightCard night={publishedNight} onRemoved={onRemoved} />);
  });

  act(() => {
    renderer!.root.findByProps({ accessibilityLabel: 'Možnosti noci' }).props.onPress();
  });
  const dialog = mockShowDialog.mock.calls[0][0] as {
    buttons: { onPress?: () => void }[];
  };
  await act(async () => {
    dialog.buttons[1].onPress?.();
    await flushPromises();
  });

  expect(mockEnqueueNightOp).toHaveBeenCalledWith({
    op: 'unpublish',
    clientId: summary.clientKey,
  });
  expect(mockMarkUnpublished).not.toHaveBeenCalled();
  expect(onRemoved).not.toHaveBeenCalled();
  expect(mockShowToast).toHaveBeenCalledWith(
    'Stažení se nepodařilo uložit. Zkus to znovu.',
  );
});
