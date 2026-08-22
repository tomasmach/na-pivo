import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import type { PartyGameEvent } from "@/data/partyGamesClient";

const mockBack = jest.fn();
const mockFinishGame = jest.fn();
const mockSendGameEvent = jest.fn();
const mockStartSharedGame = jest.fn();
const mockAddBeer = jest.fn();
const mockLoadPendingPartyGameRuntime = jest.fn();
const mockLoadQueuedPartyGameEvents = jest.fn();
let mockRouteKey = "dice";
let mockPlacedGame = false;
let mockSharedCode: string | null = "TABLE1";
let mockSharingFailure: string | undefined;
let mockSharedRoster: {
  id: string;
  nickname: string | null;
  displayName: string;
  avatarUrl: string | null;
}[] = [];
let mockGameEvents: PartyGameEvent[] = [];

// Mutable so individual tests can model a cold start (nobody known yet)
// without leaking state into other tests; rebuilt in `beforeEach`.
const createMockNight = () => ({
  id: "night-1",
  code: "TABLE1",
  startedAt: "2026-08-05T18:00:00.000Z",
  endedAt: null,
  people: [
    { id: "me", name: "Ty", avatarUrl: null, tint: "#111111", active: true },
    {
      id: "honza",
      name: "Honza",
      avatarUrl: null,
      tint: "#222222",
      active: true,
    },
    {
      id: "petra",
      name: "Petra",
      avatarUrl: null,
      tint: "#333333",
      active: true,
    },
    { id: "eva", name: "Eva", avatarUrl: null, tint: "#444444", active: false },
  ],
  stops: [],
  drinks: [],
  games: [],
  photos: [],
});
let mockNight = createMockNight();

const SHARED_ROSTER_WITHOUT_ME = [
  { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
  { id: "petra", nickname: "petra", displayName: "Petra", avatarUrl: null },
];

const GAME_PROFILE = {
  id: "me",
  nickname: "ty",
  displayName: "Ty",
  avatarUrl: null,
};

function actionEvent(
  cursor: number,
  clientId: string,
  payload: Record<string, unknown>,
): PartyGameEvent {
  return {
    cursor,
    clientId,
    gameId: "game-1",
    kind: "action",
    account: GAME_PROFILE,
    subject: null,
    delta: 0,
    payload,
    at: `2026-08-07T20:00:0${cursor}.000Z`,
  };
}

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ key: mockRouteKey }),
  useRouter: () => ({ back: mockBack }),
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock("@/components/shared/IconGlyph", () => ({
  BeerIcon: () => null,
  ChevronLeftIcon: () => null,
  PlusIcon: () => null,
}));

jest.mock("@/games/GameResult", () => {
  const ReactModule: typeof import("react") = jest.requireActual("react");
  const { Pressable }: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    GameResult: ({ onDone }: { onDone: () => void }) =>
      ReactModule.createElement(Pressable, {
        accessibilityLabel: "canonical-done",
        onPress: onDone,
      }),
  };
});

jest.mock("@/party/gameCatalog", () => ({
  findGame: (key: string) => {
    const defs = {
      dice: { key: "dice", name: "Kostky", scoring: "points", shell: "turns" },
      round: {
        key: "round",
        name: "Kdo platí rundu",
        scoring: "drinks",
        shell: "pick",
      },
      quiz: { key: "quiz", name: "Pub kvíz", scoring: "points", shell: "quiz" },
      score: {
        key: "score",
        name: "Počítadlo",
        scoring: "points",
        shell: "score",
        how: "Body.",
      },
      never: {
        key: "never",
        name: "Nikdy jsem",
        scoring: "drinks",
        shell: "prompt",
      },
      kings: {
        key: "kings",
        name: "King’s Cup",
        scoring: "drinks",
        shell: "draw",
        draw: "card",
      },
      bottle: {
        key: "bottle",
        name: "Flaška",
        scoring: "drinks",
        shell: "pick",
      },
    } as const;
    return defs[key as keyof typeof defs];
  },
}));

jest.mock("@/party/InviteSheet", () => ({ InviteSheet: () => null }));

jest.mock("@/party/gameContent", () => ({
  GAME_PROMPTS: { never: ["Jedna", "Dvě"] },
  KINGS_CARDS: [{ card: "A" }, { card: "K" }],
  KINGS_DECK: [
    { id: "clubs-A" },
    { id: "clubs-K" },
    { id: "diamonds-K" },
    { id: "hearts-K" },
    { id: "spades-K" },
  ],
}));

jest.mock("@/party/shells/GameLobby", () => {
  const ReactModule: typeof import("react") = jest.requireActual("react");
  const { Pressable, View }: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    GameLobby: ({
      table,
      onStart,
    }: {
      table: { id: string; name: string; tint: string }[];
      onStart: (players: { id: string; name: string; tint: string }[]) => void;
    }) => {
      const [selected, setSelected] = ReactModule.useState(
        table.map((player) => player.id) as string[],
      );
      return ReactModule.createElement(
        View,
        null,
        ...table.map((player) =>
          ReactModule.createElement(Pressable, {
            key: player.id,
            accessibilityLabel: `lobby-${player.id}`,
            onPress: () =>
              setSelected((current: string[]) =>
                current.includes(player.id)
                  ? current.filter((id) => id !== player.id)
                  : [...current, player.id],
              ),
          }),
        ),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "start-game",
          onPress: () =>
            onStart(table.filter((player) => selected.includes(player.id))),
        }),
      );
    },
  };
});

