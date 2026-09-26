import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { t } from '@/i18n';
import { fetchSharedTour, fetchTourRunPreview, type TourResponse } from '@/data/toursClient';
import type { TourPlan } from '../model';
import TourInviteScreen from '../TourInviteScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const token = 'invite-token-for-component-regression';
const mockParams: { token: string; r?: string } = { token };
const mockAccount = { signedIn: true, nickname: 'pepa' as string | null };
const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockStore = {
  plans: [] as TourPlan[],
  error: null,
  busy: false,
  hydrate: jest.fn(async () => ({ ok: true })),
  importShared: jest.fn(async () => ({ ok: true, id: 'saved-copy' })),
  savePublic: jest.fn(async () => ({ ok: true, id: 'public-copy' })),
  reportPublic: jest.fn(async () => ({ ok: true })),
  joinCrew: jest.fn(async () => ({ ok: true, id: 'crew-copy' })),
  activeRun: null,
  hiddenPublic: [] as string[],
};

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ replace: mockReplace, push: mockPush, canGoBack: () => false, back: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/stores/toursStore', () => ({
  useToursStore: Object.assign(() => mockStore, { getState: () => mockStore }),
}));
jest.mock('@/data/toursClient', () => ({ fetchSharedTour: jest.fn(), fetchTourRunPreview: jest.fn(async () => null) }));
jest.mock('@/stores/accountStore', () => ({
  useAccountStore: (select: (s: typeof mockAccount) => unknown) => select(mockAccount),
  selectIsSignedIn: (s: typeof mockAccount) => s.signedIn, selectNickname: (s: typeof mockAccount) => s.nickname,
}));
jest.mock('@/utils/maps', () => ({ openPubInMaps: jest.fn() }));
jest.mock('../TourMap', () => ({ TourMap: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({
  ChevronLeftIcon: () => null,
  ChevronRightIcon: () => null,
  EllipsisIcon: () => null,
  UsersIcon: () => null,
  CheckIcon: () => null,
  MinusIcon: () => null,
  FootprintsIcon: () => null,
  MapIcon: () => null,
  HistoryIcon: () => null,
}));
jest.mock('../TourJourneyIllustration', () => ({ TourJourneyIllustration: () => null }));
jest.mock('@/stores/toastStore', () => ({ useToastStore: { getState: () => ({ show: jest.fn() }) } }));
jest.mock('@/profile/Avatar', () => ({ Avatar: () => null }));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));

const plan: TourPlan = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Sdílená tour',
  scheduledDate: null,
  scheduledTime: null,
  timezone: 'Europe/Prague',
  revision: 2,
  updatedAt: '2026-09-18T10:00:00Z',
  stops: [1, 2].map((n) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    pubId: `pub-${n}`, cacheKey: null, name: `Hospoda ${n}`, address: '', lat: 50, lon: 14,
  })),
};
const ownPlan: TourPlan = { ...plan, id: '22222222-2222-4222-8222-222222222222', title: 'Vlastní tour', revision: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.plans = [ownPlan];
});

it('renders a cold invite while a saved own tour has no source and the network is pending', async () => {
  let resolve!: (result: TourResponse) => void;
  jest.mocked(fetchSharedTour).mockReturnValue(new Promise((done) => { resolve = done; }));

  const screen = render(<TourInviteScreen />);
  expect(screen.getByText(t.tours.loading)).toBeTruthy();
  expect(screen.queryByText(t.tours.import)).toBeNull();
  expect(mockStore.hydrate).toHaveBeenCalledTimes(1);

  await act(async () => { resolve({ ok: true, tour: plan }); });
  expect(screen.queryByText(t.tours.loading)).toBeNull();
  expect(screen.getByText(plan.title)).toBeTruthy();
  expect(screen.queryByText(t.tours.importUpdate)).toBeNull();
  fireEvent.press(screen.getByLabelText(t.tours.import));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/tours/[id]', params: { id: 'saved-copy' } }));
  expect(mockStore.importShared).toHaveBeenCalledWith(token, false);
});

