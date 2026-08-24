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

/** "Nikdy jsem…" — you say it, and whoever HAS done it clinks. */
export const NEVER_PROMPTS: readonly string[] = [
  'Nikdy jsem si nespletl hospodu a nečekal půl hodiny na někoho, kdo seděl jinde.',
  'Nikdy jsem neusnul v tramvaji a neprojel konečnou.',
  'Nikdy jsem nezpíval v hospodě nahlas něco, co neumím.',
  'Nikdy jsem si neobjednal pivo, které jsem si nedokázal přečíst.',
  'Nikdy jsem nezapomněl, kde mám bundu.',
  'Nikdy jsem netvrdil, že se vyznám v pivu, a pak si dal nejlevnější.',
  'Nikdy jsem se nepřidal ke stolu lidí, které jsem neznal.',
  'Nikdy jsem nevolal někomu ve dvě ráno „jenom na chvilku".',
  'Nikdy jsem si nedal k pivu něco, co se k němu vůbec nehodí.',
  'Nikdy jsem se nevsadil o rundu a nevyhrál.',
  'Nikdy jsem nešel „na jedno".',
  'Nikdy jsem si nepletl jména dvou lidí u jednoho stolu celý večer.',
  'Nikdy jsem nefotil jídlo v hospodě.',
  'Nikdy jsem se nevrátil do hospody pro telefon.',
  'Nikdy jsem netvrdil hospodskému, že tohle pivo je jinak natočené než minule.',
  'Nikdy jsem nešel domů pěšky přes celé město, protože „to je kousek".',
  'Nikdy jsem neslíbil, že příští kolo platím já, a pak toho nelitoval.',
  'Nikdy jsem nedělal, že znám kapelu, co hraje v rádiu.',
  'Nikdy jsem neseděl v hospodě, kde jsem nechápal, jak se objednává.',
  'Nikdy jsem nepřišel na sraz jako první a nedělal, že jsem taky dorazil pozdě.',
  'Nikdy jsem si nedal nealko a netvrdil, že to je jedno.',
  'Nikdy jsem se nehádal o to, která hospoda má lepší tank.',
  'Nikdy jsem neztratil účtenku a nedělal, že se to nestalo.',
  'Nikdy jsem si nenechal poradit pivo a pak toho nelitoval.',
  'Nikdy jsem netvrdil, že zítra vstávám brzo.',
];

/** "Kategorie" — someone names one, you go round until somebody stalls. */
export const CATEGORY_PROMPTS: readonly string[] = [
  'České pivovary',
  'Věci, co mají pěnu',
  'Důvody jít na jedno',
  'Co se dá dát k pivu',
  'Hospodské hlášky',
  'Města, kde jste byli na pivu',
  'Značky, co poznáte po chuti',
  'Věci, co nikdy nepatří do piva',
  'Výmluvy, proč jsi přišel pozdě',
  'Co se dá zapomenout v hospodě',
  'Typy hospodských',
  'Nápisy na tácku',
  'Věci, co dělá stůl, když se čeká na jídlo',
  'Pivní styly',
  'Co říct, když nevíš, co si dát',
  'Důvody jít domů',
  'Věci, co má každá hospoda',
  'Zvuky hospody',
  'Co se říká při přípitku',
  'Věci, co se nedají vysvětlit ráno',
];

/** "Pravidlo večera" — one rule, and it holds until morning. */
export const RULE_PROMPTS: readonly string[] = [
  'Žádná jména. Kdo někoho osloví jménem, ukloní se.',
  'Pivo se drží jen levou rukou.',
  'Nikdo neříká „pivo". Říkej si tomu, jak chceš, ale ne takhle.',
  'Před každým přípitkem musíš někomu poděkovat.',
  'Kdo se podívá na mobil, platí další rundu.',
  'Každý má přezdívku a jinak se na něj nesmí mluvit.',
  'Kdo řekne „ne", zvedne se a ukloní se.',
  'Nikdo nesmí ukazovat prstem.',
  'Kdo si sedne jinam, začíná nový večer.',
  'Každá věta musí začínat „prý".',
  'Kdo se zasměje nahlas, dělá další přípitek.',
  'Zákaz mluvit o práci. Kdo to zkusí, ukloní se.',
];

/**
 * King's Cup, one rule per card.
 *
 * The classic deck, cleaned up: every rule is something the TABLE does, and the
 * ones that traditionally single out one person into drinking a lot are turned
 * into rules that spread the silliness instead.
 */
export const KINGS_CARDS: readonly {
  card: string;
  title: string;
  rule: string;
}[] = [
  {
    card: 'A',
    title: 'Přípitek',
    rule: 'Zvedni sklo. Celý stůl se přidá a připije si na večer.',
  },
  {
    card: '2',
    title: 'Ty',
    rule: 'Vybereš jednoho. Všechno, co řekneš, musí do konce kola zopakovat on.',
  },
  { card: '3', title: 'Já', rule: 'Vymyslíš si nové jméno. Do konce hry jsi on.' },
  {
    card: '4',
    title: 'Podlaha',
    rule: 'Všichni sáhnou na zem. Poslední ukloní se celé hospodě.',
  },
  { card: '5', title: 'Kluci', rule: 'Zazpívají kluci u stolu jeden refrén.' },
  { card: '6', title: 'Holky', rule: 'Zazpívají holky u stolu jeden refrén.' },
  {
    card: '7',
    title: 'Nebe',
    rule: 'Všichni ruku nahoru. Poslední ukloní se.',
  },
  {
    card: '8',
    title: 'Kamarád',
    rule: 'Vyber si parťáka. Od teď jste tým a všechno říkáte oba najednou.',
  },
  {
    card: '9',
    title: 'Rým',
    rule: 'Řekni slovo. Dokola se rýmuje, kdo se zasekne, ukloní se.',
  },
  {
    card: '10',
    title: 'Kategorie',
    rule: 'Vyhlas kategorii. Kdo nic nevymyslí, ukloní se.',
  },
  {
    card: 'J',
    title: 'Pravidlo',
    rule: 'Vymysli pravidlo, které platí do konce hry.',
  },
  {
    card: 'Q',
    title: 'Otázky',
    rule: 'Až do další dámy odpovídáš jen otázkou.',
  },
  {
    card: 'K',
    title: 'Král',
    rule: 'Doprostřed. Čtvrtý král platí rundu pro stůl.',
  },
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
export const THUMB_PROMPTS: readonly string[] = [
  'Nenápadně polož palec na stůl. Poslední, kdo si všimne, ukloní se hospodě.',
];

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
