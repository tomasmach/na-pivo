import React from 'react';
import TestRenderer, { act, type ReactTestRenderer } from 'react-test-renderer';

import SuggestPubEventScreen from '../suggest-pub-event';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockSubmitPubEventSuggestion = jest.fn();
const mockGenerateUuidV4 = jest.fn(() => 'suggestion-draft-id');
const mockBack = jest.fn();
const mockShowToast = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack }),
  useLocalSearchParams: () => ({
    name: 'Hospoda U Testu',
    city: 'Praha',
    lat: '50.075',
    lng: '14.44',
    externalId: 'place-1',
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
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
  ChevronLeftIcon: () => null,
  ClockIcon: () => null,
}));
jest.mock('@/data/account', () => ({
  generateUuidV4: () => mockGenerateUuidV4(),
}));
jest.mock('@/data/pubEventsClient', () => ({
  submitPubEventSuggestion: (input: unknown) => mockSubmitPubEventSuggestion(input),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: (message: string) => void }) => unknown) =>
    selector({ show: mockShowToast }),
}));

describe('SuggestPubEventScreen', () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-21T17:00:00.000Z'));
    mockSubmitPubEventSuggestion
      .mockResolvedValueOnce('retry')
      .mockResolvedValueOnce('ok');
    act(() => {
      renderer = TestRenderer.create(<SuggestPubEventScreen />);
    });
  });

  afterEach(() => {
    if (renderer) act(() => renderer?.unmount());
    renderer = undefined;
    jest.useRealTimers();
  });

  it('reuses the draft client id after a retryable failure', async () => {
    const title = renderer!.root.findByProps({ placeholder: 'Třeba hospodský kvíz' });
    act(() => title.props.onChangeText('Hospodský kvíz'));

    let submit = renderer!.root.findByProps({ accessibilityLabel: 'Poslat návrh ke kontrole' });
    await act(async () => {
      await submit.props.onPress();
    });
    submit = renderer!.root.findByProps({ accessibilityLabel: 'Poslat návrh ke kontrole' });
    await act(async () => {
      await submit.props.onPress();
    });

    expect(mockSubmitPubEventSuggestion).toHaveBeenCalledTimes(2);
    expect(mockSubmitPubEventSuggestion.mock.calls[0][0].clientId).toBe('suggestion-draft-id');
    expect(mockSubmitPubEventSuggestion.mock.calls[1][0].clientId).toBe('suggestion-draft-id');
    expect(mockGenerateUuidV4).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