it.each([
  { revision: 2, update: false },
  { revision: 1, update: true },
])('uses the matching imported revision $revision after loading alongside an own plan', async ({ revision, update }) => {
  mockStore.plans = [ownPlan, {
    ...plan, id: 'saved-copy', title: 'Uložená kopie',
    source: { tourId: plan.id, revision, token },
  }];
  jest.mocked(fetchSharedTour).mockResolvedValue({ ok: true, tour: plan });
  const screen = render(<TourInviteScreen />);
  const action = await screen.findByLabelText(update ? t.tours.update : t.tours.openSaved);
  expect(!!screen.queryByText(t.tours.importUpdate)).toBe(update);
  fireEvent.press(action);
  await waitFor(() => expect(mockStore.importShared).toHaveBeenCalledWith(token, update));
});

it('shows a public tour with its author and saves it as an own plan', async () => {
  const publicInfo = { id: '33333333-3333-4333-8333-333333333333', peopleCount: 0, city: 'Praha', walkM: 1200,
    author: { id: 'author-id', nickname: 'pivni_vlk', displayName: 'Pavel V.', avatarUrl: null } };
  jest.mocked(fetchSharedTour).mockResolvedValue({ ok: true, tour: plan, public: publicInfo });
  const screen = render(<TourInviteScreen />);
  expect(await screen.findByText(t.tours.publicTour)).toBeTruthy();
  expect(screen.getByText('@pivni_vlk')).toBeTruthy();
  expect(screen.getByText('Praha · 2 hospody, asi 1,2 km pěšky')).toBeTruthy();
  fireEvent.press(screen.getByLabelText(t.tours.authorA11y('pivni_vlk')));
  expect(mockPush).toHaveBeenCalledWith('/parta/author-id');
  fireEvent.press(screen.getByLabelText(t.tours.import));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: '/tours/[id]', params: { id: 'public-copy' } }));
  expect(mockStore.savePublic).toHaveBeenCalledWith(token);
  expect(mockStore.importShared).not.toHaveBeenCalled();
});

it('does not show a public tour this phone reported', async () => {
  const publicInfo = { id: '33333333-3333-4333-8333-333333333333', peopleCount: 0, city: 'Praha', walkM: 1200,
    author: { id: 'author-id', nickname: 'pivni_vlk', displayName: '', avatarUrl: null } };
  mockStore.hiddenPublic = [publicInfo.id];
  jest.mocked(fetchSharedTour).mockResolvedValue({ ok: true, tour: plan, public: publicInfo });
  try {
    const screen = render(<TourInviteScreen />);
    expect(await screen.findByText(t.tours.reported)).toBeTruthy();
    expect(screen.queryByText(plan.title)).toBeNull();
  } finally {
    mockStore.hiddenPublic = [];
  }
});

it('joins the party behind a scanned code, or sends a friend without an account or nickname to set it up first', async () => {
  const runId = '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab';
  mockParams.r = runId;
  const publicInfo = { id: '33333333-3333-4333-8333-333333333333', peopleCount: 3, city: 'Praha', walkM: 1200,
    author: { id: 'author-id', nickname: 'pivni_vlk', displayName: '', avatarUrl: null } };
  jest.mocked(fetchSharedTour).mockResolvedValue({ ok: true, tour: plan, public: publicInfo });
  jest.mocked(fetchTourRunPreview).mockResolvedValue({ organizer: { id: 'o', nickname: 'vojta', displayName: '', avatarUrl: null }, going: 3, members: [] });
  try {
    const screen = render(<TourInviteScreen />);
    expect(await screen.findByText(t.tours.crewAlreadyGoing('vojta', 2))).toBeTruthy();
    // Who invites replaces how many walked it before.
    expect(screen.queryByText(t.tours.peopleCount(3))).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('tour-crew-join')); });
    expect(mockStore.joinCrew).toHaveBeenCalledWith(token, runId);
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/tours/[id]', params: { id: 'crew-copy' } });

    mockAccount.nickname = null;
    screen.rerender(<TourInviteScreen />);
    expect(screen.getByText(t.tours.pickNickname)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('tour-crew-join')); });
    expect(mockPush).toHaveBeenCalledWith('/profile/edit');

    mockAccount.signedIn = false;
    screen.rerender(<TourInviteScreen />);
    expect(screen.getByText(t.tours.crewSignInJoin)).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('tour-crew-join')); });
    expect(mockPush).toHaveBeenCalledWith('/auth');
  } finally {
    delete mockParams.r;
    mockAccount.signedIn = true;
    mockAccount.nickname = 'pepa';
  }
});
