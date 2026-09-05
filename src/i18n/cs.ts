/**
 * Czech UI strings: the source of truth for every user-facing word in the app.
 * en.ts mirrors this shape key for key (TypeScript enforces it). Screens never
 * import this file directly; they read `t` from '@/i18n', which picks the
 * language in locale.ts.
 */

import { beerCountLabel, beerNoun, czechPlural, peopleCountLabel, pubCountLabel } from './plural';
import type { DrinkType, OutsidePlaceContext, ServingType } from '@/drinks/drinkTypes';

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
    friendFallback: 'Kamarád',
    drinkerFallback: 'Pivař',
    beerFallback: 'Pivo',
    close: 'Zavřít',
  },

  map: {
    compass: 'Kompas',
    map: 'Mapa',
    layerAll: 'V okolí',
    layerVisited: 'Moje stopy',
    layerFriends: 'Parta teď',
    zoomForPubs: 'Přibliž město a ukážu ti podniky v jeho okolí.',
    // The map card's loud line is a short count and nothing else — a full
    // sentence at 18pt wrapped mid-phrase ("Ve výřezu 243 podniků · 1 / už znáš").
    // The detail goes on the quiet line under it.
    viewportPubs: (n: number) =>
      czechPlural(n, {
        one: '1 podnik ve výřezu',
        few: `${n} podniky ve výřezu`,
        many: `${n} podniků ve výřezu`,
      }),
    viewportKnown: (n: number) =>
      czechPlural(n, {
        one: '1 už znáš',
        few: `${n} už znáš`,
        many: `${n} už znáš`,
      }),
    // Nothing visited in view — the quiet line would otherwise sit empty.
    viewportKnownNone: 'Nic z toho ještě neznáš',
    liveShort: (n: number) =>
      n === 0
        ? 'Nikdo z party není na pivu'
        : czechPlural(n, {
            one: '1 kamarád je na pivu',
            few: `${n} kamarádi jsou na pivu`,
            many: `${n} kamarádů je na pivu`,
          }),
    citySummary: (visits: number, pubs: number) =>
      `${visits} večerů · ${pubs} ${pubs === 1 ? 'hospoda' : pubs < 5 ? 'hospody' : 'hospod'}`,
    showMyPubs: 'Ukázat moje hospody',
    findMe: 'Najdi mě',
    liveNow: 'TEĎ NA PIVU',
    friendFallback: 'Kamarád',
    friendIsHere: (name: string) => `${name} je tady teď`,
    friendsAreHere: (name: string, others: number) => `${name} a ${others} další jsou tady`,
    aimCompass: 'Namířit kompas',
    pinHint: 'Zamiř špendlík na hospodu',
    pinConfirm: 'Hospoda stojí tady',
    pubFallback: 'Podnik v pivní mapě',
    visitedSummary: (count: number, date: string) => `Byl jsi tu ${count}× · naposledy ${date}`,
    notVisited: 'Tady ještě nemáš čárku.',
    visited: 'Navštíveno',
    pubDetail: 'Detail hospody',
    offline: 'Mapa drží poslední data. Parta se ozve, až chytíš signál.',
    retry: 'Zkusit znovu',
    loading: 'Sháním podniky…',
    permissionHint: 'Rozhlížet se můžeš i bez polohy. Ťukni a najdu tě.',
    openWithoutLocation: 'Otevřít mapu bez polohy',
    listTitle: 'Podniky na mapě',
    listLink: 'Seznam',
    refresh: 'Načíst znovu',
    closeList: 'Zavřít seznam podniků',
    emptyList: 'V tomhle filtru zatím nic není.',
    pubNameFallback: 'Hospoda',
  },

  // — Hospody jako výběr místa večera (modal `/pick-pub` nad Pít) —
  pubPicker: {
    closeA11y: 'Zavřít výběr hospody',
    outsideTitle: 'Mimo hospodu',
    outsideFact: 'Doma, venku, na chatě…',
  },

  pubDetail: {
    tabs: ['Info', 'Aktivita'] as const,
    closeA11y: 'Zavřít detail hospody',
    moreA11y: 'Další možnosti hospody',
    navigate: 'Navigovat',
    startHere: 'Začít tu večer',
    chooseHere: 'Vybrat tuhle hospodu',
    beerFallback: 'Pivo',
    openingTitle: 'Otevíračka',
    openingClosed: 'Zavřeno',
    openingAdd: 'Doplnit otevíračku',
    openingEditA11y: 'Upravit otevíračku',
    tapsTitle: 'Na čepu',
    tapsAdd: 'Doplnit piva a ceny',
    tapsEditA11y: 'Upravit piva a ceny',
    beerFrom: 'Pivo od',
    eventsTitle: 'Aktuální akce',
    eventVerified: 'Ověřeno',
    eventSuggest: 'Navrhnout akci',
    eventSuggestSignedOut: 'Přihlas se a navrhni akci',
    visitsTitle: 'Co se tu dělo',
    visits: 'Návštěv',
    lastVisit: 'Naposled',
    amenitiesTitle: 'Vybavení',
    moreTitle: 'Co ještě?',
    renameAction: 'Opravit název',
    editOwnedAction: 'Upravit vlastní hospodu',
    reportAction: 'Nahlásit hospodu',
    reportTitle: 'Co je špatně?',
    reportClosed: 'Hospoda zavřela',
    reportNotPub: 'Není to hospoda',
    reportConfirmTitle: (name: string) => `Nahlásit „${name}“?`,
    reportConfirmBody: 'Nahlášení může hospodu skrýt i ostatním.',
    reportConfirmCancel: 'Zpátky',
    reportConfirmAction: 'Nahlásit',
    reportSaved: 'Nahlášeno. Mrknu na to.',
    reportQueued: 'Nahlášení je uložené. Pošlu ho, až bude signál.',
    saveFailed: 'Teď to nešlo uložit. Zkus to za chvíli.',
    renameTitle: 'Opravit název',
    renameLabel: 'Název hospody',
    renameSave: 'Uložit název',
    activityLoadError: 'Aktivitu jsem teď nenačetl.',
    activityEmpty: 'Zatím sem nikdo nic nezapsal. Buď první.',
    activityRetry: 'Zkusit znovu',
    activityLoadMore: 'Načíst další',
    activityLoadMoreRetry: 'Zkusit další znovu',
    activityLoadMoreA11y: 'Načíst další aktivitu hospody',
    stateLoading: 'Načítám hospodu…',
    stateFailed: 'Hospodu jsem nenačetl.',
    eventToday: (range: string) => `Dnes ${range}`,
    eventSuggestHint: 'Po kontrole ji ukážeme ostatním.',
    // The crown stays "Kč" in both languages: these are Czech pub prices.
    priceValue: (czk: number) => `${czk} Kč`,
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
    mapIntroTitle: 'Zmapuj hospodu',
    subtitleEmpty: 'Co tady mají? Dej vědět.',
    subtitleSome: 'Jde ti to!',
    subtitleDone: 'Paráda, máš to celé!',
    ringCaption: 'zmapováno',
    personal: (n: number, total: number) => `Zmapováno ${n} z ${total}`,
    footerHint: 'Každá odpověď se uloží sama. Díky!',
    closeA11y: 'Zavřít mapování hospody',
    offline: 'Teď jsi offline. Odpovědi si schovám a pošlu je později.',
    ringA11y: (pct: number) => `Zmapováno z ${pct} procent`,
    // Makes the public-vs-private distinction explicit: this is shared community
    // data, unlike the private rating on the evening card.
    publicNote: 'Veřejné. Uvidí to ostatní pivaři.',
    entryA11yPublic: 'Otevře veřejné mapování hospody, viditelné pro ostatní',

    // Info fact rows (otevíračka + piva) — the two non-amenity groups the hub
    // also covers. Each row taps through to the contribute editor.
    infoSection: 'OTEVÍRAČKA A PIVA',
    factHoursLabel: 'Otevírací doba',
    factHoursFilled: 'Vyplněno · uprav',
    factHoursMissing: 'Chybí · doplň',
    factBeersLabel: 'Piva na čepu',
    factBeersMissing: 'Chybí · doplň, co točí',
    factBeersCount: (n: number) =>
      n === 1 ? '1 pivo · uprav' : n >= 2 && n <= 4 ? `${n} piva · uprav` : `${n} piv · uprav`,
    factBeersWithPrice: (n: number, price: string) =>
      n === 1 ? `1 pivo · ${price}` : n >= 2 && n <= 4 ? `${n} piva · ${price}` : `${n} piv · ${price}`,
    factReferencePrice: (price: string) => `Velké pivo · ${price}`,
    factBeersRotating: (detail: string | null) =>
      detail ? `Rotuje · ${detail}` : 'Rotující nabídka · uprav',
    factEditA11y: (label: string, filled: boolean) =>
      filled ? `Upravit: ${label}` : `Doplnit: ${label}`,

    // Detail actions — kept visible at the end of the mapping scroll.
    renameRowLabel: 'Přejmenovat hospodu',
    renameRowHint: 'Přejmenuj nebo oprav překlep',
    reportRowLabel: 'Nahlásit hospodu',

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

    // Confidence signal — how many people confirmed the fact, not a yes/no poll.
    // "Má to" is amber + count, "nemají" is a calm muted count, "sporné" flags a
    // recent conflict, "first" celebrates the first mapper.
    confHas: (n: number) =>
      n <= 1
        ? 'jen 1 potvrzení'
        : czechPlural(n, {
            one: `potvrdil ${n} člověk`,
            few: `potvrdili ${n} lidé`,
            many: `potvrdilo ${n} lidí`,
          }),
    confNo: (n: number) => `nemají · ${peopleCountLabel(n)}`,
    confDisputed: 'sporné · ověř to',
    confFirst: 'zmapoval jsi první',
    confA11y: (label: string, detail: string) => `${label}: ${detail}`,

    // Amenities section header + the one public-data chip that replaced the
    // four-line mapping intro.
    amenitiesSection: 'CO TU JE',
    publicChip: 'veřejné',
    offlineChip: 'offline · uloží se',

    // Fact tiles (otevíračka + piva) — the two editable info groups.
    tileHours: 'Otevíračka',
    tileHoursEmpty: 'doplň otevíračku',
    tileBeers: 'Piva',
    tileBeersEmpty: 'doplň, co točí',
    tileBeersValue: (count: number, price: string | null) => {
      const head = count > 0 ? `${count} na čepu` : null;
      if (head && price) return `${head} · od ${price}`;
      if (head) return head;
      if (price) return `od ${price}`;
      return '';
    },
    tileMapped: (age: string) => `zmapováno ${age}`,
    tileHoursOpenDays: (n: number) =>
      czechPlural(n, { one: 'otevřeno 1 den', few: `otevřeno ${n} dny`, many: `otevřeno ${n} dní` }),
    tileA11y: (label: string, detail: string) => `${label}, ${detail}. Uprav.`,

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
    mapperEmpty: 'Ještě nemáš nic zmapováno. Najdi hospodu a řekni, co v ní je.',
    mapperSignedOut: 'Přihlas se a mapování ti zůstane všude, kde se přihlásíš.',

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
  },

  compass: {
    headerTitle: 'na pivo',
    hiddenPubHint: 'Ťukni pro odhalení',
    /** Stands in for the pub's name while "Schovávat názvy hospod" is on. */
    hiddenPubName: 'Tajná hospoda',
    distanceCaption: {
      nearest: 'do nejbližšího piva',
      surprise: 'do tvého náhodného piva',
    },
    modeNearest: 'Nejbližší',
    modeSurprise: 'Překvap mě',
    openInMaps: 'Otevřít v mapách',
    reportTitle: 'Chybí nebo nesedí?',
    reportBody: (pubName: string) =>
      `Přidej jinou hospodu, oprav „${pubName}“, nebo nahlas problém.`,
    reportRename: 'Opravit název',
    reportNotPub: 'Není to hospoda',
    reportConfirmTitle: (name: string) => `Nahlásit „${name}“?`,
    reportConfirmBody: 'Nahlášení může hospodu skrýt i ostatním.',
    reportConfirmCancel: 'Zpátky',
    reportConfirmAction: 'Nahlásit',
    reportAddMissing: 'Přidat jinou hospodu',
    renameTitle: 'Jak se jmenuje?',
    renameBody: (pubName: string) =>
      `Přejmenuju „${pubName}“ i pro ostatní pivaře, když se oprava odešle.`,
    renamePlaceholder: 'Nový název hospody',
    renameSave: 'Uložit název',
    renameSaving: 'Ukládám',
    renameSavedToast: 'Název hospody je opravený.',
    renameQueuedToast: 'Název je opravený tady. Až bude signál, pošlu ho dál.',
    calibrationHint: 'Otoč telefonem do osmičky, ať se kompas srovná',
    openNow: 'Otevřeno',
    openUntil: (t: string) => `Otevřeno do ${t}`,
    closedNow: 'Zavřeno',
    closedUntil: (t: string) => `Zavřeno · otevře v ${t}`,
    hoursUnknown: 'Otevíračku neznám',
    detailsLoading: 'Načítám info',
    contribute: 'Doplnit info',
    addMissingPubLink: 'Není to ta hospoda? Přidej ji',
    pubFixShort: 'Chybí / nesedí',
    // The leading beer glyph is a line-art icon rendered next to this text in
    // the pub card (see RevealedPubPill), not an emoji baked into the string.
    beerWithPrice: (name: string, price: string) => `${name} · ${price}`,
    referenceBeer: 'Velké pivo',
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
    beerFilterSearching: 'Hledám…',
    beerFilterRotatingHint:
      'Beru poslední potvrzenou nabídku. U rotujících výčepů se to může změnit.',
    pubFilterButton: 'Filtry',
    pubFilterButtonActive: (count: number) => `Filtry · ${count}`,
    pubFilterTitle: 'Kam dneska?',
    pubFilterSubtitle: 'Vyber, co musí hospoda splňovat.',
    pubFilterMatchAll: 'Hospoda musí splnit všechno, co vybereš. Počítám jen to, co lidi potvrdili.',
    pubFilterLimit: (count: number) => `Vyber nejvýš ${count} vlastností, ať má kompas kde hledat.`,
    pubFilterClear: 'Zrušit',
    pubFilterApply: 'Ukázat hospody',
    beerFilterSection: 'Pivo',
    otherPlacesSection: 'Místa',
    amenityFilterSections: {
      fun: 'Zábava',
      practical: 'Praktické',
      seating: 'Posezení',
    },
    otherPlacesFilter: 'Další místa s výčepem',
    otherPlacesHint: 'Stánky, kempy a sportovní areály, kde někdo potvrdil pivo.',
    // Price filter (histogram + two-thumb range slider) copy
    priceFilterLabel: 'Cena piva',
    priceFilterSubtitle: 'Velké pivo · sloupce po 5 Kč. Ceny starší než rok ber orientačně.',
    priceFilterFromLowest: 'Od nejlevnějšího',
    priceFilterFrom: (price: string) => `Od ${price}`,
    priceFilterNoLimit: 'Bez limitu',
    priceFilterMax: (price: string) => `Do ${price}`,
    priceFilterPubCount: (count: number) =>
      count === 1 ? '1 hospoda' : count >= 2 && count <= 4 ? `${count} hospody` : `${count} hospod`,
    priceFilterHidesUnknown: 'Hospody bez známé ceny se při zapnutém filtru schovají.',
    priceFilterNoData: 'Ceny tu zatím nikdo nezmapoval. Zapiš pivo v hospodě a bude tu líp vidět.',
    // Price age — how old the price observation is. Rendered next to the price
    // so the card never pretends a stale number is today's truth.
    priceAgeToday: 'dnes',
    priceAgeYesterday: 'včera',
    priceAgeDays: (n: number) => `před ${n} dny`,
    priceAgeWeeks: (n: number) => (n === 1 ? 'před týdnem' : `před ${n} týdny`),
    priceAgeMonths: (n: number) => (n === 1 ? 'před měsícem' : `před ${n} měsíci`),
    /** Prefix for prices older than ~6 months — visibly approximate. */
    priceApprox: (price: string) => `≈ ${price}`,

    // — Tácek rebuild: one card, one amber button, everything else behind "…" —

    /** The one glowing button. Its label says exactly what the tap does. */
    navigateCta: 'Doveď mě tam',
    navigateCtaSub: 'otevřu ti navigaci',
    /** Same button, dimmed, while the first search is still running. */
    searchingCtaSub: 'hledám nejbližší hospodu',
    /** The quiet outline twin: reroll in "Překvap mě", skip in "Nejbližší". */
    anotherPub: 'Dej mi jinou',
    /** Same slot while you're aiming at a friend's pub. */
    backToNearest: 'Zpět na nejbližší',
    /** Amber text door in the card footer — the twin of "Účet →" on the counter. */
    mapPubLink: 'O hospodě',
    /** Footer copy while pub names are hidden in settings. */
    revealHint: 'Ťukni a prozradím kam',
    /** Declined unit under the big distance numeral, e.g. "80 / METRŮ". */
    distanceUnitMeters: 'METRŮ',
    // Whole km decline nominatively (1 KILOMETR / 2–4 KILOMETRY / 5+ KILOMETRŮ);
    // a decimal distance ("2,5 km") takes the genitive singular ("KILOMETRU").
    distanceUnitKm: (value: number) => {
      if (!Number.isInteger(value)) return 'KILOMETRU';
      if (value === 1) return 'KILOMETR';
      return czechPlural(value, { one: 'KILOMETR', few: 'KILOMETRY', many: 'KILOMETRŮ' });
    },

    // — "Co ještě?" overflow sheet —
    moreTitle: 'Co ještě?',
    moreMap: 'Pivní mapa',
    moreFilters: 'Filtry',
    moreFiltersActive: (count: number) =>
      count === 1 ? '1 aktivní' : count >= 2 && count <= 4 ? `${count} aktivní` : `${count} aktivních`,
    moreHome: 'Navigovat domů',
    moreModeNearest: 'Hledej nejbližší',
    moreModeSurprise: 'Překvap mě',
    moreAddPub: 'Přidat hospodu',
    moreReport: 'Nahlásit hospodu',
    moreSearchSettings: 'Nastavení hledání',
    moreRetry: 'Zkusit znovu',

    // — Nudge slot: at most one of these, ever —
    nudgeFilters: (count: number) =>
      count === 1 ? 'Filtruju jednu věc' : count >= 2 && count <= 4 ? `Filtruju ${count} věci` : `Filtruju ${count} věcí`,
    nudgeFiltersClear: 'Zrušit',
    nudgeFocused: 'Mířím za partou',
    /** Badge on the head cell while the needle is borrowed by a friend's
     *  "Ukaž na kompasu" instead of pointing at the list's first pub. */
    focusBadge: 'Cíl',
    nudgeNoMagnetometer: 'Tvůj telefon nemá kompas, šipka se točit nebude.',
    nudgeCalibrate: 'Otoč telefonem do osmičky, ať se kompas srovná.',
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
    // Short lines, not paragraphs. Onboarding is read standing up with a thumb
    // on "další" — three concrete things beat one well-written block nobody
    // finishes. Each line is something the app actually does; no promises.
    slide1Title: 'Vítej Na pivu',
    slide1Body: 'Pivní deníček do kapsy.',
    slide1Bullets: [
      // The compass leads, because it is the thing this app is still known for
      // and the one line that says WHERE you are going. The diary comes second:
      // it is what you do once you are there.
      'Kompas na mapě tě dovede do nejbližší otevřené',
      'Zapíšeš pivo dvěma ťuknutími',
      'Soukromý přehled večerů naskakuje sám',
    ],
    slide2Title: 'Večer s partou',
    slide2Body: 'Ne tabulka, ale večer.',
    slide2Bullets: [
      'Vidíš, kdo sedí u stolu',
      'Hry rozhodnou, kdo platí rundu',
      'Z večera je post, ne výkaz',
    ],
    slide3Title: 'Ať o nic nepřijdeš',
    slide3Body: 'Bez účtu to jde taky.',
    slide3Bullets: [
      'Deník přežije výměnu telefonu',
      'Odznaky a mapérské žebříčky',
      'Účet doplníš kdykoliv později',
    ],
    slide3BodyAndroid: 'Bez účtu to jde taky.',
    slide3BulletsAndroid: [
      'Deník přežije výměnu telefonu',
      'Věk může ověřit Google Play',
      'Datum narození ani doklady nevidím',
    ],
    slide3Cta: 'Založit účet',
    slide3Later: 'Zatím bez účtu',
    // Canned labels in the onboarding preview. The names in the fixture
    // (U Fleků, Honza, Klára) stay Czech on purpose.
    previewStatBeers: 'piv',
    previewStatTable: 'u stolu',
    previewStatNight: 'večer',
    previewMe: 'Ty',
    previewGame: 'Kostky',
    previewPhoto: 'Fotka',
    previewBoardTitle: 'Mapéři tenhle měsíc',
    previewBoardUnit: 'hospod',
  },

  celebration: {
    eyebrow: 'VÍTEJ V',
    headerTitle: 'Jsi na místě',
    headlineLine1: 'Na',
    headlineLine2: 'zdraví!',
    subtitle: 'Dej si jedno za mě',
    backToCompass: 'Zpět na kompas',
    openInMaps: 'Otevřít v mapách',
    pubFallback: 'Hospoda',
  },

  empty: {
    headlineLine1: 'Tady se',
    headlineLine2: 'nenapiješ',
    body: 'V okolí jsem žádnou hospodu nenašel. Zkus to znovu nebo si v nastavení zvětši dosah.',
    searchFailedHeadlineLine1: 'Hledání',
    searchFailedHeadlineLine2: 'spadlo',
    searchFailedBody:
      'Hospody se mi nestáhly. Mrkni na signál a zkus to znovu.',
    openSettings: 'Otevřít nastavení',
    retry: 'Zkusit znovu',
    addPub: 'Přidat hospodu',
    filteredHeadlineLine1: 'Tahle kombinace',
    filteredHeadlineLine2: 'je vzácná',
    filteredBody: 'V okolí zatím nemám zmapovanou hospodu, která splní všechno.',
    editFilters: 'Upravit filtry',
    clearFilters: 'Zrušit filtry',
  },

  settings: {
    title: 'Nastavení',
    // "Co ti kompas najde" named the whole screen after one feature. The
    // compass is a cell in the pub list now, not the product.
    compassSection: 'Hledání hospod',
    notificationsSection: 'Kdy se ozvu',
    privacySection: 'Soukromí',
    privacyDoor: {
      title: 'Kdo tě vidí',
      subtitle: 'Neviditelný režim, sdílení piv s partou a klid v noci',
    },
    locationPrivacy: 'Domov i trasu nechávám v telefonu. Historii polohy neukládám.',
    // Section group labels — one clear meaning per group.
    sections: {
      search: 'HLEDÁNÍ',
      app: 'APLIKACE',
      contribute: 'PŘISPĚJ',
      about: 'O APLIKACI',
    },
    // Existing anonymous or claimed accounts drill into /account; only a
    // genuinely missing session opens /auth.
    accountCard: {
      header: 'ÚČET',
      verified: 'E-mail ověřen',
      verifiedInline: 'e-mail ověřen',
      ctaSignedIn: 'Můj účet',
      ctaManageData: 'Účet a data',
      manageDataSubtitle: 'Správa dat nebo přihlášení',
      ctaSignedOutSubtitle: 'Piva, odznaky i partu budeš mít všude, kde se přihlásíš',
      signedOutTitle: 'Přihlásit se',
      signedOutSubtitle: 'Piva, hodnocení i odznaky budeš mít všude, kde se přihlásíš',
    },
    distance: {
      header: 'MAXIMÁLNÍ VZDÁLENOST',
      helper: 'Hospody hledám jen do téhle vzdálenosti.',
      unlimited: 'Bez limitu',
      unlimitedUnit: 'BEZ LIMITU',
      kmShort: 'km',
      rangeMin: '500 m',
      rangeMax: '∞',
      accessibilityLabel: 'Maximální dosah hledání',
      increase: 'Zvětšit dosah',
      decrease: 'Zmenšit dosah',
    },
    haptics: {
      title: 'Vibrace u cíle',
      subtitle: 'Zachrochtá ti to v kapse',
    },
    pubReminders: {
      title: 'Připomenout v hospodě',
      subtitle: 'Večer občas kouknu, jestli nesedíš u výčepu. Bez ukládání trasy.',
      failureEyebrow: 'PŘIPOMÍNKY NEBĚŽÍ',
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
    language: {
      section: 'Jazyk aplikace',
      label: 'Appka mluví',
      system: 'Podle telefonu',
      cs: 'Česky',
      en: 'English',
      option: (name: string) => `Jazyk aplikace: ${name}`,
    },
    beerCountReminder: {
      title: 'Kontrola deníčku',
      subtitle: 'Po zápisu nastavím jednu upomínku ke kontrole deníčku. Sama se neopakuje.',
      intervalLabel: 'Za',
      intervalOption: (minutes: number) => `Zkontrolovat deníček za ${minutes} minut`,
      intervalShort: (minutes: number) => `${minutes} min`,
    },
    sound: {
      title: 'Zvuk cinknutí',
      subtitle: 'Drobné „cink“ u cíle',
    },
    waterNudge: {
      title: 'Připomenout vodu',
      subtitle: 'Volitelně po čtyřech pivech, jen v telefonu. Neodhaduje střízlivost.',
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
      subtitle: 'Když vím, že zahrádku nemají, jdu dál',
    },
    hidePubNames: {
      title: 'Schovávat názvy hospod',
      subtitle: 'Název se ukáže až po ťuknutí',
    },
    currency: {
      title: 'Měna cen',
      subtitle: 'Automaticky podle země, kde zrovna jsi',
      czk: 'Kč',
      eur: '€',
      footer: (currency: string) =>
        `Ceny počítám v ${currency === 'EUR' ? '€' : 'Kč'}, podle země, kde zrovna jsi.`,
    },
    marketingEmails: {
      title: 'Novinky e-mailem',
      subtitle: 'Tipy a nabídky můžeš kdykoli vypnout',
    },
    about: {
      title: 'O appce',
    },
    feedback: 'Napiš mi / nahlas chybu',
    feedbackCtaSubtitle: 'Něco nehraje nebo ti něco chybí? Dej mi vědět.',
    addPub: 'Přidat chybějící hospodu',
    addPubCtaSubtitle: 'Nevidíš svůj podnik? Přidej ho mezi ostatní.',
    privacy: 'Soukromí',
    more: {
      title: 'Co ještě?',
      accessibilityLabel: 'Další možnosti nastavení',
      homePoint: 'Domovský bod',
      configured: 'Nastavený',
      notConfigured: 'Nenastavený',
      navigateGoogle: 'Navigovat přes Google',
      navigateMapy: 'Navigovat přes Mapy.com',
      myAddedPubs: 'Moje přidané hospody',
    },
    discord: {
      title: 'Přidej se na komunitní Discord',
      subtitle: 'Pivo, hospody a řeči kolem. Stav se na jedno.',
      url: 'https://discord.gg/EDw8EW7Az8',
    },
    creator: {
      header: 'TVŮRCE',
      name: 'Tomáš Mach',
      instagram: 'Instagram',
      instagramUrl: 'https://www.instagram.com/jsem_mach/',
      linkedin: 'LinkedIn',
      linkedinUrl: 'https://www.linkedin.com/in/mach-tomas/',
    },
    footer: 'Bez reklam · Bez placení',
  },

  pubReminderOnboarding: {
    eyebrow: 'NOVINKA PRO VEČERY',
    title: 'Až sedneš do hospody, cinknu ti.',
    body:
      'Počítadlo ti večer připomene, když dorazíš k hospodě. Stačí zapnout notifikace a polohu na pozadí.',
    introCta: 'Ukázat, co povoluju',
    detailsTitle: 'Co bude telefon chtít povolit',
    detailsBody:
      'Kompasu stačí poloha při používání. Připomínka navíc potřebuje polohu „vždy“.',
    notificationTitle: 'Notifikace',
    notificationBody: 'Pošlu jen krátké připomenutí, ať večer nezmizí bez zápisu.',
    locationTitle: 'Poloha „vždy“',
    locationBody:
      'Sbírám ji jen kvůli hospodskému okruhu, i když je appka zavřená nebo ji zrovna nepoužíváš.',
    privacyTitle: 'Bez GPS deníčku',
    privacyBody: 'Trasy neukládám. Hlídám jen, jestli nejsi kousek od hospody.',
    cta: 'Zapnout připomínky',
    ctaBusy: 'Zapínám…',
    skip: 'Teď ne, nech mě pít v klidu',
    backgroundDisclosureTitle: 'Připomínky potřebují polohu na pozadí',
    backgroundDisclosureBody:
      'Na pivo použije tvoji polohu i tehdy, když je appka zavřená nebo ji zrovna nepoužíváš. Slouží výhradně na připomínky u hospody: kolem nejbližších podniků si v telefonu nastavím zóny a když do některé vejdeš, cinknu ti na zápis piva. Trasu ani GPS body nikam neukládám.',
    backgroundDisclosureConfirm: 'Chápu, povolit polohu',
    backgroundDisclosureDeny: 'Teď ne',
  },

  nicknameNudge: {
    eyebrow: 'DOKONČI SI ÚČET',
    title: 'Chybí ti @přezdívka',
    body:
      'Účet máš, ale bez přezdívky tě parta nenajde. Vyber si ji a profil, parta i žebříčky pojedou naplno.',
    cta: 'Uložit přezdívku',
    ctaBusy: 'Ukládám…',
    savedToast: 'A je to, přezdívka je tvoje.',
    skip: 'Teď ne',
  },

  ugcConsent: {
    title: 'Pravidla pro sdílený obsah',
    lines: [
      'Co zveřejníš (večery, fotky, komentáře, hospody), vidí ostatní pivaři.',
      'Žádná nenávist, žádné obtěžování, nic sexuálního, žádný spam. Nahlášený obsah smažu a účet můžu zablokovat.',
      'Podrobnosti jsou v podmínkách používání.',
    ],
    termsLink: 'Přečíst podmínky',
    accept: 'Souhlasím',
    acceptBusy: 'Ukládám…',
    later: 'Teď ne',
    laterHint: 'Dokud nesouhlasíš, zůstane to jen u tebe v telefonu.',
    error: 'Nepovedlo se to uložit. Zkus to za chvíli.',
  },

  report: {
    title: 'Napiš mi',
    intro: 'Něco nefunguje nebo ti něco chybí? Napiš mi pár slov, pomůže to.',
    categoryBug: 'Chyba',
    categoryIdea: 'Nápad',
    categoryOther: 'Jiné',
    messagePlaceholder: 'Popiš, co se stalo nebo co ti chybí…',
    attachmentCaption: 'Fotka nebo screenshot (nepovinné)',
    attachmentAdd: 'Přidat přílohu',
    attachmentHelper: 'Jedna fotka, před odesláním ji zmenším.',
    attachmentReady: 'Příloha je připravená',
    attachmentPrivacy: 'Odešlu ji jen spolu s tímhle hlášením.',
    attachmentRemove: 'Odebrat přílohu',
    attachmentPreparing: 'Připravuju fotku…',
    attachmentSourceTitle: 'Odkud vezmeš fotku?',
    attachmentCamera: 'Vyfotit',
    attachmentLibrary: 'Vybrat z galerie',
    attachmentPermissionTitle: 'Bez povolení to nepůjde',
    attachmentPermissionDenied: 'Povol přístup k foťáku nebo galerii a zkus to znovu.',
    attachmentPermissionBlocked: 'Přístup je vypnutý. Zapni ho v Nastavení telefonu.',
    attachmentOpenSettings: 'Otevřít Nastavení',
    attachmentErrorTitle: 'Fotka se nepovedla',
    attachmentErrorBody: 'Zkus vybrat jinou fotku nebo to pošli bez ní.',
    contactCaption: 'Kam ti můžu odepsat? (nepovinné)',
    contactInstagram: 'Instagram',
    contactEmail: 'E-mail',
    contactInstagramPlaceholder: '@tvujprofil',
    contactEmailPlaceholder: 'tvuj@email.cz',
    submit: 'Odeslat',
    versionCaption: (version: string) => `Odesílám i verzi appky: ${version}`,
    successTitle: 'Díky!',
    successBody:
      'Zpráva dorazí, i kdyby zrovna nebyl signál. Odešlu ji, jakmile budeš online.',
    successClose: 'Zavřít',
  },

  contribute: {
    title: 'Doplnit info',
    unknownPub: 'Hospoda',
    hoursTab: 'Otevíračka',
    beersTab: 'Piva',
    publicSubmitHint: 'Uvidí to ostatní pivaři',
    hoursHeader: 'Otevírací doba',
    hoursOpenNow: (time: string) => `Teď otevřeno · do ${time}`,
    hoursOpenNoChange: 'Teď otevřeno',
    hoursClosedNow: (time: string) => `Teď zavřeno · otevřu v ${time}`,
    hoursClosedNoChange: 'Teď zavřeno',
    closedToggle: 'Zavřeno',
    addInterval: 'Přidat čas',
    copyCurrentDayToAll: 'Použít i pro ostatní dny',
    copyWeek: 'Stejně celý týden',
    daySheetTitle: (day: string) => `Kdy má ${day} otevřeno?`,
    editDayA11y: (day: string, hours: string) =>
      `${day}, ${hours}. Upravit otevírací dobu.`,
    closeSheet: 'Zavřít',
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
    daysIn: {
      mo: 'v pondělí',
      tu: 'v úterý',
      we: 've středu',
      th: 've čtvrtek',
      fr: 'v pátek',
      sa: 'v sobotu',
      su: 'v neděli',
    },
    daysAt: {
      mo: 'pondělí',
      tu: 'úterý',
      we: 'středy',
      th: 'čtvrtka',
      fr: 'pátku',
      sa: 'soboty',
      su: 'neděle',
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
    beersEmpty: 'Zatím nevím, co tady točí.',
    beersLifecycleHint: 'Nech tu jen to, co se čepuje teď. Smazaná piva zůstanou v historii.',
    beersLifecycleHintShort: 'Nech tu jen to, co se čepuje teď.',
    beerMenuTypeLabel: 'Jak to tu s čepy chodí?',
    beerMenuFixed: 'Stálá nabídka',
    beerMenuFixedHint: 'Většina piv zůstává na čepu dlouhodobě.',
    beerMenuRotating: 'Rotující nabídka',
    beerMenuRotatingHint: 'Piva se tu pravidelně střídají. Seznam ber jako aktuální momentku.',
    historicalBeersHeader: 'Dříve tu bylo',
    historicalBeersHint: 'Vrátilo se na čep? Ťukni a je zpátky.',
    historicalBeersDoor: (count: number) =>
      `Dřív tu ${count === 1 ? 'bylo 1 pivo' : count >= 2 && count <= 4 ? `byla ${count} piva` : `bylo ${count} piv`}`,
    beerSuggestionsLoading: 'Hledám piva…',
    addBeerSheetTitle: 'Co se tu čepuje?',
    editBeerSheetTitle: 'Uprav pivo',
    beerPriceOptional: 'Cena (nepovinná)',
    removeBeer: 'Smazat pivo',
    priceMissing: 'cena chybí',
    volumeMissing: 'objem neuvedeno',
    editBeerA11y: (name: string, meta: string) =>
      `${name}, ${meta}. Upravit pivo.`,
    addSmallBeer: 'Přidat malé',
    addBeer: 'Přidat pivo',
    maxBeersNudge: 'Dvanáct piv stačí.',
    invalidDayNudge: (day: string) => `Čas u ${day} nedává smysl.`,
    fix: 'Oprav',
    fixHoursA11y: 'Opravit neplatnou otevírací dobu',
    scanningNudge: 'Čtu lístek…',
    scanMenuSecondary: 'Vyfoť lístek',
    save: 'Uložit',
    savedToast: 'Díky! Mám to',
    // Mapér reward for a first-time hours/beers contribution to a pub.
    xpToast: (xp: number) => `Díky za zmapování! +${xp} XP`,
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
      permissionCameraDenied: 'Foťák jsem nedostal. Zkus to znovu.',
      permissionLibraryDenied: 'Do galerie jsem se nedostal. Zkus to znovu.',
      permissionCameraBlocked: 'Foťák je pro Na pivo vypnutý. Povol ho v Nastavení a zkus to znovu.',
      permissionLibraryBlocked: 'Galerie je pro Na pivo vypnutá. Povol ji v Nastavení a zkus to znovu.',
      openSettings: 'Otevřít Nastavení',
      permissionDenied: 'Pusť k tomu foťák nebo galerii v Nastavení a zkus to znovu',
      errorToast: 'Skenování se nepovedlo, zkus to znovu',
    },
  },

  addPub: {
    title: 'Přidat hospodu',
    editTitle: 'Opravit hospodu',
    intro:
      'Vyplň název, město a adresu a potvrď, kde hospoda stojí. Po odeslání ji uvidí i ostatní.',
    editIntro:
      'Název můžeš opravit hned. Pro změnu adresy potvrď nový bod přímo u hospody.',
    locationHeader: 'Poloha',
    locationBody: 'Přidej hospodu tam, kde právě stojíš. Uložím jen tenhle bod, žádnou trasu ani historii polohy.',
    editLocationHeader: 'Změna polohy (nepovinná)',
    editLocationBody: 'Původní bod nechám být. Novou adresu potvrzuj, jen když ta stará fakt nesedí.',
    useCurrentLocation: 'Použít moji aktuální polohu',
    useCurrentLocationHint: 'Nejlíp to sedne přímo v hospodě nebo před ní.',
    mapPinLocationBody: 'Hospodu uložím přesně tam, kam míří špendlík z mapy. Jen tenhle bod, žádná trasa ani historie polohy.',
    useMapPin: 'Použít špendlík z mapy',
    useMapPinHint: 'Když bod nesedí, vrať se na mapu a zamiř znovu.',
    mapPinSelectedTitle: 'Použije se špendlík z mapy',
    editUseCurrentLocation: 'Opravit adresu a polohu',
    editUseCurrentLocationHint: 'Zapni přímo u hospody, pak uprav město a adresu.',
    locating: 'Zjišťuju polohu…',
    nameLabel: 'Název',
    namePlaceholder: 'Např. Hospoda U Komunity',
    currentLocationSelectedTitle: 'Použije se tvoje aktuální poloha',
    addressLookingUp: 'Dohledávám adresu…',
    addressLookupUnavailable: 'Adresu jsem nenašel. Doplň ji ručně.',
    searchingPlaces: 'Hledám podniky poblíž…',
    noPlaceSuggestions: 'Nic jsem nenašel. Název můžeš dopsat ručně.',
    selectedPlace: 'Vybraný podnik',
    loadingPlace: 'Dohledávám podnik…',
    placeLookupUnavailable: 'Tenhle podnik jsem nenačetl. Zkus ho vybrat znovu.',
    cityLabel: 'Město',
    cityPlaceholder: 'Praha',
    addressLabel: 'Adresa',
    addressPlaceholder: 'Ulice a číslo',
    locationError: 'Nejdřív potvrď polohu hospody.',
    locationPermissionDenied: 'Bez povolení polohy hospodu neumístím. Povol ji v Nastavení a zkus to znovu.',
    locationUnavailable: 'Polohu teď nevidím. Zkus to venku nebo blíž k oknu.',
    retryLocation: 'Zkusit polohu znovu',
    save: 'Přidat hospodu',
    editSave: 'Uložit opravu',
    saving: 'Ukládám…',
    savedToast: 'Mám ji, díky!',
    queuedToast: 'Hospoda čeká na připojení. Uložil jsem ji v telefonu.',
    failedToast: 'Hospodu jsem neověřil. Oprav údaje nebo to zkus znovu.',
    editQueuedToast: 'Opravu mám v telefonu a pošlu ji, až budeš online.',
    editSavedToast: 'Oprava je uložená.',
    myPubsTitle: 'Moje přidané hospody',
    emptyTitle: 'Zatím tu žádná není.',
    emptyBody: 'Když v kompasu chybí hospoda, doplň ji. Přidám ji do mapy i ostatním.',
    syncedCaption: 'V KOMPASU',
    noneSyncedCaption: 'ZATÍM NIC',
    latestPub: (name: string) => `Naposled: ${name}`,
    allSynced: 'Všechno je venku.',
    listLabel: 'Tvoje hospody',
    statusPending: 'Čeká',
    statusSynced: 'V kompasu',
    statusFailed: 'Neprošla',
    pendingCount: (count: number) =>
      count === 1
        ? 'Jedna hospoda čeká na odeslání'
        : count >= 2 && count <= 4
          ? `${count} hospody čekají na odeslání`
          : `${count} hospod čeká na odeslání`,
    failedCount: (count: number) =>
      count === 1
        ? 'Jedna hospoda neprošla'
        : count >= 2 && count <= 4
          ? `${count} hospody neprošly`
          : `${count} hospod neprošlo`,
    needsFixCount: (count: number) =>
      count === 1
        ? '1 potřebuje opravit'
        : count >= 2 && count <= 4
          ? `${count} potřebují opravit`
          : `${count} potřebuje opravit`,
    totalCount: (count: number) => `Celkem ${pubCountLabel(count)}`,
    retryingAll: 'Zkouším to poslat…',
    loadFailed: 'Teď jsem je nenačetl.',
    retryAll: 'Znovu poslat neúspěšné hospody',
    retryLoad: 'Znovu načíst přidané hospody',
    retry: 'Zkusit znovu',
    retrying: 'Zkouším…',
    edit: 'Opravit hospodu',
    openPubActions: (name: string) => `Otevřít akce hospody ${name}`,
    addFirstCta: 'Přidej první hospodu',
    addCta: 'Přidej hospodu',
    addCtaHint: 'Chybí v kompasu? Doplním ji do mapy i ostatním.',
    editFromDetailHint: 'Jen u hospody, kterou jsi přidal ty',
    openMyPubs: 'Moje přidané hospody',
    openMyPubsHint: 'Přidej hospodu, sleduj stav, oprav údaje',
  },

  account: {
    // — Auth screen (sign in / sign up) —
    authTitle: 'Účet',
    tabLogin: 'Přihlásit se',
    tabRegister: 'Registrovat',
    haveAccount: 'Už mám účet.',
    noAccount: 'Ještě nemáš účet?',
    emailLabel: 'E-mail',
    emailPlaceholder: 'tvuj@email.cz',
    passwordLabel: 'Heslo',
    passwordPlaceholder: 'Alespoň 8 znaků',
    nicknameLabel: 'Přezdívka',
    termsNotePrefix: 'Pokračováním souhlasíš s ',
    termsNoteTermsLink: 'podmínkami použití',
    termsNoteMiddle: ' a bereš na vědomí ',
    termsNotePrivacyLink: 'zásady soukromí',
    termsNoteSuffix: '.',
    nicknameSetFailedToast: 'Přezdívku jsem teď neuložil, nastavíš ji v profilu.',
    errorNicknameMissing: 'Vyber si přezdívku, bez ní tě parta nenajde.',
    errorNicknameNotReady: 'Mrkni ještě na přezdívku, něco s ní nehraje.',
    submitLogin: 'Přihlásit se',
    submitRegister: 'Vytvořit účet',
    loading: 'Pracuju…',
    orDivider: 'nebo',
    continueWithApple: 'Pokračovat přes Apple',
    continueWithGoogle: 'Pokračovat přes Google',
    forgotPassword: 'Zapomenuté heslo?',

    // — Inline validation —
    errorEmailInvalid: 'Zadej platný e-mail.',
    errorPasswordShort: 'Heslo musí mít alespoň 8 znaků.',
    errorGeneric: 'Něco se pokazilo. Zkus to znovu.',
    sessionExpired:
      'Přihlášení vypršelo. Přihlas se znovu, piva uložená v telefonu zůstanou.',

    // — Forgot password (inline) —
    resetPrompt: 'Zadej e-mail a pošlu ti odkaz i kód pro obnovu hesla.',
    resetSend: 'Poslat odkaz a kód',
    resetSentToast: 'Jestli účet existuje, poslal jsem odkaz i kód pro obnovu hesla.',

    // — Post-register / verification —
    verifyEmailSentToast: 'Ověřovací e-mail je na cestě.',

    // — Account management screen —
    accountTitle: 'Účet',
    accountLoadError: 'Účet jsem teď nenačetl.',
    accountRetry: 'Zkusit znovu',
    emailVerified: 'E-mail ověřen',
    emailUnverified: 'E-mail není ověřen',
    emailMissing: 'E-mail není nastaven',
    verifyEmailRequestedToast: 'Ověřovací e-mail je na cestě.',
    anonymousName: 'Anonymní účet',
    anonymousDataNote: 'Data máš uložená v tomhle telefonu',
    ctaMethods: 'Jak se přihlašuješ',
    moreTitle: 'Co ještě?',
    nudgeVerify: 'E-mail ještě není ověřený.',
    nudgeVerifyCta: 'Poslat znovu',
    nudgeSingleMethod: (provider: string) => `Přihlásíš se jen přes ${provider}.`,
    exportRunning: 'Připravuju tvoje data…',

    // — Sign-in methods sheet —
    methodEmail: 'E-mail a heslo',
    methodGoogle: 'Google',
    methodApple: 'Apple',
    linkCta: 'Propojit',
    unlinkCta: 'Odpojit',
    linkedLabel: 'Propojeno',
    methodNotLinked: 'Není propojeno',
    methodOnly: 'Jediné přihlášení, odpojit nejde',
    unlinkConfirmTitle: (provider: string) => `Odpojit ${provider}?`,
    unlinkConfirmBody: 'Přihlásíš se pak jen zbývajícími způsoby.',
    linkedGoogleToast: 'Google je propojený.',
    linkedAppleToast: 'Apple je propojený.',
    unlinkedToast: 'Odpojeno.',
    setPasswordCta: 'Nastavit heslo',
    setPasswordHeader: 'Nastavit heslo',
    setPasswordSave: 'Uložit heslo',
    setPasswordToast: 'Heslo je nastavené.',

    // — Data export —
    exportData: 'Stáhnout moje data',
    exportDialogTitle: 'Export mých dat',
    exportDataToast: 'Data jsou připravená.',
    exportNetworkError:
      'Export se nestáhl. Zkus to znovu, až chytíš signál.',
    exportServerError: 'Export teď nedám dohromady. Zkus to za chvíli.',
    exportRateLimited:
      'Dnešní limit exportů je pryč. Zkus to zítra.',
    exportAccountTransitionError:
      'Účet se právě mění. Zkus export spustit znovu.',
    subscriptionTitle: 'Na Pivo+',
    subscriptionFree: 'Free',
    subscriptionPlus: 'Plus',
    subscriptionInactive: 'Neaktivní',
    subscriptionPending: 'Čeká na ověření',
    subscriptionActive: 'Aktivní',
    subscriptionRestore: 'Obnovit nákupy',
    subscriptionRestoreUnavailableTitle: 'Na Pivo+ ještě není spuštěné',
    subscriptionRestoreUnavailableBody:
      'Až bude co obnovovat, najdeš to tady.',
    reportProfile: 'Nahlásit profil',
    reportProfileSubtitle: 'Přezdívka nebo avatar porušuje pravidla',

    // — Sign out —
    logout: 'Odhlásit se',

    // — Danger zone —
    deleteAccount: 'Smazat účet',
    deleteConfirmTitle: 'Smazat účet?',
    deleteConfirmBody:
      'Účet hned vypnu. Když se do 14 dní znovu přihlásíš, smazání zruším. Potom smažu profil, soukromá data i tvoje příspěvky k hospodám. Zůstat můžou jen nutné záznamy pro moderaci a anonymizovaný kontext společných her.',
    deleteAnonymousConfirmBody:
      'Anonymní účet hned vypnu. Za 14 dní smažu profil, soukromá data i tvoje příspěvky k hospodám. Obnovit ho nepůjde. Zůstat můžou jen nutné záznamy pro moderaci a anonymizovaný kontext společných her.',
    deleteConfirmCancel: 'Zrušit',
    deleteConfirmConfirm: 'Smazat',
    deleteToast: 'Účet je vypnutý. Za 14 dní ho smažu.',

    // — Password reset screen (deep link) —
    resetTitle: 'Obnova hesla',
    resetCodeLabel: 'Kód z e-mailu',
    resetCodePlaceholder: 'Vlož sem celý kód',
    resetNewPasswordLabel: 'Nové heslo',
    resetSubmit: 'Změnit heslo',
    resetDoneToast: 'Heslo je změněné.',
    errorResetCodeMissing: 'Zadej kód z e-mailu.',
    resetInvalidTitle: 'Neplatný odkaz',
    resetInvalidBody: 'Tenhle odkaz na obnovu hesla už neplatí. Vyžádej si nový.',
    resetInvalidCta: 'Zpět do appky',

    // — Email verification screen (deep link) —
    verifyTitle: 'Ověření e-mailu',
    verifyLoading: 'Ověřuju e-mail…',
    verifySuccessTitle: 'E-mail ověřen',
    verifySuccessBody: 'Díky! Tvůj e-mail je teď ověřený.',
    verifyErrorTitle: 'Ověření nevyšlo',
    verifyErrorBody: 'Odkaz je špatný nebo mu vypršela platnost. Nech si poslat nový.',
    verifyInvalidBody: 'Chybí ověřovací kód. Otevři odkaz z e-mailu znovu.',
    verifyDoneCta: 'Zpět do appky',
  },

  tabs: {
    compass: 'Kompas',
    counter: 'Počítadlo',
    myBeers: 'Moje piva',
    // Počítadlo + Moje piva live behind one tab now, switched by a segment.
    beer: 'Štamgast',
    friends: 'Parta',
    profile: 'Profil',
    // — 3.0 navigation (§17.1). The route names stay as they are so the Live
    // Activity deep link (napivo://beer) and every existing router.replace keep
    // working; only what the bar SAYS changes.
    feed: 'Kocoviny',
    pubs: 'Hospody',
    party: 'Party',
    community: 'Komunita',
    /** The party tab while your own evening is running. */
    partyRunning: 'Večer',
  },

  beerCheckins: {
    quickCta: 'Ohodnotit a sdílet partě',
    quickDismiss: 'Nechat být',
    sheetTitle: 'Zapsat pivo',
    beerLabel: 'Pivo',
    beerPlaceholder: 'Co máš ve skle?',
    useSuggestion: (name: string) => `Použít existující pivo ${name}`,
    breweryLabel: 'Pivovar',
    styleLabel: 'Styl',
    optionalPlaceholder: 'Nepovinné',
    ratingLabel: 'Hodnocení',
    ratingA11y: (value: number) => `Hodnocení ${value} z 5`,
    noteLabel: 'Poznámka',
    notePlaceholder: 'Hořkost, pěna, nálada u stolu…',
    // Fast one-tap verdict chips — max 3, replaces the need to type a note.
    tagsLabel: 'Rychlý verdikt',
    // Czech labels for the fixed wire tag set (keys are the BEER_TAGS values).
    tags: {
      crisp: 'Má říz',
      great_foam: 'Pěna jak smetana',
      smooth: 'Jde samo',
      watery: 'Vodový',
      stale: 'Zvětralý',
      overpriced: 'Předražený',
      one_more: 'Chutnalo mi',
      never_again: 'Už nikdy',
    } as Record<string, string>,
    tagAddA11y: (label: string) => `Přidat verdikt ${label}`,
    tagRemoveA11y: (label: string) => `Odebrat verdikt ${label}`,
    visibilityLabel: 'Viditelnost',
    visibilityPrivate: 'Jen pro mě',
    visibilityFriends: 'Parta',
    submit: 'Uložit pivo',
    saved: 'Pivo zapsané. Na zdraví.',
    saveError: 'Pivo se mi nepovedlo uložit. Zkus to znovu.',
    feedHeader: 'Piva party',
    feedEmpty: 'Parta zatím žádné pivo nesdílela.',
    detailHeader: 'Detail piva',
    detailLoadError: 'Detail piva jsem teď nenačetl.',
    detailRetry: 'Zkusit znovu',
    lastBeersHeader: 'Poslední piva',
    // Memory strip on the check-in sheet. Known variant is a single low-key line
    // assembled from structured data; missing pieces just drop out.
    memoryKnownLead: 'Znáš ho.',
    memoryKnown: ({
      count,
      lastDate,
      lastPub,
      lastRating,
    }: {
      count: number;
      lastDate: string;
      lastPub: string;
      lastRating: number | null;
    }) => {
      const parts: string[] = [`${count}×`];
      const last = [lastDate ? `naposledy ${lastDate}` : '', lastPub ? `v ${lastPub}` : '']
        .filter(Boolean)
        .join(' ');
      if (last) parts.push(last);
      if (lastRating != null) parts.push(`${lastRating.toFixed(1).replace(/\.0$/, '')}★`);
      return parts.join(' · ');
    },
    memoryFirstTime: 'Prvně spolu. Ať to stojí za to.',
    // Beer-detail relationship hero — "Piješ ho od června".
    detailSinceMonth: (month: string) => `Piješ ho od ${month}`,
    detailMyTagsLabel: 'Můj verdikt',
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
    locating: 'Hledám tvoje okolí…',
    noNearby: 'V okolí teď nikdo stůl neotevřel.',
    noMine: 'Zatím žádné vlastní ani domluvené setkání.',
    distance: {
      under_1_km: 'do 1 km',
      '1_3_km': '1-3 km',
      '3_8_km': '3-8 km',
      '8_15_km': '8-15 km',
    },
    spots: (count: number) =>
      count === 1
        ? 'poslední místo'
        : `${count} ${czechPlural(count, { one: 'volné místo', few: 'volná místa', many: 'volných míst' })}`,
    host: (name: string) => `Pořádá ${name}`,
    addressHidden: 'Přesná adresa až po schválení',
    addressApproved: 'Adresa pro schválené',
    join: 'Požádat o místo',
    joinSent: 'Žádost letí pořadateli.',
    pending: 'Čeká na schválení',
    approved: 'Máš místo',
    leave: 'Odejít ze setkání',
    cancelRequest: 'Stáhnout žádost',
    report: 'Nahlásit setkání',
    reportTitle: 'Nahlásit setkání?',
    reportCancel: 'Nechat být',
    reported: 'Díky. Mrknu na to.',
    cancelEvent: 'Zrušit setkání',
    cancelConfirmTitle: 'Zrušit setkání?',
    cancelConfirmBack: 'Nechat ho',
    cancelled: 'Setkání je zrušené.',
    statusCancelled: 'Zrušeno',
    statusEnded: 'Skončilo',
    statusLive: 'Právě teď',
    statusAdults: '18+',
    approve: 'Schválit',
    reject: 'Odmítnout',
    requestMessage: 'Vzkaz pro pořadatele',
    requestPlaceholder: 'Kdo jsi a proč chceš dorazit? (nepovinné)',
    requests: 'ŽÁDOSTI O MÍSTO',
    formTitle: 'Název setkání',
    formTitlePlaceholder: 'Pivo, deskovky a klid',
    description: 'Co se bude dít',
    descriptionPlaceholder: 'Krátce popiš večer. Přesnou adresu sem nepiš.',
    city: 'Město',
    cityPlaceholder: 'Praha',
    area: 'Čtvrť nebo část města',
    areaPlaceholder: 'Vinohrady',
    exactAddress: 'Přesná adresa',
    exactAddressPlaceholder: 'Ulice, číslo a případně zvonek',
    exactAddressHint: 'Ve veřejném přehledu ji nikdy neukážu. Dostanou ji jen lidé, které schválíš.',
    useLocation: 'Použít polohu tohoto místa',
    locationReady: 'Poloha uložená jen k tomuto setkání',
    start: 'Začátek',
    today: 'Dnes',
    tomorrow: 'Zítra',
    duration: 'Délka',
    durationHours: (hours: number) => `${hours} h`,
    capacity: 'Kapacita včetně tebe',
    adultsConfirm: 'Je mi 18+ a setkání je jen pro dospělé.',
    publish: 'Otevřít stůl',
    created: 'Stůl je otevřený. Přesná adresa zůstává skrytá.',
    titleRequired: 'Napiš název setkání.',
    cityRequired: 'Doplň město.',
    addressRequired: 'Doplň přesnou adresu.',
    locationRequired: 'Potvrď polohu setkání.',
    adultsRequired: 'Potvrď, že je setkání jen pro dospělé.',
    startPastError: 'Vyber čas, který teprve přijde.',
    authError: 'Pro domácí setkání se nejdřív přihlas.',
    loadError: 'Setkání jsem teď nenačetl.',
    actionError: 'Tohle se teď nepovedlo. Zkus to znovu.',
    retry: 'Zkusit znovu',
    open: 'Pivo u někoho',
    openHint: 'Objev malé domácí posezení poblíž. Adresa až po schválení.',
    detailLoading: 'Načítám akci',
    detailMissing: 'Tuhle akci už nenajdu.',
    detailRetryA11y: 'Zkusit načíst akci znovu',
    hostFallback: 'Pořadatel',
    guestFallback: 'Návštěvník',
    stepperDecrease: 'Snížit',
    stepperIncrease: 'Zvýšit',
    attendingCount: (count: number) =>
      `${count} ${czechPlural(count, { one: 'pivař', few: 'pivaři', many: 'pivařů' })}`,
    spotsLeft: (count: number) =>
      `${count} ${czechPlural(count, {
        one: 'místo zbývá',
        few: 'místa zbývají',
        many: 'míst zbývá',
      })}`,
    goingLine: (people: string, spots: string) => `Jde ${people} · ${spots}`,
    busy: 'Chvilku…',

    // — Účast —
    hostEnded: 'Tvoje akce skončila',
    hosting: 'Pořádáš',
    eventEnded: 'Akce skončila',
    going: 'Jdeš',
    wantToGo: 'Chci jít',
    leftToast: 'Účast je zrušená.',
    cancelAttendanceA11y: 'Zrušit účast',
    requestJoinA11y: 'Požádat o účast',
    pendingHint: 'Po schválení si vybereš tým.',

    // — Žádosti o místo (pořadatel) —
    requestsHeading: 'Žádosti o místo',
    approveShort: 'Jo',
    rejectShort: 'Ne',
    approveRequestA11y: (name: string) => `Schválit žádost ${name}`,
    rejectRequestA11y: (name: string) => `Zamítnout žádost ${name}`,
    approvedToast: (name: string) => `${name} jde s vámi.`,
    rejectedToast: 'Žádost je zamítnutá.',
    noRequests: 'Nikdo teď nečeká.',
    capacityFull: 'Kapacita je plná. Žádost můžeš jen zamítnout.',

    // — Týmy —
    teamsTitle: 'Týmy',
    teamsAssigned: (assigned: number, total: number) => `${assigned}/${total} v týmech`,
    teamsLoadingA11y: 'Načítám týmy',
    teamsLoading: 'Skládám soupisku…',
    teamsEmpty: 'Zatím žádný tým. Někdo musí vykopnout první.',
    unassigned: (people: string) => `Bez týmu: ${people}.`,
    teamOf: (members: number, capacity: number) => `${members} z ${capacity}`,
    teamMine: 'Tvůj tým',
    teamEmpty: 'Zatím prázdný stůl.',
    teamJoin: 'Přidat se',
    teamLeave: 'Opustit tým',
    teamAlreadyIn: 'Už jsi v týmu',
    teamFull: 'Tým je plný',
    teamJoined: (name: string) => `Jsi v týmu ${name}.`,
    teamLeft: 'Z týmu jsi venku.',
    teamCreated: (name: string) => `Tým ${name} je na světě.`,
    teamExists: 'Tým už je připravený.',
    teamNamePlaceholder: 'Název týmu',
    teamNameA11y: 'Název nového týmu',
    teamCreateA11y: 'Založit tým',
    teamCreating: 'Zakládám…',
    teamCreate: 'Založit',
  },

  photoDiary: {
    // — Diary section on the profile —
    header: 'PIVNÍ FOTKY',
    title: 'Pivní fotky',
    empty: 'Zatím tu nic není. Vyfoť svoje pivo a začni si plnit album.',
    emptyTitle: 'Zvedni pivo, cvakni fotku',
    emptyProfile: 'Zatím tu nemáš cvaknuté ani jedno pivo.',
    addPhoto: 'Přidat fotku',
    takePhoto: 'Vyfotit pivo',
    pickFromLibrary: 'Vybrat z galerie',
    contestLink: 'FotoPivař',
    /** Link beside the profile heading, opens the whole album. */
    viewAll: 'Zobrazit vše',
    photoCount: (n: number) =>
      n === 1 ? '1 fotka' : n >= 2 && n <= 4 ? `${n} fotky` : `${n} fotek`,

    // — Source sheet —
    sheetTitle: 'Cvakni pivo',
    sheetSubtitle: 'Než spadne pěna. Fotka jde do tvého deníčku.',
    cameraHelper: 'Vyfoť ho rovnou u stolu',
    libraryHelper: 'Máš ho už v mobilu',

    // — Compose sheet —
    composeTitle: 'Do deníčku',
    captionLabel: 'Popisek',
    captionPlaceholder: 'Co to bylo za pivo a za večer?',
    pubLabel: 'Hospoda',
    pubNone: 'Bez hospody',
    pubNoneNearby: 'Poblíž jsem žádnou hospodu nenašel.',
    visibilityLabel: 'Viditelnost',
    visibilityPrivate: 'Jen pro mě',
    visibilityFriends: 'Parta',
    addToContest: 'Poslat rovnou do FotoPivaře',
    addToContestHint: 'V soutěži ji uvidí každý. V deníčku ti zůstane.',
    save: 'Uložit do deníčku',
    saveAndEnterContest: 'Uložit a přihlásit',
    saved: 'Fotka je v albu. Na zdraví.',
    savedForContest: 'Fotka je v deníčku a míří do soutěže.',
    contestEntryFailed: 'Fotka je uložená, ale do soutěže se nepřihlásila. Zkus to z jejího detailu.',
    errorPick: 'Fotku jsem nenačetl. Zkus to znovu.',
    errorSave: 'Fotku se mi nepovedlo uložit. Zkus to znovu.',

    // — Sync states on a diary tile —
    pendingBadge: 'Čeká na nahrání',
    failedBadge: 'Nenahrálo se to',
    syncPendingShort: 'Nahrává se',
    syncFailedShort: 'Nenahráno',
    retryUpload: 'Zkusit znovu',
    retryQueuedToast: 'Beru. Zkusím to nahrát znovu.',

    // — Photo detail —
    detailTitle: 'Fotka piva',
    detailMissing: 'Tahle fotka už tu není.',
    viewerLoadError: 'Fotku jsem nenačetl.',
    viewerRetry: 'Zkusit znovu',
    enterContestCta: 'Přihlásit do soutěže',
    enterContestHint: 'Nahranou fotku můžeš poslat do soutěže o FotoPivaře.',
    inContestNote: 'Tahle fotka právě bojuje o FotoPivaře.',
    openContest: 'Otevřít soutěž',
    syncBeforeContest: 'Do soutěže může, až se nahraje.',

    // — Delete flow —
    deleteConfirmTitle: 'Smazat fotku?',
    deleteConfirmBody: 'Zmizí z alba i ze soutěže. Tohle vrátit neumím.',
    deleteConfirm: 'Smazat',
    deleteCancel: 'Nechat',
    deletedToast: 'Fotka je schovaná. Ze serveru zmizí, jakmile bude síť.',
    deleteError: 'Fotku jsem nesmazal. Zkus to znovu.',

    // — Failed-upload messages (codes off POST /v1/beer-photos, persisted by
    //   the queue as `failureCode` and surfaced on the photo detail) —
    errorLimitReached: 'Album je plné. Smaž nějakou starší fotku a zkus to znovu.',
    errorTooLarge: 'Tahle fotka je moc velká. Zkus jinou.',
    errorInvalid: 'Tohle mi jako fotka piva nejde načíst. Zkus jinou.',

    // — Permissions (mirrors profile.setup wording) —
    permissionCameraBody: 'Foťák jsem nedostal. Zkus to znovu a povol focení.',
    permissionLibraryBody: 'K fotkám jsem se nedostal. Zkus to znovu a povol galerii.',
    permissionBlockedBody: 'Přístup je zakázaný. Povol ho v systémovém Nastavení a zkus to znovu.',
    openSettings: 'Otevřít Nastavení',

    // — Friend gallery (section hides entirely when empty) —
    friendHeader: (name: string) => `Pivní fotky · ${name}`,

    // — Counter (Štamgast) capture pill —
    counterCta: 'Foťák: pivo nebo menu',
  },

  partaPhotos: {
    // — Fresh parta photo strip on the Parta tab (hides entirely when empty) —
    header: 'ČERSTVĚ CVAKNUTO',
    you: 'Ty',
  },

  photoContest: {
    // — Contest screen —
    title: 'FotoPivař',
    subtitle: 'Soutěž o nejlepší pivní fotku. Každých 14 dní nové kolo.',
    noContest: 'Zrovna se nesoutěží. Zajdi zatím na jedno.',
    emptyEntries: 'Zatím tu není ani jedna fotka. Buď první.',

    // — Countdown —
    endsInDays: (n: number) =>
      n === 1 ? 'Končí zítra' : n >= 2 && n <= 4 ? `Končí za ${n} dny` : `Končí za ${n} dní`,
    endsToday: 'Poslední den! Večer se sčítají hlasy.',
    ended: 'Kolo skončilo. Sčítá se.',

    // — My entry —
    myEntryHeader: 'TVOJE FOTKA V KOLE',
    entriesHeader: 'KDO SOUTĚŽÍ',
    enterCta: 'Přihlásit fotku',
    enterCardTitle: 'Cvakni nebo vyber fotku',
    enterCardHint: 'Novou vyfotíš rovnou tady. Uloží se i do tvého deníčku.',
    takePhotoCta: 'Vyfotit soutěžní fotku',
    pickFromDiary: 'NEBO VYBER Z DENÍČKU',
    enterNoPhotos: 'V deníčku zatím žádná nahraná fotka není.',
    goToDiary: 'Do deníčku',
    enterConfirmTitle: 'Přihlásit tuhle fotku?',
    enterConfirmBody: 'Uvidí ji každý, kdo do soutěže nakoukne. Jedna fotka na kolo.',
    withdrawCta: 'Stáhnout ze soutěže',
    withdrawConfirmTitle: 'Stáhnout fotku ze soutěže?',
    withdrawConfirmBody: 'Přijdeš o nasbírané hlasy. Vrátit je neumím.',
    enteredToast: 'Fotka je v soutěži. Hodně štěstí.',
    withdrawnToast: 'Fotka je ze soutěže venku.',
    myEntryBadge: 'Tvoje fotka',

    // — Reporting an entry —
    entryActionsTitle: (name: string) => `Fotka od ${name}`,
    openPhotoAction: 'Otevřít fotku',
    openProfileAction: 'Mrknout na profil',
    reportAction: 'Nahlásit fotku',
    reportConfirmTitle: 'Nahlásit tuhle fotku?',
    reportConfirmBody: 'Poletí na kontrolu. Díky, že hlídáš výčep.',
    reportedToast: 'Nahlášeno. Mrknu na to.',

    // — Results celebration (top 3, shown once per round) —
    resultsEyebrow: 'VÝSLEDKY KOLA',
    resultsTitleFirst: 'Zlatý tácek je tvůj!',
    resultsTitleSecond: 'Druhé místo!',
    resultsTitleThird: 'Třetí místo!',
    resultsBodyFirst: 'Tvoje fotka vyhrála celé kolo. Klobouk dolů a pěnu nahoru.',
    resultsBodySecond: 'Stříbro na bedně. Na zlatý tácek chybělo jen pár hlasů.',
    resultsBodyThird: 'Bronz na bedně. Příště to cinkne výš.',
    resultsStatVotes: 'Hlasy',
    resultsStatXp: 'XP',
    resultsStatWins: 'Výhry',
    resultsCta: 'Otevřít soutěž',
    resultsClose: 'Zavřít',

    // — Reigning winner strip (next round) —
    reigningTitle: 'Úřadující FotoPivař',

    // — Parta teaser strip —
    teaserFallbackSubtitle: 'Soutěž o nejlepší pivní fotku každých 14 dní',
    teaserEmptySubtitle: 'Nové kolo běží a čeká na první fotku',
    teaserResultsSubtitle: 'Kolo skončilo a výsledky jsou venku',
    teaserResultsPodiumSubtitle: 'Jsi na bedně! Mrkni na výsledky',
    teaserVoteSubtitle: (n: number) =>
      n === 1
        ? '1 fotka v kole čeká na tvůj hlas'
        : n >= 2 && n <= 4
          ? `${n} fotky v kole čekají na tvůj hlas`
          : `${n} fotek v kole čeká na tvůj hlas`,
    teaserVotedSubtitle: 'Tvůj hlas je uvnitř, sleduj finiš',
    teaserMyEntrySubtitle: (votes: string) => `Tvoje fotka drží ${votes}`,

    // — Loading / error —
    loadError: 'Soutěž jsem teď nenačetl. Zkus to znovu.',
    retry: 'Zkusit znovu',

    // — Voting —
    votesCount: (n: number) =>
      n === 1 ? '1 hlas' : n >= 2 && n <= 4 ? `${n} hlasy` : `${n} hlasů`,

    // — Winners (last round) —
    winnersHeader: 'MINULÉ KOLO',
    winnerRank: (n: number) => `${n}. místo`,
    winnerBadgeNote: 'Vítěz nosí odznak FotoPivař.',

    // — Errors (codes off the contest endpoints) —
    errorCannotVoteOwn: 'Vlastní fotce hlas nedáš. Pěkný pokus.',
    errorNicknameRequired: 'Do soutěže potřebuješ přezdívku. Nastav si ji v profilu.',
    errorVote: 'Hlas se nezapočítal. Zkus to znovu.',
    errorEnter: 'Fotku jsem do soutěže nedostal. Zkus to znovu.',
    errorGeneric: 'Něco se pokazilo. Zkus to znovu.',
  },

  friends: {
    title: 'Parta',
    hubTitle: 'Parta',
    peopleTitle: 'Parta',
    addPeopleTitle: 'Přidat do party',
    // — "S kým chodíš na pivo" (nahradilo sekce žádostí a odeslaných pozvánek) —
    togetherHeader: 'S kým chodíš na pivo',
    togetherEmpty: 'Zatím nikdo. Objeví se tu každý, s kým si sedneš k jednomu stolu.',
    lastSeenTogether: (when: string) => `naposled ${when}`,
    // Backend counts shared pub+day pairs, so this is evenings, never beers.
    sharedEvenings: (n: number) =>
      n === 0
        ? 'zatím žádný společný večer'
        : n === 1
          ? '1 společný večer'
          : n >= 2 && n <= 4
            ? `${n} společné večery`
            : `${n} společných večerů`,
    notTogetherYet: 'ještě jste spolu neseděli',
    addPersonCta: 'Přidat člověka',
    // — jednosměrné sledování —
    followingHeader: 'Sleduješ',
    followingLastDrink: (beer: string) => `dal si ${beer}`,
    followingQuiet: 'zatím nic nového',
    follow: 'Sledovat',
    unfollow: 'Nesledovat',
    followed: 'Sleduješ, co pije.',
    unfollowed: 'Sledování je pryč.',
    followError: 'Sledování se nepovedlo. Zkus to znovu.',
    requestsSummary: (n: number) => {
      if (n === 0) return 'Žádné nové žádosti';
      if (n === 1) return '1 žádost čeká';
      if (n >= 2 && n <= 4) return `${n} žádosti čekají`;
      return `${n} žádostí čeká`;
    },
    requestsEmpty: 'Nikdo nový teď nečeká.',
    outgoingEmpty: 'Žádná pozvánka teď nečeká na potvrzení.',
    plansEmpty: 'Na dnešek zatím nic není.',
    heroTitle: 'Kdo jde dneska na jedno?',
    heroBody:
      'Kámoše přidáš kódem nebo pozvánkou. Pak hned vidíš, kdo zrovna sedí na pivu.',
    firstRunOffline: 'Zatím ticho. Načtu to, až chytneš signál.',
    refresh: 'Obnovit',
    searchPlaceholder: 'Přezdívka kámoše',
    searchCta: 'Najít',
    addByNickname: 'Pozvat',
    emptyFriends: 'Zatím piješ solo. Najdi přezdívku a pošli první pozvánku.',
    emptyActive: 'Nikdo z party teď nesvítí v hospodě.',
    activeHeader: 'Teď na pivu',
    requestsHeader: 'Čekají na tebe',
    addHeader: 'Přidat do party',
    friendsHeader: 'Kámoši',
    feedHeader: 'Cinklo v partě',
    outgoingHeader: 'Odeslané pozvánky',
    accept: 'Přijmout',
    decline: 'Nechat být',
    remove: 'Odebrat',
    removeTitle: 'Odebrat kámoše?',
    removeBody: (name: string) => `${name} už neuvidí tvoje hospodské signály a zmizí z party.`,
    removeConfirm: 'Odebrat',
    requestSent: 'Pozvánka letí ke stolu.',
    requestAccepted: 'Je v partě.',
    requestDeclined: 'Pozvánka je pryč.',
    requestActionError: 'Žádost jsem teď nevyřídil. Zkus to znovu.',
    friendRemoved: 'Už není v partě.',
    // One-tap quick broadcast from the counter (rich compose lives on Parta).
    shareHereShort: 'Cinknout partě',
    // "signál" is reserved for connectivity; the broadcast is a "cinknutí".
    shareSuccess: 'Cinknuto!',
    shareError: 'Partě jsem to nedal vědět.',
    queueSaveError: 'Akci se mi nepovedlo uložit. Zkus to znovu.',
    // Counter "already broadcasting" state once I'm live (drops the re-broadcast).
    counterAlreadyLive: 'Už svítíš partě',
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
    offline: 'Partu jsem teď nenačetl. Ukazuju poslední, co vím.',
    retry: 'Zkusit znovu',

    // — RSVP loop (Jdu / Možná / Dneska ne) —
    rsvpGoing: 'Jdu',
    rsvpMaybe: 'Možná',
    rsvpCant: 'Dneska ne',
    rsvpError: 'Nepovedlo se to odeslat. Zkus to znovu.',
    rsvpClearedToast: 'Odpověď zrušená.',
    rsvpQueued: 'Zapíšu to partě, až bude signál.',
    // Roster count word only — the numeral renders separately in amber.
    goingLabel: (n: number) => (n === 1 ? 'jde' : 'jdou'),
    // Secondary "2 možná · 1 dneska ne" line; skips zero buckets, '' when both 0.
    maybeCantLine: (maybe: number, cant: number) => {
      const parts: string[] = [];
      if (maybe > 0) parts.push(`${maybe} možná`);
      if (cant > 0) parts.push(`${cant} dneska ne`);
      return parts.join(' · ');
    },
    rosterEmpty: 'Zatím nikdo nekývl.',

    // — My active activity card ("Cinkl jsi partě") —
    // Present tense keeps it genderless (retired the masculine "Cinkl jsi").
    myActiveTitle: 'Svítíš partě',
    nobodyYet: 'Čekáš na první kývnutí.',
    whoComing: 'Kdo dorazí?',
    // "Zabalit" = pub slang for calling it a night; one verb family across
    // button → confirm → toast (a11y label stays descriptive).
    endActivity: 'Zabalit',
    endActivityA11y: 'Ukončit cinknutí',
    endActivityConfirmTitle: 'Zabalit to?',
    endActivityConfirmBody: 'Parta přestane vidět, že jsi na pivu.',
    endActivityConfirmConfirm: 'Zabalit',
    endedToast: 'Dopito.',
    // Offline end: the DELETE is queued and lands on the next flush (§H4).
    endQueued: 'Zabalím to, až bude signál.',

    // — Party streak —
    streakWeeks: (n: number) =>
      n === 1
        ? '1 týden v sérii'
        : n >= 2 && n <= 4
          ? `${n} týdny v sérii`
          : `${n} týdnů v sérii`,
    streakThisWeek: 'Tenhle týden už hoří. Drž to.',
    streakDead: 'Série spadla. Zapal ji novým pivem s partou.',
    streakEmpty: 'Bez série',

    // — Party leaderboard —
    leaderboardHeader: 'Žebříček party · 30 dní',
    // Nouns only — the numeral renders separately.
    leaderboardVisits: (n: number) =>
      n === 1 ? 'návštěva' : n >= 2 && n <= 4 ? 'návštěvy' : 'návštěv',
    leaderboardBeers: (n: number) => (n === 1 ? 'pivo' : n >= 2 && n <= 4 ? 'piva' : 'piv'),
    leaderboardMetricBeers: 'Piva',
    leaderboardMetricVisits: 'Návštěvy',
    leaderboardMe: 'Ty',
    leaderboardEmpty: 'Zatím nemáš s kým soupeřit. Přiber parťáky.',
    leaderboardMore: (n: number) =>
      n === 1 ? '+1 další' : n >= 2 && n <= 4 ? `+${n} další` : `+${n} dalších`,

    // — Social settings sheet (ghost + klid v noci) —
    settingsOpen: 'Otevřít nastavení party',
    settingsTitle: 'Nastavení party',
    settingsClose: 'Zavřít nastavení',
    ghostTitle: 'Neviditelný režim',
    ghostSubtitle:
      'Parta nevidí, kde sedíš, ani co jsi vypil. Tvoje cinknutí zůstanou jen u tebe.',
    shareDrinksTitle: 'Ukazovat partě, kde sedím',
    shareDrinksSubtitle:
      'Kámoši uvidí, ve které hospodě zrovna jsi a co ti večer teklo. Nikdo jiný ne.',
    ghostActive: 'Neviditelný režim je zapnutý',
    ghostChip: 'Skrytě',
    quietTitle: 'Klid v noci',
    quietSubtitle: 'V noci ti nepřijdou žádné cinky.',
    quietRange: (a: number, b: number) =>
      `Od ${String(a).padStart(2, '0')}:00 do ${String(b).padStart(2, '0')}:00`,
    hourStepperDecrement: 'o hodinu zpět',
    hourStepperIncrement: 'o hodinu vpřed',
    settingsSaved: 'Uloženo.',
    settingsError: 'Nastavení se nepovedlo uložit.',

    // — Hero sub-line variants (priority order in the screen) —
    heroLiveMine: (n: number) => `U tvého stolu už ${n}. Objednávej.`,
    // I'm broadcasting but nobody RSVP'd yet — heroQuiet would contradict it.
    // Wording must not echo the "SVÍTÍŠ PARTĚ" card kicker right below it.
    heroLiveSolo: 'Parta o tobě ví. Teď ať někdo kývne.',
    heroStreakRisk: 'Série visí na vlásku, tenhle týden ji ještě nikdo nezapálil.',
    heroFriendLive: (name: string) => `${name} svítí v hospodě. Kývneš?`,
    heroManyLive: (n: number) => `${n} z party teď sedí. Kdo se přidá?`,
    heroQuiet: 'Klid v partě. Někdo musí cinknout první.',

    // — Hero pulse panel —
    pulseQuietLabel: 'Klid v lokále',
    pulseLiveLabel: 'Teď se sedí',
    pulseMineLabel: 'Svítíš partě',
    pulseQuietTitle: 'Hoď první cinknutí',
    pulseQuietBody: 'Sedíš u stolu? Cinkni partě a nech kámoše kývnout.',
    pulseLiveBody: 'Někdo už drží stůl. Dej partě vědět, jestli dorazíš taky.',
    pulseMineBody: 'Cinknutí je venku. Teď čekáš, kdo kývne.',
    pulseJoinCta: 'Cinknout taky',
    pulseFriendCount: (n: number) =>
      n === 1
        ? '1 kámoš'
        : n >= 2 && n <= 4
          ? `${n} kámoši`
          : `${n} kámošů`,

    // — Tácek rebuild: one table card, one amber button, the rest behind "…" —

    /** Header chip when you have nobody yet. */
    soloChip: 'Zatím solo',
    /** Wide caption under the big numeral on the table card. */
    tableCaption: 'DNESKA NA PIVU',
    tableCaptionQuiet: 'KLID V LOKÁLE',
    /** Amber door in the card footer. */
    tableLink: 'Kdo jde',
    /** Quiet fact when no streak is running. */
    noStreak: 'Bez série',
    /** Quiet fact while the invisible mode hides you from the leaderboard. */
    hiddenRank: 'Jedeš v utajení',

    // — The one button, by state —
    ctaPing: 'Cinknout partě',
    ctaPingToo: 'Cinknout taky',
    ctaWhoIsComing: 'Kdo dorazí?',
    ctaAddFriend: 'Přidej kámoše',
    ctaSignIn: 'Přihlásit se',
    ctaNickname: 'Doplnit přezdívku',
    /** Behind the "…" door, because the footer holds one button only. */
    secondaryAddFriend: 'Přidat kámoše',

    // — Doors in the card footer: three surfaces, always visible —
    railVycep: 'Výčep',
    railLeaderboards: 'Žebříčky',
    railPhotoContest: 'FotoPivař',

    // — "Co spolu podniknout": the two other evening formats, on the surface —
    planHeader: 'Co spolu podniknout',
    planHomePartyTitle: 'Pivo u někoho',
    planHomePartyBody: 'Malé domácí posezení v okolí.',

    // — "Co ještě?" rows —
    moreTitle: 'Co ještě?',
    moreSettings: 'Nastavení party',
    moreMyCode: 'Můj kód',
    moreWholeParty: 'Celá parta',

    // — Nudge slot: at most one —
    nudgeRequest: (name: string) => `${name} chce do party`,
    nudgeRequestAccept: 'Přijmout',
    nudgeOffline: 'Ukazuju poslední, co vím.',
    nudgeOfflineRetry: 'Zkusit znovu',
    // "Někdo drží stůl" is no longer a nudge: "Kdo kde sedí" sits right under
    // the card with that friend's own card and its RSVP in it, so the strip was
    // repeating the card a thumb-width below it (§0.3).
    nudgeBroadcasting: 'Cinknutí je venku.',
    nudgeBroadcastEnd: 'Zabalit',
    nudgePush: 'Cinknu ti, když někdo sedne.',
    nudgePushEnable: 'Zapnout',
    nudgeContest: 'Výsledky kola jsou venku.',
    nudgeContestOpen: 'Mrknout',
    streakRiskFact: 'Tenhle týden ještě nezapálená',

    // — Kdo kde sedí: live presence derived from the counter, no ping needed —
    presenceHeader: 'Kdo kde sedí',
    presenceMe: 'Ty',
    presenceSomewhere: 'Někde na pivu',
    presenceBeers: (n: number) =>
      n === 1 ? '1 pivo' : n >= 2 && n <= 4 ? `${n} piva` : `${n} piv`,
    presenceHiddenNote: 'Jedeš v neviditelném režimu, takže tě parta u stolu nevidí.',
    presenceEmpty: 'Nikdo z party teď nikde nesedí.',
    /**
     * The card headline. Deliberately without the pub: "drží stůl Lokál
     * Dlouhááá" needs a locative ("v Lokálu Dlouhááá") that we cannot decline
     * for arbitrary pub names, and the row right below the card names the pub
     * anyway. "sedí" is third person, so it stays genderless.
     */
    headlineSitting: (name: string, others: number) => {
      if (others <= 0) return `${name} sedí na pivu.`;
      if (others === 1) return `${name} a ještě jeden sedí na pivu.`;
      if (others <= 4) return `${name} a další ${others} sedí na pivu.`;
      return `${name} a dalších ${others} sedí na pivu.`;
    },
    /** Card caption when the number counts people actually sitting somewhere. */
    tableCaptionSitting: 'SEDÍ NA PIVU',
    /**
     * The shared table, detected instead of declared. Same grammar constraints
     * as headlineSitting: no pub name (we cannot decline it) and no case on the
     * friend's name (a nickname is not declinable either), so everybody stays in
     * the nominative and the verb stays third-person genderless.
     */
    headlineTogether: (name: string, others: number) => {
      if (others <= 0) return `${name} sedí u stolu s tebou.`;
      if (others === 1) return `${name} a ještě jeden sedí u stolu s tebou.`;
      if (others <= 4) return `${name} a další ${others} sedí u stolu s tebou.`;
      return `${name} a dalších ${others} sedí u stolu s tebou.`;
    },
    /** Quiet marker on the presence rows that are sitting where I am. */
    presenceSameTable: 'u tvého stolu',

    // — The automatic evening feed, no hanging-up required.
    //   Deliberately NOT called "Výčep": that name already belongs to the
    //   screen behind the rail door, where you hang a night up on purpose. Two
    //   different things under one name is the confusion this rebuild is
    //   supposed to be removing, not adding.
    sittingsHeader: 'Co se pilo',
    sittingsEmpty: 'Zatím tu nikdo nic nevypil. Až se to změní, dozvíš se to tady.',
    sittingsMore: 'Načíst starší',
    sittingsLoading: 'Načítám…',
    /** Inline rating on a sitting row: "4,0/5 · Pilsner Urquell". */
    sittingRating: (rating: number, beer: string) =>
      `${rating.toFixed(1).replace('.', ',')}/5${beer ? ` · ${beer}` : ''}`,

    // — The one feed under the card —
    streamHeader: 'Co se děje',
    streamEmpty: 'Zatím ticho. Cinkni partě a rozjeď to.',

    // ── Parta 3.0 ──────────────────────────────────────────────────────────

    // — "CO TĚ ČEKÁ" cold-start teaser (§J) —
    whatIsPartaHeader: 'Co tě čeká',
    whatIsParta1: 'Jdeš na pivo? Cinkni a parta to hned ví.',
    whatIsParta2: 'Kámoši kývnou, jestli dorazí.',
    whatIsParta3: 'Společné večery drží sérii a posouvají tě v žebříčku.',

    // — Growth block "SEŽEŇ PARTU" (§A1) —
    growthHeader: 'Sežeň partu',
    myCodeCta: 'Ukázat můj kód',
    scanCta: 'Naskenovat kód',
    inviteShareCta: 'Poslat pozvánku',

    // — Identity gate (§A2) —
    coldStartAnonTitle: 'Přidej se k partě',
    coldStartAnonBody:
      'Přihlas se nebo si založ účet. Pak tě kámoši najdou podle přezdívky.',
    coldStartAnonCta: 'Přihlásit se',
    coldStartSetupTitle: 'Jak ti má parta říkat?',
    coldStartSetupBody: 'Doplň si přezdívku, ať tě kámoši najdou.',
    coldStartSetupCta: 'Doplnit přezdívku',

    // — CodeSheet "Můj kód" / QR / invite (§A3) —
    codeSheetTitle: 'Můj kód',
    codeSheetHint: 'Ukaž kámošovi QR kód nebo mu pošli pozvánku odkazem.',
    codeShare: 'Sdílet pozvánku',
    codeCopy: 'Poslat odkaz',
    codeCopied: 'Odkaz připravený.',
    codeScan: 'Přidat kámoše',
    codeNoNick: 'Přidej si přezdívku, ať tě poznají.',
    codeNoNickCta: 'Doplnit',
    codeOffline: 'Kód dostaneš, až chytneš signál.',
    shareMessage: (link: string) =>
      `Přidej si mě na Na pivo, ať víš, kdy jdu na jedno: ${link}`,

    // — Deep-link claim (§A5) —
    claimTitle: (name: string) => `${name} tě zve do party`,
    claimBody: 'Přidáš se? Uvidíte, kdo z vás je zrovna na pivu.',
    claimCta: 'Přidat do party',
    claimDone: 'Hotovo, čeká na potvrzení.',
    claimExpired: 'Pozvánka už vypršela. Ať ti kámoš pošle novou.',
    claimInvalid: 'Tuhle pozvánku neznám.',
    claimLoading: 'Načítám pozvánku…',
    claimSelf: 'To je tvůj vlastní kód.',
    claimBack: 'Zpět',

    // — Compose "Cinkni partě" (§B) —
    // Infinitive like every other button in the app ("Přijmout", "Zapnout…").
    composeOpen: 'Cinknout partě',
    composeTitle: 'Cinknout partě',
    planComposeTitle: 'Domluvit pivo',
    composeAudienceLabel: 'KOMU',
    recipientAll: 'Celá parta',
    recipientCustom: 'Vybrat',
    recipientAllSummary: (n: number) =>
      n === 0
        ? 'Cinknutí poletí celé partě.'
        : n === 1
          ? 'Cinknutí poletí 1 kámošovi.'
          : n >= 2 && n <= 4
            ? `Cinknutí poletí ${n} kámošům.`
            : `Cinknutí poletí ${n} kámošům.`,
    recipientCustomSummary: (n: number) =>
      n === 0
        ? 'Vyber, koho chceš vytáhnout na jedno.'
        : n === 1
          ? 'Vybraný 1 kámoš.'
          : n >= 2 && n <= 4
            ? `Vybraní ${n} kámoši.`
            : `Vybráno ${n} kámošů.`,
    recipientNoFriends: 'Nejdřív si přidej kámoše do party.',
    recipientNoSelection: 'Vyber, komu to cinkne.',
    recipientGroupPlaceholder: 'Název partičky',
    recipientGroupSave: 'Uložit',
    recipientGroupSaved: 'Partička uložená.',
    recipientGroupSaveHint: 'Vyber kámoše a pojmenuj partičku.',
    composePubLabel: 'KDE',
    composeNearby: 'Poblíž',
    composeRecent: 'Nedávné',
    composeNoNearby: 'Nic poblíž. Zkus nedávné nebo hledej.',
    composeNoRecent: 'Zatím žádné nedávné hospody.',
    composeLocPermCta: 'Zapnout polohu',
    composeTimeLabel: 'KDY',
    composeNow: 'Teď',
    composeLater: 'Na čas',
    composeMsgLabel: 'VZKAZ (nepovinný)',
    composeMsgPlaceholder: 'Držím stůl. Přidáš se?',
    composeSubmitNow: 'Cinknout',
    composeSubmitPlan: 'Naplánovat',
    composeNoPub: 'Vyber hospodu',
    composeQueued: 'Uloženo. Cinknu partě, až chytneš signál.',
    composeMeters: (m: number) => `${m} m`,

    // — Plans (§B3) —
    plansHeader: 'Plán na dnes',
    planMineTitle: 'Tvůj plán',
    planAt: (t: string) => `Dnes v ${t}`,
    planCreated: 'Plán letí partě. Když poběží připomínky, ještě tě odpoledne cinknu.',
    planCancel: 'Zrušit plán',
    planCancelConfirmTitle: 'Zrušit plán?',
    planCancelConfirmBody: 'Parta uvidí, že dneska nakonec nikam nejdeš.',
    planCanceled: 'Plán zrušený.',
    planCancelQueued: 'Zruším plán, až bude signál.',

    // — Reactions "Na zdraví" (§C) —
    cheers: 'Na zdraví',
    cheersA11y: (name: string) => `Připít na zdraví ${name}`,
    cheersCount: (n: number) => `${n}× na zdraví`,
    cheersDone: 'Ťuk! Na zdraví.',
    cheersUndone: 'Připití zpět.',
    reactQueued: 'Nejsi online. Připiju, až bude signál.',
    reactError: 'Připití se nepovedlo. Zkus to znovu.',

    // — Offline / stale cues (§H) —
    staleNote: 'stará data',

    // — Cancel outgoing invite (§F5) —
    cancelInviteTitle: 'Zrušit pozvánku?',
    cancelInviteConfirm: 'Zrušit pozvánku',
    inviteCanceled: 'Pozvánka zrušená.',

    // — Push opt-in strip + toggle (§E) —
    pushPromptTitle: 'Ať nezmeškáš večer',
    pushPromptBody: 'Dám ti vědět, když parta vyrazí nebo tě někdo pozve.',
    pushPromptCta: 'Zapnout upozornění',
    pushPromptDismiss: 'Teď ne',
    pushEnabledToast: 'Platí, dám vědět.',
    pushDeniedHint: 'Upozornění máš vypnutá v systému.',
    pushDeniedCta: 'Zapnout',
    pushToggleTitle: 'Upozornění na partu',
    pushToggleSub: 'Cinky, pozvánky a kdo je na pivu.',
    pushDisableError: 'Vypnutí se nepovedlo. Zkus to znovu.',

    // — Compass handoff (§F2) —
    showOnCompass: 'Ukaž na kompasu',
    // The compass "pointing at a friend" banner + escape hatch.
    friendCompassKicker: 'MÍŘÍŠ ZA PARTOU',
    friendCompassBack: 'Zpět na nejbližší',

    // — Friend profile (§F1) —
    statSharedBeers: 'společná piva',
    statNightsTogether: 'večerů spolu',
    statRitualsTogether: 'společných milníků',
    statStreakTogether: 'týdnů v sérii',
    profileNoHistory: 'Ještě jste spolu nikde nebyli. Tak cinkni.',
    profileRecentHeader: 'NAPOSLEDY SPOLU',
    profileRemove: 'Odebrat z party',
    profileActionsA11y: 'Další možnosti',
    profileError: 'Profil jsem teď nenačetl. Zkus to za chvíli.',

    // — Safety: block / report (§G) —
    blockTitle: (name: string) => `Zablokovat ${name}?`,
    blockBody: 'Zmizíš mu z party, neuvidí tě a nemůže tě pozvat.',
    blockConfirm: 'Zablokovat',
    blockAction: 'Zablokovat',
    blocked: 'Zablokováno.',
    unblockAction: 'Odblokovat',
    unblocked: 'Odblokováno.',
    profileBlocked: 'Profil je zablokovaný.',
    reportAction: 'Nahlásit',
    reportDone: 'Díky, mrknu na to.',
    // Row long-press action sheet title.
    rowActionsTitle: 'Co s tím?',

    // — Public (non-friend) profile via /parta/<id> — reached from Žebříčky —
    addToParty: 'Přidat do party',
    requestSentToast: 'Žádost letí. Teď musí kývnout.',
    requestPendingStrip: 'Žádost o partu čeká na kývnutí.',
    acceptRequest: 'Přijmout do party',
    requestAcceptedToast: 'A je v partě.',
    publicStatBeers: (n: number) =>
      n === 1 ? 'pivo v deníčku' : n >= 2 && n <= 4 ? 'piva v deníčku' : 'piv v deníčku',
    publicStatPubs: (n: number) =>
      n === 1 ? 'hospoda' : n >= 2 && n <= 4 ? 'hospody' : 'hospod',
    publicStatMapper: 'Mapér level',
    showcaseHeader: 'Vitrína odznaků',

    // — Správa party (Profil → /profile/parta) —
    manageTitle: 'Správa party',
    // Footer cross-link on Parta → the management screen.
    manageLink: 'Celá parta a pozvánky',
    // Management → Parta cross-link when incoming requests are waiting.
    manageIncomingLink: (n: number) =>
      n === 1
        ? '1 kámoš čeká na tebe v Partě'
        : n >= 2 && n <= 4
          ? `${n} kámoši čekají na tebe v Partě`
          : `${n} kámošů čeká na tebe v Partě`,
    fallbackName: 'Kámoš',
    pubFallback: 'Hospoda',
  },

  // Global leaderboards — /leaderboards (Žebříčky). Countrywide boards over
  // logged beers, discovered pubs, and Mapér XP. Copy measures diary activity
  // (zapsaná piva, objevené hospody), never litres — no chug-contest energy.
  leaderboards: {
    back: 'Zpět',
    // The screen owns three boards over three windows, so both switches sit on
    // the screen: a segmented track for the board and a quiet text row for the
    // window. Nothing here hides behind a „…“ sheet.
    screenTitle: 'Žebříčky',
    categoryTab: (category: 'beers' | 'pubs' | 'mapper') =>
      category === 'beers' ? 'Pivaři' : category === 'pubs' ? 'Objevitelé' : 'Mapéři',
    periodTab: (period: 'week' | 'year' | 'all') =>
      period === 'week' ? 'Týden' : period === 'year' ? 'Letos' : 'Celkem',
    // Mapér XP never resets, so the window row has nothing to switch — it says
    // so instead of showing three chips where two would do nothing.
    mapperPeriodNote: 'Sbírá se odjakživa',
    selectCategory: (label: string, selected: boolean) =>
      selected ? `${label}, vybráno` : `Přepnout na ${label}`,
    selectPeriod: (label: string, selected: boolean) =>
      selected ? `${label}, vybráno` : `Přepnout na ${label}`,
    tableTitle: (
      category: 'beers' | 'pubs' | 'mapper',
      period: 'week' | 'year' | 'all',
    ) => {
      if (category === 'mapper') return 'Mapéři · odjakživa';
      const categoryLabel = category === 'beers' ? 'Pivaři' : 'Objevitelé';
      const periodLabel =
        period === 'week' ? 'tenhle týden' : period === 'year' ? 'letos' : 'celkem';
      return `${categoryLabel} · ${periodLabel}`;
    },
    // Quiet eyebrow inside the hero card names what the board measures.
    subtitle: (category: 'beers' | 'pubs' | 'mapper', period: 'week' | 'year' | 'all') => {
      if (category === 'beers') {
        return period === 'week'
          ? 'Kdo tenhle týden zapsal nejvíc piv.'
          : period === 'year'
            ? 'Kdo letos zapsal nejvíc piv.'
            : 'Síň slávy. Všechna zapsaná piva.';
      }
      if (category === 'pubs') {
        return period === 'week'
          ? 'Kdo tenhle týden vystřídal nejvíc hospod.'
          : period === 'year'
            ? 'Kdo letos objevil nejvíc hospod.'
            : 'Kdo zná nejvíc hospod ze všech.';
      }
      return 'Kdo toho pro ostatní nejvíc zmapoval.';
    },

    // — Score units (noun only; the numeral renders separately) —
    unitBeers: (n: number) => (n === 1 ? 'pivo' : n >= 2 && n <= 4 ? 'piva' : 'piv'),
    unitPubs: (n: number) => (n === 1 ? 'hospoda' : n >= 2 && n <= 4 ? 'hospody' : 'hospod'),
    unitXp: 'XP',
    score: (category: 'beers' | 'pubs' | 'mapper', label: string, n: number) => {
      if (category === 'mapper') return `${label} XP`;
      const unit =
        category === 'beers'
          ? n === 1
            ? 'pivo'
            : n >= 2 && n <= 4
              ? 'piva'
              : 'piv'
          : n === 1
            ? 'hospoda'
            : n >= 2 && n <= 4
              ? 'hospody'
              : 'hospod';
      return `${label} ${unit}`;
    },

    // — Rows —
    rowMe: 'Ty',
    rowFriend: 'v partě',
    rowFallbackName: 'Pivař',

    // — No standing yet —
    // Without a rank there is no numeral and no podium to draw, so the card
    // says what is missing instead of drawing a placeholder for it.
    emptyBoardTitle: 'Tabulka je prázdná',
    emptyBoardBody: (category: 'beers' | 'pubs' | 'mapper') =>
      category === 'beers'
        ? 'Ticho jako před otvíračkou. První zapsané pivo tě posadí na první místo.'
        : category === 'pubs'
          ? 'Ticho jako před otvíračkou. První nová hospoda tě posadí na první místo.'
          : 'Ticho jako před otvíračkou. První doplněné info tě posadí na první místo.',
    errorTitle: 'Tabulku jsem nenačetl',
    errorBody: 'Server možná zrovna točí. Zkus to za chvilku znovu.',
    notRankedTitle: 'Ještě nejsi v tabulce',
    notRankedBody: (category: 'beers' | 'pubs' | 'mapper') =>
      category === 'beers'
        ? 'Zapiš pivo a naskočíš mezi ostatní.'
        : category === 'pubs'
          ? 'Zapiš pivo v nové hospodě a naskočíš mezi ostatní.'
          : 'Doplň, co o své hospodě víš, a naskočíš mezi ostatní.',
    weeklyReset: 'Nový závod v pondělí',
    blankA11y: (table: string, title: string, body: string) => `${table}. ${title}. ${body}`,
    // The rules of the race. They only show while the card has no rank to draw,
    // where they turn empty space into the one thing a newcomer actually needs.
    rulesCaption: 'JAK SE TO POČÍTÁ',
    rules: (
      category: 'beers' | 'pubs' | 'mapper',
      period: 'week' | 'year' | 'all',
      hasNickname: boolean,
    ) => [
      category === 'beers'
        ? 'Každé zapsané pivo je čárka.'
        : category === 'pubs'
          ? 'Každá nová hospoda je bod.'
          : 'Za každé doplněné info je XP.',
      category === 'mapper'
        ? 'Sbírá se odjakživa, nic se nemaže.'
        : period === 'week'
          ? 'V pondělí se tabulka maže a jede se nanovo.'
          : period === 'year'
            ? 'Počítá se všechno od Nového roku.'
            : 'Síň slávy. Nic se nemaže.',
      hasNickname
        ? 'V tabulce jsi pod svojí přezdívkou.'
        : 'Bez přezdívky tě v tabulce nikdo nevidí.',
    ],

    // — My standing —
    rankNoun: 'MÍSTO',
    noScore: 'Zatím bez čárky',
    totalInBoard: (count: string | null) => `z ${count ?? '-'} v tabulce`,
    listLabel: 'Kdo vede',
    heroA11y: (table: string, rank: string, score: string, total: number | null) =>
      `${table}. Pořadí podle skóre ${rank}. ${score}. V tabulce je ${total ?? 0}.`,
    chase: (category: 'beers' | 'pubs' | 'mapper', gap: number) => {
      const unit =
        category === 'beers'
          ? gap === 1
            ? 'pivo'
            : gap >= 2 && gap <= 4
              ? 'piva'
              : 'piv'
          : category === 'pubs'
            ? gap === 1
              ? 'hospoda'
              : gap >= 2 && gap <= 4
                ? 'hospody'
                : 'hospod'
            : 'XP';
      return `Do tabulky ti chybí ${gap} ${unit}.`;
    },

    // — Primary CTA —
    // No sub-labels here: the label already says what one tap does, and the
    // second line only repeated it in a quieter voice.
    ghostCta: 'Ukázat se',
    ghostAnonCta: 'Založit přezdívku',
    ghostNudge: 'Bez přezdívky tě nikdo nevidí',
    ctaBeers: 'Přidej si čárku',
    ctaPubs: 'Objev novou hospodu',
    ctaMapper: 'Zmapuj hospodu',
    retry: 'Zkusit znovu',

    // — Entry points —
    entryProfileTitle: 'Žebříčky',
    entryProfileSubtitle: 'Kde stojíš mezi pivaři z celé země',

    // — Rank teaser (Parta hero) — the entry point carries data, not a bare
    // link: "Tenhle týden jsi 47. pivař v zemi". Title renders in three parts
    // so the rank can sit in amber. Genderless throughout.
    teaserTitleBefore: 'Tenhle týden jsi ',
    teaserTitleRank: (rank: number) => `${rank}. pivař`,
    teaserTitleAfter: ' v zemi',
    teaserFallbackTitle: 'Žebříčky',
    teaserFallbackSubtitle: 'Poměř se s pivaři z celé země. V pondělí se jede nanovo.',
    teaserGhostSubtitle: 'Hraješ jako duch, v žebříčku tě nikdo nevidí',
    teaserTopSubtitle: 'Držíš se v top 10 · nový závod od pondělí',
    teaserResetNote: 'Nový závod každé pondělí',
    teaserChase: (gap: number) => {
      const unit = gap === 1 ? 'pivo' : gap >= 2 && gap <= 4 ? 'piva' : 'piv';
      return `Do top 10 ti chybí ${gap} ${unit}`;
    },

    // — Counter chip + post-log rank moment —
    // Rendered as `${rank}.` + this suffix (the numeral sits in amber).
    chipLabelSuffix: ' v zemi tenhle týden',
    rankUpToast: (rank: number) => `Posun v žebříčku! Teď jsi ${rank}. pivař v zemi.`,
  },

  // The merged "Pivo" tab — a segmented control flips between counting and the
  // personal history; the two screens below it are unchanged.
  beer: {
    segmentCount: 'Počítat',
    segmentDiary: 'Deník',
    // Kept so older references keep compiling; the tab now has two segments.
    segmentStats: 'Výkon',
    segmentHistory: 'Historie',
  },

  // "Deník" — the merged trail + numbers surface. One card for the last night,
  // a quiet chronology under it, one amber button, and every lifetime number a
  // tap away in the "Kolik jich už bylo?" sheet.
  diary: {
    // — Hero card —
    running: 'pořád běží',
    // Shown small under the big numeral when the night had no drink at all.
    emptyNoun: 'ZATÍM NIC',
    noPub: 'Bez hospody',
    // Three facts about the night that the big number cannot hold.
    factSpent: 'Utraceno',
    factSpan: 'Délka',
    factPace: 'Tempo',
    // Shown when a night has no price, no span or too few drinks to have a pace.
    factEmpty: '-',

    // — Chronology under the card —
    olderHeader: 'Starší večery',
    manualHeader: 'Dopsaná piva',
    /** Discreet markers on a row, and what a screen reader says about it. */
    privateTag: 'Jen pro tebe',
    queuedTag: 'Čeká na odeslání',
    // "12. 6. · 5 piv · 320 Kč"
    nightMeta: (parts: string[]) => parts.filter(Boolean).join(' · '),

    // — Nudge slot —
    loadFailed: 'Deníček jsem nenačetl.',
    retry: 'Zkusit znovu',
    queued: (count: number) =>
      count === 1
        ? '1 zápis čeká na odeslání'
        : count < 5
          ? `${count} zápisy čekají na odeslání`
          : `${count} zápisů čeká na odeslání`,

    // — The one button —
    cta: 'Dopiš večer',

    // — Empty state —
    emptyTitle: 'Prázdný deníček',
    emptyBody: 'Ťukni pivo v Počítadle, nebo dopiš večer, na který si vzpomeneš.',

    // — "Kolik jich už bylo?" sheet: every lifetime number, one tap deep —
    statsTitle: 'Kolik jich už bylo?',
    statsTotalCaption: 'PIV CELKEM',
    statsEvenings: 'Večerů',
    statsPubs: 'Hospod',
    statsSpent: 'Utraceno',
    statsThisMonth: 'Tenhle měsíc',
    statsMonthBeers: 'Piv',
    statsMonthAvgLabel: 'Průměr na večer',
    // Moved here from the profile's stats grid — numbers have one home now.
    statsRatings: 'Hodnocení',
    statsWalked: 'Nachozeno',
    statsRecordsTitle: 'Rekordy',
    statsRecordMost: 'Nejvíc za večer',
    statsRecordFastest: 'Nejrychlejší pivo',
    statsRecordLongest: 'Nejdelší večer',
    statsEmptyValue: 'Zatím nic',
    statsPubsTitle: 'Tvoje hospody',
    statsYearsTitle: 'Roky',
    // Second line under a year: "průměr 3,4 na večer"
    statsYearAvg: (avg: string) => `průměr ${avg} na večer`,
    statsFooter: 'Počítám jen piva, ale útrata je za všechno.',
    /** Druhá věta patiček jen bez účtu — s účtem si pamatuju všechno. */
    statsFooterNoAccount: 'Bez účtu si pamatuju posledních 50 večerů.',
    /** The noun under the numeral on a night that held no beer at all. */
    otherNoun: (type: 'wine' | 'soft_drink' | 'shot', count: number) =>
      czechPlural(count, {
        wine: { one: 'víno', few: 'vína', many: 'vín' },
        soft_drink: { one: 'nealko', few: 'nealka', many: 'nealk' },
        shot: { one: 'panák', few: 'panáky', many: 'panáků' },
      }[type]),
  },

  profile: {
    // — Tab header —
    title: 'Profil',
    diaryTitle: 'Pivní deník',
    privateDiary: 'Soukromý pivní deník',
    historyFactsHeader: 'Údaje večerů',

    // — Tácek rebuild: one card, one amber button, the rest behind "…" —

    /** Identity row when there is no account yet. */
    noAccountNick: 'Zatím bez účtu',
    noAccountCaption: 'Piva ti počítám i tak.',
    /** Wide caption under the big lifetime numeral. */
    lifetimeCaption: 'PIV ZA ŽIVOT',
    lifetimeCaptionEmpty: 'ČISTEJ ŠTOS',
    /** Amber door in the card footer. */
    badgesLink: 'Odznaky',
    /** Link beside the Odznaky heading, opens the full badge cabinet. */
    badgesAll: 'Zobrazit vše',
    /** Footer facts. */
    levelLine: (level: number, title: string) => `Úroveň ${level} · ${title}`,
    levelToNext: (xp: number) => `ještě ${xp} XP do dalšího levelu`,
    levelMaxed: 'Máš všechno, jsi legenda.',
    levelNoAccount: 'Level ti naskočí s účtem.',
    /** Caption under the level ring while there is no account to have a rung. */
    levelRingCaption: 'Úroveň',
    // — Lifetime trio in the card. Shorter than the `stat*` labels of the old
    //   stats grid, because each one only gets a narrow share of the card. —
    cardStatPubs: 'HOSPODY',
    cardStatEvenings: 'VEČERY',
    cardStatSpent: 'UTRACENO',
    cardStatDailyAverage: 'PIV DENNĚ',
    streakUnit: (count: number) =>
      `${czechPlural(count, { one: 'týden', few: 'týdny', many: 'týdnů' })} v řadě`,
    streakBest: (count: number) =>
      `Nejlepší ${count} ${czechPlural(count, { one: 'týden', few: 'týdny', many: 'týdnů' })}`,

    // — The one button —
    ctaCode: 'Ukaž svůj kód',
    ctaCodeSub: 'Kámoš tě naskenuje a jste parta.',
    ctaSignUp: 'Založ si profil',
    ctaSignUpSub: 'Ať o piva nepřijdeš při výměně mobilu.',
    secondaryPhotos: 'Pivní fotky',

    // — "Co ještě?" rows —
    moreTitle: 'Co ještě?',
    moreSettings: 'Nastavení',
    moreLeaderboards: 'Žebříčky',
    moreParta: 'Parta',
    morePartaCount: (friends: string) => friends,
    morePartaEmpty: 'Sežeň si partu',
    moreFollow: 'Sleduj Na pivo',

    // — Nudge slot: at most one —
    nudgePhotoFailed: 'Fotka se nenahrála.',
    nudgePhotoRetry: 'Zkusit',
    nudgeNickname: 'Bez přezdívky tě parta nepozná.',
    nudgeNicknameFix: 'Doplnit',
    // Count first: the strip truncates from the right, and losing the pub name
    // costs less than losing the number the line exists to show.
    nudgeLastNight: (pub: string, beers: string) => `${beers} · ${pub}`,
    nudgeLastNightOpen: 'Otevřít',
    nudgeEmpty: 'Zatím čistej štos. Zapiš první pivo.',
    nudgeEmptyCta: 'Na tácek',

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
    statDailyAverage: 'PIV DENNĚ',
    statSpent: 'UTRACENO',
    // Diary still formats its distance summary with these compatibility labels.
    kmShort: 'km',
    notAvailable: '-',

    // — Achievements —
    achievementsHeader: 'ODZNAKY',
    badgeCollectionTitle: 'Tvoje vitrína',
    badgeCollectionCta: 'Mrkni na všechny odznaky a výzvy',
    badgeCollectionIntro: 'Každý odznak je malá hospodská historka. Ty získané svítí, na další máš nápovědu.',
    creator: {
      header: 'ZŮSTAŇ V OBRAZE',
      title: 'Na pivo i mimo appku',
      subtitle: 'Novinky, zákulisí a občasný pivní výlet najdeš tady.',
      instagram: 'Instagram',
      instagramUrl: 'https://www.instagram.com/jsem_mach/',
      linkedin: 'LinkedIn',
      linkedinUrl: 'https://www.linkedin.com/in/mach-tomas/',
      discord: 'Discord',
      discordUrl: 'https://discord.gg/EDw8EW7Az8',
    },
    badgeFirstTenTitle: 'Prvních 10 piv',
    badgeFirstTenLocked: 'Napočítej 10 piv',
    badgeRegularTitle: 'Stálý host',
    badgeRegularLocked: 'Navštiv jednu hospodu 5×',
    badgeReviewerTitle: 'Recenzent',
    badgeReviewerLocked: 'Ohodnoť 10 hospod',
    badgeFotoPivarTitle: 'FotoPivař',
    badgeFotoPivarLocked: 'Vyhraj kolo fotosoutěže',
    // — Pivař badges (outside-pub drinking wave) —
    badgeChatarTitle: 'Chatař',
    badgeChatarLocked: 'Zapiš první pivo mimo hospodu',
    badgePodSirakemTitle: 'Pod širákem',
    badgePodSirakemLocked: 'Zapiš pivo venku pod širým nebem',
    badgeLahvacTitle: 'Lahváčový filozof',
    badgeLahvacLocked: 'Zapiš 25 lahváčů',
    badgePlechTitle: 'Plechovkáč',
    badgePlechLocked: 'Zapiš 25 plechovek',
    // — Diary/social badges (leaderboards wave) —
    badgeFirstBeerTitle: 'První pivo',
    badgeFirstBeerLocked: 'Zapiš svoje první pivo',
    badgeCenturyTitle: 'Stovka',
    badgeCenturyLocked: 'Napočítej 100 piv',
    badgePilgrimTitle: 'Poutník',
    badgePilgrimLocked: 'Navštiv 25 různých hospod',
    badgeStamgastTitle: 'Štamgast',
    badgeStamgastLocked: 'Navštiv jednu hospodu 10×',
    badgeNightOwlTitle: 'Noční sova',
    badgeNightOwlLocked: 'Zapiš pivo po půlnoci',
    badgeTasterTitle: 'Ochutnávač',
    badgeTasterLocked: 'Ochutnej 10 různých piv',
    badgePartyAnimalTitle: 'Duše party',
    badgePartyAnimalLocked: 'Měj v partě 5 parťáků',

    // — Recent activity —
    recentHeader: 'POSLEDNÍ AKTIVITA',

    // — Account & settings rows —
    manageAccount: 'Spravovat účet',
    settingsRow: 'Nastavení',

    // — Parta cross-link (Parta 3.0 §A2 entry point) —
    myCode: 'Můj kód',
    partaCount: (n: number) =>
      n === 0
        ? 'Sežeň si partu'
        : n === 1
          ? '1 kámoš v partě'
          : n >= 2 && n <= 4
            ? `${n} kámoši v partě`
            : `${n} kámošů v partě`,

    report: {
      button: 'Nahlásit',
      profileFallback: 'tenhle profil',
      confirmTitle: 'Nahlásit profil?',
      confirmBody: (profile: string) =>
        `Hlášení na ${profile} si projdu. Použij to pro nevhodnou přezdívku, fotku nebo spam.`,
      confirmSubmit: 'Nahlásit',
      sentToast: 'Hlášení mám, mrknu na to.',
    },

    // — Signed-out hero —
    signedOutTitle: 'Založ si profil',
    signedOutBody:
      'Založ si účet a piva, hodnocení, partu i žebříčky budeš mít všude, kde se přihlásíš.',
    signedOutCta: 'Vytvořit účet',

    // — One-screen privacy choice after registration —
    privacy: {
      eyebrow: 'JEŠTĚ JEDNA VĚC',
      title: 'Jak chceš být vidět?',
      body: 'Vyber si, kdo tě v Na pivu najde. Kdykoli to změníš v profilu.',
      publicTitle: 'Veřejný štamgast',
      publicBody: 'Lidi tě najdou podle jména nebo přezdívky a uvidí tě v žebříčcích.',
      privateTitle: 'Jen pro partu',
      privateBody: 'Veřejně tě nikdo nenajde. Profil uvidí jen tvoji kamarádi.',
      promise: 'Přesnou polohu ani soukromý pivní deník tahle volba nikdy nezveřejní.',
      confirm: 'Potvrdit a jít na pivo',
      saving: 'Ukládám…',
      skip: 'Přeskočit, nic neměnit',
      skipAfterError: 'Pokračovat beze změny',
      error: 'Nastavení jsem neuložil. Zkus to znovu, nebo pokračuj beze změny.',
    },

    // — Shared profile form copy —
    form: {
      nicknamePlaceholder: 'prezdivka',
      nicknameChecking: 'Ověřuju…',
      nicknameAvailable: 'Volné',
      nicknameTaken: 'Tahle přezdívka je zabraná',
      nicknameInvalid: 'Neplatná přezdívka',
      nicknameTooShort: 'Aspoň 3 znaky',
      nicknameTooLong: 'Nejvíc 20 znaků',
      nicknameCharset: 'Jen písmena bez diakritiky, číslice, _ a .',
      nicknameReserved: 'Tahle přezdívka není dostupná',
      avatarUploadError: 'Fotka se nenahrála. Zkus to znovu.',
      permissionBody: 'Pro výběr fotky potřebuju přístup ke galerii. Povol ho v Nastavení.',
      permissionBlockedBody: 'Přístup k fotkám je zakázaný. Povol ho v systémovém Nastavení a zkus to znovu.',
      openSettings: 'Otevřít Nastavení',
    },

    // — Edit screen —
    edit: {
      title: 'Upravit profil',
      avatarHeader: 'FOTKA',
      changePhoto: 'Změnit fotku',
      removePhoto: 'Odebrat fotku',
      removePhotoConfirmTitle: 'Odebrat profilovku?',
      removePhotoConfirmBody: 'Profil se vrátí k iniciále.',
      removePhotoConfirmCancel: 'Nechat ji',
      removePhotoConfirmAction: 'Odebrat',
      nicknameHeader: 'PŘEZDÍVKA',
      displayNameHeader: 'JMÉNO',
      displayNameLabel: 'Jméno (nepovinné)',
      displayNamePlaceholder: 'Jak ti mám říkat',
      visibilityHeader: 'VIDITELNOST',
      visibilityToggleLabel: 'Veřejný profil',
      // Compact reminder; the post-registration privacy screen carries the full choice.
      consent:
        'Veřejný profil tě ukáže v žebříčcích a ve vyhledávání podle přezdívky a fotky. Polohu ani jednotlivá piva nikdy nezveřejňuju.',
      consentPrivate: 'Když vypneš, uvidí tě jen tví kamarádi.',
      save: 'Uložit',
      saving: 'Ukládám…',
      savedToast: 'Profil je uložený.',
      errorGeneric: 'Něco se pokazilo. Zkus to znovu.',
    },
    // Four-up strip under the profile chart.
    chartStatBeers: 'Piv',
    chartStatEvenings: 'Večerů',
    chartStatPubs: 'Hospod',
    chartStatLongest: 'Nejdelší',
    recordEveningLength: 'Délka večera',
    firstEntryNone: 'Zatím bez zápisu',
    firstEntryUnknown: 'První zápis už je v deníčku',
    firstEntrySince: (when: string) => `První zápis ${when}`,
    // Tabs and the chart window picker. State holds keys, these are the labels.
    tabStats: 'Statistiky',
    tabActivity: 'Aktivita',
    periodWeek: 'Týden',
    periodMonth: 'Měsíc',
    periodYear: 'Rok',
    handleFallback: 'Tvůj profil',
    createProfileA11y: 'Založit profil',
    statsLoadingA11y: 'Načítám statistiky',
    statsRetryA11y: 'Načíst statistiky znovu',
    statsRetry: 'Statistiky teď nedotekly. Zkusit znovu',
    myNightsLoadingA11y: 'Načítám tvoje večery',
    myNightsRetryA11y: 'Načíst svoje večery znovu',
    myNightsRefreshA11y: 'Obnovit svoje večery',
    myNightsMoreA11y: 'Načíst starší večery',
    nightsError: 'Večery se teď nedotáhly',
    nightsEmpty: 'Zatím žádný zveřejněný večer',
    nightsRetry: 'Zkusit znovu',
    nightsStale: 'Jedeš z posledního načtení · Obnovit',
    nightsLoadingMore: 'Dotahuju…',
    nightsMore: 'Starší večery',
  },

  party: {
    /** Server rule: a published night needs at least one drink of my own. */
    nothingToPublish: 'Bez vlastního piva není co zveřejnit.',
    gamesComingSoon: 'Hry ještě dolaďuju. Přijdou v další verzi.',
    gamesSoonBadge: 'Brzy',
    staleEveningClosed: 'Starý večer jsem zavřel.',
    nightTitleOutsidePub: 'Večer mimo hospodu',
    nightTitleAtPub: (pubName: string) => `Večer v ${pubName}`,
    nightTitleFallback: 'Pivní večer',
    gamesTitle: 'Hry',
    gameToolsTitle: 'Pomůcky ke stolu',
    eveningExtrasTitle: 'Na celý večer',
    scoringPoints: 'Na body',
    scoringNoPoints: 'Bez bodů',
  },

  gameResult: {
    payingSelf: 'Platíš ty',
    payingOther: (name: string) => `Platí ${name}`,
    payingNote: 'Další runda je jasná.',
    winningSelf: 'Vyhráváš',
    winningOther: (name: string) => `Vyhrává ${name}`,
    winningNote: 'Nejvíc bodů u stolu.',
    done: 'Dohráno',
    doneNote: 'Výsledek zůstal u večera.',
    closeLabel: 'Konec',
  },

  gameHost: {
    loading: 'Načítám hru…',
    unavailable: 'Hra v téhle verzi nejde spustit.',
    loadFailed: 'Hru jsem nenačetl.',
    stopped: 'Hra se zastavila.',
    timeout: 'Hra se nespustila včas.',
    retry: 'Zkusit znovu',
    spectator: 'Tuhle hru jen sleduješ.',
    savingResult: 'Ukládám výsledek…',
    waitingForResult: 'Čekám na výsledek…',
    resultSaveFailed: 'Výsledek jsem neuložil.',
    /** The page raised the `protocol_mismatch` code (see games/protocol.ts). */
    protocolMismatch: 'Hra dostala zprávu, které nerozumí.',
  },

  counter: {
    partyTotalBeersLabel: 'celkem piv',
    // — Permission gate —
    permTitle: 'Potřebuju tvoji polohu',
    // Same Google Play prominent-disclosure wording rules as `permissions.body`.
    permBody:
      'Na pivo sbírá údaje o tvé poloze, aby poznalo hospody v okolí a podnik, ve kterém sedíš. Aktuální nebo přibližná poloha se kvůli tomu posílá na můj server. Se zapnutými hospodskými připomínkami kontroluju polohu, i když je appka zavřená nebo ji zrovna nepoužíváš. GPS trasu ani historii polohy neukládám.',
    permCta: 'Povolit polohu',
    permOpenSettings: 'Otevřít Nastavení',

    // — Place chip / picker —
    // There is no "detecting" or "no pub nearby" screen any more: both are just
    // states of the place chip, and the picker is where you resolve them.
    detecting: 'Hledám, kde sedíš…',
    retry: 'Zkusit znovu',
    noPubAddPub: 'Přidat hospodu',
    pickerTitle: 'Kde sedíš?',

    // — Mimo hospodu (logging outside a pub) —
    // The picker splits into two sections: nearby pubs + the outside contexts.
    pickerNearbyHeader: 'Blízké hospody',
    pickerOutsideHeader: 'Mimo hospodu',
    outsideLabel: (context: OutsidePlaceContext) =>
      ({ private: 'Doma / na chatě', outdoors: 'Venku', other: 'Mimo hospodu' })[context],
    // Entry from the permission gate — counting is never blocked by GPS.
    outsideNoLocationCta: 'Zapsat pivo bez polohy',
    // Caption of the session-drinks group in the pick sheet (outside a pub there
    // is no community menu; the list holds what you've logged tonight).
    outsideMenuHeader: 'Dnes piješ',

    // — Coaster meta ("3 piva · 186 Kč · před 12 min") —
    lastDrinkShortJustNow: 'právě teď',
    lastDrinkShortMinutesAgo: (minutes: number) => `před ${minutes} min`,
    // A local, optional hydration nudge. It makes no health, sobriety, BAC, or
    // driving claim. `count` is the beer that triggered it (4, 8, 12...).
    waterNudge: (count: number) => {
      const lines = [
        'Jestli chceš, dej si teď i sklenici vody.',
        'Jen malá připomínka: voda může přijít vhod.',
        'Co takhle krátká pauza a sklenice vody?',
      ];
      const index = Math.max(0, Math.round(count / 4) - 1) % lines.length;
      return lines[index];
    },

    // — Sync —
    // Server hard-rejected a drink over the daily anti-abuse cap ("drink_limited"):
    // the entry stays in the local diary only, so no data is lost — just not synced.
    drinkLimitedToast: 'Dneska už toho bylo na server moc, tenhle zápis zůstává jen v tvém deníčku.',

    // ── "Tácek" surface ──────────────────────────────────────────────────────
    // The counter is four blocks: place chip, coaster (čárky), one nudge slot,
    // one button. The button's label always says exactly what one tap does.

    // Coaster, nothing counted yet — the only line of prose on the screen.
    coasterEmpty: 'Čistej tácek',
    // The one button, in each of its states.
    ctaPick: 'Co si dáš?',
    ctaFirstBeer: 'Zapiš první pivo',
    ctaLogBeer: 'Zapiš pivo',
    repeatCta: 'Zapsat stejné pivo',
    // The quiet twin of "Ještě jedno" — a different beer, a shot, a Kofola. Lives
    // in the card as a chip, on screen the whole time the CTA is repeating.
    quickOtherBeer: 'Jiné pivo',
    quickMapPub: 'Zmapuj',
    resumeSub: (summary: string) => `Posledně tady: ${summary}.`,
    // Place chip when GPS found nothing close enough to say "you sit here".
    placeUnknown: 'Kde sedíš?',

    // Nudge slot — one occupant at a time, never stacked.
    // Ordinal, so it stays genderless ("3. pivo", not "dal jsi třetí").
    countedStrip: (n: number) => `Máš to tam. ${n}. pivo.`,
    countedStripOther: 'Máš to tam.',
    undo: 'Vrátit',
    // The rapid-drink guard is inline now: the tap does NOT count until this is
    // confirmed, and letting it time out means "no".
    rapidInline: (minutes: number) => `Poslední pivo před ${minutes} min. Je zápis správně?`,
    rapidInlineJustNow: 'Pivo máš zapsané před chvilkou. Je zápis správně?',
    rapidInlineConfirm: 'Ano, zapsat',
    checkinNudge: 'Stálo za to?',
    checkinNudgeCta: 'Ohodnotit',
    dopitoNudge: 'Dopito?',
    // One-shot toast after the very first count, ever. The only teaching copy.
    undoHint: 'Ťukni na Účet, když chceš něco vrátit.',

    // Toast right after a beer lands. The undo strip below states the fact
    // ("Máš to tam. 3. pivo."), so this one only carries the mood — short,
    // genderless, and it rotates so the tenth beer doesn't read like the second.
    // `n` is the beer's ordinal in tonight's tally.
    countedToast: (n: number) => {
      if (n === 1) return 'První dneska. Ať ti chutná!';
      const lines = [
        'Čárka na tácku přibyla.',
        'Zapsáno, večer běží.',
        'Máš to v deníčku.',
        'A je tam další.',
      ];
      return lines[(n - 2) % lines.length];
    },
    // Same moment, but the drink wasn't a beer — no beer-counting flavour.
    countedToastOther: 'Zapsáno, mám to.',

    // "Tvůj účet" sheet — the one place that removes and closes.
    receiptTitle: 'Tvůj účet',
    receiptChip: 'Účet',
    receiptStarted: (time: string) => `Načato v ${time}`,
    receiptTotal: 'Celkem',
    receiptClose: 'Dopito, zavřít účet',

    // "Co si dáš?" sheet — the one place that adds.
    pickTitle: 'Co si dáš?',
    pickAddBeer: 'Přidat jiné pivo',
    pickNonBeer: 'Nealko, panák nebo víno',
    pickEmptyPub: 'Tady ještě nikdo nic nezapsal.',
    pickEmptyOutside: 'Lahváč, plechovka, cokoliv.',
    pickFirstBeer: 'Zapsat první pivo',

    // — "Víc" sheet — everything that isn't counting sits one tap deeper.
    moreTitle: 'Co ještě?',
    moreStory: 'Nálepka na story',
    moreMapPub: 'Zmapovat hospodu',

    // Caption of the pub's community menu inside the pick sheet.
    menuHeader: 'Co tu mají',
    rotatingMenuBadge: 'Rotující čepy',
    rotatingMenuHint: 'Piva se tu střídají. Tohle je poslední potvrzená nabídka.',
    scanDrinks: 'Vyfotit nápojový lístek',
    scanDrinksLoading: 'Čtu nápoják…',
    scanDrinksTitle: 'Co si dáváš?',
    scanDrinksHint: 'Vyber nápoj a před zapsáním ho ještě můžeš upravit.',
    scanDrinksEmpty: 'Na fotce jsem žádný nápoj nepřečetl.',
    cameraTitle: 'Co chceš cvaknout?',
    cameraBeer: 'Pivo do deníčku',
    cameraMenu: 'Menu hospody',
    cameraMenuNeedsPub: 'Vyber hospodu a ťukni na foťák znovu',
    // — Backdate (zapsat nápoj zpětně) —
    backdateLink: 'Zapsat nápoj zpětně',
    backdateTitle: 'Kdy to bylo?',
    backdateHourAgo: 'Před hodinou',
    backdateTwoHoursAgo: 'Před dvěma hodinami',
    backdateYesterdayEvening: 'Včera večer',
    perBeerCount: (n: number) => `${n}×`,

    // — Closing / resuming an evening —
    // Explicit "I'm done" — archives the session to history.
    doneDrinking: 'Dopito',
    doneTitle: 'Dopito?',
    doneBody: 'Zavřu tenhle večer a najdeš ho v Historii.',
    doneConfirm: 'Dopito',
    // Offered when a recent evening at this pub auto-completed and can continue.
    resumeEvening: 'Pokračovat ve večeru',

    // — Beer / price modal —
    priceModalTitle: 'Kolik stojí?',
    addModalTitle: 'Jaké pivo si dáváš?',
    addDrinkModalTitle: (type: DrinkType) =>
      ({
        beer: 'Jaké pivo si dáváš?',
        wine: 'Jaké víno si dáváš?',
        soft_drink: 'Jaké nealko si dáváš?',
        shot: 'Jaký panák padl?',
      })[type],
    drinkTypeLabel: (type: DrinkType) =>
      ({ beer: 'Pivo', wine: 'Víno', soft_drink: 'Nealko', shot: 'Panák' })[type],
    drinkNamePlaceholder: (type: DrinkType) =>
      ({
        beer: 'Název piva, např. Pilsner Urquell 12°',
        wine: 'Název, např. Ryzlink vlašský',
        soft_drink: 'Název, např. Kofola',
        shot: 'Název, např. Slivovice',
      })[type],
    editModalTitle: 'Uprav cenu',
    beerNamePlaceholder: 'Název piva, např. Pilsner Urquell 12°',
    // Add-form shortcut into the AI menu scan (hands over to the contribute
    // editor). Framed as filling the PUB's menu, not logging your own drinks.
    scanMenuShortcut: 'Vyfoť lístek a doplním, co tu mají',
    // — Serving type (only asked outside a pub; in a pub it stays unasked) —
    servingLabel: 'Jak je podané?',
    servingTypeLabel: (serving: ServingType) =>
      ({
        unknown: 'Nevím',
        draft: 'Točené',
        bottle: 'Lahváč',
        can: 'Plechovka',
        plastic_bottle: 'PETka',
        other: 'Jinak',
      })[serving],
    // Outside a pub the price is optional — you rarely know it at home.
    outsidePricePlaceholder: 'Cena (nepovinná)',
    priceLabel: 'Cena za',
    volumeSmall: '0,3 l',
    volumeMedium: '0,4 l',
    volumeLarge: '0,5 l',
    volumeOther: 'Jiné',
    volumeCustomPlaceholder: 'např. 1000',
    volumeUnitMl: 'ml',
    confirmCount: 'Připsat pivo',
    confirmDrink: (type: DrinkType) =>
      ({ beer: 'Připsat pivo', wine: 'Připsat víno', soft_drink: 'Připsat nealko', shot: 'Připsat panáka' })[type],
    confirmSave: 'Uložit',
    cancel: 'Zrušit',

    // — Formatting helpers —
    price: (czk: number) => `${czk} Kč`,
    // "62 Kč · 0,5 l" or just "62 Kč" when no volume.
    beerMeta: (price: string, ml?: number) =>
      ml ? `${price} · ${formatVolume(ml)}` : price,
  },

  // — Pivař (drink-logging XP ladder; XP bar strings are shared with Mapér) —
  pivar: {
    header: 'TVŮJ LEVEL',
    level: (n: number, title: string) => `Úroveň ${n} · ${title}`,
  },

  // "Výčep" — finished nights from the automatic Parta history and explicitly
  // public stories in Svět. Prices and raw location history never leave the
  // diary. The one-tap reaction is a "runda" — a symbolic round bought for the
  // author of a published story.
  vycep: {
    title: 'Výčep',
    deleteCommentTitle: 'Smazat komentář?',
    deleteCommentBody: 'Komentář zmizí všem.',
    deleteCommentCancel: 'Nechat ho',
    deleteCommentConfirm: 'Smazat',
    scopeParta: 'Parta',
    scopeWorld: 'Svět',

    // Parta-tab teaser strip.
    teaserSubtitle: 'Vyvěšené noci tvé party i zbytku světa.',

    // — Feed —
    emptyPartaTitle: 'V Kocovinách je zatím prázdno',
    emptyPartaBody: 'Až někdo z party zapíše večer, objeví se tady.',
    emptyWorldTitle: 'Svět zatím mlčí',
    emptyWorldBody: 'Nikdo teď nemá vyvěšenou noc. Vyvěs tu svoji a rozjeď to.',
    loadError: 'Výčep jsem nenačetl.',
    retry: 'Zkusit znovu',
    loadMore: 'Načíst další večery',
    loadMoreError: 'Další večery jsem nenačetl · Zkusit znovu',
    loadMoreRetryA11y: 'Zkusit načíst další večery',
    publishLatestCta: 'Vyvěs svoji noc',
    logBeerCta: 'Zapiš si pivo',
    anonymousAuthor: 'Pivař',
    myNightChip: 'Tvoje noc',
    visibilityChipFriends: 'Jen parta',
    visibilityChipWorld: 'Celý svět',
    // "3 h 20 min" pub-to-pub span of the night.
    nightDuration: (hours: number, minutes: number) =>
      hours > 0 ? (minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`) : `${minutes} min`,
    outsidePub: 'Mimo hospodu',

    // — Runda (the reaction) —
    round: 'Runda',
    roundCount: (n: number) =>
      czechPlural(n, { one: '1 runda', few: `${n} rundy`, many: `${n} rund` }),
    roundSentToast: 'Runda poslaná. Dobrej tah.',
    roundUndoneToast: 'Runda vrácená zpátky na tácek.',
    roundQueuedToast: 'Rundu pošlu, až chytím signál.',
    roundErrorToast: 'Runda nedošla. Zkus to za chvíli.',

    // — Publish sheet —
    publishTitle: 'Vyvěsit noc na Výčep',
    publishBody:
      'Vyvěsím počet piv, hospody, datum a jak dlouho noc trvala. Útratu, polohu ani jednotlivá piva nikam neposílám.',
    visibilityLabel: 'KDO TO UVIDÍ',
    visibilityFriendsHint: 'Noc uvidí jen tvoje parta.',
    visibilityWorldHint: 'Noc uvidí každý, kdo otevře Výčep. I mimo tvoji partu.',
    publishCta: 'Vyvěsit',
    updateCta: 'Vyvěsit znovu',
    publishedToast: 'Noc visí v Kocovinách.',
    publishQueuedToast: 'Vyvěsím ji, až budeš online.',
    publishErrorToast: 'Noc se mi nepovedlo uložit. Zkus to znovu.',
    unpublishCta: 'Stáhnout z Kocovin',
    unpublishConfirmBody: 'Večer zmizí z Kocovin i profilů. V deníčku ti zůstane.',
    unpublishedToast: 'Noc už v Kocovinách nevisí.',
    unpublishErrorToast: 'Stažení se mi nepovedlo uložit. Zkus to znovu.',
    nicknameNeededTitle: 'Chybí ti přezdívka',
    nicknameNeededBody:
      'Aby noc mohl vidět celý svět, potřebuješ přezdívku. Nastavíš ji v profilu za minutku.',
    nothingToPublish: 'Prázdnou noc nevyvěsíš. Nejdřív musí něco padnout.',

    // — Story share (transparent sticker pasted over the user's own photo) —
    // Live variant: shared from the counter while still at the pub, as an
    // invite ("come join me") rather than a recap of the finished night.
    storyLiveEntryCta: 'Nálepka na story',
    // Short label for the compact action card right under the counter hero.
    storyEntryShort: 'Nálepka',
    storyLiveTopArc: 'PRÁVĚ TEĎ',
    storyLiveHero: 'NA PIVU',
    storyLiveCta: 'Stav se!',
    storyModalTitle: 'Nálepka na story',
    storyStickerHint: 'Vyfoť si vlastní story a tuhle nálepku na ni nalep.',
    storyShareCta: 'Sdílet jinam',
    storyCopyCta: 'Kopírovat nálepku',
    storyPreparing: 'Připravuju…',
    storyCopied: 'Zkopírováno. Otevři Instagram a vlož do story.',
    storyShareError: 'Nálepku se nepovedlo připravit. Zkus to znovu.',
    shareNightCta: 'Sdílet noc',
    // Small always-true footer line on the story image itself.
    storyBrand: 'NA PIVO',
    storyStatBeers: (n: number) => czechPlural(n, { one: 'pivo', few: 'piva', many: 'piv' }),
    // Compact "and also" line under the hero for non-beer drinks. Empty when
    // the night was beer-only, so the card stays clean.
    storySecondaryLine: (wine: number, shots: number, soft: number): string => {
      const parts: string[] = [];
      if (wine > 0)
        parts.push(`${wine} ${czechPlural(wine, { one: 'víno', few: 'vína', many: 'vín' })}`);
      if (shots > 0)
        parts.push(
          `${shots} ${czechPlural(shots, { one: 'panák', few: 'panáky', many: 'panáků' })}`,
        );
      if (soft > 0) parts.push(`${soft}× nealko`);
      return parts.length > 0 ? `k tomu ${parts.join(' · ')}` : '';
    },

    // — Evening detail entry —
    sectionTitle: 'Výčep',
    sectionHeader: 'VÝČEP',
    publishEntryTitle: 'Vyvěsit na Výčep',
    publishEntryBody: 'Pochlub se partě nebo celému světu, jak šla noc.',
    publishedState: (visibility: string) => `Visí v Kocovinách · ${visibility}`,

    // — Reporting a public night —
    reportNight: 'Nahlásit noc',
    reportTitle: 'Nahlásit tuhle noc?',
    reportBody: 'Nahlášení pošleš anonymně mně. Mrknu na to.',
    reportConfirm: 'Nahlásit',
    reportSentToast: 'Díky, mám to. Mrknu na to.',
    reportErrorToast: 'Nahlášení nedošlo. Zkus to znovu.',
  },

  myBeers: {
    // Tab label + screen title.
    title: 'Moje piva',

    // — Empty state —
    emptyTitle: 'Zatím žádná pivní stopa',
    // Shown when the detail is opened for an evening that is no longer there.
    eveningGoneTitle: 'Tenhle večer už v deníčku není.',
    emptyBody:
      'Ťukni na pivo v Počítadle a večer se uloží sem. Uvidíš, kde to bylo, co teklo a kolik to dalo.',

    // — Sections —
    currentHeader: 'AKTUÁLNÍ VEČER',
    pastHeader: 'MINULÉ VEČERY',
    diaryHeader: 'PIVNÍ DENÍČEK',
    historicalCta: 'Zapsat zpětně',
    historicalCtaBody: 'Dopiš piva, hospodu, čas a cenu.',
    historicalTitle: 'Dopsat piva',
    historicalBeersLabel: 'Piva',
    historicalAddBeer: 'Přidat pivo',
    historicalNextBeerPlaceholder: 'Další pivo',
    historicalDateLabel: 'Datum',
    historicalDatePlaceholder: '12. 6. 2026',
    historicalTimeLabel: 'Čas',
    historicalTimeFromLabel: 'Od',
    historicalTimeToLabel: 'Do',
    historicalTimePlaceholder: '19:45',
    historicalTimeToPlaceholder: 'Nepovinné',
    historicalDateError: 'Zkontroluj datum a časy. Budoucnost zatím nečepuju.',
    historicalPubLabel: 'Hospoda',
    historicalPubPlaceholder: 'Kde to bylo?',
    historicalQuantityLabel: 'Počet',
    historicalPriceLabel: 'Cena / ks',
    historicalPricePlaceholder: 'Nepovinné',
    historicalCityLabel: 'Město',
    historicalVisibilityHint: 'Starší zápisy jsou nejdřív jen pro tebe.',
    historicalVisibilityFriendsHint: 'Parta uvidí piva, hospodu, čas a poznámku.',
    historicalVisibilityPrivateHint: 'Nechám si to jen v tvém deníčku.',
    historicalSubmit: 'Uložit vzpomínku',
    historicalSaved: (count: number) =>
      count === 1 ? 'Vzpomínka zapsaná.' : count >= 2 && count <= 4 ? `${count} piva zapsaná.` : `${count} piv zapsáno.`,
    historicalSaveError: 'Vzpomínku se mi nepovedlo uložit. Zkus to znovu.',
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
    breakdownTitle: 'Co padlo',
    // Hero stats above the breakdown.
    statBeers: 'Piv',
    statOther: 'Ostatní',
    // Meta shown to the right of a beer name, e.g. "2× · 124 Kč" (count × subtotal).
    // The volume is appended to the name separately in EveningBreakdown.
    breakdownLine: (count: number, price: string) => `${count}× · ${price}`,
    drinkGroupTotal: (price: string) => `Celkem ${price}`,
    addDrinkToEvening: 'Dopsat pivo',
    addDrinkToEveningTitle: 'Co ještě padlo?',
    addDrinkToEveningSubmit: 'Dopsat do večera',
    addDrinkToEveningSaved: 'Pivo dopsané. Večer sedí.',
    editDrink: 'Upravit',
    deleteDrink: 'Odebrat jeden nápoj',
    editDrinkTitle: 'Opravit název nápoje',
    editDrinkGroupTitle: (count: number) =>
      count > 1 ? `Přejmenovat všech ${count} nápojů` : 'Opravit název nápoje',
    editDrinkPlaceholder: 'Název nápoje',
    editDrinkSave: 'Uložit',
    editDrinkCancel: 'Zrušit',
    editDrinkEmpty: 'Bez názvu to nepůjde.',
    deleteDrinkTitle: 'Odebrat jeden nápoj?',
    deleteDrinkBody: 'Počet na řádku snížím o jeden.',
    deleteDrinkConfirm: 'Odebrat',
    deleteDrinkCancel: 'Zrušit',
    totalLabel: 'Celkem',

    // — Personal pub rating ("Stálo to za návrat?") —
    ratingTitle: 'Stálo to za to?',
    ratingHint: 'Jen pro tebe. Uvidíš to všude, kde se přihlásíš, nikdo jiný ne.',
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
    emptyBody: 'Až si zapíšeš večer, najdeš tu soukromý přehled.',

    // — Hero: last performance ("ráno koukni na výkon") —
    heroToday: 'DNEŠNÍ VÝKON',
    heroYesterday: 'VČEREJŠÍ VÝKON',
    // Noun shown small next to the big numeral, e.g. "5  piv".
    heroBeersNoun: (beers: number) => beerNoun(beers),
    // One-liner reacting to last night's tally, picked by PerformanceTone.
    // No emoji: the design system bans them in UI chrome (§12).
    toneStart: 'Jedno na zahřátí.',
    toneWarmup: 'Slušnej základ.',
    toneSolid: 'Pěknej večer.',
    toneBig: 'Tohle byla jízda!',
    toneHuge: 'Legendární nářez. Klobouk dolů.',
    // Micro-stat captions under the hero (only with 2+ beers).
    heroDuration: 'DÉLKA VEČERA',
    heroAvg: 'PRŮMĚR NA PIVO',
    heroFastest: 'NEJRYCHLEJŠÍ',

    // — Personal records —
    recordsHeader: 'OSOBNÍ REKORDY',
    recordMostBeers: 'Nejvíc za večer',
    recordFastest: 'Nejrychlejší pivo',
    recordLongest: 'Nejdelší večer',
    // "9 piv · U Zlatého tygra" (pub optional).
    recordMostBeersValue: (beersLabel: string, pub: string | null) =>
      pub ? `${beersLabel} · ${pub}` : beersLabel,
    recordEmpty: 'Zatím nic',

    // — Lifetime totals —
    totalsHeader: 'CELKEM',
    totalBeers: 'PIV CELKEM',
    totalEvenings: 'VEČERŮ',
    totalPubs: 'HOSPOD SE ZÁPISEM',
    totalSpent: 'UTRACENO',

    // — Monthly and yearly trend —
    periodsHeader: 'PŘEHLED PO OBDOBÍ',
    monthsHeader: 'POSLEDNÍCH 12 MĚSÍCŮ',
    yearsHeader: 'ROKY',
    periodBeers: 'PIV TENTO MĚSÍC',
    periodEvenings: (count: number) =>
      count === 1 ? '1 pivní večer' : count >= 2 && count <= 4 ? `${count} pivní večery` : `${count} pivních večerů`,
    periodAverage: (average: number) =>
      average > 0 ? `Průměrně ${average.toLocaleString('cs-CZ')} piva na večer` : 'Tenhle měsíc zatím na suchu',
    yearSummary: (beers: number, average: number) =>
      `${beerCountLabel(beers)}, průměr ${average.toLocaleString('cs-CZ')} na večer`,
    monthsA11y: 'Počet piv za posledních dvanáct měsíců',
    monthA11y: (period: string, beers: number) => `${period}: ${beerCountLabel(beers)}`,

    // — Top pubs ("kolik jsem kde vypil") —
    pubsHeader: 'TVOJE HOSPODY',
    pubsSubtitle: 'Hospody podle počtu zápisů',

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
    empty: 'Pro tuhle verzi tu zatím žádné novinky nemám.',
    // Offline / timeout / dormant backend — distinct from "empty" so the user
    // knows it's worth trying again later.
    error: 'Novinky jsem teď nenačetl. Mrkni na to za chvíli.',
    footer: 'Bez reklam · Bez placení',
    playStore: 'Na pivo v Google Play',
    playStoreA11y: 'Otevřít Na pivo v Google Play',
  },

  privacy: {
    title: 'Soukromí',
    body: [
      'Sbírám omezené provozní a produktové statistiky: otevření appky, zobrazení hlavních obrazovek, použití hlavních tlačítek a ovládacích prvků, výsledky vybraných akcí, technické chyby, verzi appky a součet nachozených metrů.',
      'U produktových událostí posílám jen pevné hrubé kategorie. Neposílám v nich názvy hospod ani piv, tvoje texty, identifikátory prohlížených profilů nebo příspěvků, vyhledávací dotazy, GPS body ani trasu.',
      'Jednotlivé provozní, produktové a chybové události na serveru automaticky mažu nejpozději po 90 dnech. Souhrnné čítače můžou zůstat po dobu existence účtu a události spojené s účtem najdeš v exportu dat.',
      'Pro stažení okolních hospod může appka poslat aktuální nebo přibližnou polohu na můj server.',
      'Nachozené metry se počítají v telefonu a na server se posílá jen součet po dávkách, nikdy GPS body ani trasa.',
      'Průběžnou GPS historii, trasu pohybu ani jednotlivé GPS body neukládám.',
      'Hospodské připomínky jsou dobrovolná funkce s polohou na pozadí: appka si kolem nejbližších hospod nastaví zóny a telefon ji upozorní, když do některé vejdeš. Vyhodnocuje se to přímo v telefonu a na server se při tom žádné souřadnice neposílají. Funkci kdykoli vypneš.',
      'Pro zobrazení otevírací doby appka pošle název a polohu vybrané hospody na můj server, který dohledá otevírací dobu.',
      'Appka vytvoří anonymní náhodný identifikátor zařízení a odešle ho na můj server, aby každému zařízení patřil dočasný účet. Identifikátor neobsahuje žádné osobní údaje a slouží jen k odlišení zařízení.',
      'Účet je dobrovolný. Když se zaregistruješ e-mailem, ukládám e-mail a heslo jen v zahashované podobě. Přes Google nebo Apple dostanu identifikátor účtu, e-mail a případně jméno; heslo od poskytovatele nikdy nevidím.',
      'Profil může obsahovat přezdívku, jméno a avatar. U veřejného profilu tě podle přezdívky a fotky můžou najít ostatní; přesná poloha, deníček a jednotlivá piva se veřejně nezobrazují.',
      'Počítadlo, historie večerů, návštěvy hospod a tvoje soukromá hodnocení se ukládají lokálně a synchronizují se jen k tvému účtu. Po odhlášení nebo smazání účtu appka z tohohle zařízení vyčistí lokální soukromý deníček, hodnocení i zápisy, které čekají na odeslání.',
      'Sdílení večera s Partou je ve výchozím stavu zapnuté: přijatí kamarádi můžou vidět, že jsi v hospodě, kolik piv máš a tvůj poslední zápis. V nastavení Party to vypneš, nebo zapneš neviditelný režim. Nikdo jiný než přijatí kamarádi tyhle údaje nevidí.',
      'Fotky piv ukládám na serveru bez metadat a GPS polohy. Ve výchozím stavu je vidí jen tvoje Parta; veřejné jsou jen fotky, které přihlásíš do fotosoutěže.',
      'Když vyfotíš pivní lístek přes „Vyfoť menu“, fotka se přes můj server pošle ke zpracování AI modelu (přes službu OpenRouter). Fotku neukládám a poskytovatel ji podle mého nastavení nesmí použít k trénování.',
      'Když povolíš notifikace, uložím si push token zařízení a zprávy z Party doručuju přes Expo Push Service. Hospodské připomínky se zobrazují přímo v telefonu a nikam se neposílají.',
      'Když dobrovolně doplníš otevírací dobu, piva na čepu nebo chybějící hospodu, appka je odešle na můj server. Tyhle příspěvky pomáhají ostatním a můžou se zobrazit veřejně, ale bez tvé přesné polohy.',
      'V účtu si můžeš vyžádat JSON export svých dat e-mailem nebo účet smazat. Po smazání vyčistím lokální soukromá data v appce a serverová data se smažou podle zásad ochrany osobních údajů.',
      'Transakční e-maily, například ověření adresy, obnova hesla, export dat nebo potvrzení smazání účtu, posílám přes Resend. Téhle službě předám jen e-mailovou adresu a obsah nutný k odeslání zprávy.',
    ],
    contactLabel: 'Kontakt',
    contactEmail: 'tomades1@gmail.com',
    fullPolicyLink: 'Kompletní zásady ochrany osobních údajů',
  },

  // — Social rail in the evening card: three doors to the community half of the
  //   product, which was otherwise only reachable from an overflow sheet.
  a11y: {
    onboardingStep: (step: number, total: number) => `Krok ${step} ze ${total}`,
    celebrationOpenMaps: (pub: string) => `Otevřít hospodu ${pub} v mapách`,
    celebrationBackToCompass: 'Zpět na kompas',
    // — Výčep —
    vycepLink: 'Otevřít Výčep, feed vyvěšených nocí',
    vycepBack: 'Zpět',
    roundButton: (owner: string) => `Poslat rundu: ${owner}`,
    nightCard: (owner: string) => `Noc pivaře ${owner}`,
    shareNightButton: 'Sdílet noc jako obrázek',
    publishNightButton: 'Vyvěsit noc na Výčep',
    nightMenu: 'Možnosti noci',

    pubPillHidden: 'Skrytá hospoda, ťukni pro odhalení',
    pubPillRevealed: (pubName: string) => `${pubName}, ťukni pro otevření v mapách`,
    openStatus: (status: string) => `Stav otevírací doby: ${status}`,
    pubRating: (rating: string, count?: string) =>
      count ? `Hodnocení: ${rating} z 5, ${count} hodnocení` : `Hodnocení: ${rating} z 5`,
    pubGarden: 'Má zahrádku',
    toggleOn: 'zapnuto',
    toggleOff: 'vypnuto',
    settingsButton: 'Otevřít nastavení',
    // — Parta 3.0 —
    tabFeedBadge: (requests: number, unread: boolean, live: boolean) => {
      const base = 'Záložka Kocoviny';
      if (requests === 1) return `${base}, 1 nová žádost`;
      if (requests >= 2 && requests <= 4) return `${base}, ${requests} nové žádosti`;
      if (requests >= 5) return `${base}, ${requests} nových žádostí`;
      if (live) return `${base}, kamarád právě sedí v hospodě`;
      if (unread) return `${base}, nové dění`;
      return base;
    },
    openParta: 'Otevřít Partu',
    openPartaWithRequests: (n: number) => {
      if (n === 1) return 'Otevřít Partu, čeká 1 žádost';
      if (n >= 2 && n <= 4) return `Otevřít Partu, čekají ${n} žádosti`;
      return `Otevřít Partu, čeká ${n} žádostí`;
    },
    // Back chevron on the Profile → Správa party screen.
    manageBack: 'Zpět na profil',
    rsvpGroup: 'Jdeš?',
    rerollButton: 'Vyber jinou hospodu',
    skipButton: 'Přeskočit na další hospodu',
    skipButtonHint: 'Vynechá tuhle hospodu a najde další nejbližší',
    pubFixButton: 'Chybí nebo nesedí hospoda',
    renamePubInput: 'Nový název hospody',
    renamePubSaveButton: 'Uložit opravený název hospody',
    contributeBeersLine: (text: string) => `Piva na čepu: ${text}. Ťukni pro doplnění.`,
    contributeDayClosedToggle: (day: string) => `${day}: přepnout zavřeno`,
    contributeAddInterval: (day: string) => `${day}: přidat čas`,
    contributeRemoveInterval: (day: string) => `${day}: odebrat čas`,
    contributeCopyToAll: 'Zkopírovat časy z pondělí do všech dnů',
    contributeAddBeer: 'Přidat pivo',
    contributeBeerMenuType: (label: string) => `Typ nabídky piv: ${label}`,
    contributeRemoveBeer: 'Odebrat pivo',
    contributeRestoreHistoricalBeer: (name: string) => `Vrátit ${name} na aktuální nabídku`,
    contributeSaveButton: 'Uložit doplněné údaje',
    addPubButton: 'Přidat chybějící hospodu',
    addPubNameInput: 'Název hospody',
    addPubCityInput: 'Město hospody',
    addPubAddressInput: 'Adresa hospody',
    addPubSuggestion: (name: string) => `Vybrat podnik ${name}`,
    addPubUseCurrentLocationButton: 'Použít moji aktuální polohu pro novou hospodu',
    addPubCurrentLocationSelected: 'Pro novou hospodu se použije tvoje aktuální poloha',
    addPubMapPinSelected: 'Pro novou hospodu se použije špendlík z mapy',
    mapPinCancel: 'Zrušit přidávání hospody',
    addPubSaveButton: 'Přidat hospodu',
    feedbackCategory: (label: string) => `Kategorie: ${label}`,
    feedbackContactChannel: (label: string) => `Kontakt přes: ${label}`,
    feedbackContactInput: 'Kontakt pro odpověď',
    feedbackSubmitButton: 'Odeslat zpětnou vazbu',
    backButton: 'Zpět',
    communityChallenge: (title: string, done: number, goal: number) =>
      `${title}. Splněno ${done} z ${goal}. Otevřít výzvu`,
    communityEvent: (title: string, when: string, place: string) =>
      `${title}. ${when}. ${place}. Otevřít akci`,
    modeNearestButton: 'Mód: Nejbližší hospoda',
    modeSurpriseButton: 'Mód: Překvap mě',
    beerBrandFilterInput: 'Filtrovat hospody podle značky piva ze záznamů',
    beerBrandFilterSuggestion: (name: string) => `Vybrat značku ${name}`,
    clearBeerBrandFilter: 'Zrušit filtr značky piva',
    toggleOtherTapPlaces: 'Zahrnout další místa s výčepem',
    openBeerBrandFilter: 'Otevřít filtr značky piva',
    beerBrandFilterActive: (name: string) => `Filtr piva: ${name}. Ťukni pro změnu`,
    selectBeerBrand: (name: string) => `Filtrovat na ${name}`,
    closeBeerBrandFilter: 'Zavřít filtr',
    openPubFilters: 'Otevřít filtry hospod',
    pubFiltersActive: (count: number) => `Aktivní filtry hospod: ${count}. Ťukni pro změnu`,
    closePubFilters: 'Zavřít filtry hospod',
    clearPubFilters: 'Zrušit všechny filtry hospod',
    applyPubFilters: 'Použít vybrané filtry hospod',
    togglePubAmenityFilter: (name: string) => `Filtrovat podle vlastnosti ${name}`,
    priceFilterMinSlider: 'Nejnižší cena piva',
    priceFilterMaxSlider: 'Nejvyšší cena piva',
    priceFilterValue: (label: string) => `Cenový limit: ${label}`,
    pubPriceAge: (price: string, age: string) => `Pivo za ${price}, údaj ${age}`,
    beerMap: 'Pivní mapa hospod, navštívených míst a kamarádů',
    mapSwitchCompass: 'Přepnout na kompas',
    mapSwitchCompassSelected: 'Kompas je vybraný',
    mapSwitchMap: 'Mapa je vybraná',
    mapSwitchToMap: 'Přepnout na mapu',
    openBeerMap: 'Otevřít pivní mapu',
    mapLocate: 'Najít mě na mapě',
    mapList: 'Zobrazit podniky jako seznam',
    mapRefresh: 'Obnovit podniky a partu',
    mapPub: (name: string, visits: number) =>
      visits > 0 ? `${name}, navštíveno ${visits}krát` : `${name}, zatím nenavštíveno`,
    mapReportClosed: (name: string) => `Nahlásit hospodu ${name}, že už nefunguje`,
    mapLive: (friend: string, pub: string) => `${friend} je teď v hospodě ${pub}`,
    mapCity: (city: string, visits: number) => `${city}, ${visits} pivních večerů. Přiblížit`,
    mapCluster: (count: number) => `${count} podniků. Přiblížit`,

    // — "Zmapuj hospodu" / Mapér —
    // `into`/`next` are the into-level XP numbers shown on the visible bar so the
    // spoken progress matches the rendered progress. `next == null` = maxed level.
    mapperLevel: (n: number, title: string, into: number, next: number | null) =>
      next == null
        ? `Mapér úroveň ${n}, ${title}, máš všechno`
        : `Mapér úroveň ${n}, ${title}, ${into} z ${next} XP`,
    pivarLevel: (n: number, title: string, into: number, next: number | null) =>
      next == null
        ? `Pivař úroveň ${n}, ${title}, máš všechno`
        : `Pivař úroveň ${n}, ${title}, ${into} z ${next} XP`,
    // Mapér badge state (announced after the title so VoiceOver reads e.g.
    // "Objevitel, splněno" or "Objevitel, zamčeno, Zmapuj 10 hospod").
    badgeUnlocked: (title: string) => `${title}, splněno`,
    badgeLocked: (title: string, hint: string) => `${title}, zamčeno, ${hint}`,

    // — Žebříčky (global leaderboards) —
    leaderboardRow: (rank: number, name: string, score: number, unit: string) =>
      `${rank}. ${name}, ${score} ${unit}`,
    leaderboardCategory: 'Kategorie žebříčku',
    leaderboardPeriod: 'Období žebříčku',
    leaderboardsOpen: 'Otevřít žebříčky',

    // — Tabs —
    tabCompass: 'Záložka Kompas',
    tabBeer: 'Záložka Štamgast',
    tabFriends: 'Záložka Parta',
    // — 3.0 navigation (§17.1) —
    tabFeed: 'Záložka Kocoviny',
    tabPubs: 'Záložka Hospody',
    tabParty: 'Záložka Party',
    tabCommunity: 'Záložka Komunita',
    beerSegmentCount: 'Přepnout na počítání piv',
    beerSegmentStats: 'Přepnout na statistiky výkonu',
    beerSegmentHistory: 'Přepnout na historii večerů',
    counterDone: 'Dopito, zavřít tenhle večer',
    counterResume: 'Pokračovat v předchozím večeru',
    tabProfile: 'Záložka Profil',

    // — Counter —
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
    counterRequestLocation: 'Povolit polohu',
    counterRetry: 'Hledat hospodu znovu',
    counterRepeat: (name: string) => `Zapsat stejné pivo: ${name}`,
    counterMore: 'Další možnosti k tomuhle večeru',
    // — Tácek surface —
    counterCoaster: (countLabel: string, spent?: string) =>
      `${countLabel}${spent ? `, utraceno ${spent}` : ''}. Otevře tvůj účet.`,
    counterCoasterEmpty: 'Čistej tácek, zatím nic nepadlo',
    counterPlaceChip: (place: string) => `Změnit místo. Teď ${place}.`,
    counterUndoStrip: 'Vrátit poslední pivo',
    counterRapidConfirm: 'Ano, zapsat',
    counterCheckinDismiss: 'Zavřít nabídku hodnocení',
    counterReceiptChip: 'Otevřít tvůj účet',
    counterQuickOtherBeer: 'Vybrat jiné pivo nebo drink',
    counterQuickMapPub: 'Doplnit informace o hospodě',
    counterRemoveIdentity: (name: string) => `Odebrat poslední ${name} z účtu`,

    // — Moje piva —
    myBeersEvening: (pub: string, summary: string) =>
      `Večer v hospodě ${pub}, ${summary}. Ťukni pro detail.`,
    myBeersAddHistorical: 'Zapsat piva zpětně',
    myBeersAddDrinkToEvening: 'Dopsat pivo do tohoto večera',
    myBeersRemoveHistoricalBeer: (beer: string) => `Odebrat pivo ${beer}`,
    myBeersDiaryEntry: (beer: string, meta: string) =>
      `Zápis piva ${beer}${meta ? `, ${meta}` : ''}. Ťukni pro detail.`,
    ratingLike: (pub: string) => `Hodnotit ${pub} jako dobrou`,
    ratingDislike: (pub: string) => `Hodnotit ${pub} jako slabou`,
    ratingNote: (note: string) => `Štítek: ${note}`,
    ratingNoteInput: (pub: string) => `Vlastní poznámka k hospodě ${pub}`,

    // — Profil —
    profileMore: 'Co ještě? Nastavení, žebříčky a další',
    profileCard: (beers: string, level: string) =>
      `${beers} za život. ${level}. Ťukni pro odznaky.`,
    profileBadges: 'Otevřít odznaky',
    profileIdentity: 'Upravit profil',
    profileDiary: 'Otevřít soukromý pivní deník',
    profileParta: 'Otevřít partu',

    // — Parta —
    partaMore: 'Co ještě? Nastavení, žebříčky a další',
    partaChip: (friends: string) => `Tvoje parta, ${friends}. Ťukni pro celou partu.`,
    partaCard: (count: string, headline: string) =>
      `${count} z party dneska na pivu. ${headline} Ťukni pro seznam.`,
    partaTable: 'Kdo dneska jde',
    presenceRow: (name: string, pub: string) =>
      `${name} teď sedí ${pub}. Ťukni pro profil.`,
    presenceRowMine: (pub: string) => `Teď sedíš ${pub}. Ťukni pro profil.`,
    presenceCompass: (pub: string) => `Ukázat ${pub} na kompasu`,
    sittingRow: (name: string, what: string, where: string, when: string) =>
      `${name}, ${what}, ${where}${when ? `, ${when}` : ''}. Ťukni pro profil.`,
    partyGameBeerCounter: (count: string) =>
      `Máš ${count}. Přidat další.`,

    // — Kompas —
    compassMore: 'Co ještě? Mapa, filtry a další',
    compassCard: (pub: string, distance: string, status: string) =>
      `${pub}, ${distance}${status ? `, ${status}` : ''}. Ťukni pro info o hospodě.`,
    compassCardHidden: 'Hospoda je schovaná. Ťukni a prozradím kam.',
    compassLoading: 'Hledám nejbližší hospodu',
    compassNavigate: (pub: string) => `Doveď mě do hospody ${pub}, otevře navigaci`,
    compassAnother: 'Vyber mi jinou hospodu',
    compassBackToNearest: 'Zpět na nejbližší hospodu',
    compassClearFilters: 'Zrušit všechny filtry',

    // — Deník —
    diarySegment: 'Přepnout na deník večerů',
    diaryCard: (count: string, pub: string, when: string) =>
      `Poslední večer: ${count} v hospodě ${pub}, ${when}. Ťukni pro rozpis.`,
    diaryCardEmpty: 'Zatím žádný zapsaný večer',
    diaryNight: (pub: string, meta: string) => `Večer ${pub}, ${meta}. Ťukni pro detail.`,
    diaryStats: 'Ukázat čísla za celou dobu',
    diaryStatsClose: 'Zavřít čísla',
    diaryRetry: 'Načíst deníček znovu',

    // — Účet / přihlášení —
    accountRow: 'Otevřít účet',
    authEmailInput: 'E-mail',
    authPasswordInput: 'Heslo',
    authResetEmailInput: 'E-mail pro obnovu hesla',
    authResetCodeInput: 'Kód pro obnovu hesla',
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
    accountExportData: 'Sdílet export mých dat',
    accountMethods: 'Otevřít způsoby přihlášení',
    accountMore: 'Otevřít další možnosti účtu',
    accountIdentity: (name: string, email: string, methods: string) =>
      `${name}. ${email || 'E-mail není nastaven'}. Přihlášení: ${methods}.`,
    accountRestorePurchases: 'Obnovit nákupy',
    accountReportProfile: 'Nahlásit profil',
    accountLogout: 'Odhlásit se',
    accountRetry: 'Znovu načíst účet',
    accountDelete: 'Smazat účet',

    // — Profil —
    profileEdit: 'Upravit profil',
    profileVisibility: 'Změnit viditelnost profilu',
    profileManageAccount: 'Spravovat účet',
    accountManageData: 'Spravovat účet a moje data',
    profileSettings: 'Otevřít nastavení',
    profileSignUp: 'Vytvořit účet',
    profileNicknameInput: 'Přezdívka',
    profilePickPhoto: 'Vybrat fotku z knihovny',
    profileRemovePhoto: 'Odebrat fotku',
    profileDisplayNameInput: 'Jméno',
    profileVisibilityToggle: (state: string) => `Veřejný profil: ${state}`,
    profileClose: 'Zavřít',

    // — Pivní fotky / FotoPivař —
    photoAddTile: 'Přidat fotku piva',
    photoTile: (label: string) => `Fotka piva${label ? `, ${label}` : ''}. Ťukni pro detail.`,
    photoContestLink: 'Otevřít soutěž FotoPivař',
    photoAlbumLink: 'Otevřít album pivních fotek',
    leaderboardsLink: 'Otevřít žebříček pivařů',
    partyLeaderboardMetric: 'Metrika žebříčku party',
    photoCaptionInput: 'Popisek fotky',
    photoPickPub: 'Označit hospodu',
    photoClearPub: 'Zrušit označenou hospodu',
    photoVisibility: (label: string) => `Viditelnost fotky: ${label}`,
    photoContestToggle: 'Poslat fotku rovnou do soutěže FotoPivař',
    photoDelete: 'Smazat fotku',
    photoRetry: 'Zkusit nahrát fotku znovu',
    contestVote: (name: string) => `Dát hlas fotce od ${name}`,
    contestUnvote: (name: string) => `Vzít hlas fotce od ${name}`,
    contestEntryActions: (name: string) => `Možnosti fotky od ${name}`,
    contestOpenPhoto: (name: string) => `Otevřít fotku od ${name}`,
    contestOpenProfile: (name: string) => `Otevřít profil ${name}`,
    contestPhotoActionsHint: 'Podržením otevřeš další možnosti fotky.',
    contestPickMyPhoto: (label: string) =>
      `Přihlásit fotku${label ? ` ${label}` : ''} do soutěže`,
    friendPhotoTile: (name: string) => `Fotka od ${name}. Ťukni pro zvětšení.`,
    partaPhotoTile: (name: string) => `Fotka od ${name}. Ťukni pro zvětšení.`,
    photoViewerClose: 'Zavřít fotku',
    photoViewerRetry: 'Znovu načíst fotku',
    communitySearchButton: 'Hledat',
    contributeTimeHours: (label: string) => `${label} hodiny`,
    contributeTimeMinutes: (label: string) => `${label} minuty`,
  },

  startup: {
    lockedTitle: 'Telefon teď nepustil účet',
    lockedBody: 'Odemkni ho a zkus to znovu. Tvoje data zatím nechávám zamčená.',
    lockedRetry: 'Zkusit znovu',
  },

  challengeDetail: {
    routeLoading: 'Načítám výzvu',
    routeLoadError: 'Výzvu se teď nepovedlo načíst.',
    routeRetry: 'Zkusit znovu',
  },

  beerDetail: {
    // Genitive month names for the "Piješ ho od června" relationship line.
    monthName: (index: number) =>
      [
        'ledna',
        'února',
        'března',
        'dubna',
        'května',
        'června',
        'července',
        'srpna',
        'září',
        'října',
        'listopadu',
        'prosince',
      ][index] ?? '',
    statMine: 'moje',
    statMyAverage: 'můj průměr',
    statParty: 'parta',
    partyDrinkersHeader: 'KDO Z PARTY PIL',
    recentHeader: 'POSLEDNÍ ZÁPISY',
    recentEmpty: 'Zatím žádný zápis.',
    myHistoryHeader: 'MOJE HISTORIE',
    myHistoryEmpty: 'Tohle pivo sis ještě nezapsal.',
    noPub: 'Bez hospody',
  },

  homePoint: {
    title: 'Domovský bod',
    lead: 'Kde je tvoje domácí základna?',
    addressLabel: 'Adresa nebo město',
    addressPlaceholder: 'Třeba Vinohradská 12, Praha',
    addressA11y: 'Adresa nebo město domovského bodu',
    findOnMapA11y: 'Najít adresu na mapě',
    findOnMap: 'Najít na mapě',
    searching: 'Hledám místo…',
    or: 'nebo',
    useCurrentLocation: 'Použít moji polohu',
    privacy:
      'Adresu jednou pošlu geokódovací službě, ať ji najdu na mapě. V telefonu zůstane jen ten potvrzený bod, žádná historie polohy ani trasy.',
    mapA11y: 'Mapa pro výběr domovského bodu',
    mapHint: 'Najdi místo, pak ho ťuknutím dolaď',
    refineHint: 'Sedí bod přesně? Když ne, ťukni na správné místo v mapě.',
    permissionDenied:
      'Poloha je vypnutá. Domov si označ ťuknutím do mapy, nebo si polohu povol v nastavení telefonu.',
    clear: 'Smazat domovský bod',
    saveChange: 'Uložit změnu',
    save: 'Uložit domov',
    emptyQueryError: 'Napiš adresu nebo město, které mám najít.',
    notFoundError: 'Tohle místo jsem nenašel. Zkus doplnit ulici, číslo nebo město.',
    searchFailedError: 'Hledání se teď nepovedlo. Zkus to za chvíli znovu.',
  },

  suggestPubEvent: {
    title: 'Navrhnout akci',
    intro: 'Napiš, co se v hospodě děje.',
    nameLabel: 'Název akce',
    namePlaceholder: 'Třeba hospodský kvíz',
    startLabel: 'Začátek',
    endLabel: 'Konec',
    detailsLabel: 'Podrobnosti (nepovinné)',
    detailsPlaceholder: 'Vstupné, rezervace nebo co čekat',
    moderation:
      'Návrh nejdřív zkontroluju. Až projde, ukáže se v detailu hospody. Neověřené a skončené akce ostatní neuvidí.',
    submitA11y: 'Poslat návrh ke kontrole',
    submit: 'Poslat ke kontrole',
    submitting: 'Posílám…',
    submitted: 'Návrh je u výčepu na kontrole.',
    invalidError: 'Mrkni na název a časy. Konec musí být po začátku.',
    authError: 'Přihlášení vypršelo. Přihlas se a zkus to znovu.',
    rejectedError: 'Tenhle návrh server nevzal. Zkontroluj časy a délku akce.',
    offlineError: 'Server se teď neozývá. Návrh zůstal ve formuláři, zkus to za chvíli.',
  },

  currency: {
    // The suffix is the currency symbol; CZK always renders as "Kč".
    pricePlaceholder: (suffix: string) => `Cena (${suffix})`,
  },

  nearestMap: {
    backA11y: 'Zpátky',
    permissionDenied: 'Povol polohu a ukážu ti nejbližší hospodu.',
    loadFailed: 'Hospodu jsem teď nenačetl.',
    searching: 'Hledám nejbližší hospodu…',
    allowLocation: 'Povolit polohu',
    retry: 'Zkusit znovu',
    recentreA11y: 'Vycentrovat na hospodu',
  },

  publicProfile: {
    relationshipFriend: 'Parťák',
    relationshipAccept: 'Přijmout',
    handleFallback: 'Pivař',
    busy: 'Chvilku…',
    invite: 'Na pivo?',
    inviteA11y: (handle: string) => `Pozvat ${handle} na pivo`,
    removeConfirmTitle: (handle: string) => `Odebrat ${handle} z party?`,
    removeKeep: 'Nechat v partě',
    removeAction: 'Odebrat',
    loadingA11y: 'Načítám profil',
    loadFailed: 'Profil se teď nenačetl',
    retry: 'Zkusit znovu',
    backA11y: 'Zpět',
    moreA11y: 'Další možnosti profilu',
    nightsTogether: (count: number) => `Byli jste spolu ${count}× na pivu`,
    nightsTogetherNone: 'Ještě jste spolu nebyli',
    totalsTitle: 'Celkem',
    badgesTitle: 'Odznaky',
    statMapper: 'Mapér',
    nightsLoadingA11y: 'Načítám večery',
  },

  pubList: {
    // Opening state on a pub row / compass cell.
    openLoading: 'Načítám otevíračku',
    open: 'Otevřeno',
    openUntil: (time: string) => `Otevřeno do ${time}`,
    closed: 'Zavřeno',
    closedUntil: (time: string) => `Zavřeno · otevře v ${time}`,
    hoursUnknown: 'Otevírací doba neznámá',
    beerWithPrice: (name: string, czk: number) => `${name}  (${czk} Kč)`,
    beerFrom: (czk: number) => `Pivo od ${czk} Kč`,
    addressUnknown: 'Adresu neznám',
    lastVisitToday: 'dnes',
    lastVisitYesterday: 'včera',
    distanceUnknown: 'vzdálenost neznámá',
    cellA11y: (badge: string, name: string, distance: string) =>
      `${badge} hospoda ${name}, ${distance}`,
    carouselA11y: (name: string, distance: string) => `${name}, ${distance}, detail`,
    clusterA11y: (pubs: string) => `${pubs}. Přiblížit`,
    // Beer filter sheet.
    filterClearA11y: 'Zrušit výběr',
    filterClear: 'Vymazat',
    filterApplyA11y: 'Použít filtr',
    filterShowCount: (count: number) => `Ukázat (${count})`,
    filterShowAll: 'Ukázat vše',
    // Sort menu and the badge on the head cell it explains.
    sortTitle: 'Seřadit',
    sortNearest: 'Nejbližší',
    sortRating: 'Nejlépe hodnocené',
    sortRandom: 'Náhodně v okolí',
    badgeNearest: 'Nejbližší',
    badgeRating: 'Nejlíp hodnocená',
    badgeRandom: 'Náhodná',
    // Filter chips.
    toggleOpen: 'Otevřeno',
    toggleTank: 'Tank',
    toggleGarden: 'Zahrádka',
    priceChip: 'Cena',
    gamesChip: 'Hry',
    moreFiltersChip: 'Další',
    beerChip: 'Pivo',
    beerChipCount: (count: number) => `Pivo (${count})`,
    beerChipA11y: (names: string) => `Pivo: ${names}`,
    beerChipPick: 'Vybrat piva',
    priceChipA11y: 'Filtrovat podle ceny piva',
    gamesChipA11y: 'Filtrovat podle her v hospodě',
    moreFiltersChipA11y: 'Otevřít další filtry hospod',
    tankChipA11y: 'Filtrovat hospody s tankovým pivem',
    visitedA11y: 'Tuhle hospodu už znáš',
    // Map and list chrome.
    placesList: 'Seznam hospod',
    centreOnMe: 'Vycentrovat na mě',
    allowLocation: 'Povolit polohu',
    searchA11y: 'Hledat hospodu nebo pivo',
    searchPlaceholder: 'Hledej hospodu nebo pivo',
    staleBanner: 'Ukazuju poslední uložené hospody.',
    staleRefresh: 'Obnovit',
    noLocationBanner: 'Vzdálenost bez polohy nespočítám.',
    noLocationAllow: 'Povolit',
    // List states.
    loadingPubs: 'Hledám hospody…',
    permissionDenied: 'Povol polohu a ukážu ti, co je kolem.',
    loadFailed: 'Hospody jsem teď nenačetl.',
    emptyNearby: 'V okolí zatím nic není.',
    retry: 'Zkusit znovu',
    noFilterMatch: 'Na tuhle kombinaci filtrů nic nemám.',
    clearFilters: 'Zrušit filtry',
  },

  search: {
    tabPubs: 'Hospody',
    tabBeers: 'Piva',
    tabPeople: 'Pivaři',
    loadingA11y: 'Hledám',
    failed: 'Hledání se mi teď nepovedlo.',
    noResults: 'Nic jsem nenašel. Zkus to jinak.',
    tooShort: 'Napiš aspoň dvě písmena.',
    placeholder: 'Hospodu, pivo nebo pivaře',
    clear: 'Smazat',
    cancel: 'Zrušit',
    cancelA11y: 'Zrušit hledání',
    recent: 'Nedávno',
    peopleYouMayKnow: 'Pivaři, které možná znáš',
  },

  clientErrors: {
    offline: 'Teď se k serveru nedostanu.',
    account: 'Účet teď není připravený.',
    auth: 'Přihlášení vypršelo.',
    network: 'Síť se netváří. Zkus to za chvíli.',
    save: 'Nepodařilo se to uložit. Zkus to znovu.',
    accountChanged: 'Účet se mezitím změnil.',
    accountChangedDelete: 'Účet se mezitím změnil. Smazání potvrď znovu.',
    invalidResponse: 'Data ze serveru nedávala smysl. Zkus to znovu.',
    actionFailed: 'Tohle se teď nepovedlo.',
    eventsSignIn: 'Pro domácí setkání se nejdřív přihlas.',
    commentIncomplete: 'Komentář se nevrátil celý.',
    eveningMissing: 'Takový večer tu není.',
    eveningSaveFailed: 'Večer se mi nepovedlo uložit k dokončení.',
    gameSaveFailed: 'Rozehranou hru se nepodařilo uložit.',
    gameShareRejected: 'Server sdílení hry odmítl.',
    gameShareSaveFailed: 'Hru se nepodařilo uložit pro sdílení.',
    gameShareFailed: 'Hru se nepodařilo sdílet se stolem.',
    tableCreateFailed: 'Stůl se nepodařilo založit. Zkus to znovu.',
    tableJoinFailed: 'Přisednout ke stolu se nepovedlo. Zkus to znovu.',
    inviteAccountChanging: 'Účet se právě mění. Pozvánku zkus za chvilku znovu.',
  },

  auth: {
    genericError: 'Něco se pokazilo. Zkus to znovu.',
    network: 'Nepodařilo se spojit se serverem. Zkontroluj připojení a zkus to znovu.',
    photoDeletionsPending: 'Nejdřív musím dosmazat fotky. Připoj se k internetu a zkus to znovu.',
    photoDeletionsRekeyFailed: 'Rozdělané mazání fotek se nepodařilo přenést. Uvolni místo v telefonu a zkus to znovu.',
    sessionBoundaryFailed: 'Odhlášení se nepodařilo dokončit. Odemkni telefon a zkus to znovu.',
    credentialBoundaryFailed: 'Přihlášení nejde dokončit, dokud se nesmažou stará data v telefonu. Uvolni místo a zkus to znovu.',
    accountDeletionReceiptFailed: 'Smazání účtu nejde v telefonu dokončit. Uvolni místo, odemkni telefon a zkus to znovu.',
    accountDeletionRecovered: 'Předchozí mazání jsem dokončil. Pokud chceš smazat i aktuální účet, potvrď to znovu.',
    invalidSession: 'Server neposlal platné přihlášení. Zkus to znovu.',
    sessionStorage: 'Přihlášení se nepodařilo uložit. Odemkni telefon a zkus to znovu.',
    socialUnsupported: 'Tenhle způsob přihlášení na tvém telefonu nejde.',
    socialMisconfigured: 'Google přihlášení teď není správně nastavené. Zkus zatím přihlášení e-mailem.',
    socialPlayServices: 'Google Play služby chybí nebo jsou zastaralé. Aktualizuj je, nebo se přihlas e-mailem.',
    socialAccountPicker: 'Výběr Google účtu se nepodařilo otevřít. Zkontroluj účet v telefonu, zkus to znovu, nebo se přihlas e-mailem.',
    socialFailed: 'Přihlášení přes Google nebo Apple se nezdařilo. Zkus to znovu.',
    signInFailed: 'Přihlášení se nezdařilo.',
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

  liveParty: {
    // — People —
    you: 'Ty',
    someone: 'Někdo',
    fallbackPlayer: (n: number) => `Hráč ${n}`,
    // — Hub header —
    pickPubPlaceholder: 'Vyber hospodu',
    tapPrice: (price: number) => `${price} Kč`,
    addAction: (label: string) => `Přidat: ${label}`,
    a11yMinimize: 'Minimalizovat večer',
    a11yOpenBill: 'Otevřít účet',
    billPill: 'Účet',
    a11yEndNight: 'Ukončit večer',
    endPill: 'Ukončit',
    a11yChangePub: (pubName: string) => `${pubName}. Změnit hospodu.`,
    a11yInvite: 'Přizvat ke stolu',
    invitePill: 'Pozvat',
    a11yTableWith: (names: string) => `U stolu: ty, ${names}`,
    a11yTableAlone: 'U stolu: ty',
    a11yJoinWithCode: 'Přisednout ke stolu kódem',
    joinPrompt: 'Někdo už stůl založil?',
    joinLink: 'Přisednout kódem',
    // — Before the night —
    idlePubLabel: 'Hospoda',
    idleTableLabel: 'U stolu',
    idleGamesLabel: 'Hry',
    idleGamesMore: (n: number) => (n === 1 ? 'a 1 další' : n < 5 ? `a ${n} další` : `a ${n} dalších`),
    idleGamesSoon: 'Přijdou v další verzi',
    a11yOpenGames: 'Otevřít hry',
    idleSeatedTitle: 'Kdo už sedí',
    idleLastTitle: 'Naposledy',
    a11yLastNight: (label: string) => `Poslední večer, ${label}. Otevřít.`,
    pickPubTitle: 'Kde sedíš?',
    pickPubSearch: 'Hledej hospodu',
    pickPubNearby: 'Kolem tebe',
    pickPubPicked: 'vybráno',
    pickPubNoNearby: 'Kolem tebe zatím žádnou hospodu nevidím. Zkus hledat.',
    pickPubNoResults: 'Nic jsem nenašel. Zkus to jinak.',
    pickPubClear: 'Smazat hledání',
    // — The thread —
    threadNightStarted: (pubName: string) => `Večer začal v ${pubName}`,
    threadMovedTo: (pubName: string) => `Přesun do ${pubName}`,
    threadJoined: (name: string) => `${name} je u stolu`,
    threadPhoto: 'Fotka',
    gamePlacedSelf: (game: string) => `Hodil jsi na stůl ${game}`,
    gamePlacedOther: (name: string, game: string) => `${name} hodil na stůl ${game}`,
    a11yGameResult: (game: string) => `${game}, výsledek`,
    a11yGameStart: (game: string) => `Spustit ${game}`,
    gamePaying: (name: string) => `Platí ${name}`,
    gameWinner: (name: string) => `Vyhrál ${name}`,
    gamePlayed: 'Odehráno',
    gamePlayedNoWinner: 'Odehráno, nikdo nevyhrál',
    gameTapToPlay: 'Ťukni a hraj',
    rowMenuTitle: 'Co to bylo?',
    rowEdit: 'Upravit',
    undoLogged: (name: string) => `Zapsáno: ${name}`,
    a11yUndo: (name: string) => `Vrátit zápis ${name}`,
    undoAction: 'Vrátit',
    // — Controls —
    photo: 'Foto',
    photoWithCount: (count: number) => `Foto, ${count}`,
    a11yAddDrink: (name: string) => `Přidat ${name}`,
    a11yStartNight: 'Začít večer prvním nápojem',
    startNight: 'Začni večer',
    a11yPickOtherDrink: 'Vybrat jiný nápoj',
    games: 'Hry',
    editDrinkTitle: 'Upravit nápoj',
    // — Stopwatch and the minimised bar —
    clockUnit: 'večer',
    a11yBar: (pubName: string, beers: string) => `Večer běží, ${pubName}, ${beers}. Otevřít.`,
    a11yAddBeer: 'Přidat pivo',
    // — Pulse —
    pulseIdle: 'Zatím sucho',
    pulseIdleBasis: 'Večer začne prvním pivem.',
    pulseFirst: 'Rozjezd',
    pulseFirstBasis: (minutes: number) => `První pivo před ${minutes} min`,
    pulseFirstNow: 'První pivo právě teď',
    pulsePaused: 'Pauza',
    pulsePausedBasis: (minutes: number) => `Bez piva už ${minutes} min`,
    pulseSteady: 'Večer běží',
    pulseSteadyBasis: (minutes: number) => `Poslední zápis před ${minutes} min`,
    statMyBeers: 'tvoje piva',
    statBeers: 'piva',
    statLoggedBeers: 'zapsaná piva',
  },

  finishNight: {
    errorCloseTablePublished: 'Příspěvek je uložený, ale stůl se nepodařilo zavřít. Zkus to znovu.',
    errorLeaveTablePublished: 'Příspěvek je uložený, ale od stolu se nepodařilo odejít. Zkus to znovu.',
    errorCloseTable: 'Stůl se nepodařilo zavřít. Zkus to znovu.',
    errorLeaveTable: 'Od stolu se nepodařilo odejít. Zkus to znovu.',
    errorSavePost: 'Příspěvek se nepodařilo uložit. Zkus to znovu.',
    errorFinish: 'Večer se nepodařilo dokončit. Zkus to znovu.',
    a11yBack: 'Zpátky do večera',
    title: 'Ukončit večer',
    statBeers: 'Piva',
    statNight: 'Večer',
    statAtTable: 'U stolu',
    statKinds: 'Druhů',
    photosLabel: 'Fotky',
    a11yAddPhoto: 'Přidat fotku',
    gamesLabel: 'Hry',
    gamePaying: (game: string, name: string) => `${game} · platí ${name}`,
    gameWinner: (game: string, name: string) => `${game} · vyhrál ${name}`,
    gamePlayed: (game: string) => `${game} · odehráno`,
    roastLabel: 'Roast večera',
    a11yRoastSwitch: 'Přidat roast k příspěvku',
    titlePlaceholder: 'Jak to nazveš',
    a11yTitleInput: 'Název večera',
    previewLabel: 'Takhle to půjde ven',
    visibility: 'Uvidí tvoje parta',
    a11yPublish: 'Ukončit a zveřejnit večer',
    publishing: 'Ukládám…',
    publish: 'Ukončit a zveřejnit',
    a11yFinishPrivate: 'Ukončit večer bez zveřejnění',
    finishPrivate: 'Ukončit bez zveřejnění',
  },

  partyRecap: {
    recovering: 'Tahám poslední večer…',
    empty: 'Zatím nemáš dokončený večer.',
    failed: 'Ten večer teď nenačtu.',
    a11yShare: 'Sdílet večer',
    statBeers: 'Piva',
    statNight: 'Večer',
    statPubs: 'Hospody',
    sectionPeople: 'Kdo tam byl',
    sectionStops: 'Štace',
    sectionChart: 'Jak to šlo',
    sectionGames: 'Hry',
    gamePaying: (name: string) => `Platí ${name}`,
    gameWinner: (name: string) => `Vyhrál ${name}`,
    gamePlayed: 'Odehráno',
  },

  partyDrinkSheet: {
    title: 'Co si dáš?',
    newDrink: 'Nový nápoj',
    scanMenu: 'Naskenovat lístek',
  },

  partyBeers: {
    a11yAdd: (beer: string) => `Dát si ${beer}`,
    price: (czk: number) => `${czk} Kč`,
    alreadyCount: (count: number) => `už ${count}×`,
    a11yOwnBeer: 'Zapsat vlastní pivo',
    otherBeer: 'Jiné pivo',
    customTitle: 'Co piješ?',
    customPlaceholder: 'Značka a stupně',
    save: 'Zapsat',
    sheetTitle: 'Co piješ',
    sheetSubtitle: 'Uprav počty nebo si dej něco jiného.',
  },

  partyInvite: {
    shareWithLink: (link: string, code: string) =>
      `Přisedni si ke stolu v Na pivu: ${link}\nKód: ${code}`,
    shareWithoutLink: (code: string) => `Přisedni si ke stolu v Na pivu. Kód: ${code}`,
    linkCopied: 'Odkaz je ve schránce.',
    title: 'Přizvat ke stolu',
    hintScanOrRead: 'Naskenuj kód, nebo ho přečti nahlas.',
    hintReadAloud: 'Přečti kód nahlas.',
    creatingCode: 'Zakládám kód. Chvilku.',
    a11yCopyLink: 'Zkopírovat odkaz',
    friendsSection: 'Kamarádi',
    retry: 'Načíst znovu',
    emptyFriends: 'V partě zatím nikdo není.',
    friendFallbackName: 'Pivař',
    atTable: 'U stolu',
    sent: 'Posláno',
    a11ySendCode: (name: string) => `Poslat kód: ${name}`,
    sendCode: 'Poslat kód',
    joinTitle: 'Přisednout ke stolu',
    a11yCodeField: 'Kód stolu',
    a11yJoin: 'Přisednout',
    joining: 'Připojuju…',
    join: 'Přisednout',
  },

  nightChart: {
    empty: 'Zatím není co kreslit.',
    barChart: 'Sloupcový graf',
    pieChart: 'Koláčový graf',
  },

  games: {
    quiz: {
      name: 'Pub kvíz',
      blurb: 'Každý na svém. Kdo ví víc.',
      how: 'Stejná otázka na všech telefonech. Ťukneš odpověď a zamkne se. Odhalí se, až odpoví všichni.',
      intro: 'Odpovídáš za sebe. Nikdo neuvidí, co jsi ťuknul, dokud neodpoví všichni.',
    },
    dice: {
      name: 'Kostky',
      blurb: 'Kdo zůstane, platí.',
      how: 'Každý hodí. Nejvyšší bere kolo. Kdo vyhraje třikrát, je z obliga. Kdo zbude poslední, platí rundu.',
      intro: 'Třikrát vyhraješ kolo a máš klid.',
    },
    categories: {
      name: 'Kategorie',
      blurb: 'Kdo se zasekne, bere bod.',
      how: 'Někdo řekne kategorii. Dokola jmenujete, kdo se zasekne, bere bod.',
      intro: 'Kdo se zasekne, ťukne si.',
    },
    never: {
      name: 'Nikdy jsem…',
      blurb: 'Kdo to udělal, přizná to.',
      how: 'Řekneš, co jsi nikdy nedělal. Kdo ano, zvedne ruku.',
      intro: 'Kdo to udělal, zvedne ruku.',
    },
    kings: {
      name: 'King’s Cup',
      blurb: 'Karty a pravidla, co si vymyslíte.',
      how: 'Taháte karty, každá má pravidlo. Král doprostřed, čtvrtý platí rundu.',
      intro: 'Táhni kartu. Co je na ní, to platí.',
    },
    round: {
      name: 'Kdo platí rundu',
      blurb: 'Jména běží bubnem. Někdo to zaplatit musí.',
      how: 'Roztoč buben se jmény. Až zpomalí a zastaví, vybraný člověk platí rundu.',
      intro: 'Jména proběhnou bubnem. Někdo to zaplatit musí.',
    },
    bottle: {
      name: 'Flaška',
      blurb: 'Točí se, ukáže, ptá se.',
      how: 'Roztoč. Na koho ukáže, ten odpovídá na jednu otázku od stolu.',
      intro: 'Roztoč. Na koho ukáže, ten je na řadě.',
    },
    thumb: {
      name: 'Palec',
      blurb: 'Kdo si všimne poslední, ukloní se.',
      how: 'Nenápadně polož palec na stůl. Poslední, kdo si všimne, ukloní se hospodě.',
      intro: 'Polož palec na stůl. Nenápadně.',
    },
    rules: {
      name: 'Pravidlo večera',
      blurb: 'Jedno pravidlo, platí do rána.',
      how: 'Vymyslete pravidlo, třeba „žádná jména“. Kdo ho poruší, ukloní se.',
      intro: 'Jedno pravidlo, platí do rána.',
    },
  },

  gameContent: {
    never: [
      'Nikdy jsem si nespletl hospodu a nečekal půl hodiny na někoho, kdo seděl jinde.',
      'Nikdy jsem neusnul v tramvaji a neprojel konečnou.',
      'Nikdy jsem nezpíval v hospodě nahlas něco, co neumím.',
      'Nikdy jsem si neobjednal pivo, které jsem si nedokázal přečíst.',
      'Nikdy jsem nezapomněl, kde mám bundu.',
      'Nikdy jsem netvrdil, že se vyznám v pivu, a pak si dal nejlevnější.',
      'Nikdy jsem se nepřidal ke stolu lidí, které jsem neznal.',
      'Nikdy jsem nevolal někomu ve dvě ráno „jenom na chvilku“.',
      'Nikdy jsem si nedal k pivu něco, co se k němu vůbec nehodí.',
      'Nikdy jsem se nevsadil o rundu a nevyhrál.',
      'Nikdy jsem nešel „na jedno“.',
      'Nikdy jsem si nepletl jména dvou lidí u jednoho stolu celý večer.',
      'Nikdy jsem nefotil jídlo v hospodě.',
      'Nikdy jsem se nevrátil do hospody pro telefon.',
      'Nikdy jsem netvrdil hospodskému, že tohle pivo je jinak natočené než minule.',
      'Nikdy jsem nešel domů pěšky přes celé město, protože „to je kousek“.',
      'Nikdy jsem neslíbil, že příští kolo platím já, a pak toho nelitoval.',
      'Nikdy jsem nedělal, že znám kapelu, co hraje v rádiu.',
      'Nikdy jsem neseděl v hospodě, kde jsem nechápal, jak se objednává.',
      'Nikdy jsem nepřišel na sraz jako první a nedělal, že jsem taky dorazil pozdě.',
      'Nikdy jsem si nedal nealko a netvrdil, že to je jedno.',
      'Nikdy jsem se nehádal o to, která hospoda má lepší tank.',
      'Nikdy jsem neztratil účtenku a nedělal, že se to nestalo.',
      'Nikdy jsem si nenechal poradit pivo a pak toho nelitoval.',
      'Nikdy jsem netvrdil, že zítra vstávám brzo.',
    ],
    categories: [
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
    ],
    rules: [
      'Žádná jména. Kdo někoho osloví jménem, ukloní se.',
      'Pivo se drží jen levou rukou.',
      'Nikdo neříká „pivo“. Říkej si tomu, jak chceš, ale ne takhle.',
      'Před každým přípitkem musíš někomu poděkovat.',
      'Kdo se podívá na mobil, platí další rundu.',
      'Každý má přezdívku a jinak se na něj nesmí mluvit.',
      'Kdo řekne „ne“, zvedne se a ukloní se.',
      'Nikdo nesmí ukazovat prstem.',
      'Kdo si sedne jinam, začíná nový večer.',
      'Každá věta musí začínat „prý“.',
      'Kdo se zasměje nahlas, dělá další přípitek.',
      'Zákaz mluvit o práci. Kdo to zkusí, ukloní se.',
    ],
    thumb: [
      'Nenápadně polož palec na stůl. Poslední, kdo si všimne, ukloní se hospodě.',
    ],
    kings: {
      ace: {
        title: 'Přípitek',
        rule: 'Zvedni sklo. Celý stůl se přidá a připije si na večer.',
      },
      two: {
        title: 'Ty',
        rule: 'Vybereš jednoho. Všechno, co řekneš, musí do konce kola zopakovat on.',
      },
      three: { title: 'Já', rule: 'Vymyslíš si nové jméno. Do konce hry jsi on.' },
      four: {
        title: 'Podlaha',
        rule: 'Všichni sáhnou na zem. Poslední ukloní se celé hospodě.',
      },
      five: { title: 'Kluci', rule: 'Zazpívají kluci u stolu jeden refrén.' },
      six: { title: 'Holky', rule: 'Zazpívají holky u stolu jeden refrén.' },
      seven: { title: 'Nebe', rule: 'Všichni ruku nahoru. Poslední ukloní se.' },
      eight: {
        title: 'Kamarád',
        rule: 'Vyber si parťáka. Od teď jste tým a všechno říkáte oba najednou.',
      },
      nine: {
        title: 'Rým',
        rule: 'Řekni slovo. Dokola se rýmuje, kdo se zasekne, ukloní se.',
      },
      ten: {
        title: 'Kategorie',
        rule: 'Vyhlas kategorii. Kdo nic nevymyslí, ukloní se.',
      },
      jack: {
        title: 'Pravidlo',
        rule: 'Vymysli pravidlo, které platí do konce hry.',
      },
      queen: { title: 'Otázky', rule: 'Až do další dámy odpovídáš jen otázkou.' },
      king: { title: 'Král', rule: 'Doprostřed. Čtvrtý král platí rundu pro stůl.' },
    },
  },

  quiz: {
    questions: {
      qPlzen: {
        text: 'V kterém roce se poprvé uvařil Pilsner Urquell?',
        options: ['1842', '1869', '1795', '1901'],
      },
      qStupne: {
        text: 'Co udávají stupně u piva?',
        options: ['Obsah alkoholu', 'Cukernatost mladiny', 'Teplotu kvašení', 'Množství chmele'],
      },
      qChmel: {
        text: 'Která oblast je nejznámější českou chmelařskou?',
        options: ['Znojemsko', 'Mělnicko', 'Žatecko', 'Kladensko'],
      },
      qSpotreba: {
        text: 'Kolikátá je Česko ve spotřebě piva na hlavu ve světě?',
        options: ['Třetí', 'Osmé', 'Patnácté', 'První'],
      },
      qTank: {
        text: 'Co znamená „tankové pivo“?',
        options: [
          'Pivo čepované přímo z velkoobjemového tanku',
          'Pivo z kovového sudu',
          'Pivo s vyšším tlakem',
          'Pivo vařené na zakázku',
        ],
      },
      qLezak: {
        text: 'Jak dlouho se tradičně leží ležák?',
        options: ['Několik hodin', 'Několik dní', 'Několik týdnů', 'Několik let'],
      },
      qCistonos: {
        text: 'Jak se říká pěně, která zůstane na sklenici po douškách?',
        options: ['Čepice', 'Krajka', 'Věnec', 'Klobouk'],
      },
      qSvetle: {
        text: 'Který pivní styl vznikl v Plzni?',
        options: ['Pšeničné pivo', 'Stout', 'Porter', 'Světlý ležák'],
      },
      qHospoda: {
        text: 'Co je „šnyt“?',
        options: [
          'Malé pivo s vysokou vrstvou pěny',
          'Pivo bez pěny',
          'Malé pivo pro řidiče',
          'Pivo s limonádou',
        ],
      },
      qMlyn: {
        text: 'Které město se pyšní nejstarším činným pivovarem v Česku?',
        options: ['Žatec', 'Broumov', 'Rakovník', 'Plzeň'],
      },
      qSvatek: {
        text: 'Kdy se v Česku slaví Den českého piva?',
        options: ['1. května', '17. listopadu', '27. září', '6. ledna'],
      },
      qSlad: {
        text: 'Z čeho se vyrábí slad?',
        options: ['Z chmele', 'Z kvasnic', 'Z bramborového škrobu', 'Z naklíčeného obilí'],
      },
    },
  },

  gameShell: {
    retiredGame: 'Tuhle hru už nově nespustíš.',
    fallbackTitle: 'Hra',
    whoPlays: 'Kdo hraje',
    invite: 'Přizvat ke stolu',
    startWithCount: (count: number) => `Začít, hraje vás ${count}`,
    startWithCountA11y: (count: number) => `Začít, hraje ${count}`,
    needTwo: 'Aspoň dva, jinak to není hra',
    needTwoA11y: 'Potřebuješ aspoň dva hráče',
    unknownPlayer: 'Hráč',
    playerNumber: (index: number) => `Hráč ${index}`,
    nameJoiner: ' a ',
    diceTwelve: (name: string) => `${name} má dvanáct!`,
    diceSnakeEyes: (name: string) => `${name}… dvě. Au.`,
    diceHigh: (name: string, sum: number) => `${name} ${sum}`,
    roundWinner: (name: string) => `${name} bere kolo`,
    roundWinners: (names: string) => `${names} berou kolo`,
    lowestRoll: (name: string) => `Nejmíň hodil ${name}.`,
    yourTurnRoll: 'Házíš ty',
    turnRoll: (name: string) => `${name} hází`,
    nextRound: 'Další kolo',
    roll: 'Hoď',
    rollFor: (name: string) => `Hodit za ${name}`,
    spin: 'Roztoč',
    spinAgain: 'Roztoč znovu',
    drawCard: 'Táhni kartu',
    again: 'Znovu',
    againAction: (action: string) => `${action} znovu`,
    deckDone: 'Dohráno',
    cardsLeft: (count: number) => `Zbývá ${count}`,
    next: 'Další',
    promptA11y: (prompt: string) => `${prompt} Ťukni pro další.`,
    quizWaiting: (names: string) => `Zamknuto. Chybí ${names}`,
    quizCorrect: (answer: string) => `${answer}, správně`,
    quizSkipWait: 'Nečekat',
    quizSkipWaitA11y: 'Ukázat odpověď bez čekání',
    quizResults: 'Výsledky',
    quizNextQuestion: 'Další otázka',
    drumA11y: 'Buben se jmény hráčů',
    roundForTable: 'Runda pro stůl.',
    backToNight: 'Zpátky k večeru',
    backToNightScreen: 'Zpátky do večera',
    turnPick: (name: string) => `${name} je na řadě`,
    scoreA11y: (name: string, score: number) => `Bod pro ${name}. Aktuálně ${score}`,
    localOnlyGame: (detail: string) => `Hra běží jen na tomhle telefonu. ${detail}`,
    endGame: 'Konec',
    endGameA11y: 'Ukončit hru',
    tapScorer: 'Ťukni na toho, kdo bodoval.',
    tapSipper: 'Ťukni na toho, kdo dostal bod.',
  },

  community: {
    loading: 'Načítám komunitu',

    // — Sekce a přepínače (stav drží anglické klíče, tady jsou jen popisky) —
    sectionBoards: 'Žebříčky',
    sectionChallenges: 'Výzvy',
    sectionEvents: 'Akce',
    metricPubs: 'Hospody',
    metricMapper: 'Mapér XP',
    periodWeek: 'Týden',
    periodYear: 'Letos',
    periodAll: 'Celkem',
    metricChipTitle: 'Podle čeho',
    periodChipTitle: 'Za jaké období',

    // — Žebříčky —
    boardFailed: 'Žebříček se teď nedotáhl. Potáhni dolů a zkus to znovu.',
    boardRank: (rank: number) => `${rank}. místo`,
    boardEmpty: 'V tomhle žebříčku zatím nikdo není.',

    // — Výzvy —
    challengesFailed: 'Výzvy se teď nedotáhly. Potáhni dolů a zkus to znovu.',
    challengesEmpty: 'Teď neběží žádná výzva.',
    challengeMeta: (deadline: string, done: number, goal: number) =>
      `Do ${deadline} · ${done} z ${goal}`,
    challengeDeadline: (date: string) => `Do ${date}`,
    challengeGoal: (goal: number, unit: string) => `z ${goal} ${unit}`,
    challengeGoalShort: (goal: number) => `z ${goal}`,
    challengeRules: 'Co se počítá',
    challengeRivals: 'Kdo ještě jede',

    // — Akce —
    eventsFailed: 'Akce se teď nedotáhly. Potáhni dolů a zkus to znovu.',
    eventsEmpty: 'V okolí teď žádná akce není.',
    eventsSignIn: 'Přihlásit se pro akce',
    eventsMine: 'Moje akce a nové setkání',

    // — Doporučení lidí —
    suggestionsLoading: 'Načítám doporučené pivaře',
    suggestionSharedPubs: (count: number) => {
      if (count === 1) return 'Máte společnou hospodu';
      const lastTwo = count % 100;
      const few = count % 10 >= 2 && count % 10 <= 4 && (lastTwo < 12 || lastTwo > 14);
      return few ? `Máte ${count} společné hospody` : `Máte ${count} společných hospod`;
    },
    suggestionSharedFriends: (count: number) => {
      if (count === 1) return 'Jeden společný kamarád';
      const lastTwo = count % 100;
      const few = count % 10 >= 2 && count % 10 <= 4 && (lastTwo < 12 || lastTwo > 14);
      return few ? `${count} společní kamarádi` : `${count} společných kamarádů`;
    },
  },

  feed: {
    retryA11y: 'Zkusit načíst Kocoviny znovu',
    refreshA11y: 'Zkusit načíst nové večery',
    searchA11y: 'Hledat',
    profileA11y: (name: string) => `Profil ${name}`,
    nightMenuA11y: 'Možnosti večera',
    momentsA11y: 'Momentky večera',
    openNightA11y: (title: string) => `Otevřít večer ${title}`,
    commentsA11y: (count: number, noun: string) => `${count} ${noun}. Otevřít večer.`,

    // — Dlaždice odehrané hry —
    gamePlayed: 'ODEHRÁNO',
    gamePoints: 'Na body',
    gameNoPoints: 'Bez bodů',

    // — Fakta na kartě večera —
    factBeers: 'Piva',
    factNight: 'Večer',
    published: 'Publikováno',
    nightTitleFallback: 'Pivní večer',

    // — Stavy načítání —
    accountError: 'Účet se mi teď nepovedlo připravit. Zkus to za chvíli.',
    loadError: 'Kocoviny se teď nenačetly.',
    staleWithError: 'Jedeš z posledního načtení. Novější večery se teď nedotáhly.',
    staleChecking: 'Poslední načtení · kontroluju novější večery…',
    errorTitle: 'Kocoviny se teď nenačetly',
    errorBody: 'Zápisy v telefonu zůstávají v bezpečí. Zkus to za chvíli znovu.',
    emptyWorldTitle: 'Svět je zatím podezřele čerstvý',
    emptyWorldBody: 'Zatím tu nikdo nezveřejnil svůj večer.',
  },

  nightDetail: {
    back: 'Zpátky',
    title: 'Večer',
    comments: 'Komentáře',
    commentsEmpty: 'Zatím ticho. Cinkni první poznámku.',
    composerPlaceholder: 'Napiš něco k večeru',
    composerA11y: 'Komentář k večeru',
    sendA11y: 'Poslat komentář',
    sending: 'Posílám…',
    send: 'Poslat',
    deleteCommentA11y: 'Smazat komentář',
    goneTitle: 'Tenhle večer se schoval',
  },

  roast: {
    noPhotos: (pubs: string) => `${pubs} a ani jedna fotka`,
    noPhotosBasis: 'Zítra si z toho nebudeš pamatovat nic',
    noWins: (games: string) => `${games}, ani jedna výhra`,
    noWinsBasis: 'Aspoň jsi platil rundu',
    samePub: 'Zase ta samá hospoda',
    samePubBasis: (visits: number) => `${visits}. návštěva. Objevitel roku to nebude`,
    slowPace: (duration: string, beers: string) => `${duration} a ${beers}`,
    slowPaceBasis: 'To už není pití, to je schůze',
    durationMinutes: (minutes: number) => `${minutes} minut`,
    durationHours: (hours: number) =>
      `${hours} ${czechPlural(hours, { one: 'hodina', few: 'hodiny', many: 'hodin' })}`,
    durationHoursMinutes: (hours: number, minutes: number) => `${hours}h ${minutes}m`,
  },

  relativeTime: {
    now: 'teď',
    minutesAgo: (minutes: number) => `před ${minutes} min`,
    hoursAgo: (hours: number) => `před ${hours} h`,
    daysAgo: (days: number) => `před ${days} d`,
    soon: 'ještě chvíli',
    hoursMinutesLeft: (hours: number, minutes: number) => `ještě ${hours} h ${minutes} min`,
    hoursLeft: (hours: number) => `ještě ${hours} h`,
    minutesLeft: (minutes: number) => `ještě ${minutes} min`,
    today: 'dneska',
    todayShort: 'dnes',
    yesterday: 'včera',
    dayBeforeYesterday: 'předevčírem',
    daysAgoLong: (days: number) => `před ${days} dny`,
  },

  partaFeed: {
    drinkFallback: 'nápoj',
    placePrivate: 'U někoho doma',
    placeOutdoors: 'Venku',
  },

  liveActivity: {
    pubFallback: 'Pivní večer',
    beerFallback: 'Pivo',
    beerWord: (count: number) =>
      czechPlural(count, { one: 'pivo', few: 'piva', many: 'piv' }),
    beerCountA11y: (count: number) => `Počet piv ${count}`,
    total: (amount: string) => `Celkem ${amount}`,
    latestBeerFallback: 'Poslední pivo',
    latestAt: (time: string) => `naposled v ${time}`,
    firstBeerPouring: 'První pivo se teprve čepuje',
    addBeer: 'Zapsat stejné',
    addBeerA11y: 'Zapsat stejné pivo',
    openCounter: 'Otevřít počítadlo',
  },

  notifications: {
    pubReminderChannel: 'Připomínky v hospodě',
    pubReminderTitle: (pubName: string) => `Sedíš v ${pubName}?`,
    pubReminderBody: 'Naťukni počítadlo a sečti dnešní rundy.',
    beerCountChannel: 'Připomínky počítadla',
    beerCountTitle: 'Mrkni na svůj deníček',
    beerCountBody: 'Sedí dnešní zápis?',
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
