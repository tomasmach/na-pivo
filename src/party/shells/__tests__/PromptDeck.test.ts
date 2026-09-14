/* eslint-disable import/first */

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: { View: () => null },
  FadeIn: { duration: () => undefined },
  FadeOut: { duration: () => undefined },
  useReducedMotion: () => true,
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

import { promptDeck } from '@/party/shells/PromptShell';

describe('prompt deck cycles', () => {
  it('never repeats the boundary card when reshuffling', () => {
    const prompts = ['A', 'B', 'C', 'D'];
    for (let seed = 1; seed <= 100; seed += 1) {
      const first = promptDeck(prompts, seed, 0);
      const second = promptDeck(prompts, seed, 1, first.at(-1));
      expect(second[0]).not.toBe(first.at(-1));
    }
  });
});
