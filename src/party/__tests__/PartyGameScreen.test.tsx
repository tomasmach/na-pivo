/* eslint-disable @typescript-eslint/no-require-imports */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { PartyGameEvent } from '@/data/partyGamesClient';

const mockBack = jest.fn();
const mockFinishGame = jest.fn();
const mockSendGameEvent = jest.fn();
const mockStartSharedGame = jest.fn();
const mockAddBeer = jest.fn();
const mockLoadPendingPartyGameRuntime = jest.fn();
const mockLoadQueuedPartyGameEvents = jest.fn();
let mockRouteKey = 'dice';
let mockSharedRoster: {
  id: string;
  nickname: string | null;
  displayName: string;
  avatarUrl: string | null;
}[] = [];
let mockGameEvents: PartyGameEvent[] = [];

const mockNight = {
  id: 'night-1',
  code: 'TABLE1',
  startedAt: '2026-08-05T18:00:00.000Z',
  endedAt: null,
  people: [
    { id: 'me', name: 'Ty', avatarUrl: null, tint: '#111111', active: true },
    { id: 'honza', name: 'Honza', avatarUrl: null, tint: '#222222', active: true },
    { id: 'petra', name: 'Petra', avatarUrl: null, tint: '#333333', active: true },
    { id: 'eva', name: 'Eva', avatarUrl: null, tint: '#444444', active: false },
  ],
  stops: [],
  drinks: [],
  games: [],
  photos: [],
};

const GAME_PROFILE = {
  id: 'me',
  nickname: 'ty',
  displayName: 'Ty',
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
    gameId: 'game-1',
    kind: 'action',
    account: GAME_PROFILE,
    subject: null,
    delta: 0,
    payload,
    at: `2026-08-07T20:00:0${cursor}.000Z`,
  };
}

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ key: mockRouteKey }),
  useRouter: () => ({ back: mockBack }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: () => null,
  ChevronLeftIcon: () => null,
  PlusIcon: () => null,
}));

jest.mock('@/party/gameCatalog', () => ({
  findGame: (key: string) => {
    const defs = {
      dice: { key: 'dice', name: 'Kostky', scoring: 'points', shell: 'turns' },
      round: { key: 'round', name: 'Kdo platí rundu', scoring: 'drinks', shell: 'pick' },
      quiz: { key: 'quiz', name: 'Pub kvíz', scoring: 'points', shell: 'quiz' },
      score: { key: 'score', name: 'Počítadlo', scoring: 'points', shell: 'score', how: 'Body.' },
      never: { key: 'never', name: 'Nikdy jsem', scoring: 'drinks', shell: 'prompt' },
      kings: { key: 'kings', name: 'King’s Cup', scoring: 'drinks', shell: 'draw', draw: 'card' },
      bottle: { key: 'bottle', name: 'Flaška', scoring: 'drinks', shell: 'pick' },
    } as const;
    return defs[key as keyof typeof defs];
  },
}));

jest.mock('@/party/gameContent', () => ({
  GAME_PROMPTS: { never: ['Jedna', 'Dvě'] },
  KINGS_CARDS: [{ card: 'A' }, { card: 'K' }],
}));

jest.mock('@/party/shells/GameLobby', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const { Pressable, View }: typeof import('react-native') = require('react-native');
  return {
    GameLobby: ({ table, onStart }: {
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
          accessibilityLabel: 'start-game',
          onPress: () => onStart(table.filter((player) => selected.includes(player.id))),
        }),
      );
    },
  };
});

