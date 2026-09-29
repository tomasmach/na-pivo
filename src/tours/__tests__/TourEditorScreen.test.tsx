import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import TourEditorScreen from '../TourEditorScreen';
import { showAppDialog } from '@/components/shared/AppDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame = (cb) => { cb(); return 0; };

const mockStore = {
  draft: { id: '11111111-1111-4111-8111-111111111111', title: '', scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague', stops: [], revision: 0, updatedAt: '2026-09-25T10:00:00Z' },
  plans: [], error: null, busy: false,
  hydrate: jest.fn(async () => ({ ok: true })),
  updateDraft: jest.fn(async () => ({ ok: true })),
  setChallenge: jest.fn(async () => ({ ok: true })),
  removeStop: jest.fn(async () => ({ ok: true })),
  saveDraft: jest.fn(async () => ({ ok: true, id: '11111111-1111-4111-8111-111111111111' })),
};
jest.mock('@/stores/toursStore', () => ({ useToursStore: Object.assign((select?: (s: typeof mockStore) => unknown) => (select ? select(mockStore) : mockStore), { getState: () => mockStore }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn(), canGoBack: () => true }), useNavigation: () => ({ dispatch: jest.fn() }) }));
jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn(), AppDialogHost: () => null }));
jest.mock('@/components/shared/KeyboardAwareScrollView', () => {
  const react = jest.requireActual<typeof import('react')>('react');
  return { KeyboardAwareScrollView: react.forwardRef((props: { children?: React.ReactNode }, _ref) => react.createElement('ScrollView', props, props.children)) };
});
jest.mock('@/utils/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
jest.mock('@/components/shared/IconGlyph', () => ({ ArrowDownIcon: () => null, ArrowUpIcon: () => null, GripVerticalIcon: () => null, ChevronLeftIcon: () => null, ChevronRightIcon: () => null, MinusIcon: () => null, PlusIcon: () => null, XIcon: () => null }));
jest.mock('@/utils/haptics', () => ({ fireLightImpactHaptic: jest.fn() }));
jest.mock('@/stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ hapticEnabled: false }) } }));
jest.mock('../TourMap', () => ({ TourMap: () => null }));
jest.mock('../TourPubPicker', () => ({ TourPubPicker: () => null }));

const twoStops = [1, 2].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, pubId: String(n), cacheKey: null, name: `Pub ${n}`, address: 'Praha', lat: 50, lon: 14 }));
async function withDraft(patch: object, run: () => Promise<void> | void) {
  const draft = mockStore.draft;
  mockStore.draft = { ...draft, ...patch } as typeof draft;
  try { await run(); } finally { mockStore.draft = draft; }
}

beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(new Date('2026-09-28T10:00:00Z')); mockStore.updateDraft.mockClear(); mockStore.saveDraft.mockClear(); jest.mocked(showAppDialog).mockClear(); });
afterEach(() => { jest.useRealTimers(); });

it('opens the pub picker first for a tour without pubs', () => {
  const screen = render(<TourEditorScreen />);
  expect(screen.queryByTestId('tour-title')).toBeNull();
});

it('persists the typed title after a pause and on blur, not on every keystroke', () => withDraft({ stops: twoStops }, () => {
  const screen = render(<TourEditorScreen />);
  const input = screen.getByTestId('tour-title');
  fireEvent.changeText(input, 'P');
  fireEvent.changeText(input, 'Pá');
  fireEvent.changeText(input, 'Pátek');
  expect(mockStore.updateDraft).not.toHaveBeenCalled();
  act(() => { jest.advanceTimersByTime(300); });
  expect(mockStore.updateDraft).toHaveBeenCalledTimes(1);
  expect(mockStore.updateDraft).toHaveBeenLastCalledWith({ title: 'Pátek' });

  fireEvent.changeText(input, 'Pátek v Brně');
  fireEvent(input, 'blur');
  expect(mockStore.updateDraft).toHaveBeenCalledTimes(2);
  expect(mockStore.updateDraft).toHaveBeenLastCalledWith({ title: 'Pátek v Brně' });
}));

