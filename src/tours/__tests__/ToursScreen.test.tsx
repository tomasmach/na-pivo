import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { t } from '@/i18n';
import type { TourPlan, TourRun } from '../model';
import ToursScreen from '../ToursScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockPush = jest.fn();
const mockStore = {
  plans: [] as TourPlan[], draft: null as TourPlan | null, activeRun: null as TourRun | null, runs: [] as TourRun[],
  hydrated: true, error: null, busy: false,
  hydrate: jest.fn(async () => ({ ok: true })), beginDraft: jest.fn(async () => ({ ok: true })), restorePublished: jest.fn(async () => ({ ok: true })),
};
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn(), canGoBack: () => true }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@/stores/toursStore', () => ({ useToursStore: Object.assign(() => mockStore, { getState: () => mockStore }) }));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));
jest.mock('../TourJourneyIllustration', () => ({ TourJourneyIllustration: () => null }));
jest.mock('@/components/shared/IconGlyph', () => ({ ChevronLeftIcon: () => null, ChevronRightIcon: () => null, EllipsisIcon: () => null, HistoryIcon: () => null }));

const stop = (n: number) => ({ id: `s${n}`, pubId: `p${n}`, cacheKey: null, name: `Hospoda ${n}`, address: '', lat: 50 + n / 100, lon: 14 });
const plan = (id: string, title: string): TourPlan => ({ id, title, scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague', stops: [stop(1), stop(2)], revision: 1, updatedAt: '2026-09-01T10:00:00Z' });

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.plans = []; mockStore.draft = null; mockStore.activeRun = null; mockStore.runs = [];
});

it('explains the feature with a plan action and account restore when there is nothing yet', () => {
  const screen = render(<ToursScreen />);
  expect(screen.getByText(t.tours.emptyTitle)).toBeTruthy();
  expect(screen.getByLabelText(t.tours.create)).toBeTruthy();
  expect(screen.getByLabelText(t.tours.restore)).toBeTruthy();
  expect(screen.queryByLabelText(t.tours.more)).toBeNull();
});

it('puts the running tour first and opens past runs in their history view', () => {
  const walked = plan('11111111-1111-4111-8111-111111111111', 'Pátek');
  mockStore.plans = [walked, plan('22222222-2222-4222-8222-222222222222', 'Sobota')];
  mockStore.activeRun = { id: 'run', planId: walked.id, snapshot: walked, startedAt: new Date().toISOString(), endedAt: null, statuses: { s1: 'visited' } };
  mockStore.runs = [{ id: 'old-run', planId: walked.id, snapshot: walked, startedAt: '2026-09-12T18:00:00Z', endedAt: '2026-09-12T23:00:00Z', statuses: { s1: 'visited', s2: 'visited' } }];
  const screen = render(<ToursScreen />);

  expect(screen.getByLabelText(new RegExp(`^${t.tours.active}\\. Pátek\\. ${t.tours.runOf(1, 2)}`))).toBeTruthy();
  expect(screen.getByText('Sobota')).toBeTruthy();
  expect(screen.getByLabelText(t.tours.continueRun)).toBeTruthy();
  expect(screen.queryByLabelText(t.tours.restore)).toBeNull();

  fireEvent.press(screen.getByLabelText(new RegExp(`^Pátek\\. .*${t.tours.runOf(2, 2)}`)));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/tours/[id]', params: { id: walked.id, run: 'old-run' } });
});