jest.mock('@/party/shells/DiceDuelShell', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const { Pressable, Text, View }: typeof import('react-native') = require('react-native');
  return {
    DiceDuelShell: ({ onFinished, onDone, onRoll, onNextRound, state }: {
      onFinished: (result: {
        paying: string;
        standings: { name: string; score: number }[];
      }) => void;
      onDone: () => void;
      onRoll?: (result: { playerId: string; dice: [number, number] }) => void;
      onNextRound?: () => void;
      state?: { roundNumber: number; round: unknown[] };
    }) =>
      ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, {
          accessibilityLabel: `dice-state-${state?.roundNumber ?? 0}-${state?.round.length ?? 0}`,
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: 'dice-roll-action',
          onPress: () => onRoll?.({
            playerId: state?.round.length ? 'honza' : 'me',
            dice: state?.round.length ? [2, 1] : [6, 4],
          }),
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: 'dice-next-action',
          onPress: onNextRound,
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: 'dice-result',
          onPress: () =>
            onFinished({
              paying: 'Petra',
              standings: [
                { name: 'Honza', score: 3 },
                { name: 'Ty', score: 1 },
              ],
            }),
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: 'dice-done',
          onPress: onDone,
        }),
      ),
  };
});

jest.mock('@/party/shells/PickShell', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const { Pressable, Text, View }: typeof import('react-native') = require('react-native');
  return {
    PickShell: ({ onFinished, onDone, onPicked, pickedId }: {
      onFinished?: (paying: string) => void;
      onDone?: () => void;
      onPicked?: (playerId: string) => void;
      pickedId?: string | null;
    }) =>
      ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, { accessibilityLabel: `picked-${pickedId ?? 'none'}` }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: 'pick-action',
          onPress: () => onPicked?.('honza'),
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: 'round-result',
          onPress: () => onFinished?.('Honza'),
        }),
        ReactModule.createElement(Pressable, {
          accessibilityLabel: 'round-done',
          onPress: onDone,
        }),
      ),
  };
});

