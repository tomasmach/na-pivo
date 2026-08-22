import {
  isOver,
  recordRoll,
  roundLoser,
  roundWinners,
  settleRound,
  standings,
  startDice,
  whoseTurn,
  TARGET_WINS,
} from '@/games/web/dice/rules';

const PLAYERS = [
  { id: 'me', name: 'Ty', tint: '#E8A317' },
  { id: 'honza', name: 'Honza', tint: '#7DD66B' },
  { id: 'petr', name: 'Petr', tint: '#F0BE5C' },
];

/** Roll for everyone still in, in turn order, with the totals given. */
function playRound(state: ReturnType<typeof startDice>, totals: number[]) {
  let next = state;
  totals.forEach((sum) => {
    const playerId = whoseTurn(next);
    if (!playerId) return;
    next = recordRoll(next, playerId, [sum - 1, 1]);
  });
  return settleRound(next);
}

describe('diceDuel', () => {
  it('goes round the table in order and knows when the round is done', () => {
    let state = startDice(PLAYERS);
    expect(whoseTurn(state)).toBe('me');
    state = recordRoll(state, 'me', [3, 4]);
    expect(whoseTurn(state)).toBe('honza');
    state = recordRoll(state, 'honza', [1, 1]);
    state = recordRoll(state, 'petr', [6, 6]);
    expect(whoseTurn(state)).toBeNull();
  });

  it('gives the round to the highest and names the lowest', () => {
    let state = startDice(PLAYERS);
    state = recordRoll(state, 'me', [3, 4]);
    state = recordRoll(state, 'honza', [1, 1]);
    state = recordRoll(state, 'petr', [6, 6]);

    expect(roundWinners(state)).toEqual(['petr']);
    expect(roundLoser(state)).toBe('honza');
  });

  it('lets a tie for the top stand rather than inventing a roll-off', () => {
    // A rule you have to explain is a rule that stops the game.
    let state = startDice(PLAYERS);
    state = recordRoll(state, 'me', [5, 5]);
    state = recordRoll(state, 'honza', [5, 5]);
    state = recordRoll(state, 'petr', [1, 2]);

    expect(roundWinners(state)).toEqual(['me', 'honza']);
    const settled = settleRound(state);
    expect(settled.wins.me).toBe(1);
    expect(settled.wins.honza).toBe(1);
  });

  it('retires a player once they are safe, and stops dealing them in', () => {
    let state = startDice(PLAYERS);
    for (let round = 0; round < TARGET_WINS; round += 1) {
      state = playRound(state, [12, 3, 4]);
    }

    expect(state.safe).toEqual(['me']);
    expect(state.live).not.toContain('me');
    expect(whoseTurn(state)).toBe('honza');
  });

  it('ends with the last one standing holding the bill', () => {
    let state = startDice(PLAYERS);
    // Ty gets safe first, then Honza. Petr never wins a round.
    for (let round = 0; round < TARGET_WINS; round += 1) state = playRound(state, [12, 5, 3]);
    for (let round = 0; round < TARGET_WINS; round += 1) state = playRound(state, [12, 3]);

    expect(state.payingId).toBe('petr');
    expect(isOver(state)).toBe(true);
  });

  it('keeps one deterministic payer when the last two get safe together', () => {
    let state = startDice([PLAYERS[0], PLAYERS[1]]);
    for (let round = 0; round < TARGET_WINS; round += 1) state = playRound(state, [12, 12]);

    expect(state.safe).toEqual(['me']);
    expect(state.payingId).toBe('honza');
    expect(isOver(state)).toBe(true);
  });

  it('never scores anything but round wins', () => {
    // Not sips, not how much anyone drank. The board is the ladder, nothing else.
    let state = startDice(PLAYERS);
    state = playRound(state, [12, 4, 3]);

    expect(standings(state)).toEqual([
      { playerId: 'me', score: 1 },
      { playerId: 'honza', score: 0 },
      { playerId: 'petr', score: 0 },
    ]);
  });

  it('uses stable ids when two players have the same display name', () => {
    const twins = [
      { id: 'guest-a', name: 'Hráč', tint: '#111' },
      { id: 'guest-b', name: 'Hráč', tint: '#222' },
    ];
    let state = startDice(twins);
    state = recordRoll(state, 'guest-a', [6, 6]);
    state = recordRoll(state, 'guest-b', [1, 1]);

    expect(state.round.map((roll) => roll.playerId)).toEqual(['guest-a', 'guest-b']);
    expect(whoseTurn(state)).toBeNull();
  });
});
