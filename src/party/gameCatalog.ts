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
 * Each game has its own linocut artwork, shared by the cover and the stage.
 */

import type { ComponentType } from 'react';

import { t } from '@/i18n';
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

/**
 * WHICH SCREEN a game is, of the three that exist.
 *
 * Eight games, three shells. A game is content plus a shell, never its own
 * screen — the ninth game should be a row in this file and a list of prompts,
 * not another folder. It is also what keeps every game feeding the same event
 * log, so sharing a game with the table needed no per-game backend.
 *
 *   `score`   a tally: tap a name, they get a point
 *   `prompt`  a deck: one big card at a time, and a way to the next one
 *   `draw`    chance: dice, a bottle, a card off the top
 */
export type GameShell = 'score' | 'prompt' | 'draw' | 'turns' | 'pick' | 'quiz';

/** What `draw` draws. */
export type GameDraw = 'person' | 'card';

export interface GameDef {
  key: string;
  name: string;
  blurb: string;
  /** One line of rules, so nobody has to remember how it goes. */
  how: string;
  scoring: GameScoring;
  shell: GameShell;
  draw?: GameDraw;
  /** The line the shell shows before the first tap. Short — it is read once. */
  intro?: string;
  /** Cover gradient, top-left → bottom-right. */
  cover: readonly [string, string];
  Icon: ComponentType<{ size?: number; color: string }>;
}

/** Shared availability flag for the catalog and direct game routes. */
export const GAMES_COMING_SOON = false;

export const GAME_CATALOG: readonly GameDef[] = [
  {
    key: 'quiz',
    name: t.games.quiz.name,
    blurb: t.games.quiz.blurb,
    how: t.games.quiz.how,
    shell: 'quiz',
    intro: t.games.quiz.intro,
    scoring: 'points',
    cover: ['#8A5A18', '#3A2410'],
    Icon: TrophyIcon,
  },
  {
    key: 'dice',
    name: t.games.dice.name,
    blurb: t.games.dice.blurb,
    how: t.games.dice.how,
    shell: 'turns',
    intro: t.games.dice.intro,
    scoring: 'points',
    cover: ['#7A4E18', '#2E1D0E'],
    Icon: CoinsIcon,
  },
  {
    key: 'categories',
    name: t.games.categories.name,
    blurb: t.games.categories.blurb,
    how: t.games.categories.how,
    shell: 'prompt',
    intro: t.games.categories.intro,
    scoring: 'drinks',
    cover: ['#6B4A22', '#2A1C10'],
    Icon: SparklesIcon,
  },
  {
    key: 'never',
    name: t.games.never.name,
    blurb: t.games.never.blurb,
    how: t.games.never.how,
    shell: 'prompt',
    intro: t.games.never.intro,
    scoring: 'drinks',
    cover: ['#5E4326', '#241A10'],
    Icon: HandMetalIcon,
  },
  {
    key: 'kings',
    name: t.games.kings.name,
    blurb: t.games.kings.blurb,
    how: t.games.kings.how,
    shell: 'draw',
    draw: 'card',
    intro: t.games.kings.intro,
    scoring: 'drinks',
    cover: ['#7A3E2A', '#2C1A12'],
    Icon: CrownIcon,
  },
  {
    key: 'round',
    name: t.games.round.name,
    blurb: t.games.round.blurb,
    how: t.games.round.how,
    scoring: 'drinks',
    shell: 'pick',
    intro: t.games.round.intro,
    cover: ['#7A5A20', '#2C2010'],
    Icon: CoinsIcon,
  },
  {
    key: 'bottle',
    name: t.games.bottle.name,
    blurb: t.games.bottle.blurb,
    how: t.games.bottle.how,
    shell: 'pick',
    intro: t.games.bottle.intro,
    scoring: 'drinks',
    cover: ['#4E4A24', '#1E1C10'],
    Icon: BeerIcon,
  },
  {
    key: 'thumb',
    name: t.games.thumb.name,
    blurb: t.games.thumb.blurb,
    how: t.games.thumb.how,
    shell: 'prompt',
    intro: t.games.thumb.intro,
    scoring: 'drinks',
    cover: ['#3F4A2E', '#191E12'],
    Icon: UsersIcon,
  },
  {
    key: 'rules',
    name: t.games.rules.name,
    blurb: t.games.rules.blurb,
    how: t.games.rules.how,
    shell: 'prompt',
    intro: t.games.rules.intro,
    scoring: 'drinks',
    cover: ['#6A3550', '#281426'],
    Icon: SparklesIcon,
  },
];

export function findGame(key: string): GameDef | undefined {
  return GAME_CATALOG.find((game) => game.key === key);
}

/**
 * Night records persist the game name as it was when the game hit the table,
 * so a night logged in Czech would otherwise show Czech names in an English
 * UI. Prefer the catalogue name for the key; keep the stored one for games the
 * catalogue no longer knows.
 */
export function gameDisplayName(game: { key: string; name: string }): string {
  return findGame(game.key)?.name ?? game.name;
}
