/**
 * Czech UI strings. Source of truth for every user-facing word in the app.
 * Structured by screen/component so adding a second locale later is trivial.
 */

import { beerCountLabel, czechPlural } from './plural';
import type { OutsidePlaceContext, ServingType } from '@/drinks/drinkTypes';
import { nvCs } from './nv/cs';

/** Format a serving volume in ml as a Czech litre string with a decimal comma:
 *  500 → "0,5 l", 1000 → "1 l", 330 → "0,33 l", 475 → "0,475 l". */
export function formatVolume(ml: number): string {
  const text = String(Number((ml / 1000).toFixed(3)));
  return `${text.replace('.', ',')} l`;
}

/** "v 21:47" but "ve 23:58": Czech needs "ve" before dva, tři, čtyři, dvanáct… */
function atTime(time: string): string {
  const hour = Number.parseInt(time, 10);
  return [2, 3, 4, 12, 13, 14, 20, 21, 22, 23].includes(hour) ? `ve ${time}` : `v ${time}`;
}

export const cs = {
  appName: 'Na pivo',

  /** The new look (app/nv), one sub-object per area in ./nv. */
  nv: nvCs,

  common: {
    cancel: 'Zrušit',
    ok: 'OK',
    friendFallback: 'Kamarád',
    drinkerFallback: 'Pivař',
    pubFallback: 'Hospoda',
  },

  map: {
    compass: 'Kompas',
    map: 'Mapa',
    showMyPubs: 'Ukázat moje hospody',
    liveNow: 'TEĎ NA PIVU',
    beersLastWeek: (n: number) =>
      czechPlural(n, {
        one: 'Minulý týden tu padlo 1 pivo',
        few: `Minulý týden tu padla ${n} piva`,
        many: `Minulý týden tu padlo ${n} piv`,
      }),
    friendFallback: 'Kamarád',
    pinHint: 'Zamiř špendlík na hospodu',
    pubFallback: 'Podnik v pivní mapě',
    notVisited: 'Tady ještě nemáš čárku.',
    visited: 'Navštíveno',
    pubDetail: 'Detail hospody',
    offline: 'Uložená data',
    retry: 'Zkusit znovu',
    loading: 'Sháním podniky…',
    refresh: 'Načíst znovu',
  },

  // — "Zmapuj hospodu" (community pub amenities + Mapér) —
  mapPub: {
    personal: (n: number, total: number) => `Zmapováno ${n} z ${total}`,
    offline: 'Teď jsi offline. Odpovědi se uloží a pošlou později.',
    // Makes the public-vs-private distinction explicit: this is shared community
    // data, unlike the private rating on the evening card.
    publicNote: 'Veřejné. Uvidí to ostatní pivaři.',

    // Row controls
    yes: 'Ano',
    no: 'Ne',
    unmapped: 'nezmapováno',
    signal: (yes: number, no: number) => `${yes}× ano · ${no}× ne`,
    disputed: 'lidi se neshodnou',

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
      practical_vape_friendly: { label: 'E-cigarety a IQOS povoleny', short: 'E-cig / IQOS' },
    },
    // Retracting a vote only corrects the public map; the user keeps their XP
    // and counters (lifetime-achievement model — never clawed back).
    retracted: 'Smazáno z mapy. Body ti zůstávají.',

    // Profile — MAPÉR
    mapperLevel: (n: number, title: string) => `Úroveň ${n} · ${title}`,

  },

  compass: {
    openInMaps: 'Otevřít v mapách',
    reportTitle: 'Chybí nebo nesedí?',
    reportBody: (pubName: string) =>
      `Přidej jinou hospodu, oprav „${pubName}“, nebo nahlas problém.`,
    reportNotPub: 'Není to hospoda',
    reportClosed: 'Hospoda už nefunguje',
    renameTitle: 'Jak se jmenuje?',
    renameBody: (pubName: string) =>
      `Přejmenuju „${pubName}“ i pro ostatní pivaře, když se oprava odešle.`,
    renameSave: 'Uložit název',
    openNow: 'Otevřeno',
    openUntil: (t: string) => `Otevřeno do ${t}`,
    closedNow: 'Zavřeno',
    hoursUnknown: 'Otevírací doba neznámá',
    contribute: 'Doplnit info',
    ratingCount: (count: string) => `${count} hodnocení`,
    priceAgeDays: (n: number) => `před ${n} dny`,
    /** Same slot while you're aiming at a friend's pub. */
    backToNearest: 'Zpět na nejbližší',
  },

  permissions: {
    title: 'Potřebuju tvoji polohu',
    // Google Play prominent-disclosure requirement: say explicitly that the app
    // collects location data, what for, that it goes to the server, and that
    // with reminders on it happens even when the app is closed or not in use.
    body:
      'Na pivo sbírá údaje o tvé poloze, aby našlo hospody v okolí a namířilo šipku. Aktuální nebo přibližná poloha se kvůli hledání hospod posílá na můj server. Když si zapneš hospodské připomínky, kontroluju polohu, i když je appka zavřená nebo ji zrovna nepoužíváš. GPS trasu ani historii polohy neukládám.',
    cta: 'Povolit polohu',
    openSettings: 'Otevřít Nastavení',
  },

  // — First-run onboarding (route /onboarding, shown once on a fresh install) —
  onboarding: {
    skip: 'Přeskočit',
    next: 'Co dál?',
    slide1Title: 'Vítej Na pivu',
    slide2Title: 'Čárkuj si večer',
    slide3Title: 'Ať o nic nepřijdeš',
  },

  empty: {
    body: 'V tvém okolí jsem nenašel žádnou hospodu. Zkus to znovu nebo uprav dosah v nastavení.',
    openSettings: 'Otevřít nastavení',
    retry: 'Zkusit znovu',
    addPub: 'Přidat hospodu',
    editFilters: 'Upravit filtry',
    clearFilters: 'Zrušit filtry',
  },

  settings: {
    title: 'Nastavení',
    language: {
      cs: 'Čeština',
      en: 'English',
      option: (name: string) => `Přepnout jazyk na ${name}`,
    },
    accountCard: {
      ctaSignedIn: 'Můj účet',
      ctaSignedOutSubtitle: 'Deník i parta v novém mobilu',
      signedOutTitle: 'Přihlásit se',
    },
    distance: {
      title: 'Jak daleko hledat',
      sheetTitle: 'Jak daleko mám hledat?',
      unlimited: 'Bez limitu',
      kmShort: 'km',
      meters: (meters: number) => `${meters} m`,
    },
    navigation: {
      title: 'Navigovat přes',
      google: 'Google',
      mapy: 'Mapy.com',
    },
    homePoint: {
      title: 'Domovský bod',
      configured: 'Nastavený',
    },
    haptics: {
      title: 'Vibrace',
      subtitle: 'Při ťukání a když dojdeš k cíli',
    },
    pubReminders: {
      title: 'Připomenout v hospodě',
      subtitle: 'Večer občas kouknu, jestli nesedíš u výčepu. Bez ukládání trasy.',
      openSettings: 'Otevřít Nastavení',
      denied: {
        'notifications-denied': {
          title: 'Notifikace zůstaly vypnuté',
          body:
            'Připomínku bez notifikací nemám jak poslat. Zapni je v Nastavení a zkus to znovu.',
        },
        'foreground-location-denied': {
          title: 'Nejdřív povol základní polohu',
          body:
            'Poloha při používání je základ pro kompas i hospody v okolí. Až ji povolíš, dořeším polohu „vždy“ pro připomínky.',
        },
        'background-location-denied': {
          title: 'Chybí poloha „vždy“',
          body:
            'Poloha při používání stačí pro kompas. Hospodská připomínka ale běží, i když je appka zavřená, takže telefon musí mít polohu nastavenou na „Vždy“.',
        },
      },
    },
    beerCountReminder: {
      title: 'Připomenout další pivo',
      subtitle: 'Po každém pivu posunu jednu upomínku. Sama se neopakuje.',
      intervalShort: (minutes: number) => `${minutes} min`,
    },
    sound: {
      title: 'Zvuk cinknutí',
      subtitle: 'Drobné „cink“ u cíle',
    },
    waterNudge: {
      title: 'Připomenout vodu',
      subtitle: 'Po čtyřech pivech, jen v telefonu. Střízlivost neodhaduju.',
    },
    homeTransitReminder: {
      title: 'Připomenout poslední spoj',
      subtitle: '20 minut před posledním přímým spojem domů. Jen Praha a okolí, potřebuju tvůj domovský bod.',
    },
    hideClosed: {
      title: 'Skrýt zavřené hospody',
      subtitle: 'Ukážu jen otevřené a ty s neznámou dobou',
    },
    preferRated: {
      title: 'Radši dobře hodnocené',
      subtitle: 'Přeskočím známé podniky pod 4 hvězdy',
    },
    hidePubNames: {
      title: 'Schovávat názvy hospod',
      subtitle: 'Název ukážu až po ťuknutí a skryju ho i v upozorněních',
    },
    marketingEmails: {
      title: 'Novinky e-mailem',
      subtitle: 'Tipy a nabídky. Kdykoli je vypneš.',
    },
    about: {
      title: 'O appce',
    },
    feedback: 'Napiš mi nebo nahlas chybu',
    footer: 'Bez reklam · Bez placení',
  },

  report: {
    title: 'Napiš mi',
    intro: 'Něco nefunguje nebo ti něco chybí? Napiš mi pár slov, pomůže to.',
    messagePlaceholder: 'Popiš, co se stalo nebo co ti chybí…',
    attachmentSourceTitle: 'Odkud vezmeš fotku?',
    attachmentCamera: 'Vyfotit',
    attachmentLibrary: 'Vybrat z galerie',
    attachmentPermissionTitle: 'Bez povolení to nepůjde',
    attachmentPermissionDenied: 'Povol přístup k foťáku nebo galerii a zkus to znovu.',
    attachmentPermissionBlocked: 'Přístup je vypnutý. Zapni ho v Nastavení telefonu.',
    attachmentOpenSettings: 'Otevřít Nastavení',
    attachmentErrorTitle: 'Fotka se nepovedla',
    attachmentErrorBody: 'Zkus vybrat jinou fotku nebo to pošli bez ní.',
    submit: 'Odeslat',
  },

  contribute: {
    title: 'Doplnit info',
    done: 'Hotovo',
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
    removeBeer: 'Smazat pivo',
    priceMissing: 'cena chybí',
    addBeer: 'Přidat pivo',
    fix: 'Oprav',
    save: 'Uložit',
    // "Vyfoť menu" — AI OCR helper that prefills the beer rows from a photo.
    scanMenu: {
      sheetTitle: 'Naskenuju ti menu',
      sheetSubtitle: 'Vyfoť nápoják a nápoje z něj přečtu. Pak na ně mrkneš.',
      camera: 'Vyfotit',
      cameraHelper: 'Namiř foťák na lístek',
      library: 'Z galerie',
      libraryHelper: 'Vyber fotku, co už máš',
      cancel: 'Zrušit',
      successToast: (count: number) => `Mám z menu ${beerCountLabel(count)}, mrkni na ně`,
      nothingNewToast: 'Tahle piva už v seznamu máš',
      emptyToast: 'Na fotce nevidím žádné pivo, dej ho víc do záběru nebo přidej ručně',
      unavailableToast: 'Skenování teď nejede, přidej piva ručně',
      dailyCapToast: 'Dnešní limit skenování je pryč, zkus to zase zítra',
      rateLimitedToast: 'Moc rychle po sobě, dej tomu chvíli',
      badImageToast: 'Z téhle fotky to nepřečtu, zkus ostřejší záběr',
      permissionDenied: 'Pusť k tomu foťák nebo galerii v Nastavení a zkus to znovu',
      errorToast: 'Skenování se nepovedlo, zkus to znovu',
    },
  },

  addPub: {

    title: 'Přidat hospodu',
    editTitle: 'Opravit hospodu',
    intro:
      'Vyplň název, město a adresu a potvrď, kde hospoda stojí. Po odeslání ji uvidí i ostatní.',
    locating: 'Zjišťuju polohu…',
    addressPlaceholder: 'Ulice a číslo',
    locationUnavailable: 'Polohu se teď nepodařilo zjistit. Zkus to ještě jednou venku nebo blíž k oknu.',
    save: 'Přidat hospodu',
    saving: 'Ukládám…',
    failedToast: 'Hospodu se nepodařilo ověřit. Oprav údaje nebo to zkus znovu.',
    myPubsTitle: 'Moje přidané hospody',
    loading: 'Načítám hospody…',
    emptyTitle: 'Zatím tu žádná není.',
    emptyBody: 'Když v kompasu chybí hospoda, doplň ji. Přidám ji do mapy i ostatním.',
    loadFailed: 'Teď se mi je nepodařilo načíst.',
    retry: 'Zkusit znovu',
    retrying: 'Zkouším…',
    edit: 'Opravit hospodu',
  },

  account: {
    intro: 'Přihlas se a piva i hodnocení ti naskočí na všech zařízeních.',
    emailLabel: 'E-mail',
    emailPlaceholder: 'tvuj@email.cz',
    passwordLabel: 'Heslo',
    passwordPlaceholder: 'Alespoň 8 znaků',
    loading: 'Pracuju…',

    // — Inline validation —
    errorSessionStorage: 'Přihlášení se nepodařilo bezpečně uložit. Odemkni telefon a zkus to znovu.',
    errorAccountMismatch: 'V telefonu máš piva z jiného účtu. Přihlas se původním účtem, nebo se nejdřív odhlas.',
    errorEmailInvalid: 'Zadej platný e-mail.',
    errorPasswordShort: 'Heslo musí mít alespoň 8 znaků.',
    errorGeneric: 'Něco se pokazilo. Zkus to prosím znovu.',
    resetSentToast: 'Pokud účet existuje, poslal jsem odkaz a kód pro obnovu.',

    // — Post-register / verification —
    verifyEmailSentToast: 'Ověřovací e-mail je na cestě.',

    // — Account management screen —
    accountTitle: 'Účet',
    emailVerified: 'E-mail ověřen',
    unlinkCta: 'Odpojit',
    unlinkConfirmTitle: (provider: string) => `Odpojit ${provider}?`,
    unlinkConfirmBody: 'Přihlásíš se pak jen zbývajícími způsoby.',
    unlinkedToast: 'Odpojeno.',
    setPasswordToast: 'Heslo nastaveno.',

    // — Data export —
    exportData: 'Poslat moje data e-mailem',

    // — Sign out —
    logout: 'Odhlásit se',

    // — Danger zone —
    deleteAccount: 'Smazat účet',
    deleteConfirmCancel: 'Zrušit',
    deleteToast: 'Účet bude smazán.',
    resetDoneToast: 'Heslo změněno.',
    errorResetCodeMissing: 'Zadej kód z e-mailu.',
    sessionExpired: 'Přihlášení vypršelo. Přihlas se znovu, piva uložená v telefonu zůstanou v bezpečí.',
  },

  tabs: {
    compass: 'Kompas',
    counter: 'Počítadlo',
    myBeers: 'Moje piva',
    // Počítadlo + Moje piva live behind one tab now, switched by a segment.
    beer: 'Štamgast',
    friends: 'Parta',
    profile: 'Profil',
  },

  communityEvents: {
    title: 'Pivo u někoho',
    kicker: 'KOMORNÍ SETKÁNÍ 18+',
    intro: 'Malé domácí posezení v okolí. Adresu dostaneš až po schválení pořadatelem.',
    safety: 'Jdeš k někomu domů. Řekni blízkému, kam jdeš, doraz střízlivý a kdykoli odejdi, když ti něco nesedí.',
    nearby: 'V okolí',
    mine: 'Moje',
    create: 'Založit setkání',
    locate: 'Najít setkání v okolí',
    locating: 'Hledám v okolí…',
    distance: {
      under_1_km: 'do 1 km',
      '1_3_km': '1 až 3 km',
      '3_8_km': '3 až 8 km',
      '8_15_km': '8 až 15 km',
    },
    spots: (count: number) =>
      count === 1
        ? 'poslední místo'
        : count <= 4
          ? `${count} volná místa`
          : `${count} volných míst`,
    host: (name: string) => `Pořádá ${name}`,
    join: 'Požádat o místo',
    pending: 'Čeká na schválení',
    approved: 'Máš místo',
    leave: 'Odejít ze setkání',
    report: 'Nahlásit setkání',
    reportTitle: 'Nahlásit setkání?',
    reported: 'Díky, mrknu na to.',
    cancelled: 'Setkání je zrušené.',
    approve: 'Schválit',
    reject: 'Odmítnout',
    requests: 'ŽÁDOSTI O MÍSTO',
    description: 'Co se bude dít',
    city: 'Město',
    area: 'Čtvrť nebo část města',
    exactAddress: 'Přesná adresa',
    start: 'Začátek',
    today: 'Dnes',
    tomorrow: 'Zítra',
    duration: 'Délka',
    capacity: 'Kapacita včetně tebe',
    publish: 'Otevřít stůl',
    created: 'Stůl je otevřený. Přesná adresa zůstává skrytá.',
    loadError: 'Setkání se teď nepodařilo načíst.',
    retry: 'Zkusit znovu',
    open: 'Pivo u někoho',
    hostFallback: 'Pořadatel',
    reportComment: 'Nahlášeno z přehledu komunitních setkání.',
  },

  photoDiary: {
    // — Diary section on the profile —
    header: 'PIVNÍ FOTKY',
    title: 'Pivní fotky',
    empty: 'Zatím tu nic není. Vyfoť svoje pivo a začni si plnit album.',
    emptyTitle: 'Zvedni pivo, cvakni fotku',
    addPhoto: 'Přidat fotku',
    takePhoto: 'Vyfotit pivo',
    pickFromLibrary: 'Vybrat z galerie',
    photoCount: (n: number) =>
      n === 1 ? '1 fotka' : n >= 2 && n <= 4 ? `${n} fotky` : `${n} fotek`,

    // — Source sheet —
    sheetTitle: 'Cvakni pivo',
    captionLabel: 'Popisek',
    captionPlaceholder: 'Co to bylo za pivo a za večer?',
    pubLabel: 'Hospoda',
    pubNone: 'Bez hospody',
    visibilityPrivate: 'Jen pro mě',
    save: 'Uložit do deníčku',
    saved: 'Fotka je v albu. Na zdraví.',
    contestEntryFailed: 'Fotka je uložená, ale do soutěže se nepřihlásila. Zkus to z jejího detailu.',
    deleteConfirm: 'Smazat',
    deleteError: 'Fotku se nepodařilo smazat. Zkus to znovu.',
    permissionBlockedBody: 'Přístup je zakázaný. Povol ho v systémovém Nastavení a zkus to znovu.',
    openSettings: 'Otevřít Nastavení',
  },

  friends: {
    title: 'Parta',
    refresh: 'Obnovit',
    searchPlaceholder: 'Přezdívka kámoše',
    addByNickname: 'Pozvat',
    accept: 'Přijmout',
    decline: 'Nechat být',
    remove: 'Odebrat',
    removeTitle: 'Odebrat kámoše?',
    removeBody: (name: string) => `${name} už neuvidí tvoje hospodské signály a zmizí z party.`,
    requestSent: 'Pozvánka letí ke stolu.',
    requestAccepted: 'Je v partě.',
    shareError: 'Nepodařilo se dát vědět partě.',
    sharedCount: (n: number) =>
      n === 0
        ? 'Ještě žádné společné pivo'
        : n === 1
          ? '1 společné pivo'
          : n >= 2 && n <= 4
            ? `${n} společná piva`
            : `${n} společných piv`,
    lastTogether: (pub: string) => `Naposledy spolu: ${pub}`,
    // Solo, genderless rewrite (retired the corporate "jsme").
    noResults: 'Nikdo takový tu není. Zkus jinou přezdívku nebo pošli pozvánku odkazem.',
    // Snapshot-aware: the screen now renders the last-known graph behind this.
    offline: 'Parta se teď nenačetla. Ukazuju poslední, co vím.',
    retry: 'Zkusit znovu',

    // — RSVP loop (Jdu / Možná / Dneska ne) —
    rsvpGoing: 'Jdu',
    rsvpMaybe: 'Možná',
    rsvpCant: 'Dneska ne',
    // Roster count word only — the numeral renders separately in amber.
    goingLabel: (n: number) => (n === 1 ? 'jde' : 'jdou'),

    // — Party streak —
    streakWeeks: (n: number) =>
      n === 1
        ? '1 týden v sérii'
        : n >= 2 && n <= 4
          ? `${n} týdny v sérii`
          : `${n} týdnů v sérii`,

    // — Identity gate (§A2) —
    coldStartAnonTitle: 'Přidej se k partě',
    coldStartAnonBody:
      'Přihlas se nebo si založ účet. Pak tě kámoši najdou podle přezdívky.',
    coldStartAnonCta: 'Přihlásit se',
    coldStartSetupTitle: 'Jak ti má parta říkat?',
    coldStartSetupBody: 'Doplň si přezdívku, ať tě kámoši najdou.',
    coldStartSetupCta: 'Doplnit přezdívku',
    codeOffline: 'Kód dostaneš, až chytneš signál.',
    shareMessage: (link: string) =>
      `Přidej si mě na Na pivo, ať víš, kdy jdu na jedno: ${link}`,
    claimDone: 'Hotovo, čeká na potvrzení.',
    claimExpired: 'Pozvánka už vypršela. Ať ti kámoš pošle novou.',
    claimInvalid: 'Tuhle pozvánku neznám.',
    claimLoading: 'Načítám pozvánku…',
    claimSelf: 'To je tvůj vlastní kód.',

    // — Reactions "Na zdraví" (§C) —
    cheers: 'Na zdraví',

    // — Compass handoff (§F2) —
    showOnCompass: 'Ukaž na kompasu',
    blocked: 'Zablokováno.',
    unblockAction: 'Odblokovat',
    unblockTitle: (name: string) => `Odblokovat ${name}?`,
    unblockBody: 'Zase tě uvidí a může tě pozvat. Do party se tím nevrátí.',
    unblocked: 'Odblokováno.',
    fallbackName: 'Kámoš',
  },

  // The merged "Pivo" tab — a segmented control flips between counting and the
  // personal history; the two screens below it are unchanged.
  beer: {
  },

  badges: {
    title: 'Odznaky',
    empty: 'Mrkni, které odznaky se dají získat',
    next: 'Na řadě',
    nextRow: (name: string) => `Na řadě: ${name}`,
    groups: {
      pubs: 'Hospody',
      rhythm: 'Rytmus',
      beer: 'Pivo',
      social: 'Parta a fotky',
      mapping: 'Mapování',
      moments: 'Chvíle',
    },
    names: {
      beers: 'Čárkař',
      pubs: 'Poutník',
      regular: 'Štamgast',
      tasted: 'Ochutnávač',
      cities: 'Cestovatel',
      weeks: 'Týden co týden',
      ratings: 'Recenzent',
      friends: 'Parta',
      mapped: 'Kartograf',
      firstMaps: 'Prvomapér',
      completed: 'Pořádkumil',
      facts: 'Pivní detektiv',
      photos: 'Fotograf',
      contest: 'FotoPivař',
      softDrinks: 'Řidič',
      weekdays: 'Celý týden',
      months: 'Kolo roku',
      outsidePub: 'Chatař',
      outdoors: 'Pod širákem',
      bottles: 'Lahváčový filozof',
      cans: 'Plechovkáč',
      nightOwl: 'Noční sova',
      lunch: 'Pivo k obědu',
      christmasEve: 'Štědrý den',
      newYearsEve: 'Silvestr',
      beerDay: 'Den piva',
    },
    about: {
      beers: 'Všechna piva v deníku. Počítá se jen součet, nikdy tempo.',
      pubs: 'Hospody, kde máš zapsané pivo nebo návštěvu. Každá se počítá jednou.',
      regular: 'Nejvíc návštěv jedné hospody.',
      tasted: 'Různá piva v deníku. Stejné pivo podruhé se nepočítá.',
      cities: 'Města, kde máš zapsané pivo.',
      weeks: 'Nejdelší řada týdnů po sobě, ve kterých máš aspoň jedno pivo.',
      ratings: 'Hospody, které máš ohodnocené.',
      friends: 'Kamarádi v partě.',
      mapped: 'Hospody, které máš zmapované.',
      firstMaps: 'Hospody, které máš zmapované jako první.',
      completed: 'Hospody, které máš zmapované naplno.',
      facts: 'Fakta o hospodách, která máš zapsaná.',
      photos: 'Pivní fotky, které máš nahrané.',
      contest: 'Vyhraná kola fotosoutěže.',
      softDrinks: 'Nealko v deníku, třeba když řídíš.',
      weekdays: 'Pivo v každý den týdne.',
      months: 'Pivo v každém měsíci roku.',
      outsidePub: 'Pivo mimo hospodu.',
      outdoors: 'Pivo venku pod širým nebem.',
      bottles: '25 lahváčů v deníku.',
      cans: '25 plechovek v deníku.',
      nightOwl: 'Pivo po půlnoci.',
      lunch: 'Pivo mezi 11. a 14. hodinou.',
      christmasEve: 'Pivo na Štědrý den.',
      newYearsEve: 'Pivo na Silvestra.',
      beerDay: 'Pivo na Mezinárodní den piva, první pátek v srpnu.',
    },
    // Volume badges (Čárkař, lahváče, plechovky) stay plain on purpose.
    quips: {
      pubs: 'Hospoda za každým rohem a ty víš, za kterým.',
      regular: 'Tady už ti čepují dřív, než si řekneš.',
      cities: 'Pivo chutná všude trochu jinak. Ověřeno.',
      ratings: 'Hospodský tvůj názor možná nečte. Ostatní ano.',
      weeks: 'Na tenhle rytmus se dá spolehnout.',
      weekdays: 'Každý den v týdnu už má svoje pivo.',
      months: 'Leden nebo srpen, pivo chutná pořád.',
      tasted: 'Na čepu tě už máloco překvapí.',
      softDrinks: 'Kdo řídí, pije nealko. Respekt.',
      friends: 'Je s kým zajít na jedno.',
      photos: 'Pivo nejdřív vyfotit, pak teprve ochutnat.',
      contest: 'Tvoje fotka porazila všechny ostatní.',
      mapped: 'Mapa je díky tobě o kus přesnější.',
      firstMaps: 'První zápis do mapy patří tobě.',
      completed: 'Hospoda zmapovaná do posledního věšáku.',
      facts: 'Víš, kde mají zahrádku i kde berou kartu.',
      outsidePub: 'Pivo chutná i mimo hospodu.',
      outdoors: 'Nejlepší zahrádka je ta bez stolů.',
      beerDay: 'Svátek, který se slaví u výčepu.',
      nightOwl: 'Večer se protáhl přes půlnoc.',
      lunch: 'Polední menu s pěnou.',
      christmasEve: 'Kapr, cukroví a pivo k tomu.',
      newYearsEve: 'Do nového roku s pěnou.',
    },
    unit: {
      beers: (n: number) => czechPlural(n, { one: 'pivo', few: 'piva', many: 'piv' }),
      pubs: (n: number) => czechPlural(n, { one: 'hospoda', few: 'hospody', many: 'hospod' }),
      regular: (n: number) => czechPlural(n, { one: 'návštěva', few: 'návštěvy', many: 'návštěv' }),
      tasted: (n: number) => czechPlural(n, { one: 'různé pivo', few: 'různá piva', many: 'různých piv' }),
      cities: (n: number) => czechPlural(n, { one: 'město', few: 'města', many: 'měst' }),
      weeks: (n: number) => czechPlural(n, { one: 'týden v řadě', few: 'týdny v řadě', many: 'týdnů v řadě' }),
      ratings: (_n: number) => 'hodnocení',
      friends: (n: number) => czechPlural(n, { one: 'kamarád', few: 'kamarádi', many: 'kamarádů' }),
      mapped: (n: number) => czechPlural(n, { one: 'hospoda', few: 'hospody', many: 'hospod' }),
      firstMaps: (n: number) => czechPlural(n, { one: 'hospoda', few: 'hospody', many: 'hospod' }),
      completed: (n: number) => czechPlural(n, { one: 'hospoda', few: 'hospody', many: 'hospod' }),
      facts: (n: number) => czechPlural(n, { one: 'fakt', few: 'fakta', many: 'faktů' }),
      photos: (n: number) => czechPlural(n, { one: 'fotka', few: 'fotky', many: 'fotek' }),
      contest: (n: number) =>
        czechPlural(n, { one: 'vyhrané kolo', few: 'vyhraná kola', many: 'vyhraných kol' }),
      softDrinks: (n: number) => czechPlural(n, { one: 'nealko', few: 'nealka', many: 'nealek' }),
    },
    still: (amount: string) => `Ještě ${amount}`,
    levelOf: (tier: string, count: string) => `Úroveň ${tier} ze ${count}`,
    toLevel: (tier: string) => `Do úrovně ${tier}`,
    levels: 'Úrovně',
    missing: (n: string) => `chybí ${n}`,
    done: 'Hotovo',
    allLevels: 'Víc už se vyrazit nedá.',
    toastOne: (name: string) => `Nová medaile: ${name}`,
    toastMany: (n: number) =>
      czechPlural(n, { one: 'Nová medaile', few: `Přibyly ${n} nové medaile`, many: `Přibylo ${n} nových medailí` }),
    earned: 'Získáno',
    locked: 'Ještě ne',
    secretName: 'Tajné',
    secretAbout: 'Co to je, zjistíš, až ho získáš.',
    secretStatus: 'Přijde samo',
    inDays: (n: number) =>
      n === 0 ? 'Dnes' : n === 1 ? 'Zítra' : czechPlural(n, { one: `Za ${n} den`, few: `Za ${n} dny`, many: `Za ${n} dní` }),
    slotsOf: (have: number, total: number) => `${have} ${total === 7 ? 'ze' : 'z'} ${total}`,
    weekdays: ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'],
    months: ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro'],
    missingDays: (n: number) => czechPlural(n, { one: 'Chybí ti ještě 1 den.', few: `Chybí ti ještě ${n} dny.`, many: `Chybí ti ještě ${n} dní.` }),
    missingMonths: (n: number) =>
      czechPlural(n, { one: 'Chybí ti ještě 1 měsíc.', few: `Chybí ti ještě ${n} měsíce.`, many: `Chybí ti ještě ${n} měsíců.` }),
    allDays: 'Máš všechny dny.',
    allMonths: 'Máš všechny měsíce.',
    keepDays: 'Dny se sbírají napořád, klidně s odstupem měsíců.',
    keepMonths: 'Měsíce se sbírají napořád, klidně přes víc let.',
    friendsSee: 'Tenhle odznak vidí i tvoje parta.',
    onlyYou: 'Tenhle vidíš jen ty.',
    showcase: 'Vitrína',
  },
  profile: {
    // — Tab header —
    title: 'Profil',

    noAccountNick: 'Zatím bez účtu',
    noAccountCaption: 'Piva ti počítám i tak.',
    nicknameMissing: 'Doplň přezdívku',
    levelLine: (level: number, title: string) => `Úroveň ${level} · ${title}`,
    levelMaxed: 'Máš všechno, jsi legenda.',
    levelNoAccount: 'Level ti naskočí s účtem.',
    photosTitle: 'Pivní fotky',
    photosEmpty: 'Vyfoť pivo a pověs ho sem.',
    photoFailed: 'Fotka se nenahrála.',
    addPub: 'Přidat chybějící hospodu',

    // — Identity —
    editProfile: 'Upravit profil',
    // Fallback name under the avatar when no display name is set.
    noDisplayName: 'Bez jména',

    // — Visibility badge —
    visibilityPublic: 'Veřejný profil',
    visibilityPrivate: 'Soukromý profil',
    statBeers: 'PIV NAPOČÍTÁNO',
    statSpent: 'UTRACENO',
    // Diary still formats its distance summary with these compatibility labels.
    kmShort: 'km',

    // — Parta cross-link (Parta 3.0 §A2 entry point) —
    myCode: 'Můj kód',

    report: {
      button: 'Nahlásit',
    },

    // — Signed-out hero —
    signedOutTitle: 'Založ si profil',

    // — One-screen privacy choice after registration —
    privacy: {
      title: 'Jak chceš být vidět?',
      body: 'Vyber si, kdo tě v Na pivu najde. Kdykoli to změníš v profilu.',
      publicTitle: 'Veřejný profil',
      promise: 'Přesnou polohu ani soukromý pivní deník tahle volba nikdy nezveřejní.',
      confirm: 'Potvrdit a jít na pivo',
      saving: 'Ukládám…',
      skip: 'Přeskočit, nic neměnit',
      error: 'Nastavení se nepodařilo uložit. Zkus to znovu, nebo pokračuj beze změny.',
    },

    // — Shared profile form copy —
    form: {
      nicknameTaken: 'Tahle přezdívka je zabraná',
      nicknameInvalid: 'Neplatná přezdívka',
      nicknameTooShort: 'Aspoň 3 znaky',
      nicknameTooLong: 'Nejvíc 20 znaků',
      nicknameCharset: 'Jen písmena bez diakritiky, číslice, _ a .',
      nicknameReserved: 'Tahle přezdívka není dostupná',
      avatarUploadError: 'Fotku se nepodařilo nahrát. Zkus to prosím znovu.',
      permissionBody: 'Pro výběr fotky potřebuju přístup ke knihovně fotek. Povol ho v Nastavení.',
      permissionBlockedBody: 'Přístup k fotkám je zakázaný. Povol ho v systémovém Nastavení a zkus to znovu.',
      openSettings: 'Otevřít Nastavení',
    },

    // — Edit screen —
    edit: {
      title: 'Upravit profil',
      changePhoto: 'Změnit fotku',
      removePhoto: 'Odebrat fotku',
      // Compact reminder; the post-registration privacy screen carries the full choice.
      consent:
        'Veřejný profil tě zviditelní v žebříčcích a vyhledávání podle přezdívky a fotky. Poloha ani jednotlivá piva se nikdy nezveřejňují.',
      consentPrivate: 'Když vypneš, uvidí tě jen tví kamarádi.',
      save: 'Uložit',
      saving: 'Ukládám…',
      errorGeneric: 'Něco se pokazilo. Zkus to prosím znovu.',
    },
  },

  counter: {
    retry: 'Zkusit znovu',
    outsideLabel: (context: OutsidePlaceContext) =>
      ({ private: 'Doma / na chatě', outdoors: 'Venku', other: 'Mimo hospodu' })[context],
    // A local, optional hydration nudge. It makes no health, sobriety, BAC, or
    // driving claim. `count` is the beer that triggered it (4, 8, 12...).
    waterNudge: (count: number) => {
      const lines = [
        'Jestli chceš, dej si teď i sklenici vody.',
        'Sklenice vody by teď taky neuškodila.',
        'Co takhle krátká pauza a sklenice vody?',
      ];
      const index = Math.max(0, Math.round(count / 4) - 1) % lines.length;
      return lines[index];
    },

    // — Sync —
    // Server hard-rejected a drink over the daily anti-abuse cap ("drink_limited"):
    // the entry stays in the local diary only, so no data is lost — just not synced.
    drinkLimitedToast: 'Dneska už toho bylo na server moc, tenhle zápis zůstává jen v tvém deníčku.',
    // Server refused a drink as invalid: it stays in the diary, flagged for fixing.
    drinkRejectedToast: (count: number) =>
      czechPlural(count, {
        one: 'Jeden zápis se neuložil. Najdeš ho v Deníku.',
        few: `${count} zápisy se neuložily. Najdeš je v Deníku.`,
        many: `${count} zápisů se neuložilo. Najdeš je v Deníku.`,
      }),
    resumeSub: (summary: string) => `Posledně tady: ${summary}.`,
    // Place chip when GPS found nothing close enough to say "you sit here".
    placeUnknown: 'Kde sedíš?',
    undo: 'Vrátit',
    // The rapid-drink guard is inline now: the tap does NOT count until this is
    // confirmed, and letting it time out means "no".
    rapidInlineConfirm: 'Ještě jedno',
    scanDrinksEmpty: 'Na fotce jsem žádný nápoj nepřečetl.',
    cameraMenuNeedsPub: 'Vyber hospodu a pak klepni na foťák znovu',
    // Offered when a recent evening at this pub auto-completed and can continue.
    resumeEvening: 'Pokračovat ve večeru',
    servingTypeLabel: (serving: ServingType) =>
      ({
        unknown: 'Nevím',
        draft: 'Čepované',
        bottle: 'Lahváč',
        can: 'Plechovka',
        plastic_bottle: 'PETka',
        other: 'Jinak',
      })[serving],
    priceLabel: 'Cena za',
    cancel: 'Zrušit',

    // — Formatting helpers —
    price: (czk: number) => `${czk} Kč`,
  },

  // — Pivař (drink-logging XP ladder; XP bar strings are shared with Mapér) —
  pivar: {
    header: 'TVŮJ LEVEL',
    level: (n: number, title: string) => `Úroveň ${n} · ${title}`,
  },

  // "Výčep" — the public feed of finished nights (the beer-diary take on a
  // Strava feed). A night shows up here only when its owner explicitly hangs
  // it up; the copy keeps repeating what is shown (counts, pubs, date, length)
  // and what never leaves the diary (money, location, individual beers). The
  // one-tap reaction is a "runda" — a symbolic round bought for the author.
  vycep: {
    title: 'Výčep',
    scopeParta: 'Parta',
    scopeWorld: 'Svět',
    loadError: 'Výčep se nenačetl.',
    retry: 'Zkusit znovu',
    outsidePub: 'Mimo hospodu',

    // — Runda (the reaction) —
    round: 'Runda',

    // — Publish sheet —
    publishTitle: 'Vyvěsit noc na Výčep',
    publishCta: 'Vyvěsit',
    storyCopied: 'Zkopírováno. Otevři Instagram a vlož do story.',
    storyShareError: 'Nálepku se nepovedlo připravit. Zkus to znovu.',
    reportTitle: 'Nahlásit tuhle noc?',
    reportBody: 'Nahlášení mi přijde anonymně. Mrknu na to.',
  },

  myBeers: {
    // Tab label + screen title.
    title: 'Moje piva',

    // — Empty state —
    emptyTitle: 'Zatím žádná pivní stopa',
    emptyBody:
      'Ťukni na pivo v Počítadle a večer se uloží sem. Uvidíš, kde to bylo, co teklo a kolik to dalo.',

    // — Sections —
    currentHeader: 'AKTUÁLNÍ VEČER',
    pastHeader: 'MINULÉ VEČERY',
    diaryHeader: 'PIVNÍ DENÍČEK',
    historicalCta: 'Zapsat zpětně',
    historicalCtaBody: 'Dopiš piva, hospodu, čas a cenu.',
    historicalTitle: 'Dopsat piva',
    historicalSubtitle: 'Stejný zápis, jen zpětně.',
    historicalRequiredHint: 'Piva po řádcích, hospoda a čas společně.',
    historicalBeersLabel: 'Piva',
    historicalAddBeer: 'Přidat pivo',
    historicalNextBeerPlaceholder: 'Další pivo',
    historicalDateLabel: 'Datum',
    historicalDatePlaceholder: '12. 6. 2026',
    historicalTimeLabel: 'Čas',
    historicalTimeFromLabel: 'Od',
    historicalTimeToLabel: 'Do',
    historicalTimePlaceholder: '19:45',
    historicalTimeToPlaceholder: 'vol.',
    historicalDateError: 'Zkontroluj datum a časy. Budoucnost zatím nečepuju.',
    historicalPubLabel: 'Hospoda',
    historicalPubPlaceholder: 'Kde to bylo?',
    historicalQuantityLabel: 'Počet',
    historicalPriceLabel: 'Cena / ks',
    historicalPricePlaceholder: 'vol.',
    historicalCityLabel: 'Město',
    historicalVisibilityHint: 'Starší zápisy jsou nejdřív jen pro tebe.',
    historicalVisibilityFriendsHint: 'Parta uvidí piva, hospodu, čas a poznámku.',
    historicalVisibilityPrivateHint: 'Uloží se jen do tvého deníčku.',
    historicalSubmit: 'Uložit vzpomínku',
    historicalSaved: (count: number) =>
      count === 1 ? 'Vzpomínka zapsaná.' : count < 5 ? `${count} piva zapsaná.` : `${count} piv zapsáno.`,
    historicalNoPub: 'Bez hospody',

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
    drinkActionsHeader: 'ZAPSANÉ NÁPOJE',
    drinkGroupTotal: (price: string) => `Celkem ${price}`,
    addDrinkToEvening: 'Dopsat pivo',
    addDrinkToEveningTitle: 'Co ještě padlo?',
    addDrinkToEveningSubmit: 'Dopsat do večera',
    addDrinkToEveningSaved: 'Pivo dopsané. Večer sedí.',
    editDrink: 'Upravit',
    deleteDrink: 'Odebrat jeden nápoj',
    editDrinkTitle: 'Opravit název nápoje',
    editDrinkGroupTitle: (count: number) =>
      count > 1 ? `Přejmenovat ${count} ${czechPlural(count, { one: 'nápoj', few: 'nápoje', many: 'nápojů' })}` : 'Opravit název nápoje',
    editDrinkPlaceholder: 'Název nápoje',
    editDrinkSave: 'Uložit',
    editDrinkCancel: 'Zrušit',
    editDrinkEmpty: 'Bez názvu to nepůjde.',
    deleteDrinkTitle: 'Odebrat jeden nápoj?',
    deleteDrinkBody: 'Počet na řádku snížím o jeden.',
    deleteDrinkConfirm: 'Odebrat',
    deleteDrinkCancel: 'Zrušit',
    // A drink the server refused: shown under its row until fixed or removed.
    drinkRejected: 'Tohle se neuložilo, mám to jen v telefonu. Oprav to, nebo odeber.',
    // The refused field is the place or time, which the drink form cannot change.
    drinkRejectedRemoveOnly: 'Tohle se neuložilo a opravit to tady nejde. Odeber to.',
    // One line in the fix sheet for the field that was refused.
    fixDrinkHintVolume: 'Tuhle velikost jsem nevzal. Vyber jinou.',
    fixDrinkHintPrice: 'Tuhle cenu jsem nevzal. Zkus 1 až 1000 Kč.',
    fixDrinkHintName: 'Tenhle název jsem nevzal. Zkus ho napsat jinak.',
    fixDrinkTitle: 'Oprav zápis',
    fixDrinkSubmit: 'Uložit znovu',
    fixDrinkSaved: 'Beru. Zkusím to uložit znovu.',
    priceUnknown: 'Cena chybí',
    pricePartial: (price: string) => `Nejméně ${price}`,
    totalLabel: 'Celkem',

    // — Personal pub rating ("Stálo to za návrat?") —
    ratingHeader: 'STÁLO TO ZA TO?',
    ratingHint: 'Jen pro tebe. Soukromě se synchronizuje mezi tvými zařízeními.',
    verdictLike: 'Dobrý',
    verdictDislike: 'Slabý',
    // One-tap memory labels. Values stay stable for older local/server ratings;
    // labels are the copy shown in the UI.
    tagLabel: 'Pocit po odchodu',
    notePresets: [
      { value: 'Sem se vrátit', label: 'Vrátím se sem' },
      { value: 'Dobrý tankový', label: 'Dobrej výčep' },
      { value: 'Nic moc', label: 'Příště jinam' },
    ] as const,
    // Free-text note in the user's own words.
    noteLabel: 'Vlastní poznámka',
    notePlaceholder: 'Co si chceš zapamatovat? Třeba „výčep super, účet už míň“.',
  },

  // "Výkon" includes practical monthly/yearly trends. Pivní Wrapped remains a
  // separate narrative recap.
  stats: {
    // — Empty state —
    emptyTitle: 'Zatím není co měřit',
    emptyBody: 'Začni počítat piva a ráno tu najdeš svůj výkon: kolik jich padlo, jak rychle a kde.',
    totalBeers: 'PIV CELKEM',
    totalEvenings: 'VEČERŮ',

    // — Time formatting (Czech units) —
    // Evening length: "4 h 12 min" / "47 min" / "do minuty".
    span: (ms: number): string => {
      const totalMin = Math.round(ms / 60000);
      if (totalMin < 1) return 'do minuty';
      if (totalMin < 60) return `${totalMin} min`;
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      return m === 0 ? `${h} h` : `${h} h ${m} min`;
    },
    // Drinking pace: "45 s" under 1.5 min, otherwise "12 min".
    pace: (ms: number): string => {
      if (ms < 90000) return `${Math.max(1, Math.round(ms / 1000))} s`;
      return `${Math.round(ms / 60000)} min`;
    },
  },

  whatsNew: {
    defaultTitle: 'Co je nového',
    cta: 'Paráda!',
    // Full-screen three-card note shown once to people who updated to 2.1.0
    // (the release that brought the simple app back).
    apology: {
      skip: 'Přeskočit',
      slide1Title: 'Promiň za dvojku',
      slide2Title: 'Stará appka je zpátky',
      slide3Title: 'Jedna prosba',
    },
    fixed211: {
      skip: 'Přeskočit',
      slide1Title: 'Mapa na Androidu je opravená',
      slide1Body:
        'Opravil jsem useknuté značky hospod i chybějící půllitry a čísla na mapě. Díky všem, kdo mi to nahlásili.',
      slide1Next: 'Pokračovat',
      slide2Title: 'Vyhledávání hospod je zpátky',
      slide2Body:
        'V kompasu i na mapě zase najdeš lupu. Hledej podle názvu nebo města, nebo rovnou vyber některou z hospod poblíž a svých stálic.',
      slide2Next: 'Ještě pár drobností',
      slide3Title: 'Pár oprav navíc',
      slide3Body:
        'Zapracoval jsem i na výkonu a opravil chyby v partě, upozorněních a ukládání zápisů. Přehlednější jsou taky tvoje přidané hospody.',
      slide3Done: 'Jdu na pivo',
    },
    v220: {
      skip: 'Přeskočit',
      slide1Title: 'Naplánuj tah po\u00a0hospodách',
      slide1Body:
        'Vyber dvě až osm hospod, pošli partě odkaz a vyrazte. Po cestě ukážu, kolik je to pěšky a co kde čepujou. Najdeš to v Partě pod tlačítkem Tour.',
      slide1Next: 'Pokračovat',
      slide2Title: 'Nahlédni do hospody',
      slide2Body:
        'Klepni na hospodu a uvidíš, co tam čepujou a za kolik, kdy mají otevřeno a jaké akce chystají. Srdíčkem si ji uložíš do srdcovek.',
      slide2Next: 'Další novinka',
      slide3Title: 'Parta u stolu',
      slide3Body:
        'Zapište si oba hospodu, kde sedíte, a po čtvrt hodině klepněte v Partě na „Přidej lidi od stolu“. A cinknout teď můžeš i jen pár vybraným kámošům.',
      slide3Next: 'Ještě jedna věc',
      slide4Title: 'Poslední spoj domů',
      slide4Body:
        'Když máš v Nastavení domovský bod, ukážu ti během večera poslední přímý spoj domů a můžu tě na něj 20 minut předem upozornit. Zatím jen v Praze a okolí.',
      slide4Done: 'Jdu na pivo',
    },
    v221: {
      skip: 'Přeskočit',
      slide1Title: 'Odhad promile',
      slide1Body:
        'Ze zapsaného pití ti na počítadle odhadnu promile a kdy budeš na nule. Je to jen odhad, za volant podle něj nesedej.',
      slide1Next: 'Pokračovat',
      slide2Title: 'Hlídej si svoje pivo',
      slide2Body:
        'Na lístku hospody ťukni na pivo a vyber Hlídat pivo. Až ho začnou čepovat poblíž, dám ti vědět.',
      slide2Next: 'Další novinka',
      slide3Title: 'Z\u00a0odznaků jsou medaile',
      slide3Body:
        'Medaile s\u00a0každou úrovní roste a ukážu ti, kolik do další chybí. Přibyly nové, třeba Silvestr, a\u00a0některé jsou tajné.',
      slide3Next: 'Ještě jedna věc',
      slide4Title: 'Profil na jedné stránce',
      slide4Body:
        'Na Profilu máš srdcovky, odznaky, fotky i\u00a0přidané hospody. Nastavení je pod ozubeným\u00a0kolem.',
      slide4Done: 'Jdu na pivo',
    },
  },

  about: {
    // Screen title reuses settings.about.title ("O appce") as the single source.
    tagline: 'Tvůj kompas k nejbližšímu pivu.',
    // Shown while this version's release note is being fetched.
    loading: 'Načítám novinky…',
    // The backend has no note for this version (404 / empty).
    empty: 'Pro tuhle verzi tu zatím žádné novinky nemám.',
    // Offline / timeout / dormant backend — distinct from "empty" so the user
    // knows it's worth trying again later.
    error: 'Novinky se teď nepodařilo načíst. Mrkni na to za chvíli.',
    footer: 'Bez reklam · Bez placení',
  },

  tours: {
    openMap: 'Otevřít mapu', privateRun: 'Jen tvůj průchod', pastRun: 'Předchozí průchod',
    mapUnavailable: 'Mapa se nenačetla. Zastávky máš dál v seznamu.',
    clearSearch: 'Vymazat hledání',
    backToSearch: 'Zpět k výběru',
    title: 'Tour de pub', mine: 'Moje tour', create: 'Naplánovat tour', newTour: 'Nová tour',
    empty: 'Vyber 2 až 8 hospod, pošli partě odkaz a vyrazte. Po cestě ti ukážu, kolik to je pěšky a co kde čepujou.',
    emptyTitle: 'Naplánuj tah po hospodách', edit: 'Upravit', editTour: 'Upravit tour',
    untitled: 'Rozepsaná tour', draft: 'Rozepsaná', continueDraft: 'Pokračovat v rozepsané tour',
    ready: 'Připravená', imported: 'Uložená', active: 'Právě jdete', ended: 'Ukončeno',
    name: 'Název', optional: 'Bez termínu',
    when: 'Kdy', whenTitle: 'Kdy jdete?', whenToday: 'dnes', whenTomorrow: 'zítra',
    whenPast: (day: string) => `${day} už bylo`, whenTime: 'Čas', whenOtherTime: 'Jiný čas', whenQuickTimes: 'Rychlé časy',
    whenDone: 'Hotovo', whenClear: 'Bez termínu', whenPickDay: 'Nejdřív vyber den.',
    whenDst: 'Tahle hodina kvůli změně času neexistuje.',
    whenEarlierWeeks: 'Předchozí týdny', whenLaterWeeks: 'Další týdny',
    whenTimeDown: 'O čtvrt hodiny dřív', whenTimeUp: 'O čtvrt hodiny později',
    whenUnavailable: 'nejde vybrat',
    pastTitle: 'Termín už proběhl', pastMessage: 'Vyber nový, nebo tour ulož bez termínu.',
    pickNewDate: 'Vybrat nový termín', saveWithoutDate: 'Uložit bez termínu',
    suggestedTitle: (day: number | null) => day === null ? 'Tour po hospodách' : `${['Pondělí', 'Úterý', 'Středa', 'Čtvrtek', 'Pátek', 'Sobota', 'Neděle'][day]} po hospodách`,
    addPubs: 'Přidat hospody', pickerDone: (pubs: string) => `Hotovo · ${pubs}`,
    needTwo: 'Vyber aspoň 2 hospody.', needOne: 'Přidej ještě aspoň jednu hospodu.',
    pickerFull: 'Víc než 8 se nevejde. Nějakou odeber.',
    nearStop: (n: number) => `Kousek od ${n}. zastávky`, walkMinutes: (minutes: number) => `${minutes} min pěšky`,
    addAsStop: (n: number) => `Přidat jako ${n}. zastávku`, removeFromTour: 'Odebrat z tour',
    pubAdded: (n: number) => `Přidáno, ${n}. zastávka`, pubRemoved: 'Odebráno',
    addPubA11y: (name: string) => `${name}, přidat do tour`, removePubA11y: (name: string, n: number) => `${name}, ${n}. zastávka, odebrat`,
    removeChipA11y: (name: string) => `Odebrat ${name}`, pubDetailA11y: (name: string) => `Detail hospody ${name}`,
    save: 'Uložit tour', saveChanges: 'Uložit změny', saved: 'Uloženo v telefonu',
    unsavedTitle: 'Uložit změny v tour?', discardDraftTitle: 'Zahodit rozepsanou tour?', discard: 'Zahodit změny', stay: 'Zůstat',
    addStop: 'Přidat zastávku', replaceStop: 'Vyměnit zastávku', removeStop: 'Odebrat zastávku',
    publishPublic: 'Zveřejnit pro všechny', updatePublic: 'Aktualizovat veřejnou verzi', unpublish: 'Stáhnout z veřejných',
    sharePublic: 'Sdílet veřejný odkaz', unpublishTitle: 'Stáhnout z veřejných?', unpublishMessage: 'Kdo si ji uložil, tomu zůstane.',
    publicState: 'Veřejná', publicHiddenState: 'Skrytá po nahlášení', fromPublic: 'Z veřejných', publicTour: 'Veřejná tour',
    seenByAll: 'Tohle uvidí všichni', notSeenByOthers: 'Tohle ostatní neuvidí',
    seenTitle: (title: string) => `Název „${title}“`,
    seenStops: (pubs: string, distance: string) => `${pubs} v tomhle pořadí, asi ${distance} pěšky`,
    seenChallenges: (n: number) => czechPlural(n, { one: 'Výzva u 1 hospody', few: `Výzvy u ${n} hospod`, many: `Výzvy u ${n} hospod` }),
    seenProfile: 'Tvoje přezdívka a profil', hiddenMeetup: 'Datum a čas srazu', hiddenPrivate: 'Tvoje piva a poloha',
    publishNameNote: 'Když je v názvu něčí jméno, radši ho změň. Název uvidí každý.',
    publishUndoNote: 'Z veřejných ji můžeš kdykoli stáhnout. Kdo si ji mezitím uložil, tomu zůstane.',
    rulesPrefix: 'Zveřejněním souhlasíš s ', rulesLink: 'pravidly pro veřejné tour', rulesSuffix: '.',
    publishAction: 'Zveřejnit', publishedNotice: 'Tour je veřejná.', rulesUrl: 'https://na-pivo.cz/podminky#verejne-tour',
    signIn: 'Přihlásit se', pickNickname: 'Vybrat přezdívku', openPrivacy: 'Otevřít soukromí',
    report: 'Nahlásit', reportTitle: 'Nahlásit tuhle tour?',
    reportMessage: 'Přestane se ti ukazovat. Když ji nahlásí víc lidí, schová se všem, dokud se na ni nepodívám.',
    reported: 'Nahlášeno. V tomhle telefonu ti ji už neukážu.', reportFailed: 'Nahlášení se nepovedlo odeslat. Zkus to znovu.',
    backToTours: 'Zpět na Tour de pub', publicNewer: 'Veřejná · máš novější změny',
    privateHidesPublic: 'Se skrytým profilem se schovají i tvoje veřejné tour.', authorA11y: (nickname: string) => `Profil autora ${nickname}`,
    publicMeta: (city: string, pubs: string, distance: string) => [city, `${pubs}, asi ${distance} pěšky`].filter(Boolean).join(' · '),
    crewAlone: 'Zatím bez party', crewNone: 'Bez party', crewInvite: 'Přizvat partu', crewInviteMore: 'Přizvat další', crewInviteHint: 'Ukáže QR kód pro partu',
    crewGoing: (n: number) => `${n} v partě`, crewLeftMember: (names: string[]) => names.length > 1 ? `${names.join(', ')} už s vámi nejdou` : `${names[0]} už s vámi nejde`,
    crewCounted: 'Přidal jsem tě k lidem, co ji prošli.', crewPending: 'Až chytíš signál, přidám tě k lidem, co ji prošli.',
    crewClosed: 'Průchod je uzavřený, nikdo další se nepřidá.', crewRefused: 'Do party se už přidat nešlo. Tour můžeš jít i po svém.',
    crewRefusedOrganizer: 'Partu k týhle tour teď přizvat nejde. Tour můžeš jít i po svém.',
    crewSheetNote: 'Kdo to naskenuje, přidá se k vám. Uvidí tvoji přezdívku a kdo další jde.',
    crewQrA11y: 'QR kód pro připojení k partě',
    // Cinknutí to friends from Parta who are not at the table; "parta" on the tour screen is the crew, so these say "kámoši".
    crewPing: 'Cinknout kámošům', crewPingShort: 'Cinknout', crewPingThem: 'Cinknout jim', crewPingFriends: 'Kámoši z Party',
    crewPingAway: 'Kámoši, co tu nejsou', crewPingHint: 'Vybereš, kterým kámošům z Party cinkneš',
    crewPingNote: (title: string, pub: string, heading: boolean, together: boolean) =>
      `Dám vědět, že ${together ? 'jdete' : 'jdeš'} tour „${title}“ a ${heading ? (together ? 'kam míříte' : 'kam míříš') : (together ? 'kde sedíte' : 'kde sedíš')}: ${pub}.`,
    crewPingSent: 'Cinknuto. Kámoši to vidí v Partě.', crewPingQueued: 'Cinknu, až chytneš signál.',
    crewPingGhost: 'Máš zapnutý neviditelný režim, cinknutí by nikomu nepřišlo.', crewPingAllHere: 'Všichni kámoši už jdou s tebou.',
    crewPingMessage: (title: string) => `Tour de pub: ${title}`,
    crewPrivacyTitle: 'Kdo co vidí',
    crewPrivacyBody: 'Parta vidí jen, kdo jde s vámi. Zastávky a piva zůstávají v telefonu. Když projdeš aspoň polovinu hospod, započítám tě do čísla u tour.',
    crewPrivacyOptedOut: 'Parta vidí jen, kdo jde s vámi. Zastávky a piva zůstávají v telefonu. Do čísla u tour tě nezapočítám.',
    crewOptOut: 'Nezapočítávat mě', crewOptIn: 'Započítávat mě',
    crewLeave: 'Odejít z tour', crewLeaveTitle: 'Odejít z tour?', crewLeaveMessage: 'Tvůj průchod skončí a parta uvidí, že už nejdeš.',
    crewInvitedBy: (name: string) => `${name} tě bere na tour`,
    crewAlreadyGoing: (name: string, others: number) => czechPlural(others, { one: `${name} a ${others} další už jdou`, few: `${name} a ${others} další už jdou`, many: `${name} a ${others} dalších už jdou` }),
    crewJoin: 'Jdu s vámi', crewSignInJoin: 'Přihlásit se a jít s vámi',
    crewJoinPrivacy: 'Parta uvidí jen, že jdeš s ní. Hospody a piva zůstanou v tvém telefonu.',
    crewActiveRun: 'Už máš jednu tour rozchozenou.', crewActiveRunMessage: 'Ukončit ji a jít s partou?', crewEndAndJoin: 'Ukončit a jít s partou',
    crewHistory: (n: number, counted: boolean) => [n > 1 ? `${n} v partě` : 'Bez party', counted ? 'započítáno' : null].filter(Boolean).join(' · '),
    peopleCount: (n: number) => n > 0 ? czechPlural(n, { one: `Prošel ji ${n} člověk`, few: `Prošli ji ${n} lidé`, many: `Prošlo ji ${n} lidí` }) : 'Zatím ji nikdo neprošel',
    publicWithPeople: (n: number) => `Veřejná · ${czechPlural(n, { one: `prošel ji ${n} člověk`, few: `prošli ji ${n} lidé`, many: `prošlo ji ${n} lidí` })}`,
    discoverTitle: 'Veřejné tour', discoverOpen: 'Hledat veřejné tour', discoverPlaceholder: 'Město, hospoda nebo název tour', discoverClear: 'Smazat hledání',
    discoverNearMe: 'Kolem mě', discoverStops: 'Počet hospod', discoverStopsA11y: (chosen: string) => `Počet hospod, ${chosen}`, discoverStopsTitle: 'Kolik hospod?', discoverStopsAny: 'Je mi to jedno',
    discoverStopsRange: { '2-3': '2 až 3 hospody', '4-5': '4 až 5 hospod', '6-8': '6 až 8 hospod' },
    discoverChallenges: 'S výzvami', discoverNoLocation: 'Polohu nemám, napiš město nebo hospodu.',
    discoverNothingNear: 'Do 25 km od tebe zatím nikdo nic nezveřejnil. Nejbližší jsou tyhle:', discoverNothingNearFiltered: 'Do 25 km od tebe s těmahle filtry nic není. Nejbližší jsou tyhle:',
    discoverPlanOwn: 'Naplánovat vlastní tour', discoverNothing: 'Zatím tu nic není. Naplánuj první a zveřejni ji.',
    discoverNothingFiltered: 'S těmahle filtry nic nemám.', discoverNothingFor: (q: string) => `Na „${q}“ nic nemám. Zkus město nebo jinou hospodu.`, discoverClearFilters: 'Zrušit filtry',
    discoverOffline: 'Bez spojení nové tour nenačtu. Svoje tour máš dál v telefonu.', discoverFailed: 'Nedotáhlo se.',
    discoverPeople: (n: number) => czechPlural(n, { one: `prošel ji ${n} člověk`, few: `prošli ji ${n} lidé`, many: `prošlo ji ${n} lidí` }),
    discoverWithChallenges: 's výzvami', discoverDistanceA11y: (distance: string) => `${distance} od tebe`,
    challenge: 'Výzva', challengeLabel: 'Výzva:', challengeA11y: (text: string) => `Výzva: ${text}`,
    addChallenge: 'Přidat výzvu', editChallenge: 'Upravit výzvu', saveChallenge: 'Uložit výzvu',
    removeChallenge: 'Odebrat výzvu', writeChallenge: 'Napiš výzvu', challengeHint: 'Něco, co zvládne každý u stolu.',
    challengePlaceholder: 'Třeba: zeptej se výčepního, jak dlouho tu čepuje',
    challengeCount: (length: number, max: number) => `${length}/${max}`,
    challengeCountA11y: (left: number) => czechPlural(left, { one: 'Zbývá 1 znak', few: `Zbývají ${left} znaky`, many: `Zbývá ${left} znaků` }),
    stops: 'Zastávky', reorder: 'Změnit pořadí', reorderDone: 'Hotovo', moveUp: 'Posunout nahoru',
    moveDown: 'Posunout dolů', dragHint: 'Podrž úchyt a přesuň zastávku. Pořadí lze měnit i šipkami.',
    stopRemoved: 'Zastávka odebraná',
    moved: 'Pořadí změněno', removed: 'Zastávka odebrána', undo: 'Vrátit',
    firstStop: 'Místo srazu', firstStopChanges: 'První zastávka je místo srazu.',
    start: 'Vyrazit', run: 'Tvůj průchod', nextStop: 'Další zastávka', navigate: 'Navigovat',
    visited: 'Navštíveno', skipped: 'Přeskočeno', pending: 'Čeká', markVisited: 'Označit jako navštívenou',
    skip: 'Přeskočit zastávku', undoMark: 'Vrátit označení', end: 'Ukončit tour',
    endTitle: 'Ukončit průchod?', endMessage: 'Dosavadní zastávky zůstanou v tvém přehledu.',
    anotherRun: 'Už máš jednu tour rozchozenou.', anotherRunMessage: 'Ukončit ji a vyrazit na tuhle?',
    endAndStart: 'Ukončit a vyrazit', runPrivacy: 'Označení vidíš jen ty. Pivo ani návštěvu do deníku nepřidá.',
    allDone: 'Všechny zastávky máš za sebou.', repeat: 'Vytvořit kopii', history: 'Předchozí průchody',
    share: 'Poslat partě', sharedPlan: 'Sdílený plán', createLink: 'Vytvořit odkaz',
    shareNotice: 'Kdokoli s odkazem uvidí název tour, sraz, vybrané hospody a výzvy. Tvůj pohyb, průchod ani pití nesdílím.',
    localNotice: 'Nepublikované plány a průchody jsou jen v telefonu. Odhlášením nebo odinstalací o ně přijdeš.',
    published: 'Publikovaná verze', publishChanges: 'Aktualizovat odkaz', unpublished: 'V telefonu máš novější plán.',
    shareLink: 'Sdílet odkaz', copyLink: 'Kopírovat odkaz', copied: 'Odkaz zkopírován',
    revoke: 'Zrušit odkaz', revokeTitle: 'Zrušit sdílený odkaz?',
    revokeMessage: 'Odkaz přestane fungovat. Kopie, které si ostatní uložili, jim zůstanou.',
    revoked: 'Odkaz zrušen', expires: 'Platnost odkazu', rotate: 'Vytvořit nový odkaz',
    rotateMessage: 'Předchozí odkaz přestane fungovat. Nový bude potřeba poslat znovu.',
    invite: 'Pozvánka na tour', import: 'Uložit tour', openSaved: 'Otevřít uloženou tour',
    importUpdate: 'Je tu novější plán', updateMessage: 'Plán se změnil. Tvůj dosavadní průchod zůstane podle původního plánu.',
    update: 'Přijmout nový plán', keepVersion: 'Nechat uloženou verzi', checkUpdate: 'Zkontrolovat nový plán',
    invalidLink: 'Odkaz už neplatí nebo tour není dostupná.',
    delete: 'Smazat tour', deleteTitle: 'Smazat tuhle tour?',
    deleteMessage: 'Smažeš plán i jeho místní průchody. Sdílený odkaz se zruší online.',
    conflict: 'Na účtu je jiná verze', conflictMessage: 'Tvoje změny zůstaly v telefonu. Vyber verzi z účtu, nebo si vlastní změny nech jako novou tour.',
    useServer: 'Použít verzi z účtu', keepBoth: 'Zachovat jako novou tour',
    restore: 'Obnovit plány z účtu', restored: 'Plány z účtu obnoveny', retry: 'Zkusit znovu',
    close: 'Zavřít', back: 'Zpět', cancel: 'Zrušit', more: 'Možnosti tour', loading: 'Načítám tour',
    map: 'Mapa', expandMap: 'Zvětšit mapu', overlappingStops: 'Vyber zastávku',
    routeOrder: 'Čára ukazuje pořadí zastávek.', inTour: 'Už v tour',
    searchPlaceholder: 'Město nebo název hospody', searchArea: 'Hledat v této oblasti',
    searchEmpty: 'Žádné hospody. Zkus jiné město nebo posuň mapu.',
    searchOffline: 'Nová místa se nenačetla. Vybírat můžeš z dříve načtených hospod.',
    searchError: 'Hospody se nenačetly. Zkus to znovu.', search: 'Hledat',
    openingHoursUnknown: 'Otevírací dobu nemám ověřenou.', fullPubDetail: 'Detail hospody',
    addThisPub: 'Přidat tuto hospodu', replaceWithPub: 'Vybrat tuto hospodu',
    rail: 'Tour', railA11y: 'Otevřít Tour de pub', otherTours: 'Další tour', pastRuns: 'Prošlé',
    continueRun: 'Pokračovat v tour', createNew: 'Naplánovat novou', upNext: 'Nejbližší',
    runOf: (visited: number, total: number) => `${visited} ${[2, 3, 4, 6, 7].includes(total) ? 'ze' : 'z'} ${total} hospod`,
    nextPub: (name: string, minutes?: number) => `další ${name}${minutes ? `, asi ${minutes} min` : ''}`,
    compassNudge: (name: string) => `Tour: další ${name}`, open: 'Otevřít',
    openTour: (name: string) => `Otevřít tour, další zastávka ${name}`,
    counterAllDone: 'Tour: všechno odškrtnuté',
    counterAtStop: (stop: number) => `Tour: sedíš na ${['jedničce', 'dvojce', 'trojce', 'čtyřce', 'pětce', 'šestce', 'sedmičce', 'osmičce'][stop - 1] ?? stop}, pivo ji odškrtne`,
    stopCheckedOff: (stop: number) => `${['Jednička', 'Dvojka', 'Trojka', 'Čtyřka', 'Pětka', 'Šestka', 'Sedmička', 'Osmička'][stop - 1] ?? stop} v tour odškrtnutá`,
    countedAtStop: (beer: number, stop: number) => `${beer}. pivo, ${['jednička', 'dvojka', 'trojka', 'čtyřka', 'pětka', 'šestka', 'sedmička', 'osmička'][stop - 1] ?? stop} odškrtnutá`,
    logBeerAt: (stop: number) => `Zapsat pivo na ${['jedničce', 'dvojce', 'trojce', 'čtyřce', 'pětce', 'šestce', 'sedmičce', 'osmičce'][stop - 1] ?? stop}`,
    addMeetup: 'Přidat sraz', youAreHere: 'Tady sedíte', today: 'Dnes',
    onDay: ['V pondělí', 'V úterý', 'Ve středu', 'Ve čtvrtek', 'V pátek', 'V sobotu', 'V neděli'],
    closedOn: (day: string) => `${day} zavřeno`,
    closedOnMeetup: (names: string, count: number) => `V den srazu ${count > 1 ? 'mají' : 'má'} zavřeno: ${names}.`,
    onTheWaySince: (time: string) => `Na cestě od ${time}`,
    progress: (visited: number, total: number) => `${visited} / ${total} navštíveno`,
    summary: (pubs: string, distance: string) => `${pubs}, asi ${distance} pěšky`,
    walkLeg: (distance: string, minutes: number) => `${distance} · asi ${minutes} min pěšky`,
    navigateMinutes: (minutes: number) => `Navigovat · ${minutes} min`,
    errors: {
      network: 'Bez spojení se plán nezveřejní. Změny máš dál v telefonu.',
      storage: 'Změny se nepodařilo uložit do telefonu. Zkus to znovu.',
      invalid: 'Doplň název a 2 až 8 různých hospod. Datum může být nejvýš 90 dní dopředu.',
      date: 'Zadej platné datum do 90 dní a čas ve tvaru 18:00, nebo nech sraz bez termínu.',
      limit: 'Máš plný seznam tour. Nejdřív některou smaž.',
      duplicate: 'Tuhle hospodu už v tour máš.',
      stopLimit: 'Do jedné tour se vejde nejvýš 8 hospod.',
      session: 'Účet se změnil. Vrať se na Moje tour.',
      auth: 'Obnov přihlášení a zkus to znovu. Tvoje změny zůstaly v telefonu.',
      unavailable: 'Tour se nepodařilo načíst. Zkus to znovu.',
      navigation: 'Mapy se nepodařilo otevřít. Zkus to znovu.',
      publicSignIn: 'Zveřejnit může jen přihlášený.', publicNickname: 'Nejdřív si vyber přezdívku. Bude u tvých veřejných tour.',
      publicPrivate: 'Veřejné tour jdou jen s veřejným profilem.', publicRules: 'Nejdřív odsouhlas pravidla pro veřejné tour.',
      publicText: 'Tohle nezveřejním. Veřejné tour nesmí být o tom, kdo víc nebo rychleji vypije, ani obsahovat odkazy nebo telefonní čísla.',
      publicTitle: (title: string) => `Název „${title}“ nezveřejním. Veřejné tour nesmí být o tom, kdo víc nebo rychleji vypije, ani obsahovat odkazy nebo telefonní čísla.`,
      publicThrottled: 'Moc pokusů najednou. Zkus to za chvíli.',
      publicChallenge: (name: string) => `${name}: tuhle výzvu nezveřejním. Veřejné výzvy nesmí být o tom, kdo víc nebo rychleji vypije, ani obsahovat odkazy nebo telefonní čísla.`,
      publicUnknownPub: (name: string) => `${name}: tuhle hospodu u veřejné tour neznám. Vyměň ji za hospodu z hledání.`,
      publicHiddenPub: (name: string) => `${name}: tuhle hospodu komunita skryla. Vyměň ji za jinou.`,
      publicHidden: 'Tour je skrytá po nahlášení. Podívám se na ni.', publicLimit: (count: number) => `Veřejných tour můžeš mít nejvýš ${count}. Nejdřív některou stáhni.`,
      publicNetwork: 'Bez spojení tour nezveřejním. Máš ji dál v telefonu.',
    },
  },

  privacy: {
    title: 'Soukromí',
    body: [
      'Sbírám omezené provozní a produktové statistiky: otevření aplikace, zobrazení hlavních obrazovek, použití hlavních tlačítek a ovládacích prvků, výsledky vybraných akcí, technické chyby, verzi aplikace a součet nachozených metrů.',
      'U produktových událostí posílám jen pevné hrubé kategorie. Neposílám v nich názvy hospod ani piv, tvoje texty, identifikátory prohlížených profilů nebo příspěvků, vyhledávací dotazy, GPS body ani trasu.',
      'Jednotlivé provozní, produktové a chybové události na serveru automaticky mažu nejpozději po 90 dnech. Souhrnné čítače můžou zůstat po dobu existence účtu a události spojené s účtem najdeš v exportu dat.',
      'Pro stažení okolních hospod může aplikace poslat aktuální nebo přibližnou polohu na můj server.',
      'Nachozené metry se počítají v telefonu a na server se posílá jen součet po dávkách, nikdy GPS body ani trasa.',
      'Průběžnou GPS historii, trasu pohybu ani jednotlivé GPS body neukládám.',
      'Když vytvoříš odkaz na tour, uložím její název, sraz a vybrané hospody na server. Plán uvidí kdokoli s odkazem. Tvůj pohyb ani průchod tour nesdílím. Zrušení odkazu nesmaže kopie, které si ostatní už uložili.',
      'Hospodské připomínky jsou dobrovolná funkce s polohou na pozadí: appka si kolem nejbližších hospod nastaví zóny a telefon ji upozorní, když do některé vejdeš. Vyhodnocuje se to přímo v telefonu a na server se při tom žádné souřadnice neposílají. Funkci kdykoli vypneš.',
      'Pro zobrazení otevírací doby aplikace pošle název a polohu vybrané hospody na můj server, který dohledá otevírací dobu.',
      'Aplikace vytvoří anonymní náhodný identifikátor zařízení a odešle ho na můj server, aby každému zařízení patřil dočasný účet. Identifikátor neobsahuje žádné osobní údaje a slouží jen k odlišení zařízení.',
      'Účet je dobrovolný. Když se zaregistruješ e-mailem, ukládám e-mail a heslo jen v zahashované podobě. Přes Google nebo Apple dostanu identifikátor účtu, e-mail a případně jméno; heslo od poskytovatele nikdy nevidím.',
      'Profil může obsahovat přezdívku, jméno a avatar. U veřejného profilu tě podle přezdívky a fotky můžou najít ostatní; přesná poloha, deníček a jednotlivá piva se veřejně nezobrazují.',
      'Počítadlo, historie večerů, návštěvy hospod a tvoje soukromá hodnocení se ukládají lokálně a synchronizují se jen k tvému účtu. Po odhlášení nebo smazání účtu appka lokální soukromý deníček, hodnocení a čekající private sync fronty z tohohle zařízení vyčistí.',
      'Sdílení večera s Partou je ve výchozím stavu zapnuté: přijatí kamarádi můžou vidět, že jsi v hospodě, kolik piv máš a tvůj poslední zápis. V nastavení Party to vypneš, nebo použij ghost mode. Nikdo jiný než přijatí kamarádi tyhle údaje nevidí.',
      'Na mapě u hospody ukazuju, kolik piv se v ní minulý týden vypilo, a v žebříčku hospod součty za minulý týden, letos a celkem. Jsou to jen součty bez jmen, dnů a časů a hospodu ukážu, až když v ní pili aspoň tři různí lidi. Dokud máš zapnutý ghost mode, tvoje piva do nich nezapočítám. Zapnutí se v číslech projeví do několika hodin.',
      'Fotky piv ukládám na serveru bez metadat a GPS polohy. Ve výchozím stavu je vidí jen tvoje Parta; veřejné jsou jen fotky, které přihlásíš do fotosoutěže.',
      'Když vyfotíš pivní lístek přes „Vyfoť menu“, fotka se přes můj server pošle ke zpracování AI modelu (přes službu OpenRouter). Fotku neukládám a poskytovatel ji podle mého nastavení nesmí použít k trénování.',
      'Když povolíš notifikace, uložím si push token zařízení a zprávy z Party doručuju přes Expo Push Service. Hospodské připomínky se zobrazují přímo v telefonu a nikam se neposílají.',
      'Když dobrovolně doplníš otevírací dobu, piva na čepu nebo chybějící hospodu, aplikace tyto údaje odešle na můj server. Tyhle příspěvky pomáhají ostatním a můžou se zobrazit veřejně, ale bez tvé přesné polohy.',
      'V účtu si můžeš vyžádat JSON export svých dat e-mailem nebo účet smazat. Po smazání vyčistím lokální soukromá data v appce a serverová data se smažou podle zásad ochrany osobních údajů.',
      'Transakční e-maily, například ověření adresy, obnova hesla, export dat nebo potvrzení smazání účtu, posílám přes Resend. Téhle službě předám jen e-mailovou adresu a obsah nutný k odeslání zprávy.',
    ],
  },

  // — Social rail in the evening card: three doors to the community half of the
  //   product, which was otherwise only reachable from an overflow sheet.
  a11y: {
    mapPub: (name: string, visits: number) =>
      visits > 0 ? `${name}, navštíveno ${visits}krát` : `${name}, zatím nenavštíveno`,

    // — "Zmapuj hospodu" / Mapér —
    // `into`/`next` are the into-level XP numbers shown on the visible bar so the
    // spoken progress matches the rendered progress. `next == null` = maxed level.
    mapperLevel: (n: number, title: string, into: number, next: number | null) =>
      next == null
        ? `Mapér úroveň ${n}, ${title}, máš všechno`
        : `Mapér úroveň ${n}, ${title}, ${into} z ${next} XP`,
    back: 'Zpět',
  },
  xp: {
    account: {
      rookie: 'Zelenáč',
      taster: 'Ochutnávač',
      journeyman: 'Pivní tovaryš',
      barkeep: 'Výčepní',
      brewmaster: 'Sládek',
      beerMaster: 'Pivní mistr',
      beerLegend: 'Pivní legenda',
    },
    mapper: {
      newcomer: 'Nováček',
      noticer: 'Všímálek',
      regular: 'Štamgast',
      connoisseur: 'Znalec',
      pubSage: 'Hospodský mudrc',
      cartographer: 'Pivní kartograf',
      localLegend: 'Legenda lokálu',
    },
  },

  amenities: {
    outdoorTap: {
      label: 'Venkovní výčep',
      short: 'Výčep',
    },
    tankBeer: {
      label: 'Tankové pivo',
      short: 'Tank',
    },
  },

  clientErrors: {
    offline: 'Server teď není dostupný.',
    account: 'Účet teď není připravený.',
    auth: 'Přihlášení vypršelo.',
    network: 'Síť neodpovídá. Zkus to za chvíli.',
    save: 'Nepodařilo se to uložit. Zkus to znovu.',
    actionFailed: 'Tohle se teď nepovedlo.',
    eventsSignIn: 'Pro domácí setkání se nejdřív přihlas.',
    eveningMissing: 'Takový večer tu není.',
    genericRetry: 'Něco se pokazilo. Zkus to prosím znovu.',
    incompleteResponse: 'Server poslal neúplná data.',
  },

  liveActivity: {
    pubFallback: 'Pivní večer',
    beerFallback: 'Pivo',
    beerWord: (count: number) =>
      czechPlural(count, { one: 'pivo', few: 'piva', many: 'piv' }),
    latestBeerFallback: 'Poslední pivo',
    latestAt: (time: string) => `zapsáno v ${time}`,
    firstBeerPouring: 'První pivo se teprve čepuje',
    addBeer: 'Ještě jedno',
    addBeerA11y: 'Přidat stejné pivo',
    openCounter: 'Otevřít počítadlo',
    homeTransit: (time: string, stop: string) =>
      `Domů ${time}${stop ? ` · ${stop}` : ''}`,
    homeTransitCountdown: 'za',
    homeTransitMissed: 'Už jedeš nočkou',
    homeTransitA11y: (time: string, stop: string, line: string) =>
      `Poslední přímý spoj domů${line ? `, linka ${line}` : ''}, odjezd ${time}${stop ? ` ze zastávky ${stop}` : ''}`,
  },

  homeTransit: {
    title: 'Poslední přímý spoj domů',
    /** GTFS route_type: 0 tram, 1 metro, 2 vlak, 3 bus, 4 přívoz, 7 lanovka, 11 trolejbus. */
    vehicleLine: (routeType: number | null, line: string) => {
      const vehicle =
        { 0: 'Tramvaj', 1: 'Metro', 2: 'Vlak', 3: 'Bus', 4: 'Přívoz', 7: 'Lanovka', 11: 'Trolejbus' }[
          routeType ?? -1
        ] ?? 'Linka';
      return `${vehicle} ${line}`;
    },
    route: (line: string, from: string, to: string) => `${line ? `${line} · ` : ''}${from} → ${to}`,
    leavesIn: (minutes: number) =>
      minutes < 60
        ? `za ${Math.max(minutes, 1)} min`
        : `za ${Math.floor(minutes / 60)} h ${minutes % 60} min`,
    openIdos: 'Kudy domů v IDOS',
    openIdosA11y: 'Kudy domů, otevře hledání spojení v IDOS',
    footnote: 'Bez nočních linek · ROPID, CC\u00a0BY\u00a04.0, upraveno',
  },

  notifications: {
    pubReminderChannel: 'Připomínky v hospodě',
    pubReminderTitle: (pubName: string) => `Sedíš v ${pubName}?`,
    pubReminderBody: 'Otevři počítadlo a připiš si čárku.',
    beerCountChannel: 'Připomínky počítadla',
    beerCountTitle: 'Nezapisuješ si pivo?',
    beerCountBody: 'Klepni a přidej další čárku do počítadla.',
    homeTransitChannel: 'Poslední přímý spoj domů',
    homeTransitTitle: 'Za 20 minut ti jede poslední přímý spoj domů',
    homeTransitBody: (line: string, time: string, stop: string) =>
      `${line ? `Linka ${line} odjíždí` : 'Odjíždí'} ${atTime(time)}${stop ? ` ze zastávky ${stop}` : ''}.`,
    closingTimeChannel: 'Zavíračka',
    closingTimeTitle: (pubName: string, time: string) => `${pubName || 'Tvoje hospoda'} zavírá ${atTime(time)}`,
    closingTimeBody: (places: string[]) =>
      places.length === 1
        ? `Déle má otevřeno ${places[0]}.`
        : `Déle mají otevřeno ${places.slice(0, -1).join(', ')} a ${places[places.length - 1]}.`,
    closingTimeBodyHidden: (count: number) =>
      count === 1
        ? 'Kousek odsud má déle otevřeno ještě jedna hospoda.'
        : `Kousek odsud mají déle otevřeno ještě ${count} hospody.`,
    closingTimePlace: (pubName: string, distance: string) => `${pubName} (${distance})`,
    closingTimeAction: (pubName: string, distance: string) => `${pubName || 'Hospoda'} · ${distance}`,
  },

  pubDetail: {
    tabs: ['Info', 'Aktivita'] as const,
    navigate: 'Navigovat',
    beerFallback: 'Pivo',
    tapsTitle: 'Na čepu',
    visits: 'Návštěv',
    reportTitle: 'Co je špatně?',
    reportClosed: 'Hospoda zavřela',
    reportNotPub: 'Není to hospoda',
    reportConfirmTitle: (name: string) => `Nahlásit „${name}“?`,
    reportConfirmBody: 'Nahlášení může hospodu skrýt i ostatním.',
    reportQueued: 'Nahlášení je uložené. Pošlu ho, až bude signál.',
    renameTitle: 'Opravit název',
    renameLabel: 'Název hospody',
    renameSave: 'Uložit název',
    beersLastWeek: (n: number) =>
      `Minulý týden tu ${czechPlural(n, { one: 'padlo', few: 'padla', many: 'padlo' })} ${beerCountLabel(n)}`,
    eventRunning: 'Právě běží',
    eventTomorrow: 'Zítra',
    tapsRotating: 'Rotující nabídka',
    privateVerdict: (verdict: string) => `Jen pro tebe · tvůj palec: ${verdict}`,
    favoriteRemoved: 'Odebráno ze srdcovek',
    eventToday: (range: string) => `Dnes ${range}`,
  },

  beerWatch: {
    watch: 'Hlídat',
    watching: 'Hlídáš',
    failedToast: 'Teď se to nepovedlo. Zkus to za chvíli.',
    unknownBeerToast: 'Tohle pivo zatím neznám, takže ho hlídat neumím.',
    tooManyToast: 'Hlídáš už 50 piv. Nějaké odeber a pak přidej další.',
    title: 'Hlídaná piva',
    radiusFailed: 'Vzdálenost se neuložila. Zkus to znovu.',
    empty: 'Zatím nic nehlídáš. Ťukni na pivo na lístku hospody a vyber Hlídat pivo.',
    loadFailed: 'Hlídaná piva se nedotáhla.',
    retry: 'Zkusit znovu',
    openSettings: 'Otevřít nastavení',
    helped: (n: number) =>
      `Pomohlo ${n} ${czechPlural(n, { one: 'člověku', few: 'lidem', many: 'lidem' })}`,
  },

  homePoint: {
    title: 'Domovský bod',
    lead: 'Kde je tvoje domácí základna?',
    addressPlaceholder: 'Třeba Vinohradská 12, Praha',
    searching: 'Hledám místo…',
    or: 'nebo',
    privacy:
      'Adresu jednou pošlu geokódovací službě, ať ji najdu na mapě. V telefonu zůstane jen ten potvrzený bod, žádná historie polohy ani trasy.',
    permissionDenied:
      'Poloha je vypnutá. Domov si označ ťuknutím do mapy, nebo si polohu povol v nastavení telefonu.',
    clear: 'Smazat domovský bod',
    save: 'Uložit domov',
    emptyQueryError: 'Napiš adresu nebo město, které mám najít.',
    notFoundError: 'Tohle místo se nepodařilo najít. Zkus doplnit ulici, číslo nebo město.',
    searchFailedError: 'Místo se teď nepodařilo dohledat. Zkus to prosím znovu.',
  },

  auth: {
    genericRetry: 'Něco se pokazilo. Zkus to prosím znovu.',
    network: 'Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.',
    invalidSession: 'Server neposlal platné přihlášení. Zkus to prosím znovu.',
    unsupported: 'Tohle na tvém telefonu nejde.',
    socialMisconfigured: 'Google přihlášení teď není správně nastavené. Zkus zatím přihlášení e-mailem.',
    socialPlayServices: 'Google Play služby nejsou dostupné nebo potřebují aktualizaci. Aktualizuj je v Google Play, nebo se přihlas e-mailem.',
    socialAccountPicker: 'Výběr Google účtu se nepodařilo otevřít. Zkontroluj účet v telefonu, zkus to znovu, nebo se přihlas e-mailem.',
    socialFailed: 'Přihlášení přes poskytovatele se nezdařilo. Zkus to prosím znovu.',
    signInFailed: 'Přihlášení se nezdařilo.',
  },
  tourInvites: {
    invite: 'Pozvat partu',
    sheetTitle: 'Pozvat na tour',
    send: (n: number) => n > 0 ? `Pozvat ${n} ${czechPlural(n, { one: 'kámoše', few: 'kámoše', many: 'kámošů' })}` : 'Pozvat',
    alreadyInvited: 'Už má pozvánku',
    linkChanged: 'Odkaz se změnil, pozvi znovu',
    shareElsewhere: 'Poslat odkaz jinam',
    noFriends: 'V partě zatím nikoho nemáš. Odkaz ale pošleš komukoli.',
    friendsOffline: 'Partu teď nenačtu. Zkus to, až chytíš signál.',
    ghost: 'Máš zapnutý neviditelný režim, pozvánka by nikomu nepřišla.',
    sent: (n: number) => n > 0
      ? `Pozval jsem ${n} ${czechPlural(n, { one: 'kámoše', few: 'kámoše', many: 'kámošů' })}. Kdo má zapnuté notifikace, ví to hned.`
      : 'Všichni vybraní už pozvánku mají.',
    rosterSummary: (invited: number, going: number) => going > 0
      ? `Pozváno ${invited} · ${czechPlural(going, { one: 'jde', few: 'jdou', many: 'jde' })} ${going}` : `Pozváno ${invited}`,
    inboxTitle: 'Pozvánky',
    invitedBy: (name: string) => `${name} tě zve`,
    going: 'Jdu',
    notGoing: 'Nejdu',
    changeToGoing: 'Nakonec jdu',
    changeToNotGoing: 'Nakonec nejdu',
    answeredGoing: 'Jdeš. Tour máš uloženou v telefonu.',
    answeredDeclined: 'Tentokrát nejdeš. Když si to rozmyslíš, dej vědět tady.',
    answerVisible: (name: string) => `Odpověď uvidí ${name}.`,
    errors: {
      notFriends: 'Pozvat jde jen kámoše z party.',
      limit: 'Na jednu tour pozveš nejvýš 50 kámošů.',
      unsupported: 'Pozvánky teď nejdou poslat. Pošli zatím odkaz jinam.',
      gone: 'Tuhle tour už nenacházím.',
      network: 'Pozvánka teď neodešla. Zkus to znovu.',
      answer: 'Odpověď neodešla. Zkus to znovu, až chytíš signál.',
    },
  },
  tourReminders: {
    channel: 'Srazy tour',
    title: (tour: string) => `Dneska ${tour}`,
    /** Czech says „ve“ before hours that start with a consonant cluster: ve dvě, ve čtrnáct, ve dvacet. */
    at: (time: string) => `${[2, 3, 4, 12, 13, 14, 20, 21, 22, 23].includes(Number(time.slice(0, 2))) ? 've' : 'v'} ${time}`,
    bodyAt: (at: string, pub: string) => (pub ? `Sraz ${at} · ${pub}` : `Sraz ${at}`),
    bodyToday: (pub: string) => (pub ? `Sraz dneska · ${pub}` : 'Sraz dneska'),
    today: 'dneska',
    onDay: ['v pondělí', 'v úterý', 've středu', 've čtvrtek', 'v pátek', 'v sobotu', 'v neděli'],
    ask: (when: string, at: string) => `Mám ti ${when} ${at} připomenout sraz?`,
  },
  alcohol: {
    title: 'Odhad promile',
    whenToday: (time: string) => `dnes kolem ${time}`,
    whenTomorrow: (time: string) => `zítra kolem ${time}`,
    whenDate: (date: string, time: string) => `${date} kolem ${time}`,
    warning: 'Je to jen odhad ze zapsaného pití. Skutečnost se může lišit o dost. Za volant podle toho nesedej.',
    empty: 'Podle odhadu jsi na nule.',
    drinkAbv: (abv: string) => `${abv} % alkoholu`,
    male: 'Muž',
    female: 'Žena',
    edit: 'Upravit',
    sexLabel: 'Pohlaví',
    ageUnit: 'let',
    heightUnit: 'cm',
    weightUnit: 'kg',
    privacyNote: 'Na server to neposílám.',
    save: 'Rozumím, počítej',
  },
} as const;

/**
 * Structural shape every locale must satisfy: string literals widen to
 * `string`, functions keep their parameter lists, keys stay identical.
 */
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends object
      ? { readonly [K in keyof T]: Widen<T[K]> }
      : T;

export type Strings = Widen<typeof cs>;
