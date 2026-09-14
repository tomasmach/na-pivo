import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { AccessibilityInfo, Platform } from "react-native";
import type { PartyGameEvent } from "@/data/partyGamesClient";
import type { NightRecord } from "@/party/nightRecord";
import { QUIZ_QUESTIONS } from "@/party/quiz/questions";

const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
const mockFinishGame = jest.fn();
const mockSendGameEvent = jest.fn();
const mockStartSharedGame = jest.fn();
const mockAddBeer = jest.fn();
const mockLoadPendingPartyGameRuntime = jest.fn();
const mockLoadQueuedPartyGameEvents = jest.fn();
let mockRoundPickedPlayerId = "honza";
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
let mockCanonicalOutcome: {
  scores: { playerId: unknown; score: number }[];
  winnerId: unknown;
  payingId?: unknown;
} | null = null;

beforeEach(() => {
  mockCanGoBack = true;
});
// Mutable so individual tests can model a cold start (nobody known yet)
// without leaking state into other tests; rebuilt in `beforeEach`.
const createMockNight = (): NightRecord => ({
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
  useRouter: () => ({
    back: mockBack,
    replace: mockReplace,
    canGoBack: () => mockCanGoBack,
  }),
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
    GameResult: ({
      outcome,
      onDone,
    }: {
      outcome: typeof mockCanonicalOutcome;
      onDone: () => void;
    }) => {
      mockCanonicalOutcome = outcome;
      return ReactModule.createElement(Pressable, {
        accessibilityLabel: "canonical-done",
        onPress: onDone,
      });
    },
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
      categories: {
        key: "categories",
        name: "Kategorie",
        scoring: "drinks",
        shell: "prompt",
      },
      thumb: {
        key: "thumb",
        name: "Palec",
        scoring: "drinks",
        shell: "prompt",
      },
      rules: {
        key: "rules",
        name: "Pravidlo večera",
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
          onPress: () => onPicked?.(mockRoundPickedPlayerId),
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
      onFinished,
      spectator = false,
    }: {
      entrants: { id: string }[];
      answers: { entrantId: string; questionId: string }[];
      index: number;
      forceRevealed?: boolean;
      onAnswer: (option: number) => void;
      onReveal: () => void;
      onNext: () => void;
      onFinished: (result: {
        winner: string | null;
        winnerId: string | null;
        standings: { name: string; playerId: string; score: number }[];
      }) => Promise<boolean>;
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
        ReactModule.createElement(Pressable, {
          accessibilityLabel: "quiz-result-action",
          onPress: () =>
            onFinished({
              winner: "Ty",
              winnerId: "me",
              standings: [
                { name: "Ty", playerId: "me", score: 3 },
                { name: "Honza", playerId: "honza", score: 1 },
              ],
            }),
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
    mockRoundPickedPlayerId = "honza";
    mockCanGoBack = true;
    mockPlacedGame = false;
    mockSharedCode = "TABLE1";
    mockSharingFailure = undefined;
    mockSharedRoster = [];
    mockGameEvents = [];
    mockCanonicalOutcome = null;
    mockNight = createMockNight();
    mockLoadPendingPartyGameRuntime.mockResolvedValue(null);
    mockLoadQueuedPartyGameEvents.mockResolvedValue([]);
    mockSendGameEvent.mockResolvedValue(undefined);
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

  it("keeps the night beer action available during play and removes it from the result", async () => {
    const view = render(<PartyGameScreen />);
    expect(screen.queryByLabelText(/Přidat další/)).toBeNull();

    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() =>
      expect(screen.getByLabelText("dice-result")).toBeTruthy(),
    );

    fireEvent.press(screen.getByLabelText("Máš 0 piv. Přidat další."));
    expect(mockAddBeer).toHaveBeenCalledTimes(1);
    expect(mockAddBeer).toHaveBeenCalledWith("Ležák");

    mockNight = {
      ...mockNight,
      drinks: [
        {
          id: "beer-1",
          at: "2026-08-05T18:10:00.000Z",
          by: "me",
          beerName: "Ležák",
          drinkType: "beer",
          stopId: null,
        },
      ],
    };
    view.rerender(<PartyGameScreen />);
    expect(screen.getByLabelText("Máš 1 pivo. Přidat další.")).toBeTruthy();

    fireEvent.press(screen.getByLabelText("dice-result"));
    await waitFor(() =>
      expect(screen.getByLabelText("canonical-done")).toBeTruthy(),
    );
    expect(screen.queryByLabelText(/Přidat další/)).toBeNull();
  });

  it("shows GameResult before the top Konec action leaves the game", async () => {
    mockRouteKey = "never";
    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() => expect(screen.getByLabelText("Ukončit hru")).toBeTruthy());
    expect(screen.getByText("Konec").props).toMatchObject({
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.8,
    });

    fireEvent.press(screen.getByLabelText("Ukončit hru"));

    await waitFor(() => expect(screen.getByLabelText("canonical-done")).toBeTruthy());
    expect(mockBack).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText("canonical-done"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("leaves a cold-start game route through the party hub", () => {
    mockCanGoBack = false;

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("Zpátky do večera"));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/friends");
  });

  it("leaves a cold-start canonical result through the party hub", () => {
    mockCanGoBack = false;
    mockRouteKey = "score";
    mockSharedRoster = [
      { id: "honza", nickname: null, displayName: "Honza", avatarUrl: null },
    ];
    const finish = actionEvent(8, "finish-cold", {});
    finish.kind = "finish";
    finish.payload = { winner: "Honza", scores: [] };
    mockGameEvents = [finish];

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("canonical-done"));

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/friends");
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
    await waitFor(() => expect(screen.getByLabelText("canonical-done")).toBeTruthy());
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

    await waitFor(() => expect(mockFinishGame).toHaveBeenCalledTimes(1));
    expect(mockSendGameEvent).toHaveBeenCalledTimes(2);
    expect(mockSendGameEvent).toHaveBeenNthCalledWith(
      1,
      "game-1",
      {
        kind: "action",
        payload: { type: "pick", playerId: "honza", fromRevision: 0 },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
    expect(mockSendGameEvent).toHaveBeenNthCalledWith(2, "game-1", {
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

  it("enqueues exactly one durable round pick before the finish can be reported", async () => {
    mockRouteKey = "round";
    let resolvePickSend: (() => void) | null = null;
    mockSendGameEvent.mockImplementation(
      (_gameId: string, event: { kind: string }) =>
        event.kind === "action"
          ? new Promise<void>((resolve) => {
              resolvePickSend = resolve;
            })
          : Promise.resolve(),
    );

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() =>
      expect(screen.getByLabelText("pick-action")).toBeTruthy(),
    );
    const spin = screen.getByLabelText("pick-action");
    fireEvent.press(spin);
    fireEvent.press(spin);

    // The pick send is still unresolved: no second action and no finish yet.
    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);
    expect(mockSendGameEvent).toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({
        kind: "action",
        payload: { type: "pick", playerId: "honza", fromRevision: 0 },
      }),
      expect.any(String),
    );
    expect(mockFinishGame).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("canonical-done")).toBeNull();

    await act(async () => {
      resolvePickSend?.();
    });

    expect(mockSendGameEvent).toHaveBeenCalledTimes(2);
    expect(mockSendGameEvent).toHaveBeenNthCalledWith(2, "game-1", {
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
  });

  it("does not attribute an excluded lobby player's pending action by roster position", async () => {
    mockRouteKey = "round";
    mockRoundPickedPlayerId = "petra";
    let resolvePickSend: ((stored: boolean) => void) | null = null;
    mockSendGameEvent.mockImplementation(
      (_gameId: string, event: { kind: string }) =>
        event.kind === "action"
          ? new Promise<boolean>((resolve) => {
              resolvePickSend = resolve;
            })
          : Promise.resolve(true),
    );

    const view = render(<PartyGameScreen />);
    // This phone starts [host=honza, observer=petra]. Another phone wins the
    // bind race with [guest=me, host=honza].
    fireEvent.press(screen.getByLabelText("lobby-me"));
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() =>
      expect(screen.getByLabelText("pick-action")).toBeTruthy(),
    );
    fireEvent.press(screen.getByLabelText("pick-action"));
    expect(screen.getByLabelText("picked-petra")).toBeTruthy();

    mockSharedRoster = [
      {
        id: "me",
        nickname: "guest",
        displayName: "Guest",
        avatarUrl: null,
      },
      { id: "honza", nickname: "host", displayName: "Host", avatarUrl: null },
    ];
    view.rerender(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());

    expect(screen.getByLabelText("picked-none")).toBeTruthy();
    expect(screen.queryByLabelText("picked-honza")).toBeNull();
    await act(async () => resolvePickSend?.(true));

    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);
    expect(mockFinishGame).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("canonical-done")).toBeNull();
  });

  it("does not finish a round when its pick could not be stored durably", async () => {
    mockRouteKey = "round";
    mockSendGameEvent
      .mockResolvedValueOnce(false)
      .mockResolvedValue(true);

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() => expect(screen.getByLabelText("pick-action")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("pick-action"));

    await act(async () => undefined);
    expect(mockFinishGame).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("canonical-done")).toBeNull();
    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByLabelText("pick-action"));
    await waitFor(() => expect(mockSendGameEvent).toHaveBeenCalledTimes(3));
    expect(mockSendGameEvent).toHaveBeenNthCalledWith(
      2,
      "game-1",
      expect.objectContaining({ kind: "action" }),
      expect.any(String),
    );
    expect(mockFinishGame).toHaveBeenCalledTimes(1);
  });

  it("keeps a round retryable when its pick is durable but its finish is not", async () => {
    mockRouteKey = "round";
    mockSendGameEvent
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() => expect(screen.getByLabelText("pick-action")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("pick-action"));

    await act(async () => undefined);
    expect(mockSendGameEvent).toHaveBeenCalledTimes(2);
    expect(mockFinishGame).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("canonical-done")).toBeNull();

    fireEvent.press(screen.getByLabelText("pick-action"));
    await waitFor(() => expect(mockSendGameEvent).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(screen.getByLabelText("canonical-done")).toBeTruthy());
    expect(mockFinishGame).toHaveBeenCalledTimes(1);
  });

  it("keeps the manual finish action retryable after durable storage fails", async () => {
    mockRouteKey = "never";
    mockSendGameEvent.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() => expect(screen.getByLabelText("Ukončit hru")).toBeTruthy());
    fireEvent.press(screen.getByLabelText("Ukončit hru"));

    await act(async () => undefined);
    expect(screen.queryByLabelText("canonical-done")).toBeNull();
    expect(screen.getByLabelText("Ukončit hru")).toBeTruthy();
    expect(mockFinishGame).not.toHaveBeenCalled();

    fireEvent.press(screen.getByLabelText("Ukončit hru"));
    await waitFor(() => expect(screen.getByLabelText("canonical-done")).toBeTruthy());
    expect(mockFinishGame).toHaveBeenCalledTimes(1);
  });

  it("resolves the round payer from the current canonical pick when the local send lands late", async () => {
    mockRouteKey = "round";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
      { id: "petra", nickname: "petra", displayName: "Petra", avatarUrl: null },
    ];
    let resolvePickSend: (() => void) | null = null;
    mockSendGameEvent.mockImplementation(
      (_gameId: string, event: { kind: string }) =>
        event.kind === "action"
          ? new Promise<void>((resolve) => {
              resolvePickSend = resolve;
            })
          : Promise.resolve(),
    );

    const view = render(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());
    fireEvent.press(screen.getByLabelText("pick-action"));

    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);
    expect(mockFinishGame).not.toHaveBeenCalled();

    // A lower-cursor remote pick becomes canonical while our send is still
    // unresolved: the late finish must name THAT payer, not our stale spin.
    mockGameEvents = [
      actionEvent(1, "phone-a-pick", {
        type: "pick",
        playerId: "petra",
        fromRevision: 0,
      }),
    ];
    view.rerender(<PartyGameScreen />);

    await act(async () => {
      resolvePickSend?.();
    });

    expect(mockSendGameEvent).toHaveBeenCalledTimes(2);
    expect(mockSendGameEvent).toHaveBeenNthCalledWith(2, "game-1", {
      kind: "finish",
      payload: {
        winner: null,
        winnerId: null,
        scores: [],
        paying: "petra",
        payingId: "petra",
      },
    });
    expect(mockFinishGame).toHaveBeenCalledTimes(1);
    expect(mockFinishGame).toHaveBeenCalledWith(
      "round",
      expect.objectContaining({ paying: "petra", payingId: "petra" }),
    );
  });

  it("does not duplicate the round finish when a remote finish lands during the pick send", async () => {
    mockRouteKey = "round";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    let resolvePickSend: (() => void) | null = null;
    mockSendGameEvent.mockImplementation(
      (_gameId: string, event: { kind: string }) =>
        event.kind === "action"
          ? new Promise<void>((resolve) => {
              resolvePickSend = resolve;
            })
          : Promise.resolve(),
    );

    const view = render(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());
    fireEvent.press(screen.getByLabelText("pick-action"));

    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);

    const remoteFinish = actionEvent(2, "phone-a-finish", {});
    remoteFinish.kind = "finish";
    remoteFinish.payload = {
      winner: null,
      winnerId: null,
      scores: [],
      paying: "Honza",
      payingId: "honza",
    };
    mockGameEvents = [...mockGameEvents, remoteFinish];
    view.rerender(<PartyGameScreen />);
    expect(screen.getByLabelText("canonical-done")).toBeTruthy();

    await act(async () => {
      resolvePickSend?.();
    });

    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);
    expect(mockSendGameEvent).not.toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ kind: "finish" }),
    );
    expect(mockFinishGame).not.toHaveBeenCalled();
  });

  it("drops the pending round finish when the screen unmounts mid-send", async () => {
    mockRouteKey = "round";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    let resolvePickSend: (() => void) | null = null;
    mockSendGameEvent.mockImplementation(
      (_gameId: string, event: { kind: string }) =>
        event.kind === "action"
          ? new Promise<void>((resolve) => {
              resolvePickSend = resolve;
            })
          : Promise.resolve(),
    );

    const view = render(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());
    fireEvent.press(screen.getByLabelText("pick-action"));

    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => {
      resolvePickSend?.();
    });

    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);
    expect(mockSendGameEvent).not.toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({ kind: "finish" }),
    );
    expect(mockFinishGame).not.toHaveBeenCalled();
  });

  it("publishes exactly one stable-id pick action before the round finish on a two-player roster", async () => {
    mockRouteKey = "round";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: null, displayName: "Honza", avatarUrl: null },
    ];

    render(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());
    const spin = screen.getByLabelText("pick-action");
    fireEvent.press(spin);
    fireEvent.press(spin);

    await waitFor(() =>
      expect(mockSendGameEvent).toHaveBeenCalledWith(
        "game-1",
        expect.objectContaining({ kind: "finish" }),
      ),
    );
    expect(mockSendGameEvent).toHaveBeenCalledTimes(2);
    expect(mockSendGameEvent).toHaveBeenNthCalledWith(
      1,
      "game-1",
      {
        kind: "action",
        payload: { type: "pick", playerId: "honza", fromRevision: 0 },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
    expect(mockSendGameEvent).toHaveBeenNthCalledWith(2, "game-1", {
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
  });

  it("shows a staged remote round pick on another phone and the canonical result after finish", () => {
    mockRouteKey = "round";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, "phone-a-pick", {
        type: "pick",
        playerId: "honza",
        fromRevision: 0,
      }),
    ];

    const view = render(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());
    expect(screen.getByLabelText("picked-honza")).toBeTruthy();

    const finish = actionEvent(2, "phone-a-finish", {});
    finish.kind = "finish";
    finish.payload = {
      winner: null,
      winnerId: null,
      scores: [],
      paying: "Honza",
      payingId: "honza",
    };
    mockGameEvents = [...mockGameEvents, finish];
    view.rerender(<PartyGameScreen />);

    expect(screen.getByLabelText("canonical-done")).toBeTruthy();
  });

  it("reports the canonical staged pick when a late spin lands a different player", async () => {
    mockRouteKey = "round";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, "phone-a-pick", {
        type: "pick",
        playerId: "me",
        fromRevision: 0,
      }),
    ];

    render(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());
    expect(screen.getByLabelText("picked-me")).toBeTruthy();

    // The drum spins again on this phone, but the table already has a
    // canonical pick: the finish must name THAT payer, not the new spin.
    fireEvent.press(screen.getByLabelText("pick-action"));

    expect(mockSendGameEvent).not.toHaveBeenCalledWith(
      "game-1",
      expect.objectContaining({
        kind: "finish",
        payload: expect.objectContaining({ payingId: "honza" }),
      }),
    );
    expect(mockSendGameEvent).toHaveBeenCalledWith("game-1", {
      kind: "finish",
      payload: {
        winner: null,
        winnerId: null,
        scores: [],
        paying: "ty",
        payingId: "me",
      },
    });
    await waitFor(() => expect(mockFinishGame).toHaveBeenCalledTimes(1));
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
      mockSharingFailure = "Hru se nepodařilo uložit pro sdílení.";
      return null;
    });

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));

    await waitFor(() => {
      expect(
        screen.getByText("Hru se nepodařilo uložit pro sdílení."),
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
    expect(mockSendGameEvent).toHaveBeenCalledWith(
      "game-1",
      {
        kind: "score",
        subjectId: "honza",
        delta: 1,
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
  });

  it("keeps a pending score on the same player when a different lobby wins", async () => {
    mockRouteKey = "score";
    const view = render(<PartyGameScreen />);
    // This phone starts [host=honza, observer=petra]. Another phone wins the
    // bind race with [guest=me, host=honza].
    fireEvent.press(screen.getByLabelText("lobby-me"));
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() =>
      expect(screen.getByLabelText("Bod pro Honza. Aktuálně 0")).toBeTruthy(),
    );

    fireEvent.press(screen.getByLabelText("Bod pro Honza. Aktuálně 0"));
    await waitFor(() => expect(mockSendGameEvent).toHaveBeenCalledTimes(1));
    const [, sentScore, clientId] = mockSendGameEvent.mock.calls[0] as [
      string,
      { delta: number; createdAt: string },
      string,
    ];

    mockSharedRoster = [
      {
        id: "me",
        nickname: "guest",
        displayName: "Guest",
        avatarUrl: null,
      },
      { id: "honza", nickname: "host", displayName: "Host", avatarUrl: null },
    ];
    view.rerender(<PartyGameScreen />);
    act(() => jest.runOnlyPendingTimers());
    expect(screen.getByLabelText("Bod pro host. Aktuálně 1")).toBeTruthy();
    expect(screen.getByLabelText("Bod pro guest. Aktuálně 0")).toBeTruthy();
    expect(screen.queryByLabelText(/Bod pro Petra\./)).toBeNull();

    mockGameEvents = [
      {
        cursor: 9,
        clientId,
        gameId: "game-1",
        kind: "score",
        account: GAME_PROFILE,
        subject: {
          id: "honza",
          nickname: "host",
          displayName: "Host",
          avatarUrl: null,
        },
        delta: sentScore.delta,
        payload: {},
        at: sentScore.createdAt,
      },
    ];
    view.rerender(<PartyGameScreen />);

    expect(screen.getByLabelText("Bod pro host. Aktuálně 1")).toBeTruthy();
    expect(screen.getByLabelText("Bod pro guest. Aktuálně 0")).toBeTruthy();
  });

  it("rolls an optimistic score back and lets it be retried when storage fails", async () => {
    mockRouteKey = "score";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockSendGameEvent.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("Bod pro honza. Aktuálně 0"));
    await waitFor(() =>
      expect(screen.getByLabelText("Bod pro honza. Aktuálně 0")).toBeTruthy(),
    );

    fireEvent.press(screen.getByLabelText("Bod pro honza. Aktuálně 0"));
    await waitFor(() =>
      expect(screen.getByLabelText("Bod pro honza. Aktuálně 1")).toBeTruthy(),
    );
    expect(mockSendGameEvent).toHaveBeenCalledTimes(2);
  });

  it("rolls a failed quiz answer back, unlocks it and accepts a retry", async () => {
    mockRouteKey = "quiz";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockSendGameEvent.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("quiz-answer-action"));
    await waitFor(() =>
      expect(screen.queryByLabelText("quiz-answer-me-q-plzen")).toBeNull(),
    );

    fireEvent.press(screen.getByLabelText("quiz-answer-action"));
    await waitFor(() =>
      expect(screen.getByLabelText("quiz-answer-me-q-plzen")).toBeTruthy(),
    );
    expect(mockSendGameEvent).toHaveBeenCalledTimes(2);
  });

  it("keeps generic Konec hidden while the exact terminal quiz result retries", async () => {
    mockRouteKey = "quiz";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = QUIZ_QUESTIONS.map((_, index) =>
      actionEvent(index + 1, `quiz-next-${index}`, {
        type: "quiz_next",
        fromQuestion: index,
      }),
    );
    mockSendGameEvent.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    render(<PartyGameScreen />);
    expect(screen.getByLabelText(`quiz-index-${QUIZ_QUESTIONS.length}`)).toBeTruthy();
    expect(screen.queryByLabelText("Ukončit hru")).toBeNull();

    fireEvent.press(screen.getByLabelText("quiz-result-action"));
    await waitFor(() => expect(mockSendGameEvent).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText("canonical-done")).toBeNull();
    expect(screen.queryByLabelText("Ukončit hru")).toBeNull();

    fireEvent.press(screen.getByLabelText("quiz-result-action"));
    await waitFor(() => expect(mockSendGameEvent).toHaveBeenCalledTimes(2));
    expect(mockSendGameEvent.mock.calls[1]).toEqual(mockSendGameEvent.mock.calls[0]);
    expect(screen.getByLabelText("canonical-done")).toBeTruthy();
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

  it("handles a rejected shared action, rolls it back and accepts a retry", async () => {
    mockRouteKey = "never";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockSendGameEvent
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce(true);

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("prompt-action"));
    await waitFor(() => expect(screen.getByLabelText("prompt-step-0")).toBeTruthy());

    fireEvent.press(screen.getByLabelText("prompt-action"));
    await waitFor(() => expect(screen.getByLabelText("prompt-step-1")).toBeTruthy());
    expect(mockSendGameEvent).toHaveBeenCalledTimes(2);
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
          drawnById: "honza",
        },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
  });

  it("attributes a three-player King’s Cup draw to the roster turn, not the phone owner", async () => {
    mockRouteKey = "kings";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
      { id: "petra", nickname: "petra", displayName: "Petra", avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, "draw-1", {
        type: "draw",
        drawKind: "card",
        value: "clubs-A",
        fromCount: 0,
        drawnById: "me",
      }),
      actionEvent(2, "draw-2", {
        type: "draw",
        drawKind: "card",
        value: "clubs-K",
        fromCount: 1,
        drawnById: "honza",
      }),
    ];

    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("draw-action"));

    await waitFor(() =>
      expect(mockSendGameEvent).toHaveBeenCalledWith(
        "game-1",
        expect.objectContaining({
          kind: "action",
          payload: expect.objectContaining({ drawnById: "petra", fromCount: 2 }),
        }),
        expect.any(String),
      ),
    );
  });

  it("keeps canonical player ids when two players share the same display name", () => {
    mockRouteKey = "score";
    mockSharedRoster = [
      { id: "alex-a", nickname: null, displayName: "Alex", avatarUrl: null },
      { id: "alex-b", nickname: null, displayName: "Alex", avatarUrl: null },
    ];
    const finish = actionEvent(8, "finish-duplicates", {});
    finish.kind = "finish";
    finish.payload = {
      winner: "Alex",
      winnerId: "alex-b",
      paying: null,
      payingId: null,
      scores: [
        { name: "Alex", playerId: "alex-a", score: 1 },
        { name: "Alex", playerId: "alex-b", score: 2 },
      ],
    };
    mockGameEvents = [finish];

    render(<PartyGameScreen />);

    expect(mockCanonicalOutcome).toEqual({
      winnerId: { kind: "id", value: "alex-b" },
      payingId: null,
      scores: [
        { playerId: { kind: "id", value: "alex-a" }, score: 1 },
        { playerId: { kind: "id", value: "alex-b" }, score: 2 },
      ],
    });
  });

  it("keeps name-based legacy finishes readable when stable ids are absent", () => {
    mockRouteKey = "score";
    mockSharedRoster = [
      { id: "honza", nickname: null, displayName: "Honza", avatarUrl: null },
    ];
    const finish = actionEvent(8, "finish-legacy", {});
    finish.kind = "finish";
    finish.payload = {
      winner: "Honza",
      scores: [{ name: "Honza", score: 3 }],
    };
    mockGameEvents = [finish];

    render(<PartyGameScreen />);

    expect(mockCanonicalOutcome).toEqual({
      winnerId: { kind: "name", value: "Honza" },
      payingId: null,
      scores: [{ playerId: { kind: "name", value: "Honza" }, score: 3 }],
    });
  });

  it("falls back to legacy names when canonical ids are not in the roster", () => {
    mockRouteKey = "score";
    mockSharedRoster = [
      { id: "honza", nickname: null, displayName: "Honza", avatarUrl: null },
    ];
    const finish = actionEvent(8, "finish-stale-ids", {});
    finish.kind = "finish";
    finish.payload = {
      winner: "Honza",
      winnerId: "deleted-player",
      paying: null,
      payingId: "deleted-payer",
      scores: [{ name: "Honza", playerId: "deleted-player", score: 3 }],
    };
    mockGameEvents = [finish];

    render(<PartyGameScreen />);

    expect(mockCanonicalOutcome).toEqual({
      winnerId: { kind: "name", value: "Honza" },
      payingId: null,
      scores: [{ playerId: { kind: "name", value: "Honza" }, score: 3 }],
    });
  });

  it("routes a completely unknown game key back to Party without starting it", async () => {
    mockRouteKey = "garbage";
    mockCanGoBack = false;

    render(<PartyGameScreen />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/friends"));
    expect(screen.queryByLabelText("start-game")).toBeNull();
    expect(mockStartSharedGame).not.toHaveBeenCalled();
  });

  it("keeps an unknown catalogue key playable when it belongs to a known legacy game", () => {
    mockRouteKey = "legacy-score";
    mockPlacedGame = true;

    render(<PartyGameScreen />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("start-game")).toBeTruthy();
  });

  it.each([
    ["categories", "Kategorie"],
    ["thumb", "Palec"],
    ["rules", "Pravidlo večera"],
  ])("opens and advances the %s prompt route", async (routeKey, gameName) => {
    mockRouteKey = routeKey;
    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));
    await waitFor(() => expect(screen.getByLabelText("prompt-step-0")).toBeTruthy());
    expect(mockStartSharedGame).toHaveBeenCalledWith(
      expect.objectContaining({ catalogKey: routeKey, name: gameName }),
    );
    fireEvent.press(screen.getByLabelText("prompt-action"));
    await waitFor(() => expect(screen.getByLabelText("prompt-step-1")).toBeTruthy());
  });

  it("shows the canonical fourth king before finishing for the player who drew it", async () => {
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
    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
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

  it("retries the same fourth-king finish after durable storage fails", async () => {
    mockRouteKey = "kings";
    mockSharedRoster = [
      { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
      { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, "king-1", {
        type: "draw", drawKind: "card", value: "clubs-K", fromCount: 0, drawnById: "me",
      }),
      actionEvent(2, "king-2", {
        type: "draw", drawKind: "card", value: "diamonds-K", fromCount: 1, drawnById: "me",
      }),
      actionEvent(3, "king-3", {
        type: "draw", drawKind: "card", value: "hearts-K", fromCount: 2, drawnById: "me",
      }),
      actionEvent(4, "king-4", {
        type: "draw", drawKind: "card", value: "spades-K", fromCount: 3, drawnById: "honza",
      }),
    ];
    mockSendGameEvent.mockResolvedValueOnce(false).mockResolvedValueOnce(true);

    render(<PartyGameScreen />);
    await act(async () => {
      jest.advanceTimersByTime(1600);
      await Promise.resolve();
    });
    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Ukončit hru")).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(1600);
      await Promise.resolve();
    });
    expect(mockSendGameEvent).toHaveBeenCalledTimes(2);
    expect(mockSendGameEvent.mock.calls[1]).toEqual(mockSendGameEvent.mock.calls[0]);
  });

  it("pays the same roster member on every phone when the fourth king has no drawn-by author", async () => {
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

    await act(async () => {
      jest.advanceTimersByTime(1600);
      await Promise.resolve();
    });
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
        paying: "Honza",
        payingId: "honza",
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
    expect(screen.getByLabelText("Máš 0 piv. Přidat další.")).toBeTruthy();
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
    mockSendGameEvent.mockResolvedValue(undefined);
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
    mockSharingFailure = "Hru se nepodařilo uložit pro sdílení.";

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

  it("does not schedule or retry the shared fourth king finish while spectating", async () => {
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
    ];

    const view = render(<PartyGameScreen />);
    const timersBeforeFourthKing = jest.getTimerCount();
    mockGameEvents = [
      ...mockGameEvents,
      actionEvent(4, "king-4", {
        type: "draw",
        drawKind: "card",
        value: "spades-K",
        fromCount: 3,
        drawnById: "petra",
      }),
    ];
    view.rerender(<PartyGameScreen />);
    expect(screen.getByLabelText("draw-spades-K")).toBeTruthy();
    // The existing zero-delay roster hydration is unrelated. The fourth king
    // must not add a finish timer on a phone that only watches the table.
    expect(jest.getTimerCount()).toBe(timersBeforeFourthKing);

    await act(async () => {
      jest.advanceTimersByTime(6400);
      await Promise.resolve();
    });

    expect(jest.getTimerCount()).toBe(timersBeforeFourthKing);
    expect(mockSendGameEvent).not.toHaveBeenCalled();
    expect(mockFinishGame).not.toHaveBeenCalled();
  });
});

