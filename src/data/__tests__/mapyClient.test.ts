/**
 * Name + label classification for Mapy.cz POIs (isAcceptablePubName).
 *
 * The heuristic decides whether a suggested place survives filtering before it
 * ever reaches the compass. The table below is built from REAL names seen in
 * live Mapy.cz /v1/suggest responses, split into the ones that must be KEPT
 * (a real pub / half-restaurant / a positive beer keyword) and the ones that
 * must be DROPPED (cafés, sushi, shisha lounges, fast-food chains).
 *
 * Decision logic under test (see mapyClient.ts):
 *   1. Hard chain blocklist → always out (every label).
 *   2. A positive beer keyword in the name → always in (overrides negatives).
 *   3. Trusted labels (Hospoda / Pivnice / Pivovar) → in without negative check.
 *   4. Screened labels (Restaurace a pohostinství / Bar / Klub) → out on a
 *      negative keyword, otherwise in. Pizza is intentionally NOT a negative.
 */

import { isAcceptablePubName } from '../mapyClient';

const REST = 'Restaurace a pohostinství';
const BAR = 'Bar';

describe('isAcceptablePubName — must KEEP (live data)', () => {
  it.each([
    // Village "Restaurace …" — often the only pub around; recall must hold.
    ['Restaurace tankovna Modrá kočka', REST],
    ['Restaurace Sokolovna', REST],
    ['Restaurace na růžku', REST],
    ['Restaurace Nový Rybník', REST],
    ['Restaurace Království', REST],
    ['Restaurace U Fleků', REST],
    // Positive beer keywords win even under a screened label.
    ['Hospůdka Nad Viktorkou', REST],
    ['Vinohradský pivovar', REST],
    ['Pivnice U SADU', REST],
    ['Turnovská pivnice Churchill', REST],
    ['Woodoo music pub', BAR],
    ['Bohužel Bar', BAR],
    // Pizza is deliberately not a negative — left to the backend verdict.
    ['Pizzeria Vende Maria', REST],
    // No negative keyword, screened label → kept by default.
    ['U KURELŮ', REST],
  ])('keeps "%s" (label %s)', (name, label) => {
    expect(isAcceptablePubName(name, label)).toBe(true);
  });

  it.each([
    // Curated pub labels are trusted as-is, no negative screening.
    ['Hospoda U Černého vola', 'Hospoda'],
    ['Pivnice Cinská', 'Pivnice'],
    ['Pivovar Sushi House', 'Pivovar'],
  ])('trusts curated label name "%s" (label %s)', (name, label) => {
    expect(isAcceptablePubName(name, label)).toBe(true);
  });
});

describe('isAcceptablePubName — must DROP (live data)', () => {
  it.each([
    ['Sushi Sushi', REST],
    ['Thien Long 1 Asia Bistro', REST],
    ['Bistrotéka', REST],
    ['OPSO SHISHA LOUNGE BAR', BAR],
    ['Fumée Lounge Shisha & Cocktail Bar', BAR],
    ['Kafe v Presu', BAR],
    ['Zahrada - café & bistro', REST],
    // Hard chain blocklist — always out.
    ["mcdonald's", REST],
  ])('drops "%s" (label %s)', (name, label) => {
    expect(isAcceptablePubName(name, label)).toBe(false);
  });
});

describe('isAcceptablePubName — matching mechanics', () => {
  it('matches punctuation-glued keywords (e.g. "Kafe•Akropolis")', () => {
    expect(isAcceptablePubName('Kafe•Akropolis', BAR)).toBe(false);
  });

  it('is diacritics-insensitive ("Kávárna U lípy" reads as a café)', () => {
    expect(isAcceptablePubName('Kávárna U lípy', REST)).toBe(false);
  });

  it('lets "pivo" absorb the whole beer family ("pivovar", "pivnice")', () => {
    expect(isAcceptablePubName('Měšťanský pivovar', REST)).toBe(true);
    expect(isAcceptablePubName('Malá pivnice', BAR)).toBe(true);
  });

  it('does not let a short keyword leak into an unrelated word', () => {
    expect(isAcceptablePubName('Restaurace Pohoda', REST)).toBe(true);
    // "kava" is exact-match only: real pub names starting with the same
    // letters must survive, while a literal "káva" still reads as a café.
    expect(isAcceptablePubName('Restaurace Kavalír', REST)).toBe(true);
    expect(isAcceptablePubName('Kavka Bar', BAR)).toBe(true);
    expect(isAcceptablePubName('Dobrá káva', REST)).toBe(false);
  });

  it('a positive keyword overrides a negative one in the same name', () => {
    // "Pivnice" (positive) beats "bistro" (negative).
    expect(isAcceptablePubName('Pivnice & Bistro', BAR)).toBe(true);
  });

  it('applies negatives only to screened labels, not curated pub labels', () => {
    // Same café-ish name: dropped under Bar, kept under the trusted Hospoda.
    expect(isAcceptablePubName('Kavárna roh', BAR)).toBe(false);
    expect(isAcceptablePubName('Kavárna roh', 'Hospoda')).toBe(true);
  });

  it('hard chain blocklist beats everything, every label', () => {
    expect(isAcceptablePubName('Starbucks Reserve', 'Hospoda')).toBe(false);
    expect(isAcceptablePubName('KFC', BAR)).toBe(false);
  });
});
