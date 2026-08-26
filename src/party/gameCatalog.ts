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

/**
 * 2.0.0 ships the table games locked. They are visible in the sheet so the
 * table knows what is coming, but nothing can be placed or played until the
 * screens are finished. Flip to `false` to release them.
 */
export const GAMES_COMING_SOON = true;

export const GAME_CATALOG: readonly GameDef[] = [
  {
    key: 'quiz',
    name: 'Pub kvíz',
    blurb: 'Každý na svém. Kdo ví víc.',
    how: 'Stejná otázka na všech telefonech. Ťukneš odpověď a zamkne se. Odhalí se, až odpoví všichni.',
    shell: 'quiz',
    intro: 'Odpovídáš za sebe. Nikdo neuvidí, co jsi ťuknul, dokud neodpoví všichni.',
    scoring: 'points',
    cover: ['#8A5A18', '#3A2410'],
    Icon: TrophyIcon,
  },
  {
    key: 'dice',
    name: 'Kostky',
    blurb: 'Kdo zůstane, platí.',
    how: 'Každý hodí. Nejvyšší bere kolo. Kdo vyhraje třikrát, je z obliga. Kdo zbude poslední, platí rundu.',
    shell: 'turns',
    intro: 'Třikrát vyhraješ kolo a máš klid.',
    scoring: 'points',
    cover: ['#7A4E18', '#2E1D0E'],
    Icon: CoinsIcon,
  },
  {
    key: 'categories',
    name: 'Kategorie',
    blurb: 'Kdo se zasekne, bere bod.',
    how: 'Někdo řekne kategorii. Dokola jmenujete, kdo se zasekne, bere bod.',
    shell: 'prompt',
    intro: 'Kdo se zasekne, ťukne si.',
    scoring: 'drinks',
    cover: ['#6B4A22', '#2A1C10'],
    Icon: SparklesIcon,
  },
  {
    key: 'never',
    name: 'Nikdy jsem…',
    blurb: 'Kdo to udělal, přizná to.',
    how: 'Řekneš, co jsi nikdy nedělal. Kdo ano, zvedne ruku.',
    shell: 'prompt',
    intro: 'Kdo to udělal, zvedne ruku.',
    scoring: 'drinks',
    cover: ['#5E4326', '#241A10'],
    Icon: HandMetalIcon,
  },
  {
    key: 'kings',
    name: 'King’s Cup',
    blurb: 'Karty a pravidla, co si vymyslíte.',
    how: 'Taháte karty, každá má pravidlo. Král doprostřed, čtvrtý platí rundu.',
    shell: 'draw',
    draw: 'card',
    intro: 'Táhni kartu. Co je na ní, to platí.',
    scoring: 'drinks',
    cover: ['#7A3E2A', '#2C1A12'],
    Icon: CrownIcon,
  },
  {
    key: 'round',
    name: 'Kdo platí rundu',
    blurb: 'Jména běží bubnem. Někdo to zaplatit musí.',
    how: 'Roztoč buben se jmény. Až zpomalí a zastaví, vybraný člověk platí rundu.',
    scoring: 'drinks',
    shell: 'pick',
    intro: 'Jména proběhnou bubnem. Někdo to zaplatit musí.',
    cover: ['#7A5A20', '#2C2010'],
    Icon: CoinsIcon,
  },
  {
    key: 'bottle',
    name: 'Flaška',
    blurb: 'Točí se, ukáže, ptá se.',
    how: 'Roztoč. Na koho ukáže, ten odpovídá na jednu otázku od stolu.',
    shell: 'pick',
    intro: 'Roztoč. Na koho ukáže, ten je na řadě.',
    scoring: 'drinks',
    cover: ['#4E4A24', '#1E1C10'],
    Icon: BeerIcon,
  },
  {
    key: 'thumb',
    name: 'Palec',
    blurb: 'Kdo si všimne poslední, ukloní se.',
    how: 'Nenápadně polož palec na stůl. Poslední, kdo si všimne, ukloní se hospodě.',
    shell: 'prompt',
    intro: 'Polož palec na stůl. Nenápadně.',
    scoring: 'drinks',
    cover: ['#3F4A2E', '#191E12'],
    Icon: UsersIcon,
  },
  {
    key: 'rules',
    name: 'Pravidlo večera',
    blurb: 'Jedno pravidlo, platí do rána.',
    how: 'Vymyslete pravidlo, třeba „žádná jména“. Kdo ho poruší, ukloní se.',
    shell: 'prompt',
    intro: 'Jedno pravidlo, platí do rána.',
    scoring: 'drinks',
    cover: ['#6A3550', '#281426'],
    Icon: SparklesIcon,
  },
];

export function findGame(key: string): GameDef | undefined {
  return GAME_CATALOG.find((game) => game.key === key);
}
