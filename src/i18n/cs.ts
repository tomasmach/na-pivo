/**
 * Czech UI strings. Source of truth for every user-facing word in the app.
 * Structured by screen/component so adding a second locale later is trivial.
 */

export const cs = {
  appName: 'Na pivo',

  common: {
    cancel: 'Zrušit',
  },

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
    reportProblem: 'Nahlásit problém',
    reportTitle: 'Nahlásit hospodu',
    reportBody: (pubName: string) =>
      `Schováme „${pubName}“ z kompasu. Co je špatně?`,
    reportClosed: 'Už nefunguje',
    reportNotPub: 'Nemají točené',
    calibrationHint: 'Otoč telefonem do osmičky pro kalibraci kompasu',
    openNow: 'Otevřeno',
    openUntil: (t: string) => `Otevřeno do ${t}`,
    closedNow: 'Zavřeno',
    closedUntil: (t: string) => `Zavřeno · otevře v ${t}`,
    hoursUnknown: 'Otevírací doba neznámá',
    contribute: 'Doplnit info',
    beerWithPrice: (name: string, price: string) => `🍺 ${name} · ${price}`,
    beerNoPrice: (name: string) => `🍺 ${name}`,
    beerAndMore: 'a další',
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
    feedback: 'Napiš nám / nahlas chybu',
    privacy: 'Soukromí',
    creator: {
      header: 'TVŮRCE',
      name: 'Tomáš Mach',
      instagram: 'Instagram',
      instagramUrl: 'https://www.instagram.com/jsem_mach/',
      linkedin: 'LinkedIn',
      linkedinUrl: 'https://www.linkedin.com/in/mach-tomas/',
    },
    footer: 'Bez reklam · Bez placení',
    // The Mapy.com logo is rendered inline between these two halves (replacing
    // the brand name), so the attribution reads "Data o místech: [logo]
    // (Seznam.cz). …" — see app/settings.tsx footer.
    attributionBefore: 'Data o místech:',
    attributionAfter: '(Seznam.cz). Otevírací doba: samostatné vyhledávání.',
  },

  report: {
    title: 'Napiš nám',
    intro: 'Našel jsi chybu nebo ti něco chybí? Napiš nám pár slov, pomůže to.',
    categoryBug: 'Chyba',
    categoryIdea: 'Nápad',
    categoryOther: 'Jiné',
    messagePlaceholder: 'Popiš, co se stalo nebo co ti chybí…',
    contactCaption: 'Kam ti můžeme odepsat? (nepovinné)',
    contactInstagram: 'Instagram',
    contactEmail: 'E-mail',
    contactInstagramPlaceholder: '@tvujprofil',
    contactEmailPlaceholder: 'tvuj@email.cz',
    submit: 'Odeslat',
    versionCaption: (version: string) => `Odesíláme i verzi aplikace: ${version}`,
    successTitle: 'Díky! 🍺',
    successBody:
      'Zpráva dorazí, i kdyby teď zrovna nebylo připojení — odešleme ji, jakmile budeš online.',
    successClose: 'Zavřít',
  },

  contribute: {
    title: 'Doplnit info',
    intro:
      'Doplň otevírací dobu nebo piva na čepu. Údaje uvidí ostatní, kteří k téhle hospodě dorazí.',
    hoursHeader: 'Otevírací doba',
    closedToggle: 'Zavřeno',
    addInterval: 'Přidat čas',
    copyToAll: 'Zkopírovat do všech dnů',
    from: 'Od',
    to: 'Do',
    days: {
      mo: 'Pondělí',
      tu: 'Úterý',
      we: 'Středa',
      th: 'Čtvrtek',
      fr: 'Pátek',
      sa: 'Sobota',
      su: 'Neděle',
    },
    daysShort: {
      mo: 'Po',
      tu: 'Út',
      we: 'St',
      th: 'Čt',
      fr: 'Pá',
      sa: 'So',
      su: 'Ne',
    },
    beersHeader: 'Piva na čepu',
    beerNamePlaceholder: 'Název piva, např. Pilsner Urquell 12°',
    pricePlaceholder: 'Cena (Kč)',
    priceLabel: 'Cena za',
    volumeSmall: '0,3 l',
    volumeLarge: '0,5 l',
    volumeOther: 'Jiné',
    addBeer: 'Přidat pivo',
    maxBeersReached: 'Víc piv už přidat nejde',
    save: 'Uložit',
    invalidHint: 'Zkontroluj zadané časy (formát HH:MM).',
    successTitle: 'Díky! 🍺',
    successBody: 'Díky! Údaje se propíšou všem — odešleme je, jakmile budeš online.',
    successClose: 'Zavřít',
  },

  whatsNew: {
    eyebrow: 'AKTUALIZACE',
    defaultTitle: 'Co je nového',
    cta: 'Paráda!',
  },

  privacy: {
    title: 'Soukromí',
    body: [
      'Žádná analytika, žádné sledování, žádný účet.',
      'Tvoje poloha je zpracována výhradně přímo v telefonu. Aplikace ji nikam neposílá a nikde neukládá.',
      'Pro stažení okolních hospod aplikace posílá přibližnou oblast vyhledávání na Mapy.cz.',
      'Pro zobrazení otevírací doby aplikace pošle název a polohu vybrané hospody na vlastní server provozovatele, který dohledá otevírací dobu.',
      'Aplikace vytvoří anonymní náhodný identifikátor zařízení a odešle ho na náš server, aby každému zařízení patřil dočasný účet. Identifikátor neobsahuje žádné osobní údaje a slouží jen k odlišení zařízení.',
      'Když dobrovolně doplníš otevírací dobu nebo piva na čepu, aplikace tyto údaje odešle na náš server pod anonymním účtem zařízení. Údaje se zobrazují veřejně ostatním uživatelům a neobsahují žádné osobní informace o tobě.',
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
    reportPubButton: 'Nahlásit problém s hospodou',
    contributePubButton: 'Doplnit otevírací dobu a piva',
    contributeBeersLine: (text: string) => `Piva na čepu: ${text}. Ťukni pro doplnění.`,
    contributeDayClosedToggle: (day: string) => `${day}: přepnout zavřeno`,
    contributeAddInterval: (day: string) => `${day}: přidat čas`,
    contributeRemoveInterval: (day: string) => `${day}: odebrat čas`,
    contributeCopyToAll: 'Zkopírovat časy z pondělí do všech dnů',
    contributeAddBeer: 'Přidat pivo',
    contributeRemoveBeer: 'Odebrat pivo',
    contributeSaveButton: 'Uložit doplněné údaje',
    feedbackButton: 'Napiš nám nebo nahlas chybu',
    feedbackCategory: (label: string) => `Kategorie: ${label}`,
    feedbackContactChannel: (label: string) => `Kontakt přes: ${label}`,
    feedbackContactInput: 'Kontakt pro odpověď',
    feedbackSubmitButton: 'Odeslat zpětnou vazbu',
    backButton: 'Zpět',
    modeNearestButton: 'Mód: Nejbližší hospoda',
    modeSurpriseButton: 'Mód: Překvap mě',
  },
} as const;

export type Strings = typeof cs;
