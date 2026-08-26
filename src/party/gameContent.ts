/**
 * What the games actually SAY.
 *
 * Content, not code: prompts, categories, rules and cards, in Czech, tykání.
 * Bundled with the app rather than fetched, because the one place these are
 * needed is a table in a pub where the signal is bad and nobody is going to
 * wait for a deck to download.
 *
 * The line every pack walks: this is a drinking game app, so the prompts are
 * about drinking and about the table — but never about HOW MUCH. Nothing here
 * dares anyone to down anything, nothing scores whoever drank most, and nothing
 * is funny at the expense of somebody at the table who did not choose to play.
 * "Kdo si dneska otevřel pivo poslední" is a joke; "vypij ex" is a liability.
 *
 * Deliberately absent: anything sexual, anything about exes, anything that
 * needs someone to disclose something they would regret in the morning. A pub
 * quiz app does not need to be a confession booth to be funny.
 */

import { t } from '@/i18n';

/** "Nikdy jsem…" — you say it, and whoever HAS done it clinks. */
export const NEVER_PROMPTS: readonly string[] = t.gameContent.never;

/** "Kategorie" — someone names one, you go round until somebody stalls. */
export const CATEGORY_PROMPTS: readonly string[] = t.gameContent.categories;

/** "Pravidlo večera" — one rule, and it holds until morning. */
export const RULE_PROMPTS: readonly string[] = t.gameContent.rules;

/**
 * King's Cup, one rule per card.
 *
 * The classic deck, cleaned up: every rule is something the TABLE does, and the
 * ones that traditionally single out one person into drinking a lot are turned
 * into rules that spread the silliness instead.
 *
 * The rank stays here and only the words are translated: card ids are built
 * from it and a reconnect has to find the same card it drew before.
 */
export const KINGS_CARDS: readonly {
  card: string;
  title: string;
  rule: string;
}[] = [
  { card: 'A', ...t.gameContent.kings.ace },
  { card: '2', ...t.gameContent.kings.two },
  { card: '3', ...t.gameContent.kings.three },
  { card: '4', ...t.gameContent.kings.four },
  { card: '5', ...t.gameContent.kings.five },
  { card: '6', ...t.gameContent.kings.six },
  { card: '7', ...t.gameContent.kings.seven },
  { card: '8', ...t.gameContent.kings.eight },
  { card: '9', ...t.gameContent.kings.nine },
  { card: '10', ...t.gameContent.kings.ten },
  { card: 'J', ...t.gameContent.kings.jack },
  { card: 'Q', ...t.gameContent.kings.queen },
  { card: 'K', ...t.gameContent.kings.king },
];

export const KINGS_SUITS = ['clubs', 'diamonds', 'hearts', 'spades'] as const;

/** One physical deck. Stable ids make a reconnect preserve every card already drawn. */
export const KINGS_DECK = KINGS_SUITS.flatMap((suit) =>
  KINGS_CARDS.map((rule) => ({
    id: `${suit}-${rule.card}`,
    suit,
    rank: rule.card,
    title: rule.title,
    rule: rule.rule,
  })),
);

export function kingsDeck(seed: number): (typeof KINGS_DECK)[number][] {
  const deck = [...KINGS_DECK];
  let state = seed || 1;
  for (let index = deck.length - 1; index > 0; index -= 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const picked = Math.abs(state) % (index + 1);
    [deck[index], deck[picked]] = [deck[picked], deck[index]];
  }
  return deck;
}

/** One card, because Palec is a rule, not a round. */
export const THUMB_PROMPTS: readonly string[] = t.gameContent.thumb;

/**
 * The pack a game draws from. Keyed by catalogue key so a game is content plus
 * a shell, never its own screen.
 */
export const GAME_PROMPTS: Record<string, readonly string[]> = {
  never: NEVER_PROMPTS,
  categories: CATEGORY_PROMPTS,
  rules: RULE_PROMPTS,
  thumb: THUMB_PROMPTS,
};