jest.mock("@/party/shells/DiceDuelShell", () => {
  const ReactModule: typeof import("react") = jest.requireActual("react");
  const { Pressable, Text, View }: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    DiceDuelShell: ({
      onFinished,
      onDone,
      onRoll,
      onNextRound,
      state,
      spectator = false,
    }: {
      onFinished: (result: {
        payingId: string;
        paying: string;
        standings: { playerId: string; name: string; score: number }[];
      }) => void;
      onDone: () => void;
      onRoll?: (result: { playerId: string; dice: [number, number] }) => void;
      onNextRound?: () => void;
      state?: { roundNumber: number; round: unknown[] };
      spectator?: boolean;
    }) =>
      ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, {
          accessibilityLabel: `dice-spectator-${spectator ? "yes" : "no"}`,
        }),
        ReactModule.createElement(Text, {
          accessibilityLabel: `dice-state-${state?.roundNumber ?? 0}-${state?.round.length ?? 0}`,
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "dice-roll-action",
          onPress: () =>
            onRoll?.({
              playerId: state?.round.length ? "honza" : "me",
              dice: state?.round.length ? [2, 1] : [6, 4],
            }),
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "dice-next-action",
          onPress: onNextRound,
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "dice-result",
          onPress: () =>
            onFinished({
              payingId: "petra",
              paying: "Petra",
              standings: [
                { playerId: "honza", name: "Honza", score: 3 },
                { playerId: "me", name: "Ty", score: 1 },
              ],
            }),
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "dice-done",
          onPress: onDone,
        }),
      ),
  };
});

jest.mock("@/party/shells/PickShell", () => {
  const ReactModule: typeof import("react") = jest.requireActual("react");
  const { Pressable, Text, View }: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    PickShell: ({
      onFinished,
      onDone,
      onPicked,
      pickedId,
      beerCount,
      onAddBeer,
      spectator = false,
    }: {
      onFinished?: (paying: string, payingId: string) => void;
      onDone?: () => void;
      onPicked?: (playerId: string) => void;
      pickedId?: string | null;
      beerCount?: number;
      onAddBeer?: () => void;
      spectator?: boolean;
    }) =>
      ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, {
          accessibilityLabel: `pick-spectator-${spectator ? "yes" : "no"}`,
        }),
        ReactModule.createElement(Text, {
          accessibilityLabel: `picked-${pickedId ?? "none"}`,
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "pick-action",
          onPress: () => {
            onPicked?.("honza");
            onFinished?.("Honza", "honza");
          },
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "round-result",
          onPress: () => onFinished?.("Honza", "honza"),
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "round-done",
          onPress: onDone,
        }),
        beerCount === undefined
          ? null
          : ReactModule.createElement(Pressable, {
              accessibilityLabel: `Máš ${beerCount} piv. Přidat další.`,
              onPress: onAddBeer,
            }),
      ),
  };
});

jest.mock("@/party/shells/RoundDrumShell", () => {
  const ReactModule: typeof import("react") = jest.requireActual("react");
  const { Pressable, Text, View }: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    RoundDrumShell: ({
      pickedId,
      onPicked,
      onDone,
      spectator = false,
    }: {
      pickedId?: string | null;
      onPicked?: (playerId: string) => void;
      onDone?: () => void;
      spectator?: boolean;
    }) =>
      ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, {
          accessibilityLabel: `round-spectator-${spectator ? "yes" : "no"}`,
        }),
        ReactModule.createElement(Text, {
          accessibilityLabel: `picked-${pickedId ?? "none"}`,
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "pick-action",
          onPress: () => onPicked?.("honza"),
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "round-done",
          onPress: onDone,
        }),
      ),
  };
});

jest.mock("@/party/shells/QuizShell", () => {
  const ReactModule: typeof import("react") = jest.requireActual("react");
  const { Pressable, Text, View }: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    QuizShell: ({
      entrants,
      answers,
      index,
      forceRevealed,
      onAnswer,
      onReveal,
      onNext,
      spectator = false,
    }: {
      entrants: { id: string }[];
      answers: { entrantId: string; questionId: string }[];
      index: number;
      forceRevealed?: boolean;
      onAnswer: (option: number) => void;
      onReveal: () => void;
      onNext: () => void;
      spectator?: boolean;
    }) =>
      ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, {
          accessibilityLabel: `quiz-spectator-${spectator ? "yes" : "no"}`,
        }),
        ReactModule.createElement(Text, {
          accessibilityLabel: `quiz-index-${index}`,
        }),
        ReactModule.createElement(Text, {
          accessibilityLabel: `quiz-revealed-${forceRevealed ? "yes" : "no"}`,
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "quiz-answer-action",
          onPress: () => onAnswer(0),
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "quiz-reveal-action",
          onPress: onReveal,
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "quiz-next-action",
          onPress: onNext,
        }),
        ...entrants.map((entrant) =>
          ReactModule.createElement(Text, {
            key: entrant.id,
            accessibilityLabel: `quiz-entrant-${entrant.id}`,
          }),
        ),
        ...answers.map((answer) =>
          ReactModule.createElement(Text, {
            key: `${answer.entrantId}-${answer.questionId}`,
            accessibilityLabel: `quiz-answer-${answer.entrantId}-${answer.questionId}`,
          }),
        ),
      ),
  };
});