it('does not lose a title typed just before leaving the editor', () => withDraft({ stops: twoStops }, () => {
  const screen = render(<TourEditorScreen />);
  fireEvent.changeText(screen.getByTestId('tour-title'), 'Rozepsaná');
  screen.unmount();
  expect(mockStore.updateDraft).toHaveBeenLastCalledWith({ title: 'Rozepsaná' });
}));

it('adds a challenge from the stop menu through its own sheet', async () => {
  const stop = { id: '00000000-0000-4000-8000-000000000001', pubId: '1', cacheKey: null, name: 'U Tří růží', address: 'Husova 10', lat: 50, lon: 14 };
  const draft = mockStore.draft;
  mockStore.draft = { ...draft, stops: [stop] as never[] };
  try {
    const screen = render(<TourEditorScreen />);
    fireEvent.press(screen.getByLabelText('1. U Tří růží. Husova 10'));
    const { buttons } = jest.mocked(showAppDialog).mock.calls.at(-1)![0];
    expect(buttons![0].text).toBe('Přidat výzvu');
    act(() => { buttons![0].onPress!(); });
    fireEvent.changeText(screen.getByTestId('tour-challenge'), 'Najdi nejstarší pípu');
    await act(async () => { fireEvent.press(screen.getByTestId('tour-challenge-save')); });
    expect(mockStore.setChallenge).toHaveBeenCalledWith(stop.id, 'Najdi nejstarší pípu');
    expect(screen.queryByTestId('tour-challenge')).toBeNull();
  } finally {
    mockStore.draft = draft;
  }
});

it('drops the pending undo once a challenge is saved, so undo cannot erase it', async () => {
  const stops = [1, 2].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, pubId: String(n), cacheKey: null, name: `Pub ${n}`, address: 'Praha', lat: 50, lon: 14 }));
  const draft = mockStore.draft;
  mockStore.draft = { ...draft, stops: stops as never[] };
  try {
    const screen = render(<TourEditorScreen />);
    fireEvent.press(screen.getByLabelText('1. Pub 1. Praha'));
    const remove = jest.mocked(showAppDialog).mock.calls.at(-1)![0].buttons!.find((b) => b.text === 'Odebrat zastávku')!;
    await act(async () => { remove.onPress!(); });
    expect(screen.getByText('Vrátit')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('2. Pub 2. Praha'));
    act(() => { jest.mocked(showAppDialog).mock.calls.at(-1)![0].buttons![0].onPress!(); });
    fireEvent.changeText(screen.getByTestId('tour-challenge'), 'Najdi pípu');
    await act(async () => { fireEvent.press(screen.getByTestId('tour-challenge-save')); });
    expect(screen.queryByText('Vrátit')).toBeNull();
  } finally {
    mockStore.draft = draft;
  }
});

