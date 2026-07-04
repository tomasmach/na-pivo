import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

import { BeerCheckInSheet } from '@/counter/BeerCheckInSheet';
import { cs } from '@/i18n/cs';
import type { Pub } from '@/data/pubs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: jest.fn(() => ({ top: 0, right: 0, bottom: 0, left: 0 })),
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView', createAnimatedComponent: (c: unknown) => c },
  useSharedValue: jest.fn((value) => ({ value })),
  useAnimatedStyle: jest.fn((factory) => factory()),
  withRepeat: jest.fn((value) => value),
  withTiming: jest.fn((value) => value),
  cancelAnimation: jest.fn(),
}));

const impactAsync = jest.fn(async () => undefined);
jest.mock('expo-haptics', () => ({
  impactAsync: (...args: unknown[]) => impactAsync(...(args as [])),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@/utils/useReduceMotion', () => ({ useReduceMotion: () => true }));

// theme/fonts requires .ttf assets jest can't parse — stub the tokens.
jest.mock('@/theme/fonts', () => ({
  Fonts: {
    display: {
      regular: 'display-regular',
      medium: 'display-medium',
      semibold: 'display-semibold',
      bold: 'display-bold',
      extrabold: 'display-extrabold',
      black: 'display-extrabold',
    },
    ui: { regular: 'ui-regular', medium: 'ui-medium', semibold: 'ui-semibold', bold: 'ui-bold' },
  },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

jest.mock('@/data/account', () => ({ generateUuidV4: () => 'uuid-1' }));

const enqueueBeerCheckInOp = jest.fn(async (_op: unknown) => undefined);
jest.mock('@/data/beerCheckinsQueue', () => ({
  enqueueBeerCheckInOp: (op: unknown) => enqueueBeerCheckInOp(op),
}));

const showToast = jest.fn();
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: { show: unknown }) => unknown) => selector({ show: showToast }),
}));

// Mock the client value surface used by the sheet + BeerTagChips (BEER_TAGS,
// MAX_BEER_TAGS) and stub fetchBeerMemory so no network layer loads.
const fetchBeerMemory = jest.fn();
jest.mock('@/data/beerCheckinsClient', () => ({
  BEER_TAGS: [
    'crisp',
    'great_foam',
    'smooth',
    'watery',
    'stale',
    'overpriced',
    'one_more',
    'never_again',
  ],
  MAX_BEER_TAGS: 3,
  fetchBeerMemory: (...args: unknown[]) => fetchBeerMemory(...(args as [])),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: () => null,
  LockKeyholeIcon: () => null,
  StarIcon: () => null,
  UsersIcon: () => null,
  XIcon: () => null,
}));

const PUB: Pub = { name: 'Lokál Dlouhá', city: 'Praha' } as unknown as Pub;

const t = cs.beerCheckins;

function renderSheet(visible = true) {
  return render(
    <BeerCheckInSheet
      visible={visible}
      beerName="Radegast 12"
      pub={PUB}
      pubKey="pk"
      onClose={jest.fn()}
      onSubmitted={jest.fn()}
    />,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchBeerMemory.mockResolvedValue(null);
});

describe('BeerCheckInSheet — verdict tags', () => {
  it('toggles a tag on and off', async () => {
    const screen = renderSheet();
    await waitFor(() => expect(fetchBeerMemory).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText(t.tagAddA11y('Má říz')));
    // Now selected → label flips to the remove variant.
    expect(screen.queryByLabelText(t.tagRemoveA11y('Má říz'))).toBeTruthy();

    fireEvent.press(screen.getByLabelText(t.tagRemoveA11y('Má říz')));
    expect(screen.queryByLabelText(t.tagAddA11y('Má říz'))).toBeTruthy();
  });

  it('caps selection at three — the fourth tap is a silent no-op with a haptic tick', async () => {
    const screen = renderSheet();
    await waitFor(() => expect(fetchBeerMemory).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText(t.tagAddA11y('Má říz')));
    fireEvent.press(screen.getByLabelText(t.tagAddA11y('Pěna jak smetana')));
    fireEvent.press(screen.getByLabelText(t.tagAddA11y('Jde samo')));
    // Fourth tap should not select.
    fireEvent.press(screen.getByLabelText(t.tagAddA11y('Vodový')));

    expect(screen.queryByLabelText(t.tagAddA11y('Vodový'))).toBeTruthy();
    expect(screen.queryByLabelText(t.tagRemoveA11y('Vodový'))).toBeNull();
    expect(impactAsync).toHaveBeenCalledTimes(1);
  });

  it('carries the selected tags into the queued payload', async () => {
    const screen = renderSheet();
    await waitFor(() => expect(fetchBeerMemory).toHaveBeenCalled());

    fireEvent.press(screen.getByLabelText(t.tagAddA11y('Má říz')));
    fireEvent.press(screen.getByLabelText(t.tagAddA11y('Ještě jedno')));
    fireEvent.press(screen.getByText(t.submit));

    await waitFor(() => expect(enqueueBeerCheckInOp).toHaveBeenCalled());
    const op = enqueueBeerCheckInOp.mock.calls[0][0] as unknown as { payload: { tags: string[] } };
    expect(op.payload.tags).toEqual(['crisp', 'one_more']);
  });
});

describe('BeerCheckInSheet — memory strip', () => {
  it('renders the known-beer strip when my_count > 0', async () => {
    fetchBeerMemory.mockResolvedValue({
      beerName: 'Radegast 12',
      breweryName: '',
      myCount: 12,
      firstCheckedInAt: null,
      lastCheckedInAt: '2026-07-01T19:40:00Z',
      lastPubName: 'Lokál Dlouhá',
      lastRating: 4,
      myAverageRating: 4.2,
      topTags: ['crisp'],
    });
    const screen = renderSheet();
    await waitFor(() => expect(screen.queryByText(t.memoryKnownLead)).toBeTruthy());
    expect(screen.queryByText(t.memoryFirstTime)).toBeNull();
  });

  it('renders the first-time one-liner when my_count === 0', async () => {
    fetchBeerMemory.mockResolvedValue({
      beerName: 'Radegast 12',
      breweryName: '',
      myCount: 0,
      firstCheckedInAt: null,
      lastCheckedInAt: null,
      lastPubName: '',
      lastRating: null,
      myAverageRating: null,
      topTags: [],
    });
    const screen = renderSheet();
    await waitFor(() => expect(screen.queryByText(t.memoryFirstTime)).toBeTruthy());
    expect(screen.queryByText(t.memoryKnownLead)).toBeNull();
  });

  it('renders nothing on failure / offline (fetch resolves null)', async () => {
    fetchBeerMemory.mockResolvedValue(null);
    const screen = renderSheet();
    await waitFor(() => expect(fetchBeerMemory).toHaveBeenCalled());
    expect(screen.queryByText(t.memoryKnownLead)).toBeNull();
    expect(screen.queryByText(t.memoryFirstTime)).toBeNull();
  });

  it('shows neither variant while the lookup is still pending (skeleton state)', async () => {
    let resolve!: (value: null) => void;
    fetchBeerMemory.mockReturnValue(new Promise<null>((r) => (resolve = r)));
    const screen = renderSheet();
    // Lookup fired but unresolved → skeleton branch, no known / first-time text.
    await waitFor(() => expect(fetchBeerMemory).toHaveBeenCalled());
    expect(screen.queryByText(t.memoryKnownLead)).toBeNull();
    expect(screen.queryByText(t.memoryFirstTime)).toBeNull();
    await act(async () => {
      resolve(null);
    });
  });
});