describe("PartyGameScreen accessibility", () => {
  const announceSpy = jest.fn();
  const FAILURE = "Hru se nepodařilo uložit pro sdílení.";
  const SHARING_LINE = `Hra běží jen na tomhle telefonu. ${FAILURE}`;

  type MockNode = {
    props?: Record<string, unknown>;
    parent?: MockNode | null;
  };

  const rosterWithMe = [
    { id: "me", nickname: "ty", displayName: "Ty", avatarUrl: null },
    { id: "honza", nickname: "honza", displayName: "Honza", avatarUrl: null },
  ];

  function resetAccessibilitySpy() {
    (
      AccessibilityInfo as unknown as Record<string, unknown>
    ).announceForAccessibility = announceSpy;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    announceSpy.mockClear();
    Platform.OS = "ios";
    mockRouteKey = "dice";
    mockPlacedGame = false;
    mockSharedCode = "TABLE1";
    mockSharingFailure = undefined;
    mockSharedRoster = [];
    mockGameEvents = [];
    mockNight = createMockNight();
    mockLoadPendingPartyGameRuntime.mockResolvedValue(null);
    mockLoadQueuedPartyGameEvents.mockResolvedValue([]);
    mockSendGameEvent.mockResolvedValue(undefined);
    mockStartSharedGame.mockImplementation(
      async (input: { rosterIds?: string[] }) => ({
        gameId: "game-1",
        rosterIds: input.rosterIds ?? [],
      }),
    );
    resetAccessibilitySpy();
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    delete (AccessibilityInfo as unknown as Record<string, unknown>)
      .announceForAccessibility;
    Platform.OS = "ios";
  });

  it("marks the pinned game title as a header", () => {
    render(<PartyGameScreen />);
    expect(screen.getByText("Kostky").props.accessibilityRole).toBe("header");
  });

  it("announces the shared-game failure band once on iOS and does not repeat on the same state", () => {
    mockSharedRoster = rosterWithMe;
    mockSharingFailure = FAILURE;

    const view = render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByText(SHARING_LINE).props.accessibilityLiveRegion).toBe(
      "assertive",
    );
    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(announceSpy).toHaveBeenCalledWith(SHARING_LINE);

    view.rerender(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps the shared-game failure declarative on Android with zero imperative calls", () => {
    Platform.OS = "android";
    mockSharedRoster = rosterWithMe;
    mockSharingFailure = FAILURE;

    const view = render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByText(SHARING_LINE).props.accessibilityLiveRegion).toBe(
      "assertive",
    );
    view.rerender(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("announces the quiz retry failure once on iOS and keeps Retry a separate button", async () => {
    mockRouteKey = "quiz";
    mockStartSharedGame.mockImplementationOnce(async () => {
      mockSharingFailure = FAILURE;
      return null;
    });

    const view = render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText("start-game"));

    await waitFor(() =>
      expect(screen.getByLabelText("Zkusit znovu")).toBeTruthy(),
    );

    const error = screen.getByText(FAILURE);
    expect(error.props.accessibilityLiveRegion).toBe("assertive");
    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(announceSpy).toHaveBeenCalledWith(FAILURE);

    const retry = screen.getByLabelText("Zkusit znovu");
    expect(retry.props.accessibilityRole).toBe("button");
    let node = retry as unknown as MockNode;
    while (node?.parent) {
      node = node.parent;
      expect(node.props?.accessibilityLiveRegion).toBeUndefined();
      expect(node.props?.accessible).toBeUndefined();
    }

    view.rerender(<PartyGameScreen />);
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });

  it("exposes score rows with roles and a polite live region and announces a local point once on iOS", async () => {
    mockRouteKey = "score";
    mockSharedRoster = rosterWithMe;

    const view = render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });

    const meRow = screen.getByLabelText("Bod pro ty. Aktuálně 0");
    expect(meRow.props.accessibilityRole).toBe("button");
    expect(meRow.props.accessibilityState).toEqual({ disabled: false });
    expect(meRow.props.accessibilityLiveRegion).toBe("polite");

    fireEvent.press(meRow);
    await waitFor(() =>
      expect(screen.getByLabelText("Bod pro ty. Aktuálně 1")).toBeTruthy(),
    );
    expect(announceSpy).toHaveBeenCalledTimes(1);
    expect(announceSpy).toHaveBeenCalledWith("Bod pro ty. Aktuálně 1");

    // Unrelated rerender of the same state stays silent.
    view.rerender(<PartyGameScreen />);
    expect(announceSpy).toHaveBeenCalledTimes(1);

    // The local-server acknowledgement folds without repeating the announce.
    const [ackCall] = mockSendGameEvent.mock.calls.filter(
      ([, event]) => (event as { kind: string }).kind === "score",
    );
    const ackEvent = ackCall[1] as {
      kind: string;
      subjectId: string;
      delta: number;
      createdAt: string;
    };
    mockGameEvents = [
      {
        cursor: 9,
        clientId: "score-ack",
        gameId: "game-1",
        kind: "score",
        account: GAME_PROFILE,
        subject: {
          id: "me",
          nickname: "ty",
          displayName: "Ty",
          avatarUrl: null,
        },
        delta: ackEvent.delta,
        payload: {},
        at: ackEvent.createdAt,
      },
    ];
    view.rerender(<PartyGameScreen />);
    expect(screen.getByLabelText("Bod pro ty. Aktuálně 1")).toBeTruthy();
    expect(announceSpy).toHaveBeenCalledTimes(1);
  });

  it("does not announce scores that already exist at mount or on reconnect", () => {
    mockRouteKey = "score";
    mockSharedRoster = rosterWithMe;
    mockGameEvents = [
      {
        cursor: 7,
        clientId: "score-7",
        gameId: "game-1",
        kind: "score",
        account: GAME_PROFILE,
        subject: {
          id: "me",
          nickname: "ty",
          displayName: "Ty",
          avatarUrl: null,
        },
        delta: 2,
        payload: {},
        at: "2026-08-07T20:00:00.000Z",
      },
    ];

    render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(screen.getByLabelText("Bod pro ty. Aktuálně 2")).toBeTruthy();
    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("marks score rows disabled for a spectator and stays silent on an Android score change", async () => {
    Platform.OS = "android";

    // Spectator: rows stay queryable but disabled.
    mockRouteKey = "score";
    mockSharedRoster = SHARED_ROSTER_WITHOUT_ME;

    render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });

    const honzaRow = screen.getByLabelText("Bod pro honza. Aktuálně 0");
    expect(honzaRow.props.accessibilityRole).toBe("button");
    expect(honzaRow.props.accessibilityState).toEqual({ disabled: true });
    expect(honzaRow.props.accessibilityLiveRegion).toBe("polite");
    fireEvent.press(honzaRow);
    expect(mockSendGameEvent).not.toHaveBeenCalled();

    // Active player: the 0->1 transition is declarative only.
    mockSharedRoster = rosterWithMe;
    const view = render(<PartyGameScreen />);
    act(() => {
      jest.runOnlyPendingTimers();
    });
    const meRow = screen.getByLabelText("Bod pro ty. Aktuálně 0");
    fireEvent.press(meRow);
    await waitFor(() =>
      expect(screen.getByLabelText("Bod pro ty. Aktuálně 1")).toBeTruthy(),
    );
    view.rerender(<PartyGameScreen />);
    expect(announceSpy).not.toHaveBeenCalled();
  });
});
