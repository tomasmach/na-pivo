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
} from '@/party/diceDuel';

const PLAYERS = [
  { name: 'Ty', tint: '#E8A317' },
  { name: 'Honza', tint: '#7DD66B' },
  { name: 'Petr', tint: '#F0BE5C' },
];

/** Roll for everyone still in, in turn order, with the totals given. */
function playRound(state: ReturnType<typeof startDice>, totals: number[]) {
  let next = state;
  totals.forEach((sum) => {
    const name = whoseTurn(next);
    if (!name) return;
    next = recordRoll(next, name, [sum - 1, 1]);
  });
  return settleRound(next);
}

describe('diceDuel', () => {
  it('goes round the table in order and knows when the round is done', () => {
    let state = startDice(PLAYERS);
    expect(whoseTurn(state)).toBe('Ty');
    state = recordRoll(state, 'Ty', [3, 4]);
    expect(whoseTurn(state)).toBe('Honza');
    state = recordRoll(state, 'Honza', [1, 1]);
    state = recordRoll(state, 'Petr', [6, 6]);
    expect(whoseTurn(state)).toBeNull();
  });

  it('gives the round to the highest and names the lowest', () => {
    let state = startDice(PLAYERS);
    state = recordRoll(state, 'Ty', [3, 4]);
    state = recordRoll(state, 'Honza', [1, 1]);
    state = recordRoll(state, 'Petr', [6, 6]);

    expect(roundWinners(state)).toEqual(['Petr']);
    expect(roundLoser(state)).toBe('Honza');
  });

  it('lets a tie for the top stand rather than inventing a roll-off', () => {
    // A rule you have to explain is a rule that stops the game.
    let state = startDice(PLAYERS);
    state = recordRoll(state, 'Ty', [5, 5]);
    state = recordRoll(state, 'Honza', [5, 5]);
    state = recordRoll(state, 'Petr', [1, 2]);

    expect(roundWinners(state)).toEqual(['Ty', 'Honza']);
    const settled = settleRound(state);
    expect(settled.wins.Ty).toBe(1);
    expect(settled.wins.Honza).toBe(1);
  });

  it('retires a player once they are safe, and stops dealing them in', () => {
    let state = startDice(PLAYERS);
    for (let round = 0; round < TARGET_WINS; round += 1) {
      state = playRound(state, [12, 3, 4]);
    }

    expect(state.safe).toEqual(['Ty']);
    expect(state.live).not.toContain('Ty');
    expect(whoseTurn(state)).toBe('Honza');
  });

  it('ends with the last one standing holding the bill', () => {
    let state = startDice(PLAYERS);
    // Ty gets safe first, then Honza. Petr never wins a round.
    for (let round = 0; round < TARGET_WINS; round += 1) state = playRound(state, [12, 5, 3]);
    for (let round = 0; round < TARGET_WINS; round += 1) state = playRound(state, [12, 3]);

    expect(state.paying).toBe('Petr');
    expect(isOver(state)).toBe(true);
  });

  it('can end with nobody paying when the last two get safe together', () => {
    // Both cross the line in the same round. Nobody is left to pay, and that is
    // a legitimate ending rather than a state to patch around.
    let state = startDice([PLAYERS[0], PLAYERS[1]]);
    for (let round = 0; round < TARGET_WINS; round += 1) state = playRound(state, [12, 12]);

    expect(state.safe).toEqual(['Ty', 'Honza']);
    expect(state.paying).toBeNull();
    expect(isOver(state)).toBe(true);
  });

  it('never scores anything but round wins', () => {
    // Not sips, not how much anyone drank. The board is the ladder, nothing else.
    let state = startDice(PLAYERS);
    state = playRound(state, [12, 4, 3]);

    expect(standings(state)).toEqual([
      { name: 'Ty', score: 1 },
      { name: 'Honza', score: 0 },
      { name: 'Petr', score: 0 },
    ]);
  });
});
