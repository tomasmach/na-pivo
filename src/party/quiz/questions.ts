/**
 * Otázky do pub kvízu.
 *
 * Bundled with the app, not fetched: everyone at the table has to see the same
 * question at the same moment, and a pub is exactly where the signal is worst.
 * The network carries who answered what — four bytes — never the content.
 *
 * What the pack is trying to be: pub trivia a Czech table can actually argue
 * about. Beer and pubs are the spine, but not all of it — a quiz that is only
 * about beer runs out after two rounds and stops being a quiz. No dates nobody
 * could know, no questions that are really a vocabulary test, and every wrong
 * answer plausible enough to be worth choosing.
 *
 * `answer` is an index into `options`. Kept as data rather than a flag on the
 * option so a question cannot end up with two right answers.
 */

export interface QuizQuestion {
  id: string;
  text: string;
  options: readonly string[];
  /** Index into `options`. */
  answer: number;
}

export const QUIZ_QUESTIONS: readonly QuizQuestion[] = [
  {
    id: 'q-plzen',
    text: 'V kterém roce se poprvé uvařil Pilsner Urquell?',
    options: ['1842', '1869', '1795', '1901'],
    answer: 0,
  },
  {
    id: 'q-stupne',
    text: 'Co udávají stupně u piva?',
    options: ['Obsah alkoholu', 'Cukernatost mladiny', 'Teplotu kvašení', 'Množství chmele'],
    answer: 1,
  },
  {
    id: 'q-chmel',
    text: 'Která oblast je nejznámější českou chmelařskou?',
    options: ['Znojemsko', 'Mělnicko', 'Žatecko', 'Kladensko'],
    answer: 2,
  },
  {
    id: 'q-spotreba',
    text: 'Kolikátá je Česko ve spotřebě piva na hlavu ve světě?',
    options: ['Třetí', 'Osmé', 'Patnácté', 'První'],
    answer: 3,
  },
  {
    id: 'q-tank',
    text: 'Co znamená „tankové pivo"?',
    options: [
      'Pivo čepované přímo z velkoobjemového tanku',
      'Pivo z kovového sudu',
      'Pivo s vyšším tlakem',
      'Pivo vařené na zakázku',
    ],
    answer: 0,
  },
  {
    id: 'q-lezak',
    text: 'Jak dlouho se tradičně leží ležák?',
    options: ['Několik hodin', 'Několik dní', 'Několik týdnů', 'Několik let'],
    answer: 2,
  },
  {
    id: 'q-cistonos',
    text: 'Jak se říká pěně, která zůstane na sklenici po douškách?',
    options: ['Čepice', 'Krajka', 'Věnec', 'Klobouk'],
    answer: 1,
  },
  {
    id: 'q-svetle',
    text: 'Který pivní styl vznikl v Plzni?',
    options: ['Pšeničné pivo', 'Stout', 'Porter', 'Světlý ležák'],
    answer: 3,
  },
  {
    id: 'q-hospoda',
    text: 'Co je „šnyt"?',
    options: [
      'Malé pivo s vysokou vrstvou pěny',
      'Pivo bez pěny',
      'Malé pivo pro řidiče',
      'Pivo s limonádou',
    ],
    answer: 0,
  },
  {
    id: 'q-mlyn',
    text: 'Které město se pyšní nejstarším činným pivovarem v Česku?',
    options: ['Žatec', 'Broumov', 'Rakovník', 'Plzeň'],
    answer: 1,
  },
  {
    id: 'q-svatek',
    text: 'Kdy se v Česku slaví Den českého piva?',
    options: ['1. května', '17. listopadu', '27. září', '6. ledna'],
    answer: 2,
  },
  {
    id: 'q-slad',
    text: 'Z čeho se vyrábí slad?',
    options: ['Z chmele', 'Z kvasnic', 'Z bramborového škrobu', 'Z naklíčeného obilí'],
    answer: 3,
  },
];