it('picks the meetup from the calendar and a time chip instead of typing it', async () => {
  await withDraft({ stops: twoStops }, async () => {
    const screen = render(<TourEditorScreen />);
    expect(screen.getByLabelText('Kdy: Bez termínu')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tour-when'));
    await act(async () => { fireEvent.press(screen.getByLabelText('pátek 2. října')); });
    expect(mockStore.updateDraft).toHaveBeenLastCalledWith({ scheduledDate: '2026-10-02', scheduledTime: null });
  });
  await withDraft({ stops: twoStops, scheduledDate: '2026-10-02' }, async () => {
    const screen = render(<TourEditorScreen />);
    expect(screen.getByLabelText('Kdy: pá 2. 10.')).toBeTruthy();
    fireEvent.press(screen.getByTestId('tour-when'));
    await act(async () => { fireEvent.press(screen.getByLabelText('19:00')); });
    expect(mockStore.updateDraft).toHaveBeenLastCalledWith({ scheduledDate: '2026-10-02', scheduledTime: '19:00' });
  });
});

it('never offers a day in the past or more than 90 days ahead', async () => {
  jest.setSystemTime(new Date('2026-09-30T10:00:00Z'));
  await withDraft({ stops: twoStops }, () => {
    const screen = render(<TourEditorScreen />);
    fireEvent.press(screen.getByTestId('tour-when'));
    expect(screen.getByLabelText('pondělí 28. září, nejde vybrat').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByLabelText('středa 30. září, dnes').props.accessibilityState.disabled).toBe(false);
    for (let page = 0; page < 3; page++) fireEvent.press(screen.getByLabelText('Další týdny'));
    expect(screen.getByLabelText('úterý 29. prosince').props.accessibilityState.disabled).toBe(false);
    expect(screen.getByLabelText('středa 30. prosince, nejde vybrat').props.accessibilityState.disabled).toBe(true);
  });
});

it('keeps saving off until the tour has two pubs, and says so', async () => {
  await withDraft({ stops: twoStops.slice(0, 1) }, () => {
    const screen = render(<TourEditorScreen />);
    expect(screen.getByText('Přidej ještě aspoň jednu hospodu.')).toBeTruthy();
    expect(screen.getByTestId('tour-save').props.accessibilityState.disabled).toBe(true);
  });
});

it('names an untitled tour after its meetup day when saving', async () => {
  await withDraft({ stops: twoStops, scheduledDate: '2026-10-02' }, async () => {
    const screen = render(<TourEditorScreen />);
    expect(screen.getByTestId('tour-title').props.placeholder).toBe('Pátek po hospodách');
    await act(async () => { fireEvent.press(screen.getByTestId('tour-save')); });
    expect(mockStore.updateDraft).toHaveBeenCalledWith({ title: 'Pátek po hospodách' });
    expect(mockStore.saveDraft).toHaveBeenCalled();
  });
});

it('asks for a new date instead of failing to save a tour whose day has passed', async () => {
  await withDraft({ stops: twoStops, title: 'Stará', scheduledDate: '2026-09-12', scheduledTime: '19:00' }, async () => {
    const screen = render(<TourEditorScreen />);
    expect(screen.getByLabelText('Kdy: 12. 9. už bylo')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('tour-save')); });
    expect(mockStore.saveDraft).not.toHaveBeenCalled();
    const dialog = jest.mocked(showAppDialog).mock.calls.at(-1)![0];
    expect(dialog.title).toBe('Termín už proběhl');
    await act(async () => { dialog.buttons!.find((b) => b.text === 'Uložit bez termínu')!.onPress!(); });
    expect(mockStore.updateDraft).toHaveBeenCalledWith({ title: 'Stará', scheduledDate: null, scheduledTime: null });
    expect(mockStore.saveDraft).toHaveBeenCalled();
  });
});

it('shows a failed meetup save once, then still lets the sheet close', async () => {
  await withDraft({ stops: twoStops }, async () => {
    const screen = render(<TourEditorScreen />);
    fireEvent.press(screen.getByTestId('tour-when'));
    mockStore.updateDraft.mockResolvedValueOnce({ ok: false } as never);
    await act(async () => { fireEvent.press(screen.getByLabelText('pátek 2. října')); });
    await act(async () => { fireEvent.press(screen.getByTestId('tour-when-done')); });
    expect(screen.getByText('Změny se nepodařilo uložit do telefonu. Zkus to znovu.')).toBeTruthy();
    // The test Modal renders inline, so read its visibility instead of its children.
    const sheet = () => screen.UNSAFE_root.findAll((node) => (node.type as unknown) === 'Modal' && node.findAll((child) => child.props.testID === 'tour-when-done').length > 0)[0];
    expect(sheet().props.visible).toBe(true);
    await act(async () => { fireEvent.press(screen.getByTestId('tour-when-done')); });
    expect(sheet().props.visible).toBe(false);
  });
});