jest.mock("@/party/shells/DrawShell", () => {
  const ReactModule: typeof import("react") = jest.requireActual("react");
  const { Pressable, Text, View }: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    DrawShell: ({
      result,
      onDraw,
      onDeckFinished,
      spectator = false,
    }: {
      result?: { cardId?: string } | null;
      onDraw?: (result: { nonce: string; cardId: string }) => void;
      onDeckFinished?: () => void;
      spectator?: boolean;
    }) =>
      ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, {
          accessibilityLabel: `draw-spectator-${spectator ? "yes" : "no"}`,
        }),
        ReactModule.createElement(Text, {
          accessibilityLabel: `draw-${result?.cardId ?? "none"}`,
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "draw-action",
          onPress: () => onDraw?.({ nonce: "local", cardId: "K" }),
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "draw-deck-finished",
          onPress: onDeckFinished,
        }),
      ),
  };
});
jest.mock("@/party/shells/PromptShell", () => {
  const ReactModule: typeof import("react") = jest.requireActual("react");
  const { Pressable, Text, View }: typeof import("react-native") =
    jest.requireActual("react-native");
  return {
    PromptShell: ({
      step,
      onNext,
      spectator = false,
    }: {
      step?: number;
      onNext?: () => void;
      spectator?: boolean;
    }) =>
      ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, {
          accessibilityLabel: `prompt-spectator-${spectator ? "yes" : "no"}`,
        }),
        ReactModule.createElement(Text, {
          accessibilityLabel: `prompt-step-${step ?? -1}`,
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "prompt-action",
          onPress: onNext,
        }),
      ),
  };
});

jest.mock("@/party/useNightRecord", () => ({
  useNightRecord: () => mockNight,
}));
jest.mock("@/party/usePartyBeer", () => ({
  usePartyBeer: () => ({
    add: mockAddBeer,
    remove: jest.fn(),
    rename: jest.fn(),
  }),
}));

jest.mock("@/mocks/livePartyStore", () => ({
  useLivePartyStore: (selector: (state: unknown) => unknown) =>
    selector({ houseBeer: "Ležák", finishGame: mockFinishGame, games: [] }),
}));

jest.mock("@/data/partyGameStartsQueue", () => ({
  loadPendingPartyGameRuntime: (...args: unknown[]) =>
    mockLoadPendingPartyGameRuntime(...args),
}));
jest.mock("@/data/partyGamesQueue", () => ({
  loadQueuedPartyGameEvents: (...args: unknown[]) =>
    mockLoadQueuedPartyGameEvents(...args),
}));

jest.mock("@/stores/partyEveningStore", () => ({
  selectConfirmedPartyJoinCode: (state: { evening?: { joinCode?: string } }) =>
    state.evening?.joinCode ?? null,
  usePartyEveningStore: (selector: (state: unknown) => unknown) =>
    selector({ evening: mockSharedCode ? { joinCode: mockSharedCode } : null }),
}));

jest.mock("@/stores/partyGamesStore", () => ({
  eventsOfGame: (events: PartyGameEvent[], gameId: string | null) =>
    events.filter((event) => event.gameId === gameId),
  useFollowPartyGames: () => undefined,
  usePartyGamesStore: (selector: (state: unknown) => unknown) =>
    selector({
      code: mockSharedCode,
      games:
        mockPlacedGame ||
        mockSharedRoster.length > 0 ||
        mockGameEvents.length > 0
          ? [
              {
                id: "game-1",
                catalogKey: mockRouteKey,
                roster: mockSharedRoster,
                seed: 17,
              },
            ]
          : [],
      events: mockGameEvents,
      sharingFailures:
        mockRouteKey && mockSharingFailure
          ? { [mockRouteKey]: mockSharingFailure }
          : {},
      start: mockStartSharedGame,
      send: mockSendGameEvent,
    }),
}));

// Mocks must be registered before the screen module is evaluated.
// eslint-disable-next-line import/first
import PartyGameScreen from "@/party/PartyGameScreen";

