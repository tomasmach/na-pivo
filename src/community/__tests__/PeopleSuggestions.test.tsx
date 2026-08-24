import React from 'react';

import {
  fetchFriendSuggestions,
  followAccount,
} from '@/data/friendsClient';

import { PeopleSuggestions } from '../PeopleSuggestions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => true }));
jest.mock('@/components/shared/IconGlyph', () => {
  const stub = () => null;
  return new Proxy({}, { get: () => stub });
});
jest.mock('@/data/friendsClient', () => ({
  fetchFriendSuggestions: jest.fn(),
  followAccount: jest.fn(),
}));
jest.mock('@/friends/SkeletonBlock', () => ({
  __esModule: true,
  default: () => React.createElement('SkeletonBlock'),
}));
jest.mock('@/profile/Avatar', () => ({
  Avatar: (props: Record<string, unknown>) => React.createElement('Avatar', props),
}));
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: jest.Mock }) => unknown) =>
    selector({ show: jest.fn() }),
}));
jest.mock('@/theme/fonts', () => ({ FontScaleCap: { body: 1.3 } }));


const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

const fetchSuggestionsMock = fetchFriendSuggestions as jest.MockedFunction<
  typeof fetchFriendSuggestions
>;
const followMock = followAccount as jest.MockedFunction<typeof followAccount>;

async function flushEffects(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  followMock.mockResolvedValue({ ok: true });
});

describe('PeopleSuggestions', () => {
  it('shows the real recommendation reason and follows the selected account', async () => {
    fetchSuggestionsMock.mockResolvedValue([
      {
        id: 'friend-1',
        nickname: 'honza',
        displayName: 'Honza',
        avatarUrl: null,
        isPublic: true,
        suggestionReason: { kind: 'shared_pubs', count: 2 },
      },
    ]);
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(<PeopleSuggestions />);
      await flushEffects();
    });

    expect(JSON.stringify(renderer!.toJSON())).toContain('@honza');
    expect(JSON.stringify(renderer!.toJSON())).toContain('Máte 2 společné hospody');

    await act(async () => {
      renderer!.root.findByProps({ accessibilityLabel: 'Sledovat: @honza' }).props.onPress();
      await flushEffects();
    });

    expect(followMock).toHaveBeenCalledWith('friend-1');
  });

  it('disappears when the backend has no explainable recommendation', async () => {
    fetchSuggestionsMock.mockResolvedValue([]);
    let renderer: ReturnType<typeof TestRenderer.create>;
    await act(async () => {
      renderer = TestRenderer.create(<PeopleSuggestions />);
      await flushEffects();
    });

    expect(renderer!.toJSON()).toBeNull();
  });
});