jest.mock('@/party/shells/QuizShell', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const { Text, View }: typeof import('react-native') = require('react-native');
  return {
    QuizShell: ({ entrants, answers }: {
      entrants: { id: string }[];
      answers: { entrantId: string; questionId: string }[];
    }) =>
      ReactModule.createElement(
        View,
        null,
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

jest.mock('@/party/shells/DrawShell', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const { Pressable, Text, View }: typeof import('react-native') = require('react-native');
  return {
    DrawShell: ({ result, onDraw }: {
      result?: { cardId?: string } | null;
      onDraw?: (result: { nonce: string; cardId: string }) => void;
    }) => ReactModule.createElement(
      View,
      null,
      ReactModule.createElement(Text, { accessibilityLabel: `draw-${result?.cardId ?? 'none'}` }),
      ReactModule.createElement(Pressable, {
        accessibilityLabel: 'draw-action',
        onPress: () => onDraw?.({ nonce: 'local', cardId: 'K' }),
      }),
    ),
  };
});
jest.mock('@/party/shells/PromptShell', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const { Pressable, Text, View }: typeof import('react-native') = require('react-native');
  return {
    PromptShell: ({ step, onNext }: { step?: number; onNext?: () => void }) =>
      ReactModule.createElement(
        View,
        null,
        ReactModule.createElement(Text, { accessibilityLabel: `prompt-step-${step ?? -1}` }),
        ReactModule.createElement(Pressable, { accessibilityLabel: 'prompt-action', onPress: onNext }),
      ),
  };
});

jest.mock('@/party/useNightRecord', () => ({ useNightRecord: () => mockNight }));
jest.mock('@/party/usePartyBeer', () => ({
  usePartyBeer: () => ({ add: mockAddBeer, remove: jest.fn(), rename: jest.fn() }),
}));

jest.mock('@/mocks/livePartyStore', () => ({
  useLivePartyStore: (selector: (state: unknown) => unknown) =>
    selector({ houseBeer: 'Ležák', finishGame: mockFinishGame, games: [] }),
}));

jest.mock('@/data/partyGameStartsQueue', () => ({
  loadPendingPartyGameRuntime: (...args: unknown[]) =>
    mockLoadPendingPartyGameRuntime(...args),
}));
jest.mock('@/data/partyGamesQueue', () => ({
  loadQueuedPartyGameEvents: (...args: unknown[]) =>
    mockLoadQueuedPartyGameEvents(...args),
}));

jest.mock('@/stores/partyEveningStore', () => ({
  selectConfirmedPartyJoinCode: (state: { evening?: { joinCode?: string } }) =>
    state.evening?.joinCode ?? null,
  usePartyEveningStore: (selector: (state: unknown) => unknown) =>
    selector({ evening: { joinCode: 'TABLE1' } }),
}));

jest.mock('@/stores/partyGamesStore', () => ({
  eventsOfGame: (events: PartyGameEvent[], gameId: string | null) =>
    events.filter((event) => event.gameId === gameId),
  useFollowPartyGames: () => undefined,
  usePartyGamesStore: (selector: (state: unknown) => unknown) =>
    selector({
      code: 'TABLE1',
      games: [{ id: 'game-1', catalogKey: mockRouteKey, roster: mockSharedRoster, seed: 17 }],
      events: mockGameEvents,
      sharingFailures: {},
      start: mockStartSharedGame,
      send: mockSendGameEvent,
    }),
}));

// Mocks must be registered before the screen module is evaluated.
// eslint-disable-next-line import/first
import PartyGameScreen from '@/party/PartyGameScreen';

describe('PartyGameScreen result wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteKey = 'dice';
    mockSharedRoster = [];
    mockGameEvents = [];
    mockLoadPendingPartyGameRuntime.mockResolvedValue(null);
    mockLoadQueuedPartyGameEvents.mockResolvedValue([]);
    mockStartSharedGame.mockImplementation(async (input: { rosterIds?: string[] }) => ({
      gameId: 'game-1',
      rosterIds: input.rosterIds ?? [],
    }));
  });

  it('keeps the dice result canonical when leaving GameResult', async () => {
    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText('start-game'));
    await waitFor(() => expect(screen.getByLabelText('dice-result')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('dice-result'));
    fireEvent.press(screen.getByLabelText('dice-done'));

    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);
    expect(mockSendGameEvent).toHaveBeenCalledWith('game-1', {
      kind: 'finish',
      payload: {
        winner: 'Honza',
        scores: [
          { name: 'Honza', score: 3 },
          { name: 'Ty', score: 1 },
        ],
        paying: 'Petra',
      },
    });
    expect(mockFinishGame).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('keeps the round payer canonical when leaving GameResult', async () => {
    mockRouteKey = 'round';
    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText('start-game'));
    await waitFor(() => expect(screen.getByLabelText('round-result')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('round-result'));
    fireEvent.press(screen.getByLabelText('round-done'));

    expect(mockSendGameEvent).toHaveBeenCalledTimes(1);
    expect(mockSendGameEvent).toHaveBeenCalledWith('game-1', {
      kind: 'finish',
      payload: { winner: null, scores: [], paying: 'Honza' },
    });
    expect(mockFinishGame).toHaveBeenCalledTimes(1);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('passes only active players selected in the lobby to Pub quiz', async () => {
    mockRouteKey = 'quiz';
    render(<PartyGameScreen />);
    fireEvent.press(screen.getByLabelText('lobby-petra'));
    fireEvent.press(screen.getByLabelText('start-game'));

    await waitFor(() => expect(screen.getByLabelText('quiz-entrant-me')).toBeTruthy());
    expect(screen.getByLabelText('quiz-entrant-honza')).toBeTruthy();
    expect(screen.queryByLabelText('quiz-entrant-petra')).toBeNull();
    expect(screen.queryByLabelText('quiz-entrant-eva')).toBeNull();
    expect(mockStartSharedGame).toHaveBeenCalledWith({
      catalogKey: 'quiz',
      name: 'Pub kvíz',
      scoring: 'points',
      rosterIds: ['honza', 'me'],
    });
  });

  it('uses the server roster on another phone without reopening the lobby', () => {
    mockRouteKey = 'quiz';
    mockSharedRoster = [
      { id: 'honza', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
      { id: 'petra', nickname: 'petra', displayName: 'Petra', avatarUrl: null },
    ];

    render(<PartyGameScreen />);

    expect(screen.queryByLabelText('start-game')).toBeNull();
    expect(screen.getByLabelText('quiz-entrant-honza')).toBeTruthy();
    expect(screen.getByLabelText('quiz-entrant-petra')).toBeTruthy();
    expect(screen.queryByLabelText('quiz-entrant-me')).toBeNull();
    expect(mockStartSharedGame).not.toHaveBeenCalled();
  });

  it('folds remote score events and appends a local score event', async () => {
    mockRouteKey = 'score';
    mockSharedRoster = [
      { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
      { id: 'honza', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
    ];
    mockGameEvents = [{
      cursor: 7,
      clientId: 'score-7',
      gameId: 'game-1',
      kind: 'score',
      account: { id: 'petra', nickname: 'petra', displayName: 'Petra', avatarUrl: null },
      subject: { id: 'honza', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
      delta: 2,
      payload: {},
      at: '2026-08-07T20:00:00.000Z',
    }];

    render(<PartyGameScreen />);

    const honza = screen.getByLabelText('Bod pro honza. Aktuálně 2');
    fireEvent.press(honza);

    await waitFor(() => {
      expect(screen.getByLabelText('Bod pro honza. Aktuálně 3')).toBeTruthy();
    });
    expect(mockSendGameEvent).toHaveBeenCalledWith('game-1', {
      kind: 'score',
      subjectId: 'honza',
      delta: 1,
      createdAt: expect.any(String),
    });
  });

  it('hydrates an offline score event after the game screen reopens', async () => {
    mockRouteKey = 'score';
    mockSharedRoster = [
      { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
      { id: 'honza', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
    ];
    mockLoadQueuedPartyGameEvents.mockResolvedValueOnce([{
      gameId: 'game-1',
      queuedAt: Date.parse('2026-08-07T20:00:00.000Z'),
      event: {
        clientId: 'offline-score-1',
        kind: 'score',
        subjectId: 'honza',
        delta: 2,
        createdAt: '2026-08-07T20:00:00.000Z',
      },
    }]);

    render(<PartyGameScreen />);

    await waitFor(() => {
      expect(screen.getByLabelText('Bod pro honza. Aktuálně 2')).toBeTruthy();
    });
    expect(mockSendGameEvent).not.toHaveBeenCalled();
  });

  it('hydrates the selected lobby and queued quiz answer after an offline kill', async () => {
    mockRouteKey = 'quiz';
    mockLoadPendingPartyGameRuntime.mockResolvedValue({
      localGameId: 'local:start-1',
      rosterIds: ['me', 'honza'],
    });
    mockLoadQueuedPartyGameEvents.mockResolvedValue([{
      gameId: 'local:start-1',
      queuedAt: Date.parse('2026-08-07T20:00:00.000Z'),
      event: {
        clientId: 'offline-answer-1',
        kind: 'answer',
        payload: { questionId: 'q1', option: 2 },
        createdAt: '2026-08-07T20:00:00.000Z',
      },
    }]);

    render(<PartyGameScreen />);

    await waitFor(() => {
      expect(screen.getByLabelText('quiz-entrant-me')).toBeTruthy();
      expect(screen.getByLabelText('quiz-entrant-honza')).toBeTruthy();
      expect(screen.getByLabelText('quiz-answer-me-q1')).toBeTruthy();
    });
    expect(screen.queryByLabelText('start-game')).toBeNull();
  });

  it('folds and appends prompt actions with an explicit echo id', async () => {
    mockRouteKey = 'never';
    mockSharedRoster = [
      { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
      { id: 'honza', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
    ];
    mockGameEvents = [actionEvent(1, 'remote-next', { type: 'prompt_next' })];

    render(<PartyGameScreen />);
    expect(screen.getByLabelText('prompt-step-1')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('prompt-action'));

    await waitFor(() => expect(screen.getByLabelText('prompt-step-2')).toBeTruthy());
    expect(mockSendGameEvent).toHaveBeenCalledWith(
      'game-1',
      {
        kind: 'action',
        payload: { type: 'prompt_next' },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
  });

  it('hydrates a queued prompt action after a cold restart', async () => {
    mockRouteKey = 'never';
    mockSharedRoster = [
      { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
      { id: 'honza', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
    ];
    mockLoadQueuedPartyGameEvents.mockResolvedValueOnce([{
      gameId: 'game-1',
      queuedAt: Date.parse('2026-08-07T20:00:00.000Z'),
      event: {
        clientId: 'offline-prompt-1',
        kind: 'action',
        payload: { type: 'prompt_next' },
        createdAt: '2026-08-07T20:00:00.000Z',
      },
    }]);

    render(<PartyGameScreen />);

    await waitFor(() => expect(screen.getByLabelText('prompt-step-1')).toBeTruthy());
    expect(mockSendGameEvent).not.toHaveBeenCalled();
  });

  it('folds a remote card and appends the next draw result', async () => {
    mockRouteKey = 'kings';
    mockSharedRoster = [
      { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
      { id: 'honza', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, 'remote-draw', { type: 'draw', drawKind: 'card', value: 'A' }),
    ];

    render(<PartyGameScreen />);
    expect(screen.getByLabelText('draw-A')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('draw-action'));

    await waitFor(() => expect(screen.getByLabelText('draw-K')).toBeTruthy());
    expect(mockSendGameEvent).toHaveBeenCalledWith(
      'game-1',
      {
        kind: 'action',
        payload: { type: 'draw', drawKind: 'card', value: 'K' },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
  });

  it('folds a remote pick and appends a stable player id', async () => {
    mockRouteKey = 'bottle';
    mockSharedRoster = [
      { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
      { id: 'honza', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
    ];
    mockGameEvents = [actionEvent(1, 'remote-pick', { type: 'pick', playerId: 'me' })];

    render(<PartyGameScreen />);
    expect(screen.getByLabelText('picked-me')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('pick-action'));

    await waitFor(() => expect(screen.getByLabelText('picked-honza')).toBeTruthy());
    expect(mockSendGameEvent).toHaveBeenCalledWith(
      'game-1',
      {
        kind: 'action',
        payload: { type: 'pick', playerId: 'honza' },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
  });

  it('continues dice from the remote fold and appends roll and round events', async () => {
    mockRouteKey = 'dice';
    mockSharedRoster = [
      { id: 'me', nickname: 'ty', displayName: 'Ty', avatarUrl: null },
      { id: 'honza', nickname: 'honza', displayName: 'Honza', avatarUrl: null },
    ];
    mockGameEvents = [
      actionEvent(1, 'remote-roll', { type: 'dice_roll', playerId: 'me', dice: [6, 4] }),
    ];

    render(<PartyGameScreen />);
    expect(screen.getByLabelText('dice-state-1-1')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('dice-roll-action'));
    await waitFor(() => expect(screen.getByLabelText('dice-state-1-2')).toBeTruthy());
    fireEvent.press(screen.getByLabelText('dice-next-action'));
    await waitFor(() => expect(screen.getByLabelText('dice-state-2-0')).toBeTruthy());

    expect(mockSendGameEvent).toHaveBeenNthCalledWith(
      1,
      'game-1',
      {
        kind: 'action',
        payload: { type: 'dice_roll', playerId: 'honza', dice: [2, 1] },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
    expect(mockSendGameEvent).toHaveBeenNthCalledWith(
      2,
      'game-1',
      {
        kind: 'action',
        payload: { type: 'dice_next' },
        createdAt: expect.any(String),
      },
      expect.any(String),
    );
  });
});
