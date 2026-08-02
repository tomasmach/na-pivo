/**
 * The games catalogue — the single source of truth for what a table can play.
 *
 * Games are the cheapest thing in the product: no server, no storage, and they
 * are the only reason the rest of the table installs the app.
 *
 * Every game declares HOW IT IS SCORED, because that decides what it leaves
 * behind and therefore what the recap and the feed can lead with:
 *
 *   `points`   somebody wins on a tally — a real scoreboard
 *   `drinks`   nobody wins; the game hands out sips, so what it leaves is the
 *              round itself, not a ranking
 *
 * That distinction is not cosmetic. Printing a "winner" for Nikdy jsem… would
 * mean crowning whoever drank most, which is the one scoreboard this product
 * must never keep.
 *
 * `cover` is a two-stop gradient rather than artwork. Twenty illustrated covers
 * is the badge problem again (see `docs/badge-art-brief.md`) and it is not worth
 * paying twice; a warm gradient with the glyph on it reads as a cover, ships
 * today, and can be swapped for a picture later without touching the grid.
 */

import type { ComponentType } from 'react';

import {
  BeerIcon,
  CoinsIcon,
  CrownIcon,
  HandMetalIcon,
  SparklesIcon,
  TrophyIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';

/** How a game ends. See the note above — this is a product rule, not a flag. */
export type GameScoring = 'points' | 'drinks';

export interface GameDef {
  key: string;
  name: string;
  blurb: string;
  /** One line of rules, so nobody has to remember how it goes. */
  how: string;
  scoring: GameScoring;
  /** Cover gradient, top-left → bottom-right. */
  cover: readonly [string, string];
  Icon: ComponentType<{ size?: number; color: string }>;
}

export const GAME_CATALOG: readonly GameDef[] = [
  {
    key: 'quiz',
    name: 'Pub kvíz',
    blurb: 'Deset otázek, kdo víc.',
    how: 'Někdo čte otázky, ostatní hádají. Bod za správnou odpověď.',
    scoring: 'points',
    cover: ['#8A5A18', '#3A2410'],
    Icon: TrophyIcon,
  },
  {
    key: 'dice',
    name: 'Kostky',
    blurb: 'Klasika. Nejvyšší bere.',
    how: 'Každý hodí. Nejvyšší bere bod, nejnižší platí rundu.',
    scoring: 'points',
    cover: ['#7A4E18', '#2E1D0E'],
    Icon: CoinsIcon,
  },
  {
    key: 'categories',
    name: 'Kategorie',
    blurb: 'Kdo se zasekne, pije.',
    how: 'Někdo řekne kategorii. Dokola jmenujete, kdo se zasekne, pije.',
    scoring: 'drinks',
    cover: ['#6B4A22', '#2A1C10'],
    Icon: SparklesIcon,
  },
  {
    key: 'never',
    name: 'Nikdy jsem…',
    blurb: 'Kdo to udělal, pije.',
    how: 'Řekneš, co jsi nikdy nedělal. Kdo ano, ťukne si.',
    scoring: 'drinks',
    cover: ['#5E4326', '#241A10'],
    Icon: HandMetalIcon,
  },
  {
    key: 'kings',
    name: 'King’s Cup',
    blurb: 'Karty a pravidla, co si vymyslíte.',
    how: 'Taháte karty, každá má pravidlo. Král doprostřed, čtvrtý pije.',
    scoring: 'drinks',
    cover: ['#7A3E2A', '#2C1A12'],
    Icon: CrownIcon,
  },
  {
    key: 'bottle',
    name: 'Flaška',
    blurb: 'Točí se, ukáže, ptá se.',
    how: 'Roztoč. Na koho ukáže, odpovídá — nebo pije.',
    scoring: 'drinks',
    cover: ['#4E4A24', '#1E1C10'],
    Icon: BeerIcon,
  },
  {
    key: 'thumb',
    name: 'Palec',
    blurb: 'Kdo si všimne poslední, pije.',
    how: 'Nenápadně polož palec na stůl. Poslední, kdo si všimne, pije.',
    scoring: 'drinks',
    cover: ['#3F4A2E', '#191E12'],
    Icon: UsersIcon,
  },
  {
    key: 'rules',
    name: 'Pravidlo večera',
    blurb: 'Jedno pravidlo, platí do rána.',
    how: 'Vymyslete pravidlo — třeba „žádná jména“. Kdo ho poruší, pije.',
    scoring: 'drinks',
    cover: ['#6A3550', '#281426'],
    Icon: SparklesIcon,
  },
];

export function findGame(key: string): GameDef | undefined {
  return GAME_CATALOG.find((game) => game.key === key);
}
