import React from 'react';

import type { Challenge } from '@/data/challengesClient';

import { ChallengeDetailScreen } from '../ChallengeDetailScreen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('@/components/shared/IconGlyph', () => {
  const stub = () => null;
  return new Proxy({}, { get: () => stub });
});
jest.mock('@/components/shared/TabBar', () => ({ TAB_CHROME: 80 }));
jest.mock('@/profile/Avatar', () => ({
  Avatar: (props: Record<string, unknown>) => React.createElement('Avatar', props),
}));
jest.mock('@/theme/fonts', () => ({
  FontScaleCap: { heading: 1.2, body: 1.3 },
  Fonts: { numeral: 'System' },
}));


const TestRenderer = jest.requireActual('react-test-renderer');
const { act } = TestRenderer;

function challenge(overrides: Partial<Challenge> = {}): Challenge {
  return {
    id: 'new-pubs-month',
    title: 'Deset nových hospod',
    glyph: 'places',
    progress: 0.2,
    done: 2,
    goal: 10,
    unit: 'hospod',
    blurb: 'Objevuj nové podniky.',
    deadline: '2026-08-31',
    reward: '150 XP',
    rules: ['Každá hospoda jen jednou.'],
    friends: [],
    ...overrides,
  };
}

function renderedText(renderer: { toJSON: () => unknown }): string {
  return JSON.stringify(renderer.toJSON());
}

describe('ChallengeDetailScreen', () => {
  it('shows accepted friends with their real server progress', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(
        <ChallengeDetailScreen
          challenge={challenge({
            friends: [
              {
                account: {
                  id: 'friend-1',
                  nickname: 'honza',
                  displayName: 'Honza',
                  avatarUrl: 'https://cdn.test/honza.jpg',
                  isPublic: false,
                },
                done: 3,
                progress: 0.3,
              },
            ],
          })}
        />,
      );
    });

    expect(renderedText(renderer!)).toContain('Kdo ještě jede');
    expect(renderedText(renderer!)).toContain('@honza');
    expect(renderedText(renderer!)).toContain('3');
    expect(renderer!.root.findByType('Avatar').props).toMatchObject({
      uri: 'https://cdn.test/honza.jpg',
      nickname: 'honza',
      displayName: 'Honza',
      size: 40,
      border: 'quiet',
    });
  });

  it('hides the friends section when the backend returns no consented progress', () => {
    let renderer: ReturnType<typeof TestRenderer.create>;
    act(() => {
      renderer = TestRenderer.create(<ChallengeDetailScreen challenge={challenge()} />);
    });

    expect(renderedText(renderer!)).not.toContain('Kdo ještě jede');
    expect(renderedText(renderer!)).not.toContain('Zatím nikdo z tvojí party.');
  });
});
