import type { PartyGameEvent, PartyGameEventInput } from '@/data/partyGamesClient';
import { whoseTurn } from '@/games/web/dice/rules';
import {
  foldDiceActions,
  foldSharedGameActions,
  latestDraw,
  latestPick,
  promptStep,
  quizProgress,
  cardDrawActions,
  cardDraws,
  canonicalGameFinish,
  parseSharedGameAction,
  type SharedGamePlayer,
} from '@/party/sharedGameActions';

const PROFILE = {
  id: 'me',
  nickname: 'ja',
  displayName: 'Já',
  avatarUrl: null,
};

function remote(
  cursor: number,
  clientId: string,
  payload: Record<string, unknown>,
): PartyGameEvent {
  return {
    cursor,
    clientId,
    gameId: 'game',
    kind: 'action',
    account: PROFILE,
    subject: null,
    delta: 0,
    payload,
    at: `2026-08-07T00:00:0${cursor}.000Z`,
  };
}

function queued(clientId: string, payload: Record<string, unknown>): PartyGameEventInput {
  return { clientId, kind: 'action', payload };
}

it('folds reconnect state and removes only the matching optimistic echo', () => {
  const actions = foldSharedGameActions(
    [
      remote(1, 'prompt-1', { type: 'prompt_next' }),
      remote(2, 'pick-1', { type: 'pick', playerId: 'honza' }),
    ],
    [
      queued('prompt-1', { type: 'prompt_next' }),
      queued('prompt-2', { type: 'prompt_next' }),
      queued('draw-1', { type: 'draw', drawKind: 'card', value: 'K' }),
    ],
  );

  expect(promptStep(actions)).toBe(2);
  expect(latestPick(actions)?.playerId).toBe('honza');
  expect(latestDraw(actions, 'card')).toMatchObject({ value: 'K', clientId: 'draw-1' });
  expect(actions.map((action) => action.clientId)).toEqual([
    'prompt-1',
    'pick-1',
    'prompt-2',
    'draw-1',
  ]);
});

it('keeps the first valid finish as the canonical read-only result', () => {
  const first = remote(7, 'finish-a', {});
  first.kind = 'finish';
  first.payload = { winnerId: null, payingId: 'honza', scores: [] };
  const conflict = remote(8, 'finish-b', {});
  conflict.kind = 'finish';
  conflict.payload = { winnerId: null, payingId: 'petra', scores: [] };

  expect(canonicalGameFinish([conflict, first])).toEqual({
    winnerId: null,
    payingId: 'honza',
    winner: null,
    paying: null,
    scores: [],
  });
});

it('reads legacy named finish payloads but rejects Nikdo as a payer', () => {
  const finish = remote(3, 'legacy', {});
  finish.kind = 'finish';
  finish.payload = { winner: null, paying: 'Nikdo', scores: [{ name: 'Ty', score: 2 }] };

  expect(canonicalGameFinish([finish])).toEqual({
    winnerId: null,
    payingId: null,
    winner: null,
    paying: null,
    scores: [{ name: 'Ty', score: 2 }],
  });
});

it('keeps simultaneous identical actions because their client ids differ', () => {
  const actions = foldSharedGameActions([
    remote(1, 'phone-a', { type: 'prompt_next' }),
    remote(2, 'phone-b', { type: 'prompt_next' }),
  ]);

  expect(promptStep(actions)).toBe(2);
});

it('accepts only the first concurrent command for the same folded cursor', () => {
  const actions = foldSharedGameActions([
    remote(1, 'phone-a', { type: 'prompt_next', fromStep: 0 }),
    remote(2, 'phone-b', { type: 'prompt_next', fromStep: 0 }),
    remote(3, 'phone-a-next', { type: 'prompt_next', fromStep: 1 }),
  ]);

  expect(promptStep(actions)).toBe(2);
});

it('keeps quiz reveal and question progress canonical across concurrent phones', () => {
  const actions = foldSharedGameActions([
    remote(1, 'reveal-a', { type: 'quiz_reveal', question: 0 }),
    remote(2, 'next-a', { type: 'quiz_next', fromQuestion: 0 }),
    remote(3, 'next-b-stale', { type: 'quiz_next', fromQuestion: 0 }),
    remote(4, 'reveal-b', { type: 'quiz_reveal', question: 1 }),
  ]);

  expect(quizProgress(actions)).toEqual({ question: 1, forceRevealed: true });
});

