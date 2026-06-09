/**
 * Czech UI strings. Source of truth for every user-facing word in the app.
 * Structured by screen/component so adding a second locale later is trivial.
 */

export const cs = {
  appName: 'Na pivo',

  compass: {
    headerTitle: 'na pivo',
    hiddenPubHint: 'Ťukni pro odhalení',
    distanceCaption: {
      nearest: 'do nejbližšího piva',
      surprise: 'do tvého náhodného piva',
    },
    modeNearest: 'Nejbližší',
    modeSurprise: 'Překvap mě',
    rerollLabel: 'Vyber jinou hospodu',
    settingsLabel: 'Nastavení',
    openInMaps: 'Otevřít v mapách',
    calibrationHint: 'Otoč telefonem do osmičky pro kalibraci kompasu',
    openNow: 'Otevřeno',
    openUntil: (t: string) => `Otevřeno do ${t}`,
    closedNow: 'Zavřeno',
    closedUntil: (t: string) => `Zavřeno · otevře v ${t}`,
    hoursUnknown: 'Otevírací doba neznámá',
  },

  permissions: {
    title: 'Potřebujeme tvoji polohu',
    body: 'Bez polohy neumíme namířit šipku k hospodě. Tvoje poloha nikdy neopouští telefon.',
    cta: 'Povolit polohu',
    openSettings: 'Otevřít Nastavení',
  },

  celebration: {
    eyebrow: 'DORAZIL JSI DO',
    headlineLine1: 'Na',
    headlineLine2: 'zdraví!',
    subtitle: 'Dej si jedno za nás',
    backToCompass: 'Zpět na kompas',
    openInMaps: 'Otevřít v mapách',
  },

  empty: {
    headlineLine1: 'Tady se',
    headlineLine2: 'nenapiješ',
    body: 'V tvém okolí jsme nenašli hospodu. Zkus to znovu nebo uprav dosah v nastavení.',
    searchFailedHeadlineLine1: 'Hledání',
    searchFailedHeadlineLine2: 'spadlo',
    searchFailedBody:
      'Nepodařilo se stáhnout hospody. Zkontroluj připojení a zkus to znovu.',
    openSettings: 'Otevřít nastavení',
    retry: 'Zkusit znovu',
  },

  settings: {
    title: 'Nastavení',
    distance: {
      header: 'MAXIMÁLNÍ VZDÁLENOST',
      helper: 'Hledáme hospody jen v této vzdálenosti od tebe.',
      unlimited: 'Bez limitu',
      kmShort: 'km',
      mShort: 'm',
      rangeMin: '500 m',
      rangeMax: '∞',
    },
    haptics: {
      title: 'Vibrace u cíle',
      subtitle: 'Zachrochtá ti to v kapse',
    },
    sound: {
      title: 'Zvuk cinknutí',
      subtitle: 'Drobné „cink“ u cíle',
    },
    hideClosed: {
      title: 'Skrýt zavřené hospody',
      subtitle: 'Ukázat jen otevřené a ty s neznámou dobou',
    },
    about: {
      title: 'O appce',
    },
    privacy: 'Soukromí',
    footer: 'Bez reklam · Bez placení',
    attribution: 'Data o místech: Mapy.cz (Seznam.cz). Otevírací doba: samostatné vyhledávání.',
  },

  privacy: {
    title: 'Soukromí',
    body: [
      'Žádná analytika, žádné sledování, žádný účet.',
      'Tvoje poloha je zpracována výhradně přímo v telefonu. Aplikace ji nikam neposílá a nikde neukládá.',
      'Pro stažení okolních hospod aplikace posílá přibližnou oblast vyhledávání na Mapy.cz.',
      'Pro zobrazení otevírací doby aplikace pošle název a polohu vybrané hospody na vlastní server provozovatele, který dohledá otevírací dobu.',
    ],
    contactLabel: 'Kontakt',
    contactEmail: 'tomades1@gmail.com',
  },

  a11y: {
    compassArrow: (pubName: string, distance: string) =>
      `Kompas mířící k hospodě ${pubName}, ${distance}.`,
    compassArrowHidden: (distance: string) =>
      `Šipka kompasu míří k hospodě, vzdálenost ${distance}.`,
    pubPillHidden: 'Skrytá hospoda, ťukni pro odhalení',
    pubPillRevealed: (pubName: string) => `${pubName}, ťukni pro otevření v mapách`,
    openStatus: (status: string) => `Stav otevírací doby: ${status}`,
    toggleOn: 'zapnuto',
    toggleOff: 'vypnuto',
    settingsButton: 'Otevřít nastavení',
    rerollButton: 'Vyber jinou hospodu',
    skipButton: 'Přeskočit na další hospodu',
    skipButtonHint: 'Vynechá tuhle hospodu a najde další nejbližší',
    backButton: 'Zpět',
    modeNearestButton: 'Mód: Nejbližší hospoda',
    modeSurpriseButton: 'Mód: Překvap mě',
  },
} as const;

export type Strings = typeof cs;
