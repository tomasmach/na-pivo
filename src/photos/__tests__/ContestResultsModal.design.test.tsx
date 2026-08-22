import React from "react";

import { ContestResultsModal } from "@/photos/ContestResultsModal";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/utils/haptics", () => ({ fireSuccessHaptic: jest.fn() }));
jest.mock("@/data/photoContestClient", () => ({
  fetchPhotoContestTeaser: jest.fn(async () => null),
}));
jest.mock("@/components/shared/IconGlyph", () => ({ TrophyIcon: () => null }));
jest.mock("@/components/shared/GlowButton", () => {
  const ReactModule: typeof import("react") = jest.requireActual("react");
  return {
    GlowButton: (props: Record<string, unknown>) =>
      ReactModule.createElement("GlowButton", props),
  };
});
jest.mock("@/theme/shadows", () => ({ softDrop: () => ({}) }));
jest.mock("@/theme/fonts", () => ({
  Fonts: { numeral: "numeral" },
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

jest.mock("react-native-reanimated", () => {
  const ReactModule: typeof import("react") = jest.requireActual("react");
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement("AnimatedView", props, children),
    },
    Easing: { out: (value: unknown) => value, quad: "quad" },
    useReducedMotion: () => true,
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (factory: () => unknown) => factory(),
    withDelay: jest.fn((_: number, value: number) => value),
    withSpring: jest.fn((value: number) => value),
    withTiming: jest.fn((value: number) => value),
  };
});

const mockDismissResult = jest.fn();
jest.mock("@/stores/contestResultsStore", () => ({
  useContestResultsStore: (
    selector: (state: Record<string, unknown>) => unknown,
  ) =>
    selector({
      pendingResult: {
        rank: 1,
        imageUrl: null,
        votes: 12,
        xpAwarded: 50,
        winsCount: 2,
      },
      ingestSnapshot: jest.fn(),
      dismissResult: mockDismissResult,
    }),
}));
jest.mock("@/stores/releaseStore", () => ({
  useReleaseStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ checkSettled: true, pendingNote: null }),
}));
jest.mock("@/stores/launchModalMutex", () => {
  const hook = (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ holder: "contest-results" });
  hook.getState = () => ({ claim: jest.fn(), release: jest.fn() });
  return {
    useLaunchModalMutex: hook,
    useModalPresentation: () => ({ visible: true, onDismiss: jest.fn(), id: 'contest-results' }),
  };
});

const TestRenderer = jest.requireActual("react-test-renderer");
const { act } = TestRenderer;

it("renders the contest result without ambient decoration or motion when Reduce Motion is on", async () => {
  let renderer: ReturnType<typeof TestRenderer.create>;
  await act(async () => {
    renderer = TestRenderer.create(<ContestResultsModal />);
    await Promise.resolve();
  });

  const reanimated = jest.requireMock("react-native-reanimated");
  expect(reanimated.withDelay).not.toHaveBeenCalled();
  expect(reanimated.withSpring).not.toHaveBeenCalled();
  expect(reanimated.withTiming).not.toHaveBeenCalled();
  expect(renderer!.root.findByType("GlowButton").props).toMatchObject({
    glow: "none",
    height: 48,
  });
});