describe("PartyGameScreen result wiring", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockRouteKey = "dice";
    mockPlacedGame = false;
    mockSharedCode = "TABLE1";
    mockSharingFailure = undefined;
    mockSharedRoster = [];
    mockGameEvents = [];
    mockNight = createMockNight();
    mockLoadPendingPartyGameRuntime.mockResolvedValue(null);
    mockLoadQueuedPartyGameEvents.mockResolvedValue([]);
    mockStartSharedGame.mockImplementation(
      async (input: { rosterIds?: string[] }) => ({
        gameId: "game-1",
        rosterIds: input.rosterIds ?? [],
      }),
    );
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it("keeps the dice result canonical when leaving GameResult", async () => {
    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() =>
      expect(screen.getByLabelText("dice-result")).toBeTruthy(),
    );
    const result = screen.getByLabelText("dice-result");
    fireEvent.press(result);
    fireEvent.press(result);
    fireEvent.press(screen.getByLabelText("canonical-done"));

    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);
    expect(mockSendGameEvent).toHaveBeenCalledWith("game-1", {
      kind: "finish",
      payload: {
        winner: null,
        winnerId: null,
        scores: [
          { playerId: "honza", name: "Honza", score: 3 },
          { playerId: "me", name: "Ty", score: 1 },
        ],
        paying: "Petra",
        payingId: "petra",
      },
    });
    expect(mockFinishGame).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("ends the round on its first pick with a canonical payer and no empty manual finish", async () => {
    mockRouteKey = "round";
    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() =>
      expect(screen.getByLabelText("pick-action")).toBeTruthy(),
    );
    expect(screen.queryByLabelText("Ukončit hru")).toBeNull();
    const spin = screen.getByLabelText("pick-action");
    fireEvent.press(spin);
    fireEvent.press(spin);

    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);
    expect(mockSendGameEvent).toHaveBeenCalledWith("game-1", {
      kind: "finish",
      payload: {
        winner: null,
        winnerId: null,
        scores: [],
        paying: "Honza",
        payingId: "honza",
      },
    });
    expect(mockFinishGame).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();
    expect(screen.getByLabelText("canonical-done")).toBeTruthy();
  });

  it("passes only active players selected in the lobby to Pub quiz", async () => {
    mockRouteKey = "quiz";
    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("lobby-petra"));
    fireEvent.press(screen.getByLabelText("start-game"));

    await waitFor(() =>
      expect(screen.getByLabelText("quiz-entrant-me")).toBeTruthy(),
    );
    expect(screen.getByLabelText("quiz-entrant-honza")).toBeTruthy();
    expect(screen.queryByLabelText("quiz-entrant-petra")).toBeNull();
    expect(screen.queryByLabelText("quiz-entrant-eva")).toBeNull();
    expect(mockStartSharedGame).toHaveBeenCalledWith({
      catalogKey: "quiz",
      name: "Pub kvíz",
      scoring: "points",
      rosterIds: ["honza", "me"],
    });
  });

  it("keeps a multiplayer quiz in a retryable error state when its shared start is not durable", async () => {
    mockRouteKey = "quiz";
    mockStartSharedGame.mockImplementationOnce(async () => {
      mockSharingFailure = "Hru se nepodařilo bezpečně uložit pro sdílení.";
      return null;
    });

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));

    await waitFor(() => {
      expect(
        screen.getByText("Hru se nepodařilo bezpečně uložit pro sdílení."),
      ).toBeTruthy();
    });
    expect(screen.getByLabelText("Zkusit znovu")).toBeTruthy();
    expect(screen.queryByLabelText("quiz-entrant-me")).toBeNull();

    fireEvent.press(screen.getByLabelText("Zkusit znovu"));
    await waitFor(() =>
      expect(screen.getByLabelText("quiz-entrant-me")).toBeTruthy(),
    );
    expect(mockStartSharedGame).toHaveBeenCalledTimes(2);
  });

  it("opens the lobby for a placed cover and binds a non-empty roster before play", async () => {
    mockRouteKey = "round";
    mockPlacedGame = true;

    render(<PartyGameScreen />);

    expect(screen.getByLabelText("start-game")).toBeTruthy();
    expect(screen.queryByLabelText("pick-action")).toBeNull();
    fireEvent.press(screen.getByLabelText("start-game"));

    await waitFor(() =>
      expect(mockStartSharedGame).toHaveBeenCalledWith({
        catalogKey: "round",
        name: "Kdo platí rundu",
        scoring: "drinks",
        rosterIds: ["honza", "petra", "me"],
      }),
    );
    expect(screen.getByLabelText("pick-action")).toBeTruthy();
  });

  it("uses the server roster on another phone without reopening the lobby", () => {
    mockRouteKey = "quiz";
    mockSharedRoster = [
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
      { id: "petra", nickname: "petra", displayName: "Petra", avatarUrl: null },
    ];

    render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.queryByLabelText("start-game")).toBeNull();
    expect(screen.getByLabelText("quiz-entrant-honza")).toBeTruthy();
    expect(screen.getByLabelText("quiz-entrant-petra")).toBeTruthy();
    expect(screen.queryByLabelText("quiz-entrant-me")).toBeNull();
    expect(mockStartSharedGame).not.toHaveBeenCalled();
  });

  it("shares quiz reveal and next-question actions with every phone", async () => {
    mockRouteKey = "quiz";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];

    render(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());
    expect(screen.getByLabelText("quiz-index-0")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("quiz-reveal-action"));
    expect(screen.getByLabelText("quiz-revealed-yes")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("quiz-next-action"));

    await waitFor(() =>
      expect(screen.getByLabelText("quiz-index-1")).toBeTruthy(),
    );
    expect(mockSendGameEvent).toHaveBeenNthCalledWith(
      1,
      "game-1",
      expect.objectContaining({
        kind: "action",
        payload: { type: "quiz_reveal", question: 0 },
      }),
      expect.any(String),
    );
    expect(mockSendGameEvent).toHaveBeenNthCalledWith(
      2,
      "game-1",
      expect.objectContaining({
        kind: "action",
        payload: { type: "quiz_next", fromQuestion: 0 },
      }),
      expect.any(String),
    );
  });

  it("applies quiz actions received from another phone without echoing them", () => {
    mockRouteKey = "quiz";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, "phone-a-reveal", { type: "quiz_reveal", question: 0 }),
    ];

    const view = render(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());
    expect(screen.getByLabelText("quiz-index-0")).toBeTruthy();
    expect(screen.getByLabelText("quiz-revealed-yes")).toBeTruthy();

    mockGameEvents = [
      ...mockGameEvents,
      actionEvent(2, "phone-a-next", { type: "quiz_next", fromQuestion: 0 }),
    ];
    view.rerender(<PartyGameScreen />);

    expect(screen.getByLabelText("quiz-index-1")).toBeTruthy();
    expect(screen.getByLabelText("quiz-revealed-no")).toBeTruthy();
    expect(mockSendGameEvent).not.toHaveBeenCalled();
  });

  it("rejects an answer after the table has forced the reveal", () => {
    mockRouteKey = "quiz";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, "phone-a-reveal", { type: "quiz_reveal", question: 0 }),
    ];

    render(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());
    fireEvent.press(screen.getByLabelText("quiz-answer-action"));

    expect(mockSendGameEvent).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(/quiz-answer-me-/)).toBeNull();
  });

  it("opens the first finished event as a canonical read-only result", () => {
    mockRouteKey = "score";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    const finish = actionEvent(8, "finish-1", {});
    finish.kind = "finish";
    finish.payload = {
      winner: "Honza",
      winnerId: "honza",
      paying: null,
      scores: [{ name: "Honza", playerId: "honza", score: 3 }],
    };
    mockGameEvents = [finish];

    render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText("canonical-done")).toBeTruthy();
    expect(screen.queryByLabelText(/Bod pro/)).toBeNull();
    expect(screen.queryByLabelText("Ukončit hru")).toBeNull();
  });

  it("keeps an old-backend game with an empty roster playable from the current table", () => {
    mockRouteKey = "never";
    mockSharedRoster = [];
    mockGameEvents = [actionEvent(1, "old-action", { type: "prompt_next" })];

    render(<PartyGameScreen />);

    expect(screen.queryByLabelText("start-game")).toBeNull();
    expect(screen.getByLabelText("prompt-step-1")).toBeTruthy();
  });

  it("folds remote score events and appends a local score event", async () => {
    mockRouteKey = "score";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = [
      {
        cursor: 7,
        clientId: "score-7",
        gameId: "game-1",
        kind: "score",
        account: {
          id: "petra",
          nickname: "petra",
          displayName: "Petra",
          avatarUrl: null,
        },
        subject: {
          id: "honza",
          nickname: "honza",
          displayName: "Honza",
          avatarUrl: null,
        },
        delta: 2,
        payload: {},
        at: "2026-08-07T20:00:00.000Z",
      },
    ];

    render(<PartyGameScreen />);

    const honza = screen.getByLabelText("Bod pro honza. Aktuálně 2");
    fireEvent.press(honza);

    await waitFor(() => {
      expect(screen.getByLabelText("Bod pro honza. Aktuálně 3")).toBeTruthy();
    });
    expect(mockSendGameEvent).toHaveBeenCalledWith("game-1", {
      kind: "score",
      subjectId: "honza",
      delta: 1,
      createdAt: expect.any(String),
    });
  });

  it("hydrates an offline score event after the game screen reopens", async () => {
    mockRouteKey = "score";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockLoadQueuedPartyGameEvents.mockResolvedValueOnce([
      {
        gameId: "game-1",
        queuedAt: Date.parse("2026-08-07T20:00:00.000Z"),
        event: {
          clientId: "offline-score-1",
          kind: "score",
          subjectId: "honza",
          delta: 2,
          createdAt: "2026-08-07T20:00:00.000Z",
        },
      },
    ]);

    render(<PartyGameScreen />);

    await waitFor(() => {
      expect(screen.getByLabelText("Bod pro honza. Aktuálně 2")).toBeTruthy();
    });
    expect(mockSendGameEvent).not.toHaveBeenCalled();
  });

  it("hydrates the selected lobby and queued quiz answer after an offline kill", async () => {
    mockRouteKey = "quiz";
    mockLoadPendingPartyGameRuntime.mockResolvedValue({
      localGameId: "local:start-1",
      rosterIds: ["me", "honza"],
    });
    mockLoadQueuedPartyGameEvents.mockResolvedValue([
      {
        gameId: "local:start-1",
        queuedAt: Date.parse("2026-08-07T20:00:00.000Z"),
        event: {
          clientId: "offline-answer-1",
          kind: "answer",
          payload: { questionId: "q1", option: 2 },
          createdAt: "2026-08-07T20:00:00.000Z",
        },
      },
    ]);

    render(<PartyGameScreen />);

    await waitFor(() => {
      expect(screen.getByLabelText("quiz-entrant-me")).toBeTruthy();
      expect(screen.getByLabelText("quiz-entrant-honza")).toBeTruthy();
      expect(screen.getByLabelText("quiz-answer-me-q1")).toBeTruthy();
    });
    expect(screen.queryByLabelText("start-game")).toBeNull();
  });

  it("folds and appends prompt actions with an explicit echo id", async () => {
    mockRouteKey = "never";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = [actionEvent(1, "remote-next", { type: "prompt_next" })];

    render(<PartyGameScreen />);
    expect(screen.getByLabelText("prompt-step-1")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("prompt-action"));

    await waitFor(() =>
      expect(screen.getByLabelText("prompt-step-2")).toBeTruthy(),
    );
    expect(mockSendGameEvent).toHaveBeenCalledWith(
      "game-1",
      {
        kind: "action",
        payload: { type: "prompt_next", fromStep: 1 },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
  });

  it("hydrates a queued prompt action after a cold restart", async () => {
    mockRouteKey = "never";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockLoadQueuedPartyGameEvents.mockResolvedValueOnce([
      {
        gameId: "game-1",
        queuedAt: Date.parse("2026-08-07T20:00:00.000Z"),
        event: {
          clientId: "offline-prompt-1",
          kind: "action",
          payload: { type: "prompt_next" },
          createdAt: "2026-08-07T20:00:00.000Z",
        },
      },
    ]);

    render(<PartyGameScreen />);

    await waitFor(() =>
      expect(screen.getByLabelText("prompt-step-1")).toBeTruthy(),
    );
    expect(mockSendGameEvent).not.toHaveBeenCalled();
  });

  it("folds a remote card and appends the next draw result", async () => {
    mockRouteKey = "kings";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, "remote-draw", {
        type: "draw",
        drawKind: "card",
        value: "A",
      }),
    ];

    render(<PartyGameScreen />);
    expect(screen.getByLabelText("draw-A")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("draw-action"));

    await waitFor(() => expect(screen.getByLabelText("draw-K")).toBeTruthy());
    expect(mockSendGameEvent).toHaveBeenCalledWith(
      "game-1",
      {
        kind: "action",
        payload: {
          type: "draw",
          drawKind: "card",
          value: "K",
          fromCount: 1,
          drawnById: "me",
        },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
  });

  it("shows the canonical fourth king before finishing for the player who drew it", () => {
    mockRouteKey = "kings";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, "king-1", {
        type: "draw",
        drawKind: "card",
        value: "clubs-K",
        fromCount: 0,
        drawnById: "me",
      }),
      actionEvent(2, "king-2", {
        type: "draw",
        drawKind: "card",
        value: "diamonds-K",
        fromCount: 1,
        drawnById: "me",
      }),
      actionEvent(3, "king-3", {
        type: "draw",
        drawKind: "card",
        value: "hearts-K",
        fromCount: 2,
        drawnById: "me",
      }),
      actionEvent(4, "king-4", {
        type: "draw",
        drawKind: "card",
        value: "spades-K",
        fromCount: 3,
        drawnById: "honza",
      }),
    ];

    const view = render(<PartyGameScreen />);
    expect(screen.getByLabelText("draw-spades-K")).toBeTruthy();
    expect(screen.queryByLabelText("Ukončit hru")).toBeNull();
    expect(mockSendGameEvent).not.toHaveBeenCalled();

    act(() => jest.advanceTimersByTime(1599));
    expect(mockSendGameEvent).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(1));
    expect(mockSendGameEvent).toHaveBeenCalledWith("game-1", {
      kind: "finish",
      payload: {
        winner: null,
        winnerId: null,
        scores: [],
        paying: "honza",
        payingId: "honza",
      },
    });

    view.rerender(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());
    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);
  });

  it("pays the same roster member on every phone when the fourth king has no drawn-by author", () => {
    mockRouteKey = "kings";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "adam", nickname: "adam", displayName: "Adam", avatarUrl: null },
      { id: "petra", nickname: "petra", displayName: "Petra", avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, "king-1", {
        type: "draw",
        drawKind: "card",
        value: "clubs-K",
        fromCount: 0,
      }),
      actionEvent(2, "king-2", {
        type: "draw",
        drawKind: "card",
        value: "diamonds-K",
        fromCount: 1,
      }),
      actionEvent(3, "king-3", {
        type: "draw",
        drawKind: "card",
        value: "hearts-K",
        fromCount: 2,
      }),
      // Legacy clients drew without drawnById. The payer must not become
      // whoever holds this phone ('me'); every device falls back to the same
      // roster member — first by sorted id, here 'adam'.
      actionEvent(4, "king-4", {
        type: "draw",
        drawKind: "card",
        value: "spades-K",
        fromCount: 3,
      }),
    ];

    render(<PartyGameScreen />);
    expect(screen.queryByLabelText("Ukončit hru")).toBeNull();

    act(() => jest.advanceTimersByTime(1600));
    expect(mockSendGameEvent).toHaveBeenCalledWith("game-1", {
      kind: "finish",
      payload: {
        winner: null,
        winnerId: null,
        scores: [],
        paying: "adam",
        payingId: "adam",
      },
    });
  });

  it("makes a selected player pay in a local King’s Cup when this phone owner sits out", async () => {
    mockRouteKey = "kings";
    mockSharedCode = null;

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("lobby-me"));
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() =>
      expect(screen.getByLabelText("draw-deck-finished")).toBeTruthy(),
    );
    fireEvent.press(screen.getByLabelText("draw-deck-finished"));

    expect(mockFinishGame).toHaveBeenCalledWith("kings", {
      game: "King’s Cup",
      winner: null,
      winnerId: null,
      scores: [],
      paying: "Honza",
      payingId: "honza",
    });
    expect(screen.getByLabelText("canonical-done")).toBeTruthy();
  });

  it("takes Konec away in a local King’s Cup once the fourth king lands", async () => {
    mockRouteKey = "kings";
    mockSharedCode = null;

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() =>
      expect(screen.getByLabelText("Ukončit hru")).toBeTruthy(),
    );

    // Three kings are still mid-game; the generic finish stays available.
    fireEvent.press(screen.getByLabelText("draw-action"));
    fireEvent.press(screen.getByLabelText("draw-action"));
    fireEvent.press(screen.getByLabelText("draw-action"));
    expect(screen.queryByLabelText("Ukončit hru")).not.toBeNull();

    // The fourth king removes Konec before DrawShell's delayed payer report,
    // so a mis-tap can no longer overwrite the payer with a generic result.
    fireEvent.press(screen.getByLabelText("draw-action"));
    expect(screen.queryByLabelText("Ukončit hru")).toBeNull();

    expect(mockFinishGame).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(2000));
    fireEvent.press(screen.getByLabelText("draw-deck-finished"));
    await waitFor(() =>
      expect(mockFinishGame).toHaveBeenCalledWith("kings", {
        game: "King’s Cup",
        winner: null,
        winnerId: null,
        scores: [],
        paying: "Ty",
        payingId: "me",
      }),
    );
  });

  it("folds a remote pick and appends a stable player id", async () => {
    mockRouteKey = "bottle";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, "remote-pick", { type: "pick", playerId: "me" }),
    ];

    render(<PartyGameScreen />);
    expect(screen.getByLabelText("picked-me")).toBeTruthy();
    expect(screen.queryByLabelText(/Máš 0 piv\. Přidat další\./)).toBeNull();
    fireEvent.press(screen.getByLabelText("pick-action"));

    await waitFor(() =>
      expect(screen.getByLabelText("picked-honza")).toBeTruthy(),
    );
    expect(mockSendGameEvent).toHaveBeenCalledWith(
      "game-1",
      {
        kind: "action",
        payload: { type: "pick", playerId: "honza", fromRevision: 1 },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
  });

  it("continues dice from the remote fold and appends roll and round events", async () => {
    mockRouteKey = "dice";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, "remote-roll", {
        type: "dice_roll",
        playerId: "me",
        dice: [6, 4],
      }),
    ];

    render(<PartyGameScreen />);
    expect(screen.getByLabelText("dice-state-1-1")).toBeTruthy();
    fireEvent.press(screen.getByLabelText("dice-roll-action"));
    await waitFor(() =>
      expect(screen.getByLabelText("dice-state-1-2")).toBeTruthy(),
    );
    fireEvent.press(screen.getByLabelText("dice-next-action"));
    await waitFor(() =>
      expect(screen.getByLabelText("dice-state-2-0")).toBeTruthy(),
    );

    expect(mockSendGameEvent).toHaveBeenNthCalledWith(
      1,
      "game-1",
      {
        kind: "action",
        payload: { type: "dice_roll", playerId: "honza", dice: [2, 1] },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
    expect(mockSendGameEvent).toHaveBeenNthCalledWith(
      2,
      "game-1",
      {
        kind: "action",
        payload: { type: "dice_next" },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
  });
});

