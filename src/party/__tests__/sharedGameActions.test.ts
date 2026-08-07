import type { PartyGameEvent, PartyGameEventInput } from '@/data/partyGamesClient';
import { whoseTurn } from '@/games/web/dice/rules';
import {
  foldDiceActions,
  foldSharedGameActions,
  latestDraw,
  latestPick,
  promptStep,
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

it('keeps simultaneous identical actions because their client ids differ', () => {
  const actions = foldSharedGameActions([
    remote(1, 'phone-a', { type: 'prompt_next' }),
    remote(2, 'phone-b', { type: 'prompt_next' }),
  ]);

  expect(promptStep(actions)).toBe(2);
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
  expect(first.wins).toEqual({ Ty: 1, Honza: 0 });
  expect(whoseTurn(first)).toBe('Ty');
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
