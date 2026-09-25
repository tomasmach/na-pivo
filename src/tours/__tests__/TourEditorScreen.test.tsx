import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import TourEditorScreen from '../TourEditorScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockStore = {
  draft: { id: '11111111-1111-4111-8111-111111111111', title: '', scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague', stops: [], revision: 0, updatedAt: '2026-09-25T10:00:00Z' },
  plans: [], error: null, busy: false,
  hydrate: jest.fn(async () => ({ ok: true })),
  updateDraft: jest.fn(async () => ({ ok: true })),
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
jest.mock('@/components/shared/IconGlyph', () => ({ ArrowDownIcon: () => null, ArrowUpIcon: () => null, GripVerticalIcon: () => null, ChevronLeftIcon: () => null, ChevronRightIcon: () => null }));
jest.mock('../TourMap', () => ({ TourMap: () => null }));
jest.mock('../TourPubPicker', () => ({ TourPubPicker: () => null }));

beforeEach(() => { jest.useFakeTimers(); mockStore.updateDraft.mockClear(); });
afterEach(() => { jest.useRealTimers(); });

it('persists the typed title after a pause and on blur, not on every keystroke', () => {
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
});

it('does not lose a title typed just before leaving the editor', () => {
  const screen = render(<TourEditorScreen />);
  fireEvent.changeText(screen.getByTestId('tour-title'), 'Rozepsaná');
  screen.unmount();
  expect(mockStore.updateDraft).toHaveBeenLastCalledWith({ title: 'Rozepsaná' });
});
