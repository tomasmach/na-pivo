/**
 * DESIGN MOCK — the challenges, shared by the Komunita list and the detail.
 *
 * One module so the list and the detail cannot drift: the card you tap and the
 * screen you land on show the same numbers, which is the whole reason a detail
 * feels trustworthy.
 *
 * A challenge is deliberately about VARIETY and RHYTHM — new pubs, new
 * breweries, turning up on a Thursday — never about how much you drank. The
 * leaderboard already counts beers; a challenge that also counted them would
 * turn the game into a drinking contest with a progress bar.
 */

const AVATARS = 'https://i.pravatar.cc/160?img=';

export interface ChallengeRival {
  handle: string;
  avatar: string;
  done: number;
  me?: boolean;
}

/**
 * The glyph on the card.
 *
 * One per challenge, and it says what the challenge IS — a pin for new places,
 * a calendar for a rhythm, a beer for breweries. The same sparkle on all three
 * was decoration standing in for a thought: it told you a card was a card.
 */
export type ChallengeGlyph = 'places' | 'rhythm' | 'taste';

export interface Challenge {
  id: string;
  title: string;
  glyph: ChallengeGlyph;
  /** The one-line summary the card shows: deadline · progress. */
  detail: string;
  /** 0–1, for the track. */
  progress: number;
  done: number;
  goal: number;
  /** Plural noun for the goal, so "4 z 10" can read "4 z 10 hospod". */
  unit: string;
  /** The pitch. Czech, hospodský, no coaching voice. */
  blurb: string;
  deadline: string;
  reward: string;
  /** What ticks the counter. Rules in plain sentences, not a legal list. */
  counts: string[];
  rivals: ChallengeRival[];
}

export const CHALLENGES: Challenge[] = [
  {
    id: 'c1',
    title: 'Deset nových hospod',
    glyph: 'places',
    detail: 'Do konce srpna · 4 z 10',
    progress: 0.4,
    done: 4,
    goal: 10,
    unit: 'hospod',
    blurb: 'Deset podniků, kde jsi ještě nikdy neseděl. Stálice se nepočítá, i kdyby tam čepovali líp.',
    deadline: 'Do 31. srpna',
    reward: 'Odznak Objevitel',
    counts: [
      'Hospoda, kterou nemáš v navštívených.',
      'Stačí jedno pivo — nemusíš tam trávit večer.',
      'Každý podnik jen jednou, i když se vrátíš.',
    ],
    rivals: [
      { handle: '@chmelák', avatar: `${AVATARS}50`, done: 7 },
      { handle: '@pěna', avatar: `${AVATARS}41`, done: 5 },
      { handle: '@ty', avatar: `${AVATARS}12`, done: 4, me: true },
      { handle: '@klárka', avatar: `${AVATARS}64`, done: 2 },
    ],
  },
  {
    id: 'c2',
    title: 'Tři čtvrtky po sobě',
    glyph: 'rhythm',
    detail: 'Série běží · 2 ze 3',
    progress: 0.66,
    done: 2,
    goal: 3,
    unit: 'čtvrtků',
    blurb: 'Čtvrtek je nejlepší den v týdnu a ty to víš. Tři za sebou a máš to černé na bílém.',
    deadline: 'Zbývá jeden čtvrtek',
    reward: 'Odznak Čtvrtkař',
    counts: [
      'Večer, který začne ve čtvrtek.',
      'Vynechaný čtvrtek sérii nuluje.',
      'Doma se nepočítá — musí to být podnik.',
    ],
    rivals: [
      { handle: '@ty', avatar: `${AVATARS}12`, done: 2, me: true },
      { handle: '@sudík', avatar: `${AVATARS}57`, done: 2 },
      { handle: '@mišák', avatar: `${AVATARS}26`, done: 1 },
    ],
  },
  {
    id: 'c3',
    title: 'Ochutnej pět pivovarů',
    glyph: 'taste',
    detail: 'Do konce srpna · 1 z 5',
    progress: 0.2,
    done: 1,
    goal: 5,
    unit: 'pivovarů',
    blurb: 'Pět různých pivovarů, které jsi letos ještě neměl. Ideální výmluva dát si něco jiného než obvykle.',
    deadline: 'Do 31. srpna',
    reward: 'Odznak Ochutnávač',
    counts: [
      'Pivovar, který letos nemáš v deníčku.',
      'Rozhoduje pivovar, ne značka ani styl.',
      'Půlka se počítá stejně jako velké.',
    ],
    rivals: [
      { handle: '@pěna', avatar: `${AVATARS}41`, done: 4 },
      { handle: '@klárka', avatar: `${AVATARS}64`, done: 3 },
      { handle: '@ty', avatar: `${AVATARS}12`, done: 1, me: true },
    ],
  },
];

export function findChallenge(id: string | undefined): Challenge | undefined {
  return CHALLENGES.find((challenge) => challenge.id === id);
}
