/**
 * Czech UI strings. Source of truth for every user-facing word in the app.
 * Structured by screen/component so adding a second locale later is trivial.
 */

import { czechPlural } from './plural';

/** Format a serving volume in ml as a Czech litre string with a decimal comma:
 *  500 → "0,5 l", 300 → "0,3 l", 1000 → "1 l", 330 → "0,33 l". */
export function formatVolume(ml: number): string {
  const litres = ml / 1000;
  const text = Number.isInteger(litres)
    ? String(litres)
    : litres.toFixed(litres * 100 % 10 === 0 ? 1 : 2).replace(/0+$/, '').replace(/\.$/, '');
  return `${text.replace('.', ',')} l`;
}

export const cs = {
  appName: 'Na pivo',

  common: {
    cancel: 'Zrušit',
    ok: 'OK',
  },

  // — "Zmapuj hospodu" (community pub amenities + Mapér) —
  mapPub: {
    // Trigger (MapPubButton)
    triggerDefault: 'Zmapuj hospodu',
    triggerPartial: 'Doplň mapu hospody',
    triggerDone: 'Hospoda je zmapovaná',
    triggerPartialSuffix: (pct: number) => ` · ${pct} %`,
    triggerA11y: (pub: string, pct: number) => `Zmapuj hospodu ${pub}, zmapováno z ${pct} procent`,

    // Sheet header
    subtitleEmpty: 'Co tady mají? Dej vědět.',
    subtitleSome: 'Jde ti to!',
    subtitleDone: 'Paráda, máš to celé!',
    ringCaption: 'zmapováno',
    personal: (n: number, total: number) => `Zmapováno ${n} z ${total}`,
    footerHint: 'Každá odpověď se uloží sama. Díky!',
    closeA11y: 'Zavřít mapování hospody',
    offline: 'Teď jsi offline. Odpovědi se uloží a pošlou později.',
    ringA11y: (pct: number) => `Zmapováno z ${pct} procent`,
    // Makes the public-vs-private distinction explicit: this is shared community
    // data, unlike the private rating on the evening card.
    publicNote: 'Veřejné. Uvidí to ostatní pivaři.',
    // Entry button on the evening card (an alternate, friendlier label).
    entryQuestion: 'Co tady mají?',
    entryA11yPublic: 'Otevře veřejné mapování hospody, viditelné pro ostatní',

    // Info fact rows (otevíračka + piva) — the two non-amenity groups the hub
    // also covers. Each row taps through to the contribute editor.
    infoSection: 'OTEVÍRAČKA A PIVA',
    factHoursLabel: 'Otevírací doba',
    factHoursFilled: 'Vyplněno · uprav',
    factHoursMissing: 'Chybí — doplň',
    factBeersLabel: 'Piva na čepu',
    factBeersMissing: 'Chybí — doplň, co točí',
    factBeersCount: (n: number) =>
      n === 1 ? '1 pivo · uprav' : n >= 2 && n <= 4 ? `${n} piva · uprav` : `${n} piv · uprav`,
    factEditA11y: (label: string, filled: boolean) =>
      filled ? `Upravit: ${label}` : `Doplnit: ${label}`,

    // Sections (uppercase, matching the statsHeader convention). Merged to 3 so
    // no section is a single row: games+atmosphere → ZÁBAVA, payment+wifi/parking
    // → PRAKTICKÉ.
    sectionSeating: 'POSEZENÍ',
    sectionFun: 'ZÁBAVA',
    sectionPractical: 'PRAKTICKÉ',

    // Row controls
    yes: 'Ano',
    no: 'Ne',
    unmapped: 'nezmapováno',
    firstMapped: 'prvně zmapováno!',
    signal: (yes: number, no: number) => `${yes}× ano · ${no}× ne`,
    disputed: 'lidi se neshodnou',
    yesA11y: (amenity: string) => `${amenity}: ano`,
    noA11y: (amenity: string) => `${amenity}: ne`,
    clearHint: 'Ťukni znovu pro zrušení',

    // Amenity labels / chips (mirror the catalogue in src/data/amenities.ts)
    amenities: {
      payment_card: { label: 'Platba kartou', short: 'Karta' },
      seating_garden: { label: 'Zahrádka / terasa', short: 'Zahrádka' },
      seating_barrier_free: { label: 'Bezbariérový přístup', short: 'Bezbariér' },
      game_darts: { label: 'Šipky', short: 'Šipky' },
      game_billiards: { label: 'Kulečník', short: 'Kulečník' },
      game_foosball: { label: 'Stolní fotbal', short: 'Fotbálek' },
      game_jukebox: { label: 'Jukebox', short: 'Jukebox' },
      atmosphere_live_music: { label: 'Živá hudba', short: 'Živá hudba' },
      atmosphere_sports_tv: { label: 'Sport v televizi', short: 'Sport v TV' },
      practical_wifi: { label: 'Wi-Fi', short: 'Wi-Fi' },
      practical_parking: { label: 'Parkování', short: 'Parkování' },
    },

    // XP toasts
    xpFirstMapper: (xp: number) => `Prvomapér! +${xp} XP`,
    xpSession: (n: number, xp: number) => `Zmapováno ${n} věcí · +${xp} XP`,
    xpLevelUp: (title: string) => `Level up! Teď jsi ${title}.`,
    // Retracting a vote only corrects the public map; the user keeps their XP
    // and counters (lifetime-achievement model — never clawed back).
    retracted: 'Smazáno z mapy. Body ti zůstávají.',

    // Profile — MAPÉR
    mapperHeader: 'MAPÉR',
    mapperLevel: (n: number, title: string) => `Úroveň ${n} · ${title}`,
    mapperXpProgress: (cur: number, next: number) => `${cur} / ${next} XP`,
    mapperXpTotal: (xp: number) => `${xp} XP celkem`,
    mapperXpToNext: (n: number) => `ještě ${n} XP do dalšího levelu`,
    mapperXpMaxed: 'máš všechno, jsi legenda',
    mapperStatMappedPubs: 'zmapovaných hospod',
    mapperStatAnswers: 'odpovědí nasbíráno',
    mapperStatFirstMaps: 'prvně zmapováno',
    mapperStatCompleted: 'hospod hotových',
    mapperEmpty: 'Ještě jsi nic nezmapoval. Najdi hospodu a řekni, co v ní je.',
    mapperSignedOut: 'Přihlas se a mapování se ti uloží na všech zařízeních.',

    // Badges
    badgeFirstMapTitle: 'Prvomapér',
    badgeFirstMapLocked: 'Buď první, kdo hospodu zmapuje',
    badgeExplorerTitle: 'Objevitel',
    badgeExplorerLocked: 'Zmapuj 10 hospod',
    badgeCartographerTitle: 'Kartograf',
    badgeCartographerLocked: 'Zmapuj 25 hospod',
    badgeCompletionistTitle: 'Pořádkumil',
    badgeCompletionistLocked: 'Zmapuj jednu hospodu naplno',
    badgeFactMachineTitle: 'Pivní detektiv',
    badgeFactMachineLocked: 'Zaznamenej 100 faktů',

    // Level titles (5 locked); also bundled in the threshold fallback table.
    levelTitles: ['Nováček', 'Všímálek', 'Štamgast', 'Znalec', 'Hospodský mudrc'],
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
      `Co je špatně s „${pubName}“?`,
    reportRename: 'Opravit název',
    reportClosed: 'Už nefunguje',
    reportNotPub: 'Nečepují pivo',
    renameTitle: 'Jak se jmenuje?',
    renameBody: (pubName: string) =>
      `Přejmenujeme „${pubName}“ i pro ostatní pivaře, když se oprava odešle.`,
    renamePlaceholder: 'Nový název hospody',
    renameSave: 'Uložit název',
    renameSaving: 'Ukládám',
    renameSavedToast: 'Název hospody je opravený.',
    renameQueuedToast: 'Název je opravený tady. Až bude signál, pošleme ho dál.',
    calibrationHint: 'Otoč telefonem do osmičky pro kalibraci kompasu',
    openNow: 'Otevřeno',
    openUntil: (t: string) => `Otevřeno do ${t}`,
    closedNow: 'Zavřeno',
    closedUntil: (t: string) => `Zavřeno · otevře v ${t}`,
    hoursUnknown: 'Otevírací doba neznámá',
    detailsLoading: 'Načítám info',
    contribute: 'Doplnit info',
    addMissingPub: 'Chybí hospoda',
    addMissingPubLink: 'Není to ta hospoda? Přidej ji',
    contributeOrAdd: 'Doplnit / přidat',
    contributeMenuTitle: 'Co chceš doplnit?',
    // The leading beer glyph is a line-art icon rendered next to this text in
    // the pub card (see RevealedPubPill), not an emoji baked into the string.
    beerWithPrice: (name: string, price: string) => `${name} · ${price}`,
    beerNoPrice: (name: string) => name,
    beerAndMore: 'a další',
    ratingCount: (count: string) => `${count} hodnocení`,
    gardenBadge: 'Zahrádka',
    // Filter sheet (brand quick-pick) copy
    beerFilterButton: 'Filtruj piva',
    beerFilterSheetTitle: 'Na co máš chuť?',
    beerFilterSheetSubtitle: 'Ukážu jen hospody, kde to podle záznamů točí.',
    beerFilterAll: 'Všechna piva',
    beerFilterPopular: 'Oblíbené',
    beerFilterSearchPlaceholder: 'Hledat jinou značku…',
    beerFilterNoResults: 'Nic takového v záznamech není.',
  },

  permissions: {
    title: 'Potřebujeme tvoji polohu',
    body:
      'Bez polohy neumíme najít hospody v okolí ani namířit šipku. Aktuální nebo přibližná poloha se může poslat našemu serveru, který pro vyhledávání využívá Mapy.cz; GPS trasu ani historii neukládáme.',
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
    addPub: 'Přidat hospodu',
  },

  settings: {
    title: 'Nastavení',
    // Section group labels — one clear meaning per group.
    sections: {
      search: 'HLEDÁNÍ',
      app: 'APLIKACE',
      contribute: 'PŘISPĚJ',
      about: 'O APLIKACI',
    },
    // Account hub card at the top of settings (drills into /account when signed
    // in, into /auth when signed out).
    accountCard: {
      header: 'ÚČET',
      verified: 'E-mail ověřen',
      signedOutTitle: 'Přihlásit se',
      signedOutSubtitle: 'Sync piv, hodnocení a odznaků na všech zařízeních',
    },
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
    pubReminders: {
      title: 'Připomenout v hospodě',
      subtitle: 'Večer občas koukneme, jestli nesedíš u výčepu. Bez ukládání trasy.',
      failureEyebrow: 'PŘIPOMÍNKY NEBĚŽÍ',
      openSettings: 'Otevřít Nastavení',
      denied: {
        'notifications-denied': {
          title: 'Notifikace zůstaly vypnuté',
          body:
            'Připomínku bez notifikací nemáme jak poslat. Zapni je v Nastavení a zkus to znovu.',
        },
        'foreground-location-denied': {
          title: 'Nejdřív povol základní polohu',
          body:
            'Poloha při používání je základ pro kompas i hospody v okolí. Až ji povolíš, dořešíme polohu „vždy“ pro připomínky.',
        },
        'background-location-denied': {
          title: 'Chybí poloha „vždy“',
          body:
            'Poloha při používání stačí pro kompas. Hospodská připomínka ale běží i se zamčenou appkou, takže iOS musí mít polohu nastavenou na „Vždy“.',
        },
      },
    },
    sound: {
      title: 'Zvuk cinknutí',
      subtitle: 'Drobné „cink“ u cíle',
    },
    hideClosed: {
      title: 'Skrýt zavřené hospody',
      subtitle: 'Ukázat jen otevřené a ty s neznámou dobou',
    },
    preferRated: {
      title: 'Radši dobře hodnocené',
      subtitle: 'Přeskočí známé podniky pod 4 hvězdy',
    },
    preferGarden: {
      title: 'Radši se zahrádkou',
      subtitle: 'Když víme, že zahrádku nemají, jdeme dál',
    },
    hidePubNames: {
      title: 'Schovávat názvy hospod',
      subtitle: 'Název se ukáže až po ťuknutí',
    },
    currency: {
      title: 'Měna cen',
      subtitle: 'Pro zadávání cen piva v Česku nebo na Slovensku',
      czk: 'Kč',
      eur: '€',
    },
    marketingEmails: {
      title: 'Novinky e-mailem',
      subtitle: 'Tipy a nabídky můžeš kdykoli vypnout',
    },
    about: {
      title: 'O appce',
    },
    feedback: 'Napiš nám / nahlas chybu',
    feedbackCtaSubtitle: 'Něco nehraje nebo ti něco chybí? Dej nám vědět.',
    addPub: 'Přidat chybějící hospodu',
    addPubCtaSubtitle: 'Nenašel jsi svůj podnik? Přidej ho mezi ostatní.',
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

  pubReminderOnboarding: {
    eyebrow: 'NOVINKA PRO VEČERY',
    title: 'Až sedneš do hospody, cinkneme ti.',
    body:
      'Počítadlo ti večer připomene, když dorazíš k hospodě. Stačí zapnout notifikace a polohu na pozadí.',
    introCta: 'Ukázat, co povoluju',
    detailsTitle: 'Co bude iOS chtít povolit',
    detailsBody:
      'Kompasu stačí poloha při používání. Připomínka navíc potřebuje polohu „vždy“.',
    notificationTitle: 'Notifikace',
    notificationBody: 'Pošleme jen krátké připomenutí, ať večer nezmizí bez zápisu.',
    locationTitle: 'Poloha „vždy“',
    locationBody: 'iOS ji potřebuje pro hospodský okruh, i když appka zrovna neběží.',
    privacyTitle: 'Bez GPS deníčku',
    privacyBody: 'Trasy neukládáme. Hlídáme jen, jestli ses přiblížil k hospodě.',
    cta: 'Zapnout připomínky',
    ctaBusy: 'Zapínám…',
    back: 'Zpět',
    skip: 'Teď ne, nech mě pít v klidu',
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
    introHours: 'Kdy mají otevřeno? Údaje uvidí ostatní, co k téhle hospodě dorazí.',
    introBeers: 'Co tady točí? Údaje uvidí ostatní, co k téhle hospodě dorazí.',
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
    beerSuggestionsLoading: 'Hledám piva…',
    pricePlaceholder: 'Cena (Kč)',
    priceLabel: 'Cena za',
    volumeSmall: '0,3 l',
    volumeLarge: '0,5 l',
    volumeOther: 'Jiné',
    addBeer: 'Přidat pivo',
    maxBeersReached: 'Víc piv už přidat nejde',
    save: 'Uložit',
    invalidHint: 'Zkontroluj zadané časy (formát HH:MM).',
    savedToast: 'Díky! Uloženo',
    // Mapér reward for a first-time hours/beers contribution to a pub.
    xpToast: (xp: number) => `Díky za zmapování! +${xp} XP`,
  },

  addPub: {
    title: 'Přidat hospodu',
    intro:
      'Zadej název a adresu podniku, který v okolí chybí. Po odeslání se bude zobrazovat i ostatním.',
    locationHeader: 'Poloha',
    locationWithCurrent: 'Začni psát název a vyber podnik z návrhů Mapy.cz. Když tam není, použijeme tvou aktuální polohu, nebo doplň adresu ručně.',
    locationFromAddress: 'Začni psát název a vyber podnik z návrhů Mapy.cz. Když tam není, doplň ulici a číslo ručně.',
    nameLabel: 'Název',
    namePlaceholder: 'Např. Hospoda U Komunity',
    searchingPlaces: 'Hledám podniky na Mapy.cz...',
    selectedPlace: 'Vybraný podnik',
    cityLabel: 'Město',
    cityPlaceholder: 'Praha',
    addressLabel: 'Adresa',
    addressPlaceholder: 'Ulice a číslo',
    locationError: 'Polohu se nepodařilo najít. Zkus doplnit město nebo přesnější adresu.',
    locationImprecise: 'Přesnou polohu neznáme. Vyber podnik z návrhů, nebo doplň ulici a číslo.',
    save: 'Přidat hospodu',
    saving: 'Hledám polohu...',
    savedToast: 'Hospoda přidána',
  },

  account: {
    // — Auth screen (sign in / sign up) —
    authTitle: 'Účet',
    tabLogin: 'Přihlásit se',
    tabRegister: 'Registrovat',
    intro: 'Přihlas se a měj svá piva a hodnocení synchronizovaná na všech zařízeních.',
    emailLabel: 'E-mail',
    emailPlaceholder: 'tvuj@email.cz',
    passwordLabel: 'Heslo',
    passwordPlaceholder: 'Alespoň 8 znaků',
    nameLabel: 'Jméno (nepovinné)',
    namePlaceholder: 'Jak ti máme říkat',
    submitLogin: 'Přihlásit se',
    submitRegister: 'Vytvořit účet',
    loading: 'Pracuji…',
    orDivider: 'nebo',
    continueWithApple: 'Pokračovat přes Apple',
    continueWithGoogle: 'Pokračovat přes Google',
    forgotPassword: 'Zapomenuté heslo?',

    // — Inline validation —
    errorEmailInvalid: 'Zadej platný e-mail.',
    errorPasswordShort: 'Heslo musí mít alespoň 8 znaků.',
    errorGeneric: 'Něco se pokazilo. Zkus to prosím znovu.',

    // — Forgot password (inline) —
    resetPrompt: 'Zadej e-mail a pošleme ti odkaz na obnovu hesla.',
    resetSend: 'Poslat odkaz',
    resetSentToast: 'Pokud účet existuje, poslali jsme odkaz na obnovu.',

    // — Post-register / verification —
    verifyEmailSentToast: 'Ověřovací e-mail je na cestě.',

    // — Account management screen —
    accountTitle: 'Účet',
    emailVerified: 'E-mail ověřen',
    emailUnverified: 'E-mail není ověřen',
    verifyEmailCta: 'Ověřit e-mail',
    verifyEmailRequestedToast: 'Ověřovací e-mail je na cestě.',
    anonymousName: 'Tvůj účet',

    // — Sign-in methods card —
    methodsHeader: 'ZPŮSOBY PŘIHLÁŠENÍ',
    methodEmail: 'E-mail a heslo',
    methodGoogle: 'Google',
    methodApple: 'Apple',
    linkCta: 'Propojit',
    unlinkCta: 'Odpojit',
    linkedLabel: 'Propojeno',
    linkedGoogleToast: 'Google propojen.',
    linkedAppleToast: 'Apple propojen.',
    unlinkedToast: 'Odpojeno.',
    setPasswordCta: 'Nastavit heslo',
    setPasswordHeader: 'Nastavit heslo',
    setPasswordSave: 'Uložit heslo',
    setPasswordToast: 'Heslo nastaveno.',

    // — Data export —
    dataHeader: 'DATA',
    exportData: 'Poslat moje data e-mailem',
    exportDataSubtitle: 'JSON export profilu, deníku a hodnocení pošleme na tvůj e-mail',
    exportDataToast: 'Export dat je na cestě.',
    exportDataSentTitle: 'Export odeslán',
    exportDataSentBody: 'Data jsme poslali na e-mail připojený k tvému účtu.',
    subscriptionTitle: 'Na Pivo+',
    subscriptionFree: 'Free',
    subscriptionPlus: 'Plus',
    subscriptionInactive: 'Neaktivní',
    subscriptionPending: 'Čeká na ověření',
    subscriptionActive: 'Aktivní',
    subscriptionRestore: 'Obnovit nákupy',
    subscriptionRestoreUnavailableTitle: 'Na Pivo+ ještě není spuštěné',
    subscriptionRestoreUnavailableBody:
      'Účet už je připravený držet obnovu nákupů. Jakmile přibude nákupní SDK, napojí se sem ověření účtenky.',
    reportProfile: 'Nahlásit profil',
    reportProfileSubtitle: 'Přezdívka nebo avatar porušuje pravidla',

    // — Sign out —
    logout: 'Odhlásit se',

    // — Danger zone —
    dangerHeader: 'NEBEZPEČNÁ ZÓNA',
    deleteAccount: 'Smazat účet',
    deleteConfirmTitle: 'Smazat účet?',
    deleteConfirmBody:
      'Tvůj účet a data se po krátké lhůtě nevratně smažou. Tuto akci nelze vzít zpět.',
    deleteConfirmCancel: 'Zrušit',
    deleteConfirmConfirm: 'Smazat',
    deleteToast: 'Účet bude smazán.',

    // — Password reset screen (deep link) —
    resetTitle: 'Obnova hesla',
    resetNewPasswordLabel: 'Nové heslo',
    resetSubmit: 'Změnit heslo',
    resetDoneToast: 'Heslo změněno.',
    resetInvalidTitle: 'Neplatný odkaz',
    resetInvalidBody: 'Tento odkaz na obnovu hesla už neplatí. Vyžádej si nový.',
    resetInvalidCta: 'Zpět do aplikace',

    // — Email verification screen (deep link) —
    verifyTitle: 'Ověření e-mailu',
    verifyLoading: 'Ověřuji e-mail…',
    verifySuccessTitle: 'E-mail ověřen ✅',
    verifySuccessBody: 'Díky! Tvůj e-mail je teď ověřený.',
    verifyErrorTitle: 'Ověření se nezdařilo',
    verifyErrorBody: 'Odkaz už neplatí nebo je neplatný. Zkus si nechat poslat nový.',
    verifyInvalidBody: 'Chybí ověřovací kód. Otevři odkaz z e-mailu znovu.',
    verifyDoneCta: 'Zpět do aplikace',
  },

  tabs: {
    compass: 'Kompas',
    counter: 'Počítadlo',
    myBeers: 'Moje piva',
    // Počítadlo + Moje piva live behind one tab now, switched by a segment.
    beer: 'Štamgast',
    profile: 'Profil',
  },

  // The merged "Pivo" tab — a segmented control flips between counting and the
  // personal history; the two screens below it are unchanged.
  beer: {
    segmentCount: 'Počítat',
    segmentHistory: 'Historie',
  },

  profile: {
    // — Tab header —
    title: 'Profil',

    // — Identity —
    editProfile: 'Upravit profil',
    // Fallback name under the avatar when no display name is set.
    noDisplayName: 'Bez jména',

    // — Visibility badge —
    visibilityPublic: 'Veřejný profil',
    visibilityPrivate: 'Soukromý profil',

    // — Stats grid —
    statsHeader: 'TVOJE ČÍSLA',
    statBeers: 'PIV NAPOČÍTÁNO',
    statPubs: 'HOSPOD NAVŠTÍVENO',
    statRatings: 'HODNOCENÍ',
    statWalked: 'NACHOZENO',
    statSpent: 'UTRACENO',
    // Walked distance: "4,2 km" / fallback "—" when the server hasn't reported it.
    kmShort: 'km',
    notAvailable: '—',

    // — Achievements —
    achievementsHeader: 'ODZNAKY',
    badgeFirstTenTitle: 'Prvních 10 piv',
    badgeFirstTenLocked: 'Napočítej 10 piv',
    badgeRegularTitle: 'Stálý host',
    badgeRegularLocked: 'Navštiv jednu hospodu 5×',
    badgeReviewerTitle: 'Recenzent',
    badgeReviewerLocked: 'Ohodnoť 10 hospod',

    // — Recent activity —
    recentHeader: 'POSLEDNÍ AKTIVITA',

    // — Account & settings rows —
    manageAccount: 'Spravovat účet',
    settingsRow: 'Nastavení',

    report: {
      button: 'Nahlásit',
      profileFallback: 'tenhle profil',
      confirmTitle: 'Nahlásit profil?',
      confirmBody: (profile: string) =>
        `Pošleme moderátorovi hlášení na ${profile}. Použij to pro nevhodnou přezdívku, fotku nebo spam.`,
      confirmSubmit: 'Nahlásit',
      sentToast: 'Hlášení odesláno.',
    },

    // — Signed-out hero —
    signedOutTitle: 'Založ si profil',
    signedOutBody:
      'Vytvoř si účet a měj svá piva, hodnocení a odznaky synchronizované na všech zařízeních. Brzy přibydou i kamarádi a žebříčky.',
    signedOutCta: 'Vytvořit účet',

    // — Onboarding wizard —
    setup: {
      // STEP 1 — nickname + photo (one screen)
      step1Eyebrow: 'KROK 1 ZE 2',
      step1Title: 'Vytvoř si profil',
      step1Body: 'Vyber si přezdívku a klidně přidej fotku. Obojí změníš kdykoli později.',
      nicknamePlaceholder: 'prezdivka',
      nicknameChecking: 'Ověřuji…',
      nicknameAvailable: 'Volné',
      nicknameTaken: 'Tahle přezdívka je zabraná',
      nicknameInvalid: 'Neplatná přezdívka',
      nicknameTooShort: 'Aspoň 3 znaky',
      nicknameTooLong: 'Nejvíc 20 znaků',
      nicknameCharset: 'Jen písmena bez diakritiky, číslice, _ a .',
      nicknameReserved: 'Tahle přezdívka není dostupná',
      // Photo affordance: tap the avatar. Optional, so there is no skip button —
      // you just leave it empty and continue.
      photoHintEmpty: 'Klepni a přidej fotku (nepovinné)',
      photoHintSet: 'Klepni a změň fotku',
      avatarUploadError: 'Fotku se nepodařilo nahrát. Zkus to prosím znovu.',
      permissionBody: 'Pro výběr fotky potřebujeme přístup ke knihovně fotek. Povol ho v Nastavení.',
      // Shown when the OS won't re-prompt (canAskAgain=false) — the only path is Settings.
      permissionBlockedBody: 'Přístup k fotkám je zakázaný. Povol ho v systémovém Nastavení a zkus to znovu.',
      openSettings: 'Otevřít Nastavení',
      continue: 'Pokračovat',

      // STEP 2 — visibility
      step2Eyebrow: 'KROK 2 ZE 2',
      step2Title: 'Viditelnost profilu',
      visibilityToggleLabel: 'Veřejný profil',
      // The GDPR consent copy the user MUST see on the visibility step (locked).
      consentPublic:
        'Veřejný profil znamená, že tě podle přezdívky a fotky najdou ostatní v žebříčcích a vyhledávání. Tvoje přesná poloha ani jednotlivá piva se nikdy nezveřejňují. Kdykoli to vypneš v nastavení profilu.',
      consentPrivate: 'Když vypneš, uvidí tě jen tví kamarádi.',
      visibilitySaveError: 'Viditelnost profilu se nepodařilo uložit. Zkus to prosím znovu.',
      finish: 'Hotovo',
    },

    // — Edit screen —
    edit: {
      title: 'Upravit profil',
      avatarHeader: 'FOTKA',
      changePhoto: 'Změnit fotku',
      removePhoto: 'Odebrat fotku',
      nicknameHeader: 'PŘEZDÍVKA',
      displayNameHeader: 'JMÉNO',
      displayNameLabel: 'Jméno (nepovinné)',
      displayNamePlaceholder: 'Jak ti máme říkat',
      visibilityHeader: 'VIDITELNOST',
      visibilityToggleLabel: 'Veřejný profil',
      // Short GDPR copy on the edit screen (the wizard carries the full version).
      consent:
        'Veřejný profil tě zviditelní v žebříčcích a vyhledávání podle přezdívky a fotky. Poloha ani jednotlivá piva se nikdy nezveřejňují.',
      consentPrivate: 'Když vypneš, uvidí tě jen tví kamarádi.',
      save: 'Uložit',
      saving: 'Ukládám…',
      savedToast: 'Profil uložen',
      errorGeneric: 'Něco se pokazilo. Zkus to prosím znovu.',
    },
  },

  counter: {
    // — Permission gate —
    permTitle: 'Potřebujeme tvoji polohu',
    permBody:
      'Ať poznáme hospody v okolí a podnik, ve kterém sedíš. Aktuální nebo přibližná poloha se může poslat našemu serveru, který pro vyhledávání využívá Mapy.cz; GPS trasu ani historii neukládáme.',
    permCta: 'Povolit polohu',
    permOpenSettings: 'Otevřít Nastavení',

    // — Detecting / empty —
    detecting: 'Hledáme, kde sedíš…',
    noPubTitle: 'Žádná hospoda nablízku',
    noPubBody: 'Nenašli jsme hospodu ve tvém okolí. Zkus to znovu.',
    retry: 'Zkusit znovu',

    // — Active header —
    changePub: 'Změnit',
    pickerTitle: 'Kde sedíš?',

    // — Hero —
    totalSpent: (price: string) => `Utraceno ${price}`,
    heroEmptyTitle: 'Ťukni na pivo a začni počítat',
    lastDrinkJustNow: 'Poslední pivo před chvilkou',
    lastDrinkMinutesAgo: (minutes: number) =>
      `Poslední pivo před ${minutes} ${czechPlural(minutes, {
        one: 'minutou',
        few: 'minutami',
        many: 'minutami',
      })}`,
    rapidDrinkTitle: 'Už sis pivo přidal',
    rapidDrinkBody: (lastDrinkText: string) =>
      `${lastDrinkText}. Fakt chceš přidat další?`,
    rapidDrinkConfirm: 'Přidat další',

    // — Menu —
    menuHeader: 'Co tu mají',
    addBeer: 'Přidat pivo',
    perBeerCount: (n: number) => `${n}×`,
    // Empty-menu hero — the community-sourcing nudge.
    emptyMenuTitle: 'Tady ještě nikdo nepřidal pivo',
    emptyMenuBody: 'Doplň, co mají na čepu.\nPomůžeš ostatním.',
    emptyMenuCta: 'Přidat první pivo',

    // — Undo —
    undoLast: 'Vrátit poslední',

    // — Closing / resuming an evening —
    // Explicit "I'm done" — archives the session to history.
    doneDrinking: 'Dopito',
    doneTitle: 'Dopito?',
    doneBody: 'Zavřeme tenhle večer a najdeš ho v Historii.',
    doneConfirm: 'Dopito',
    // Offered when a recent evening at this pub auto-completed and can continue.
    resumeEvening: 'Pokračovat ve večeru',
    resumeHint: (summary: string) => `Posledně tu padlo ${summary}. Naváž, nebo začni ťuknutím nový.`,

    // — Beer / price modal —
    priceModalTitle: 'Kolik stojí?',
    addModalTitle: 'Jaké pivo si dáváš?',
    editModalTitle: 'Uprav cenu',
    beerNamePlaceholder: 'Název piva, např. Pilsner Urquell 12°',
    pricePlaceholder: 'Cena (Kč)',
    priceLabel: 'Cena za',
    volumeSmall: '0,3 l',
    volumeMedium: '0,4 l',
    volumeLarge: '0,5 l',
    volumeOther: 'Jiné',
    volumeCustomPlaceholder: 'např. 1000',
    volumeUnitMl: 'ml',
    confirmCount: 'Připsat pivo',
    confirmSave: 'Uložit',
    cancel: 'Zrušit',

    // — Formatting helpers —
    price: (czk: number) => `${czk} Kč`,
    // Standalone currency unit shown next to the price input.
    currencySuffix: 'Kč',
    // "62 Kč · 0,5 l" or just "62 Kč" when no volume.
    beerMeta: (price: string, ml?: number) =>
      ml ? `${price} · ${formatVolume(ml)}` : price,
  },

  myBeers: {
    // Tab label + screen title.
    title: 'Moje piva',

    // — Empty state —
    emptyTitle: 'Zatím žádná pivní stopa',
    emptyBody:
      'Ťukni na pivo v Počítadle a večer se uloží sem. Uvidíš, kde jsi byl, co jsi pil a kolik to dalo.',

    // — Sections —
    currentHeader: 'AKTUÁLNÍ VEČER',
    pastHeader: 'MINULÉ VEČERY',

    // — Date labels —
    today: 'Dnes',
    yesterday: 'Včera',

    // — Evening summary —
    // "3 piva · 186 Kč"
    summary: (beers: string, spent: string) => `${beers} · ${spent}`,
    lastDrinkJustNow: 'Poslední pivo před chvilkou',
    lastDrinkMinutesAgo: (minutes: number) =>
      `Poslední pivo před ${minutes} ${czechPlural(minutes, {
        one: 'minutou',
        few: 'minutami',
        many: 'minutami',
      })}`,

    // — Detail —
    breakdownHeader: 'CO PADLO',
    // Meta shown to the right of a beer name, e.g. "2× · 124 Kč" (count × subtotal).
    // The volume is appended to the name separately in EveningBreakdown.
    breakdownLine: (count: number, price: string) => `${count}× · ${price}`,
    drinkActionsHeader: 'JEDNOTLIVÁ PIVA',
    editDrink: 'Upravit',
    deleteDrink: 'Smazat',
    editDrinkTitle: 'Opravit název piva',
    editDrinkPlaceholder: 'Název piva',
    editDrinkSave: 'Uložit',
    editDrinkCancel: 'Zrušit',
    editDrinkEmpty: 'Bez názvu to nepůjde.',
    deleteDrinkTitle: 'Smazat pivo?',
    deleteDrinkBody: 'Když bylo navíc nebo patří jiné hospodě, smažeme ho z večera.',
    deleteDrinkConfirm: 'Smazat',
    deleteDrinkCancel: 'Zrušit',
    totalLabel: 'Celkem',

    // — Personal pub rating ("Stálo to za návrat?") —
    ratingHeader: 'STÁLO TO ZA TO?',
    ratingHint: 'Jen pro tebe. Soukromě se synchronizuje mezi tvými zařízeními.',
    verdictLike: 'Dobrý',
    verdictDislike: 'Slabý',
    // Quick preset tags — the user's own one-tap memory labels.
    tagLabel: 'Rychlá známka',
    notePresets: ['Sem se vrátit', 'Nic moc', 'Dobrý tankový'] as const,
    // Free-text note in the user's own words.
    noteLabel: 'Vlastní poznámka',
    notePlaceholder: 'Co sis chtěl zapamatovat? Třeba „skvělý výčep, ale draho".',
  },

  whatsNew: {
    eyebrow: 'AKTUALIZACE',
    defaultTitle: 'Co je nového',
    cta: 'Paráda!',
    // Version badge shown next to the eyebrow, e.g. "v1.2.0".
    versionLabel: (version: string) => `v${version}`,
  },

  about: {
    // Screen title reuses settings.about.title ("O appce") as the single source.
    tagline: 'Tvůj kompas k nejbližšímu pivu.',
    whatsNewHeader: 'CO JE NOVÉHO',
    // Shown while this version's release note is being fetched.
    loading: 'Načítám novinky…',
    // The backend has no note for this version (404 / empty).
    empty: 'Pro tuhle verzi tu zatím žádné novinky nemáme.',
    // Offline / timeout / dormant backend — distinct from "empty" so the user
    // knows it's worth trying again later.
    error: 'Novinky se teď nepodařilo načíst. Mrkni na to za chvíli.',
    footer: 'Bez reklam · Bez placení',
  },

  privacy: {
    title: 'Soukromí',
    body: [
      'Sbíráme jen omezené provozní statistiky: otevření aplikace, návrat do popředí, technické chyby, verzi aplikace a součet nachozených metrů.',
      'Pro stažení okolních hospod může aplikace poslat aktuální nebo přibližnou polohu na náš server, který pro vyhledávání využívá Mapy.cz.',
      'Nachozené metry se počítají v telefonu a na server se posílá jen součet po dávkách, nikdy GPS body ani trasa.',
      'Průběžnou GPS historii, trasu pohybu ani jednotlivé GPS body neukládáme.',
      'Pro zobrazení otevírací doby aplikace pošle název a polohu vybrané hospody na vlastní server provozovatele, který dohledá otevírací dobu.',
      'Aplikace vytvoří anonymní náhodný identifikátor zařízení a odešle ho na náš server, aby každému zařízení patřil dočasný účet. Identifikátor neobsahuje žádné osobní údaje a slouží jen k odlišení zařízení.',
      'Účet je dobrovolný. Když se zaregistruješ e-mailem, ukládáme e-mail a heslo jen v zahashované podobě. Přes Google nebo Apple dostaneme identifikátor účtu, e-mail a případně jméno; heslo od poskytovatele nikdy nevidíme.',
      'Profil může obsahovat přezdívku, jméno a avatar. U veřejného profilu tě podle přezdívky a fotky můžou najít ostatní; přesná poloha, deníček a jednotlivá piva se veřejně nezobrazují.',
      'Počítadlo, historie večerů, návštěvy hospod a tvoje soukromá hodnocení se ukládají lokálně a synchronizují se jen k tvému účtu. Po odhlášení nebo smazání účtu appka lokální soukromý deníček, hodnocení a čekající private sync fronty z tohohle zařízení vyčistí.',
      'Když dobrovolně doplníš otevírací dobu, piva na čepu nebo chybějící hospodu, aplikace tyto údaje odešle na náš server. Tyhle příspěvky pomáhají ostatním a můžou se zobrazit veřejně, ale bez tvé přesné polohy.',
      'V účtu si můžeš vyžádat JSON export svých dat e-mailem nebo účet smazat. Po smazání vyčistíme lokální soukromá data v appce a serverová data se smažou podle zásad ochrany osobních údajů.',
      'Transakční e-maily, například ověření adresy, obnova hesla, export dat nebo potvrzení smazání účtu, posíláme přes Resend. Téhle službě předáme jen e-mailovou adresu a obsah nutný k odeslání zprávy.',
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
    pubRating: (rating: string, count?: string) =>
      count ? `Hodnocení: ${rating} z 5, ${count} hodnocení` : `Hodnocení: ${rating} z 5`,
    pubGarden: 'Má zahrádku',
    toggleOn: 'zapnuto',
    toggleOff: 'vypnuto',
    settingsButton: 'Otevřít nastavení',
    rerollButton: 'Vyber jinou hospodu',
    skipButton: 'Přeskočit na další hospodu',
    skipButtonHint: 'Vynechá tuhle hospodu a najde další nejbližší',
    reportPubButton: 'Nahlásit problém s hospodou',
    renamePubInput: 'Nový název hospody',
    renamePubSaveButton: 'Uložit opravený název hospody',
    contributePubButton: 'Doplnit otevírací dobu a piva',
    contributeOrAddButton: 'Doplnit informace nebo přidat chybějící hospodu',
    contributeBeersLine: (text: string) => `Piva na čepu: ${text}. Ťukni pro doplnění.`,
    contributeDayClosedToggle: (day: string) => `${day}: přepnout zavřeno`,
    contributeAddInterval: (day: string) => `${day}: přidat čas`,
    contributeRemoveInterval: (day: string) => `${day}: odebrat čas`,
    contributeCopyToAll: 'Zkopírovat časy z pondělí do všech dnů',
    contributeAddBeer: 'Přidat pivo',
    contributeRemoveBeer: 'Odebrat pivo',
    contributeSaveButton: 'Uložit doplněné údaje',
    addPubButton: 'Přidat chybějící hospodu',
    addPubNameInput: 'Název hospody',
    addPubCityInput: 'Město hospody',
    addPubAddressInput: 'Adresa hospody',
    addPubSuggestion: (name: string) => `Vybrat podnik ${name}`,
    addPubSaveButton: 'Přidat hospodu',
    feedbackButton: 'Napiš nám nebo nahlas chybu',
    feedbackCategory: (label: string) => `Kategorie: ${label}`,
    feedbackContactChannel: (label: string) => `Kontakt přes: ${label}`,
    feedbackContactInput: 'Kontakt pro odpověď',
    feedbackSubmitButton: 'Odeslat zpětnou vazbu',
    backButton: 'Zpět',
    modeNearestButton: 'Mód: Nejbližší hospoda',
    modeSurpriseButton: 'Mód: Překvap mě',
    beerBrandFilterInput: 'Filtrovat hospody podle značky piva ze záznamů',
    beerBrandFilterSuggestion: (name: string) => `Vybrat značku ${name}`,
    clearBeerBrandFilter: 'Zrušit filtr značky piva',
    openBeerBrandFilter: 'Otevřít filtr značky piva',
    beerBrandFilterActive: (name: string) => `Filtr piva: ${name}. Klepni pro změnu`,
    selectBeerBrand: (name: string) => `Filtrovat na ${name}`,
    closeBeerBrandFilter: 'Zavřít filtr',

    // — "Zmapuj hospodu" / Mapér —
    // `into`/`next` are the into-level XP numbers shown on the visible bar so the
    // spoken progress matches the rendered progress. `next == null` = maxed level.
    mapperLevel: (n: number, title: string, into: number, next: number | null) =>
      next == null
        ? `Mapér úroveň ${n}, ${title}, máš všechno`
        : `Mapér úroveň ${n}, ${title}, ${into} z ${next} XP`,
    // Mapér badge state (announced after the title so VoiceOver reads e.g.
    // "Objevitel, splněno" or "Objevitel, zamčeno, Zmapuj 10 hospod").
    badgeUnlocked: (title: string) => `${title}, splněno`,
    badgeLocked: (title: string, hint: string) => `${title}, zamčeno, ${hint}`,

    // — Tabs —
    tabCompass: 'Záložka Kompas',
    tabCounter: 'Záložka Počítadlo',
    tabMyBeers: 'Záložka Moje piva',
    tabBeer: 'Záložka Štamgast',
    beerSegmentCount: 'Přepnout na počítání piv',
    beerSegmentHistory: 'Přepnout na historii večerů',
    counterDone: 'Dopito, zavřít tenhle večer',
    counterResume: 'Pokračovat v předchozím večeru',
    tabProfile: 'Záložka Profil',

    // — Counter —
    counterChangePub: 'Změnit hospodu',
    counterCloseModal: 'Zavřít',
    counterPickPub: (name: string, distance: string) =>
      `${name}, ${distance}. Ťukni pro výběr.`,
    counterCountBeer: (name: string, price: string) =>
      `Připsat ${name} za ${price}`,
    counterCountBeerNoPrice: (name: string) =>
      `Připsat ${name}, nejdřív zadej cenu`,
    counterEditBeer: (name: string) => `Upravit cenu u ${name}`,
    counterRemoveBeer: (name: string) => `Odebrat poslední ${name}`,
    counterAddBeer: 'Přidat nové pivo',
    counterUndo: 'Vrátit poslední připsané pivo',
    counterTotal: (count: string, price: string) =>
      `Napočítáno ${count}, utraceno ${price}`,
    counterRequestLocation: 'Povolit polohu',
    counterRetry: 'Hledat hospodu znovu',

    // — Moje piva —
    myBeersEvening: (pub: string, summary: string) =>
      `Večer v hospodě ${pub}, ${summary}. Ťukni pro detail.`,
    ratingLike: (pub: string) => `Hodnotit ${pub} jako dobrou`,
    ratingDislike: (pub: string) => `Hodnotit ${pub} jako slabou`,
    ratingNote: (note: string) => `Štítek: ${note}`,
    ratingNoteInput: (pub: string) => `Vlastní poznámka k hospodě ${pub}`,

    // — Účet / přihlášení —
    accountRow: 'Otevřít účet',
    authEmailInput: 'E-mail',
    authPasswordInput: 'Heslo',
    authNameInput: 'Jméno',
    authResetEmailInput: 'E-mail pro obnovu hesla',
    authNewPasswordInput: 'Nové heslo',
    authTabLogin: 'Přepnout na přihlášení',
    authTabRegister: 'Přepnout na registraci',
    authForgotPassword: 'Zapomenuté heslo',
    authSignInApple: 'Pokračovat přes Apple',
    authSignInGoogle: 'Pokračovat přes Google',
    accountVerifyEmail: 'Ověřit e-mail',
    accountLinkProvider: (provider: string) => `Propojit ${provider}`,
    accountUnlinkProvider: (provider: string) => `Odpojit ${provider}`,
    accountSetPassword: 'Nastavit heslo',
    accountExportData: 'Stáhnout moje data',
    accountRestorePurchases: 'Obnovit nákupy',
    accountReportProfile: 'Nahlásit profil',
    accountLogout: 'Odhlásit se',
    accountDelete: 'Smazat účet',

    // — Profil —
    profileEdit: 'Upravit profil',
    profileVisibility: 'Změnit viditelnost profilu',
    profileManageAccount: 'Spravovat účet',
    profileSettings: 'Otevřít nastavení',
    profileSignUp: 'Vytvořit účet',
    profileNicknameInput: 'Přezdívka',
    profilePickPhoto: 'Vybrat fotku z knihovny',
    profileRemovePhoto: 'Odebrat fotku',
    profileDisplayNameInput: 'Jméno',
    profileVisibilityToggle: (state: string) => `Veřejný profil: ${state}`,
    profileClose: 'Zavřít',
  },
} as const;

export type Strings = typeof cs;