it('ignores malformed quiz cursors', () => {
  expect(parseSharedGameAction({ type: 'quiz_reveal', question: -1 }, 'negative')).toBeNull();
  expect(parseSharedGameAction({ type: 'quiz_reveal', question: 0.5 }, 'decimal')).toBeNull();
  expect(parseSharedGameAction({ type: 'quiz_reveal' }, 'missing')).toBeNull();
  expect(parseSharedGameAction({ type: 'quiz_next', fromQuestion: -1 }, 'negative')).toBeNull();
  expect(parseSharedGameAction({ type: 'quiz_next', fromQuestion: 0.5 }, 'decimal')).toBeNull();
  expect(parseSharedGameAction({ type: 'quiz_next' }, 'missing')).toBeNull();
});

it('folds a physical card deck without replacement across reconnects', () => {
  const actions = foldSharedGameActions([
    remote(1, 'a', { type: 'draw', drawKind: 'card', value: 'clubs-K', fromCount: 0 }),
    remote(2, 'conflict', { type: 'draw', drawKind: 'card', value: 'clubs-K', fromCount: 0 }),
    remote(3, 'b', {
      type: 'draw', drawKind: 'card', value: 'hearts-K', fromCount: 1, drawnById: 'honza',
    }),
  ]);

  expect(cardDraws(actions, new Set(['clubs-K', 'hearts-K']))).toEqual(['clubs-K', 'hearts-K']);
  expect(latestDraw(actions, 'card')?.value).toBe('hearts-K');
  expect(cardDrawActions(actions, new Set(['clubs-K', 'hearts-K'])).at(-1)?.drawnById).toBe(
    'honza',
  );
});

it('preserves the canonical author of the fourth king', () => {
  const actions = foldSharedGameActions([
    remote(1, 'k1', { type: 'draw', drawKind: 'card', value: 'clubs-K', fromCount: 0, drawnById: 'me' }),
    remote(2, 'k2', { type: 'draw', drawKind: 'card', value: 'diamonds-K', fromCount: 1, drawnById: 'me' }),
    remote(3, 'k3', { type: 'draw', drawKind: 'card', value: 'hearts-K', fromCount: 2, drawnById: 'me' }),
    remote(4, 'k4', { type: 'draw', drawKind: 'card', value: 'spades-K', fromCount: 3, drawnById: 'honza' }),
  ]);

  expect(cardDrawActions(actions).map((draw) => draw.value)).toEqual([
    'clubs-K', 'diamonds-K', 'hearts-K', 'spades-K',
  ]);
  expect(cardDrawActions(actions).at(-1)?.drawnById).toBe('honza');
});

it('folds dice results and round transitions identically after a cold restart', () => {
  const players: SharedGamePlayer[] = [
    { id: 'me', name: 'Ty', tint: '#111' },
    { id: 'honza', name: 'Honza', tint: '#222' },
  ];
  const events = [
    remote(1, 'r1', { type: 'dice_roll', playerId: 'me', dice: [6, 5] }),
    remote(2, 'ignored-turn', { type: 'dice_roll', playerId: 'me', dice: [6, 6] }),
    remote(3, 'r2', { type: 'dice_roll', playerId: 'honza', dice: [2, 1] }),
    remote(4, 'next', { type: 'dice_next' }),
  ];
  const first = foldDiceActions(players, foldSharedGameActions(events));
  const restarted = foldDiceActions(players, foldSharedGameActions(events));

  expect(restarted).toEqual(first);
  expect(first.wins).toEqual({ me: 1, honza: 0 });
  expect(whoseTurn(first)).toBe('me');
  expect(first.roundNumber).toBe(2);
});

it('ignores malformed chance results instead of poisoning the fold', () => {
  const actions = foldSharedGameActions([
    remote(1, 'bad-die', { type: 'dice_roll', playerId: 'me', dice: [0, 9] }),
    remote(2, 'bad-pick', { type: 'pick', playerId: '' }),
    remote(3, 'good', { type: 'draw', drawKind: 'card', value: 'A' }),
    remote(4, 'unknown-card', { type: 'draw', drawKind: 'card', value: 'joker' }),
  ]);

  expect(actions).toHaveLength(2);
  expect(latestDraw(actions, 'card', new Set(['A', 'K']))?.value).toBe('A');
});
