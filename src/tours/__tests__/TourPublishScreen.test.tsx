import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { t } from '@/i18n';
import type { TourPlan } from '../model';
import TourPublishScreen from '../TourPublishScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockBack = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const plan: TourPlan = {
  id: '11111111-1111-4111-8111-111111111111', title: 'Pátek po Starém Městě', scheduledDate: null, scheduledTime: null,
  timezone: 'Europe/Prague', revision: 1, updatedAt: '2026-09-25T10:00:00Z',
  stops: [1, 2].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, pubId: `p${n}`, cacheKey: null, name: n === 1 ? 'U Zlatého tygra' : 'U Pinkasů',
    address: 'Praha', lat: 50 + n / 100, lon: 14, ...(n === 2 ? { challenge: 'Najdi pípu' } : {}) })),
};
const mockStore = {
  plans: [plan], busy: false, error: null,
  publishPublic: jest.fn(),
  beginDraft: jest.fn(async () => ({ ok: true })),
  clearError: jest.fn(),
};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: '11111111-1111-4111-8111-111111111111' }), useRouter: () => ({ back: mockBack, push: mockPush, replace: mockReplace }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@/stores/toursStore', () => ({ useToursStore: Object.assign(() => mockStore, { getState: () => mockStore }) }));
jest.mock('@/components/shared/IconGlyph', () => ({ ChevronLeftIcon: () => null, ChevronRightIcon: () => null }));

beforeEach(() => jest.clearAllMocks());

it('lists what goes public and what stays private, and leaves once published', async () => {
  mockStore.publishPublic.mockResolvedValue({ ok: true });
  const screen = render(<TourPublishScreen />);
  for (const line of [t.tours.seenTitle(plan.title), t.tours.seenChallenges(1), t.tours.seenProfile, t.tours.hiddenMeetup, t.tours.hiddenPrivate])
    expect(screen.getByText(line)).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('tour-publish')); });
  expect(mockStore.publishPublic).toHaveBeenCalledWith(plan.id);
  expect(mockBack).toHaveBeenCalled();
});

it('names the pub whose challenge was refused and offers to edit the tour', async () => {
  mockStore.publishPublic.mockResolvedValue({ ok: false, error: 'text_rejected', field: 'challenge', stop: 1 });
  const screen = render(<TourPublishScreen />);
  await act(async () => { fireEvent.press(screen.getByTestId('tour-publish')); });
  expect(screen.getByText(t.tours.errors.publicChallenge('U Pinkasů'))).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByLabelText(t.tours.editTour)); });
  expect(mockStore.beginDraft).toHaveBeenCalledWith(plan.id);
  expect(mockReplace).toHaveBeenCalledWith('/tours/edit');
  expect(mockBack).not.toHaveBeenCalled();
});

it('sends a signed-out author to sign in', async () => {
  mockStore.publishPublic.mockResolvedValue({ ok: false, error: 'sign_in' });
  const screen = render(<TourPublishScreen />);
  await act(async () => { fireEvent.press(screen.getByTestId('tour-publish')); });
  expect(screen.getByText(t.tours.errors.publicSignIn)).toBeTruthy();
  fireEvent.press(screen.getByLabelText(t.tours.signIn));
  expect(mockPush).toHaveBeenCalledWith('/auth');
});