describe("PartyGameScreen spectator mode", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockRouteKey = "dice";
    mockPlacedGame = false;
    mockSharedCode = "TABLE1";
    mockSharingFailure = undefined;
    mockSharedRoster = [];
    mockGameEvents = [];
    mockNight = createMockNight();
    mockLoadPendingPartyGameRuntime.mockResolvedValue(null);
    mockLoadQueuedPartyGameEvents.mockResolvedValue([]);
    mockStartSharedGame.mockImplementation(
      async (input: { rosterIds?: string[] }) => ({
        gameId: "game-1",
        rosterIds: input.rosterIds ?? [],
      }),
    );
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
  });

  it.each([
    ["dice", "dice", "dice-roll-action"],
    ["round", "round", "pick-action"],
    ["bottle", "pick", "pick-action"],
    ["quiz", "quiz", "quiz-answer-action"],
    ["never", "prompt", "prompt-action"],
    ["kings", "draw", "draw-action"],
  ])(
    "renders %s as spectator for a frozen roster without the current player and mutes its gameplay taps",
    async (routeKey, shellLabel, actionLabel) => {
      mockRouteKey = routeKey;
      mockSharedRoster = SHARED_ROSTER_WITHOUT_ME;

      render(<PartyGameScreen />);
      await waitFor(() =>
        expect(
          screen.getByLabelText(`${shellLabel}-spectator-yes`),
        ).toBeTruthy(),
      );

      expect(screen.queryByLabelText("Ukončit hru")).toBeNull();
      expect(screen.getByText("Tuhle hru jen sleduješ.")).toBeTruthy();

      fireEvent.press(screen.getByLabelText(actionLabel));

      expect(mockSendGameEvent).not.toHaveBeenCalled();
      expect(mockFinishGame).not.toHaveBeenCalled();
    },
  );

  it("hides the sharing failure band while spectating", () => {
    mockRouteKey = "dice";
    mockSharedRoster = SHARED_ROSTER_WITHOUT_ME;
    mockSharingFailure = "Hru se nepodařilo bezpečně uložit pro sdílení.";

    render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText("dice-spectator-yes")).toBeTruthy();
    expect(screen.getByText("Tuhle hru jen sleduješ.")).toBeTruthy();
    expect(screen.queryByText(/Hra běží jen na tomhle telefonu/)).toBeNull();
  });

  it("keeps a legacy shared game with an empty roster interactive and out of spectator mode", () => {
    mockRouteKey = "never";
    mockSharedRoster = [];
    mockGameEvents = [actionEvent(1, "old-action", { type: "prompt_next" })];

    render(<PartyGameScreen />);

    expect(screen.getByLabelText("prompt-step-1")).toBeTruthy();
    expect(screen.getByLabelText("prompt-spectator-no")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("prompt-action"));

    expect(mockSendGameEvent).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ kind: "action" }),
      expect.any(String),
    );
    expect(mockFinishGame).not.toHaveBeenCalled();
  });

  it("keeps a local pass-the-phone game interactive and out of spectator mode", async () => {
    mockRouteKey = "dice";
    mockSharedCode = null;

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));

    await waitFor(() =>
      expect(screen.getByLabelText("dice-roll-action")).toBeTruthy(),
    );
    expect(screen.getByLabelText("dice-spectator-no")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("dice-result"));

    expect(mockFinishGame).toHaveBeenCalledWith(
      "dice",
      expect.objectContaining({ payingId: "petra" }),
    );
  });

  it("does not lock a cold start into spectator mode while the current player is unknown", () => {
    mockRouteKey = "dice";
    mockNight.people = [];
    mockSharedRoster = SHARED_ROSTER_WITHOUT_ME;

    render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText("dice-spectator-no")).toBeTruthy();
    expect(screen.queryByText("Tuhle hru jen sleduješ.")).toBeNull();
  });

  it("ignores the automatic dice finish callback while spectating", () => {
    mockRouteKey = "dice";
    mockSharedRoster = SHARED_ROSTER_WITHOUT_ME;

    render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });

    fireEvent.press(screen.getByLabelText("dice-result"));

    expect(mockSendGameEvent).not.toHaveBeenCalled();
    expect(mockFinishGame).not.toHaveBeenCalled();
  });

  it("does not auto-finish on the shared fourth king timer while spectating", () => {
    mockRouteKey = "kings";
    mockSharedRoster = SHARED_ROSTER_WITHOUT_ME;
    mockGameEvents = [
      actionEvent(1, "king-1", {
        type: "draw",
        drawKind: "card",
        value: "clubs-K",
        fromCount: 0,
        drawnById: "honza",
      }),
      actionEvent(2, "king-2", {
        type: "draw",
        drawKind: "card",
        value: "diamonds-K",
        fromCount: 1,
        drawnById: "honza",
      }),
      actionEvent(3, "king-3", {
        type: "draw",
        drawKind: "card",
        value: "hearts-K",
        fromCount: 2,
        drawnById: "petra",
      }),
      actionEvent(4, "king-4", {
        type: "draw",
        drawKind: "card",
        value: "spades-K",
        fromCount: 3,
        drawnById: "petra",
      }),
    ];

    render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(screen.getByLabelText("draw-spades-K")).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(1600);
    });

    expect(mockSendGameEvent).not.toHaveBeenCalled();
    expect(mockFinishGame).not.toHaveBeenCalled();
  });
});
