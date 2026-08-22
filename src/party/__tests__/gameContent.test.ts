import { kingsDeck, KINGS_CARDS, KINGS_DECK } from '@/party/gameContent';
import { findGame } from '@/party/gameCatalog';

describe("King's Cup deck", () => {
  it('contains 52 stable cards and exactly four kings', () => {
    expect(KINGS_CARDS).toHaveLength(13);
    expect(KINGS_DECK).toHaveLength(52);
    expect(new Set(KINGS_DECK.map((card) => card.id)).size).toBe(52);
    expect(KINGS_DECK.filter((card) => card.rank === 'K')).toHaveLength(4);
  });

  it('deals deterministically from the shared game seed', () => {
    expect(kingsDeck(17)).toEqual(kingsDeck(17));
    expect(kingsDeck(17)).not.toEqual(kingsDeck(18));
  });

  it('says the same fourth-king outcome in the lobby and on the card', () => {
    expect(findGame('kings')?.how).toContain('platí rundu');
    expect(KINGS_CARDS.find((card) => card.card === 'K')?.rule).toContain('platí rundu');
  });
});
