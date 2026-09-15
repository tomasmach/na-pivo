import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';

import { AppDialogScreen } from '@/components/shared/AppDialog';
import { cs } from '@/i18n/cs';
import ReportScreen from '../ReportScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockFocused = true;

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn() }),
  useIsFocused: () => mockFocused,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: 'AnimatedView' },
  useSharedValue: jest.fn((value) => ({ value })),
  useAnimatedStyle: jest.fn((factory) => factory()),
  withSpring: jest.fn((value) => value),
  withTiming: jest.fn((value) => value),
}));

jest.mock('@/data/feedbackQueue', () => ({
  enqueueFeedback: jest.fn(async () => undefined),
}));

jest.mock('@/data/feedbackAttachmentPicker', () => ({
  pickFeedbackAttachment: jest.fn(async () => ({ status: 'cancelled' })),
}));

jest.mock('@/compass/permissions', () => ({
  openSystemSettings: jest.fn(async () => undefined),
}));

jest.mock('@/components/shared/GlowButton', () => ({
  GlowButton: ({ label, onPress }: { label: string; onPress: () => void }) => {
    return (
      <Pressable onPress={onPress}>
        <Text>{label}</Text>
      </Pressable>
    );
  },
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: () => null,
  CameraIcon: () => null,
  ChevronLeftIcon: () => null,
  ImagesIcon: () => null,
  XIcon: () => null,
}));

it('shows the attachment source dialog above the full-screen feedback route', () => {
  mockFocused = true;
  const route = () => <AppDialogScreen><ReportScreen /></AppDialogScreen>;
  const screen = render(route());

  fireEvent.press(screen.getByLabelText(cs.report.attachmentAdd));

  expect(screen.getByText(cs.report.attachmentCamera)).toBeTruthy();
  expect(screen.getByText(cs.report.attachmentLibrary)).toBeTruthy();

  // A stacked route takes focus; the old dialog must not appear underneath it
  // or reappear when the user returns to this screen.
  mockFocused = false;
  screen.rerender(route());
  expect(screen.queryByText(cs.report.attachmentCamera)).toBeNull();
  mockFocused = true;
  screen.rerender(route());
  expect(screen.queryByText(cs.report.attachmentCamera)).toBeNull();
  fireEvent.press(screen.getByLabelText(cs.report.attachmentAdd));
  expect(screen.getByText(cs.report.attachmentCamera)).toBeTruthy();
});
