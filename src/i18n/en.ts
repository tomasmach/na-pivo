/**
 * English UI strings. Same shape as cs.ts (the Czech source of truth);
 * `Strings` makes TypeScript refuse a missing or extra key.
 */

import { beerCountLabel, beerNoun, englishPlural, formatVolume, peopleCountLabel, pubCountLabel } from './enHelpers';
import type { Strings } from './cs';
import type { DrinkType, OutsidePlaceContext, ServingType } from '@/drinks/drinkTypes';

export const en: Strings = {

  appName: 'Na pivo',

  common: {
    cancel: 'Cancel',
    ok: 'OK',
    friendFallback: 'Friend',
    drinkerFallback: 'Drinker',
    beerFallback: 'Beer',
    close: 'Close',
  },

  map: {
    compass: 'Compass',
    map: 'Map',
    layerAll: 'Nearby',
    layerVisited: 'My trail',
    layerFriends: 'Crew now',
    zoomForPubs: "Zoom in on a city and I'll show you the pubs around it.",
    // The map card's loud line is a short count and nothing else: a full
    // sentence at 18pt wrapped mid-phrase ("243 pubs in view · 1 / you already
    // know"). The detail goes on the quiet line under it.
    viewportPubs: (n: number) =>
      englishPlural(n, {
        one: '1 pub in view',
        other: `${n} pubs in view`,
      }),
    viewportKnown: (n: number) =>
      englishPlural(n, {
        one: '1 you already know',
        other: `${n} you already know`,
      }),
    // Nothing visited in view: the quiet line would otherwise sit empty.
    viewportKnownNone: "You haven't been to any of these yet",
    liveShort: (n: number) =>
      n === 0
        ? 'Nobody from the crew is out for a beer'
        : englishPlural(n, {
            one: '1 friend is out for a beer',
            other: `${n} friends are out for a beer`,
          }),
    citySummary: (visits: number, pubs: number) =>
      `${visits} ${englishPlural(visits, { one: 'night', other: 'nights' })} · ${pubCountLabel(pubs)}`,
    showMyPubs: 'Show my pubs',
    findMe: 'Find me',
    liveNow: 'OUT RIGHT NOW',
    friendFallback: 'Friend',
    friendIsHere: (name: string) => `${name} is here right now`,
    friendsAreHere: (name: string, others: number) => `${name} and ${others} others are here`,
    aimCompass: 'Point the compass',
    pinHint: 'Aim the pin at the pub',
    pinConfirm: 'The pub is right here',
    pubFallback: 'A place on the beer map',
    visitedSummary: (count: number, date: string) => `You've been here ${count}× · last time ${date}`,
    notVisited: "You haven't got a tally mark here yet.",
    visited: 'Visited',
    pubDetail: 'Pub detail',
    offline: 'The map is holding the last data. The Crew will show up once you get signal.',
    retry: 'Try again',
    loading: 'Looking for pubs…',
    permissionHint: "You can look around without location too. Tap and I'll find you.",
    openWithoutLocation: 'Open the map without location',
    listTitle: 'Pubs on the map',
    listLink: 'List',
    refresh: 'Reload',
    closeList: 'Close the pub list',
    emptyList: 'Nothing matches this filter yet.',
    pubNameFallback: 'Pub',
  },

  // Pubs as the place picker for the night (modal `/pick-pub` above Drink)
  pubPicker: {
    closeA11y: 'Close the pub picker',
    outsideTitle: 'Outside a pub',
    outsideFact: 'At home, outdoors, at the cottage…',
  },

  pubDetail: {
    tabs: ['Info', 'Activity'] as const,
    closeA11y: 'Close pub detail',
    moreA11y: 'More pub options',
    navigate: 'Navigate',
    startHere: 'Start the night here',
    chooseHere: 'Pick this pub',
    beerFallback: 'Beer',
    openingTitle: 'Opening hours',
    openingClosed: 'Closed',
    openingAdd: 'Add the opening hours',
    openingEditA11y: 'Edit the opening hours',
    tapsTitle: 'On tap',
    tapsAdd: 'Add beers and prices',
    tapsEditA11y: 'Edit beers and prices',
    beerFrom: 'Beer from',
    eventsTitle: "What's on",
    eventVerified: 'Verified',
    eventSuggest: 'Suggest an event',
    eventSuggestSignedOut: 'Sign in and suggest an event',
    visitsTitle: "What's been happening here",
    visits: 'Visits',
    lastVisit: 'Last time',
    amenitiesTitle: 'Amenities',
    moreTitle: 'Anything else?',
    renameAction: 'Fix the name',
    editOwnedAction: 'Edit your own pub',
    reportAction: 'Report the pub',
    reportTitle: "What's wrong?",
    reportClosed: 'The pub has closed down',
    reportNotPub: "It's not a pub",
    reportConfirmTitle: (name: string) => `Report "${name}"?`,
    reportConfirmBody: 'Reporting can hide the pub from everyone else too.',
    reportConfirmCancel: 'Back',
    reportConfirmAction: 'Report',
    reportSaved: "Reported. I'll look into it.",
    reportQueued: "Your report is saved. I'll send it once you have signal.",
    saveFailed: "That didn't save. Try again in a bit.",
    renameTitle: 'Fix the name',
    renameLabel: 'Pub name',
    renameSave: 'Save the name',
    activityLoadError: "I couldn't load the activity.",
    activityEmpty: 'Nobody has written anything here yet. Be the first.',
    activityRetry: 'Try again',
    activityLoadMore: 'Load more',
    activityLoadMoreRetry: 'Try loading more again',
    activityLoadMoreA11y: 'Load more pub activity',
    stateLoading: 'Loading the pub…',
    stateFailed: 'I could not load the pub.',
    eventToday: (range: string) => `Today ${range}`,
    eventSuggestHint: 'I check it first, then everyone sees it.',
    // The crown stays "Kč" in both languages: these are Czech pub prices.
    priceValue: (czk: number) => `${czk} Kč`,
  },

  // "Map the pub" (community pub amenities + Mapper)
  mapPub: {
    // Trigger (MapPubButton)
    triggerDefault: 'Map the pub',
    triggerPartial: 'Finish mapping the pub',
    triggerDone: 'This pub is mapped',
    triggerPartialSuffix: (pct: number) => ` · ${pct} %`,
    triggerA11y: (pub: string, pct: number) => `Map the pub ${pub}, ${pct} percent mapped`,

    // Sheet header
    mapIntroTitle: 'Map the pub',
    subtitleEmpty: 'What have they got here? Let me know.',
    subtitleSome: 'Nice, keep going!',
    subtitleDone: "Brilliant, that's the lot!",
    ringCaption: 'mapped',
    personal: (n: number, total: number) => `Mapped ${n} of ${total}`,
    footerHint: 'Every answer saves itself. Thanks!',
    closeA11y: 'Close pub mapping',
    offline: "You're offline right now. I'll keep your answers and send them later.",
    ringA11y: (pct: number) => `${pct} percent mapped`,
    // Makes the public-vs-private distinction explicit: this is shared community
    // data, unlike the private rating on the evening card.
    publicNote: 'Public. Other drinkers will see it.',
    entryA11yPublic: 'Opens public pub mapping, visible to others',

    // Info fact rows (opening hours + beers): the two non-amenity groups the hub
    // also covers. Each row taps through to the contribute editor.
    infoSection: 'OPENING HOURS AND BEERS',
    factHoursLabel: 'Opening hours',
    factHoursFilled: 'Filled in · edit',
    factHoursMissing: 'Missing · add it',
    factBeersLabel: 'Beers on tap',
    factBeersMissing: 'Missing · add what they pour',
    factBeersCount: (n: number) => (n === 1 ? '1 beer · edit' : `${n} beers · edit`),
    factBeersWithPrice: (n: number, price: string) =>
      n === 1 ? `1 beer · ${price}` : `${n} beers · ${price}`,
    factReferencePrice: (price: string) => `Large beer · ${price}`,
    factBeersRotating: (detail: string | null) =>
      detail ? `Rotating · ${detail}` : 'Rotating selection · edit',
    factEditA11y: (label: string, filled: boolean) =>
      filled ? `Edit: ${label}` : `Add: ${label}`,

    // Detail actions, kept visible at the end of the mapping scroll.
    renameRowLabel: 'Rename the pub',
    renameRowHint: 'Rename it or fix a typo',
    reportRowLabel: 'Report the pub',

    // Sections (uppercase, matching the statsHeader convention). Merged to 3 so
    // no section is a single row: games+atmosphere → FUN, payment+wifi/parking
    // → PRACTICAL.
    sectionSeating: 'SEATING',
    sectionFun: 'FUN',
    sectionPractical: 'PRACTICAL',

    // Row controls
    yes: 'Yes',
    no: 'No',
    unmapped: 'not mapped',
    firstMapped: 'first to map it!',
    signal: (yes: number, no: number) => `${yes}× yes · ${no}× no`,
    disputed: 'people disagree',
    yesA11y: (amenity: string) => `${amenity}: yes`,
    noA11y: (amenity: string) => `${amenity}: no`,
    clearHint: 'Tap again to undo',

    // Confidence signal: how many people confirmed the fact, not a yes/no poll.
    // "They have it" is amber + count, "they do not" is a calm muted count,
    // "disputed" flags a recent conflict, "first" celebrates the first mapper.
    confHas: (n: number) =>
      n <= 1
        ? 'just 1 confirmation'
        : englishPlural(n, {
            one: `${n} person confirmed it`,
            other: `${n} people confirmed it`,
          }),
    confNo: (n: number) => `they don't · ${peopleCountLabel(n)}`,
    confDisputed: 'disputed · check it',
    confFirst: 'you mapped it first',
    confA11y: (label: string, detail: string) => `${label}: ${detail}`,

    // Amenities section header + the one public-data chip that replaced the
    // four-line mapping intro.
    amenitiesSection: 'WHAT THEY HAVE',
    publicChip: 'public',
    offlineChip: 'offline · will save',

    // Fact tiles (opening hours + beers): the two editable info groups.
    tileHours: 'Opening hours',
    tileHoursEmpty: 'add the opening hours',
    tileBeers: 'Beers',
    tileBeersEmpty: 'add what they pour',
    tileBeersValue: (count: number, price: string | null) => {
      const head = count > 0 ? `${count} on tap` : null;
      if (head && price) return `${head} · from ${price}`;
      if (head) return head;
      if (price) return `from ${price}`;
      return '';
    },
    tileMapped: (age: string) => `mapped ${age}`,
    tileHoursOpenDays: (n: number) =>
      englishPlural(n, { one: 'open 1 day', other: `open ${n} days` }),
    tileA11y: (label: string, detail: string) => `${label}, ${detail}. Edit.`,

    // Amenity labels / chips (mirror the catalogue in src/data/amenities.ts)
    amenities: {
      payment_card: { label: 'Card payments', short: 'Card' },
      seating_garden: { label: 'Beer garden / terrace', short: 'Garden' },
      seating_barrier_free: { label: 'Step-free access', short: 'Step-free' },
      game_darts: { label: 'Darts', short: 'Darts' },
      game_billiards: { label: 'Pool table', short: 'Pool' },
      game_foosball: { label: 'Table football', short: 'Foosball' },
      game_jukebox: { label: 'Jukebox', short: 'Jukebox' },
      atmosphere_live_music: { label: 'Live music', short: 'Live music' },
      atmosphere_sports_tv: { label: 'Sport on TV', short: 'Sport on TV' },
      practical_wifi: { label: 'Wi-Fi', short: 'Wi-Fi' },
      practical_parking: { label: 'Parking', short: 'Parking' },
    },

    // XP toasts
    xpFirstMapper: (xp: number) => `First mapper! +${xp} XP`,
    xpSession: (n: number, xp: number) => `Mapped ${n} things · +${xp} XP`,
    // Retracting a vote only corrects the public map; the user keeps their XP
    // and counters (lifetime-achievement model, never clawed back).
    retracted: 'Removed from the map. You keep your points.',

    // Profile: MAPPER
    mapperHeader: 'MAPPER',
    mapperLevel: (n: number, title: string) => `Level ${n} · ${title}`,
    mapperXpProgress: (cur: number, next: number) => `${cur} / ${next} XP`,
    mapperXpTotal: (xp: number) => `${xp} XP in total`,
    mapperXpToNext: (n: number) => `${n} XP to the next level`,
    mapperXpMaxed: "you've got everything, you're a legend",
    mapperStatMappedPubs: 'pubs mapped',
    mapperStatAnswers: 'answers collected',
    mapperStatFirstMaps: 'mapped first',
    mapperStatCompleted: 'pubs finished',
    mapperEmpty: "You haven't mapped anything yet. Find a pub and say what's in it.",
    mapperSignedOut: 'Sign in and your mapping stays with you wherever you sign in.',

    // Badges
    badgeFirstMapTitle: 'First mapper',
    badgeFirstMapLocked: 'Be the first to map a pub',
    badgeExplorerTitle: 'Explorer',
    badgeExplorerLocked: 'Map 10 pubs',
    badgeCartographerTitle: 'Cartographer',
    badgeCartographerLocked: 'Map 25 pubs',
    badgeCompletionistTitle: 'Completionist',
    badgeCompletionistLocked: 'Map one pub in full',
    badgeFactMachineTitle: 'Beer detective',
    badgeFactMachineLocked: 'Record 100 facts',
  },

  compass: {
    headerTitle: 'na pivo',
    hiddenPubHint: 'Tap to reveal',
    /** Stands in for the pub's name while "Hide pub names" is on. */
    hiddenPubName: 'Secret pub',
    distanceCaption: {
      nearest: 'to the nearest beer',
      surprise: 'to your random beer',
    },
    modeNearest: 'Nearest',
    modeSurprise: 'Surprise me',
    openInMaps: 'Open in maps',
    reportTitle: 'Missing or wrong?',
    reportBody: (pubName: string) =>
      `Add a different pub, fix "${pubName}", or report a problem.`,
    reportRename: 'Fix the name',
    reportNotPub: "It's not a pub",
    reportConfirmTitle: (name: string) => `Report "${name}"?`,
    reportConfirmBody: 'Reporting can hide the pub from everyone else too.',
    reportConfirmCancel: 'Back',
    reportConfirmAction: 'Report',
    reportAddMissing: 'Add a different pub',
    renameTitle: "What's it called?",
    renameBody: (pubName: string) =>
      `Once the fix goes through, I'll rename "${pubName}" for other drinkers too.`,
    renamePlaceholder: 'New pub name',
    renameSave: 'Save the name',
    renameSaving: 'Saving',
    renameSavedToast: 'The pub name is fixed.',
    renameQueuedToast: "The name is fixed here. I'll pass it on once you have signal.",
    calibrationHint: 'Wave the phone in a figure of eight so the compass settles',
    openNow: 'Open',
    openUntil: (t: string) => `Open until ${t}`,
    closedNow: 'Closed',
    closedUntil: (t: string) => `Closed · opens at ${t}`,
    hoursUnknown: "I don't know the opening hours",
    detailsLoading: 'Loading info',
    contribute: 'Add info',
    addMissingPubLink: 'Not the right pub? Add it',
    pubFixShort: 'Missing / wrong',
    // The leading beer glyph is a line-art icon rendered next to this text in
    // the pub card (see RevealedPubPill), not an emoji baked into the string.
    beerWithPrice: (name: string, price: string) => `${name} · ${price}`,
    referenceBeer: 'Large beer',
    beerNoPrice: (name: string) => name,
    beerAndMore: 'and more',
    ratingCount: (count: string) => `${count} ratings`,
    gardenBadge: 'Garden',
    // Filter sheet (brand quick-pick) copy
    beerFilterButton: 'Filter beers',
    beerFilterSheetTitle: 'What do you fancy?',
    beerFilterSheetSubtitle: "I'll only show pubs that pour it, going by the records.",
    beerFilterAll: 'All beers',
    beerFilterPopular: 'Popular',
    beerFilterSearchPlaceholder: 'Search another brand…',
    beerFilterNoResults: 'Nothing like that in the records.',
    beerFilterSearching: 'Searching…',
    beerFilterRotatingHint:
      'I go by the last confirmed lineup. Pubs with rotating taps can change.',
    pubFilterButton: 'Filters',
    pubFilterButtonActive: (count: number) => `Filters · ${count}`,
    pubFilterTitle: 'Where to today?',
    pubFilterSubtitle: 'Pick what the pub has to have.',
    pubFilterMatchAll: 'A pub has to match everything you pick. I only count what people confirmed.',
    pubFilterLimit: (count: number) => `Pick ${count} things at most, so the compass has somewhere to look.`,
    pubFilterClear: 'Clear',
    pubFilterApply: 'Show pubs',
    beerFilterSection: 'Beer',
    otherPlacesSection: 'Places',
    amenityFilterSections: {
      fun: 'Fun',
      practical: 'Practical',
      seating: 'Seating',
    },
    otherPlacesFilter: 'Other places with a tap',
    otherPlacesHint: 'Kiosks, campsites and sports grounds where someone confirmed beer.',
    // Price filter (histogram + two-thumb range slider) copy
    priceFilterLabel: 'Beer price',
    priceFilterSubtitle: 'Large beer · bars in 5 Kč steps. Take prices older than a year as a rough guide.',
    priceFilterFromLowest: 'From the cheapest',
    priceFilterFrom: (price: string) => `From ${price}`,
    priceFilterNoLimit: 'No limit',
    priceFilterMax: (price: string) => `Up to ${price}`,
    priceFilterPubCount: (count: number) => pubCountLabel(count),
    priceFilterHidesUnknown: 'Pubs with no known price hide while the filter is on.',
    priceFilterNoData: 'Nobody has mapped prices here yet. Log a beer in a pub and it will show up better.',
    // Price age: how old the price observation is. Rendered next to the price
    // so the card never pretends a stale number is today's truth.
    priceAgeToday: 'today',
    priceAgeYesterday: 'yesterday',
    priceAgeDays: (n: number) => `${n} days ago`,
    priceAgeWeeks: (n: number) => (n === 1 ? 'a week ago' : `${n} weeks ago`),
    priceAgeMonths: (n: number) => (n === 1 ? 'a month ago' : `${n} months ago`),
    /** Prefix for prices older than ~6 months, visibly approximate. */
    priceApprox: (price: string) => `≈ ${price}`,

    // Tácek rebuild: one card, one amber button, everything else behind "…"

    /** The one glowing button. Its label says exactly what the tap does. */
    navigateCta: 'Take me there',
    navigateCtaSub: "I'll open navigation",
    /** Same button, dimmed, while the first search is still running. */
    searchingCtaSub: 'looking for the nearest pub',
    /** The quiet outline twin: reroll in "Surprise me", skip in "Nearest". */
    anotherPub: 'Give me another',
    /** Same slot while you're aiming at a friend's pub. */
    backToNearest: 'Back to the nearest',
    /** Amber text door in the card footer, the twin of "Account →" on the counter. */
    mapPubLink: 'About the pub',
    /** Footer copy while pub names are hidden in settings. */
    revealHint: "Tap and I'll tell you where",
    /** Unit under the big distance numeral, e.g. "80 / METRES". */
    distanceUnitMeters: 'METRES',
    // English only needs singular and plural; a decimal distance ("2.5 km")
    // takes the plural too.
    distanceUnitKm: (value: number) => (value === 1 ? 'KILOMETRE' : 'KILOMETRES'),

    // "Anything else?" overflow sheet
    moreTitle: 'Anything else?',
    moreMap: 'Beer map',
    moreFilters: 'Filters',
    moreFiltersActive: (count: number) => `${count} active`,
    moreHome: 'Navigate home',
    moreModeNearest: 'Find the nearest',
    moreModeSurprise: 'Surprise me',
    moreAddPub: 'Add a pub',
    moreReport: 'Report the pub',
    moreSearchSettings: 'Search settings',
    moreRetry: 'Try again',

    // Nudge slot: at most one of these, ever
    nudgeFilters: (count: number) =>
      englishPlural(count, { one: 'Filtering 1 thing', other: `Filtering ${count} things` }),
    nudgeFiltersClear: 'Clear',
    nudgeFocused: 'Aiming at the crew',
    /** Badge on the head cell while the needle is borrowed by a friend's
     *  "Show on the compass" instead of pointing at the list's first pub. */
    focusBadge: 'Target',
    nudgeNoMagnetometer: "Your phone has no compass, so the needle won't turn.",
    nudgeCalibrate: 'Wave the phone in a figure of eight so the compass settles.',
  },


  permissions: {
    title: 'I need your location',
    // Google Play prominent-disclosure requirement: say explicitly that the app
    // collects location data, what for, that it goes to the server, and that
    // with reminders on it happens even when the app is closed or not in use.
    body:
      'Na pivo collects your location data to find pubs nearby and to point the needle. Your precise or approximate location is sent to my server so I can search for pubs. If you turn on pub reminders, I check your location even when the app is closed or not in use. I do not store your GPS route or your location history.',
    cta: 'Allow location',
    openSettings: 'Open Settings',
  },

  // First-run onboarding (route /onboarding, shown once on a fresh install)
  onboarding: {
    skip: 'Skip',
    next: 'What next?',
    // Short lines, not paragraphs. Onboarding is read standing up with a thumb
    // on "next", so three concrete things beat one well-written block nobody
    // finishes. Each line is something the app actually does; no promises.
    slide1Title: 'Welcome to Na pivo',
    slide1Body: 'A beer diary in your pocket.',
    slide1Bullets: [
      // The compass leads, because it is the thing this app is still known for
      // and the one line that says WHERE you are going. The diary comes second:
      // it is what you do once you are there.
      'The compass on the map takes you to the nearest open pub',
      'You log a beer in two taps',
      'A private record of your nights builds itself',
    ],
    slide2Title: 'A night with the crew',
    slide2Body: 'Not a spreadsheet, a night.',
    slide2Bullets: [
      'You see who is at the table',
      'Games decide who pays for the round',
      'A night becomes a post, not a report',
    ],
    slide3Title: "So you don't lose anything",
    slide3Body: 'It works without an account too.',
    slide3Bullets: [
      'Your diary survives a new phone',
      'Badges and Mapper leaderboards',
      'You can add an account later',
    ],
    slide3BodyAndroid: 'It works without an account too.',
    slide3BulletsAndroid: [
      'Your diary survives a new phone',
      'Google Play can verify your age',
      'I never see your date of birth or any ID',
    ],
    slide3Cta: 'Create an account',
    slide3Later: 'No account for now',
    // Canned labels in the onboarding preview. The names in the fixture
    // (U Fleků, Honza, Klára) stay Czech on purpose.
    previewStatBeers: 'beers',
    previewStatTable: 'at the table',
    previewStatNight: 'night',
    previewMe: 'You',
    previewGame: 'Dice',
    previewPhoto: 'Photo',
    previewBoardTitle: 'Mappers this month',
    previewBoardUnit: 'pubs',
  },

  celebration: {
    eyebrow: 'WELCOME TO',
    headerTitle: 'You made it',
    headlineLine1: 'Cheers,',
    headlineLine2: 'mate!',
    subtitle: 'Have one for me',
    backToCompass: 'Back to the compass',
    openInMaps: 'Open in maps',
    pubFallback: 'The pub',
  },

  empty: {
    headlineLine1: 'Nothing',
    headlineLine2: 'on tap here',
    body: "I didn't find any pub nearby. Try again or widen the range in settings.",
    searchFailedHeadlineLine1: 'The search',
    searchFailedHeadlineLine2: 'fell over',
    searchFailedBody:
      "The pubs didn't download. Check your signal and try again.",
    openSettings: 'Open settings',
    retry: 'Try again',
    addPub: 'Add a pub',
    filteredHeadlineLine1: 'That combination',
    filteredHeadlineLine2: 'is rare',
    filteredBody: "No pub I've mapped nearby ticks every box yet.",
    editFilters: 'Edit filters',
    clearFilters: 'Clear filters',
  },

  settings: {
    title: 'Settings',
    // "What the compass finds you" named the whole screen after one feature.
    // The compass is a cell in the pub list, not the product.
    compassSection: 'Finding pubs',
    notificationsSection: 'When I get in touch',
    privacySection: 'Privacy',
    privacyDoor: {
      title: 'Who sees you',
      subtitle: 'Invisible mode, sharing beers with the crew and quiet at night',
    },
    locationPrivacy: "Your home and your route stay on the phone. I don't store location history.",
    // Section group labels, one clear meaning per group.
    sections: {
      search: 'SEARCH',
      app: 'APP',
      contribute: 'CHIP IN',
      about: 'ABOUT',
    },
    // Existing anonymous or claimed accounts drill into /account; only a
    // genuinely missing session opens /auth.
    accountCard: {
      header: 'ACCOUNT',
      verified: 'Email verified',
      verifiedInline: 'email verified',
      ctaSignedIn: 'My account',
      ctaManageData: 'Account and data',
      manageDataSubtitle: 'Manage your data or sign in',
      ctaSignedOutSubtitle: 'Your beers, badges and Crew follow you wherever you sign in',
      signedOutTitle: 'Sign in',
      signedOutSubtitle: 'Your beers, ratings and badges follow you wherever you sign in',
    },
    distance: {
      header: 'MAXIMUM DISTANCE',
      helper: 'I only look for pubs up to this distance.',
      unlimited: 'No limit',
      unlimitedUnit: 'NO LIMIT',
      kmShort: 'km',
      rangeMin: '500 m',
      rangeMax: '∞',
      accessibilityLabel: 'Maximum search range',
      increase: 'Increase the range',
      decrease: 'Decrease the range',
    },
    haptics: {
      title: 'Buzz when you arrive',
      subtitle: 'It grunts in your pocket',
    },
    pubReminders: {
      title: 'Remind me in the pub',
      subtitle: "In the evening I check now and then whether you're sitting at the bar. No route stored.",
      failureEyebrow: 'REMINDERS ARE OFF',
      openSettings: 'Open Settings',
      denied: {
        'notifications-denied': {
          title: 'Notifications stayed off',
          body:
            'Without notifications I have no way to send the reminder. Turn them on in Settings and try again.',
        },
        'foreground-location-denied': {
          title: 'Allow basic location first',
          body:
            'Location while using the app is the basis for the compass and for pubs nearby. Once you allow it, I will sort out "always" location for the reminders.',
        },
        'background-location-denied': {
          title: '"Always" location is missing',
          body:
            'Location while using the app is enough for the compass. The pub reminder runs even when the app is closed, so the phone needs location set to "Always".',
        },
      },
    },
    language: {
      section: 'App language',
      label: 'The app speaks',
      system: 'Like the phone',
      cs: 'Česky',
      en: 'English',
      option: (name: string) => `App language: ${name}`,
    },
    beerCountReminder: {
      title: 'Diary check',
      subtitle: "After an entry I set one reminder to check the diary. It doesn't repeat on its own.",
      intervalLabel: 'In',
      intervalOption: (minutes: number) =>
        `Check the diary in ${minutes} ${englishPlural(minutes, { one: 'minute', other: 'minutes' })}`,
      intervalShort: (minutes: number) => `${minutes} min`,
    },
    sound: {
      title: 'Clink sound',
      subtitle: 'A small "clink" when you arrive',
    },
    waterNudge: {
      title: 'Remind me about water',
      subtitle: "Optional, after four beers, only on the phone. It doesn't estimate how sober you are.",
    },
    hideClosed: {
      title: 'Hide closed pubs',
      subtitle: 'Show only open ones and those with unknown hours',
    },
    preferRated: {
      title: 'Prefer well rated',
      subtitle: 'Skips known places under 4 stars',
    },
    preferGarden: {
      title: 'Prefer a beer garden',
      subtitle: "If I know they don't have a garden, I move on",
    },
    hidePubNames: {
      title: 'Hide pub names',
      subtitle: 'The name shows after a tap',
    },
    currency: {
      title: 'Price currency',
      subtitle: "Set automatically by the country you're in",
      czk: 'CZK',
      eur: '€',
      footer: (currency: string) =>
        `I count prices in ${currency === 'EUR' ? '€' : 'CZK'}, by the country you're in.`,
    },
    marketingEmails: {
      title: 'News by email',
      subtitle: 'You can turn tips and offers off any time',
    },
    about: {
      title: 'About the app',
    },
    feedback: 'Write to me / report a bug',
    feedbackCtaSubtitle: 'Something off or something missing? Let me know.',
    addPub: 'Add a missing pub',
    addPubCtaSubtitle: "Can't see your place? Add it with the rest.",
    privacy: 'Privacy',
    more: {
      title: 'What else?',
      accessibilityLabel: 'More settings options',
      homePoint: 'Home point',
      configured: 'Set',
      notConfigured: 'Not set',
      navigateGoogle: 'Navigate with Google',
      navigateMapy: 'Navigate with Mapy.com',
      myAddedPubs: 'Pubs I added',
    },
    discord: {
      title: 'Join the community Discord',
      subtitle: 'Beer, pubs and the talk around them. Drop in for one.',
      url: 'https://discord.gg/EDw8EW7Az8',
    },
    creator: {
      header: 'MADE BY',
      name: 'Tomáš Mach',
      instagram: 'Instagram',
      instagramUrl: 'https://www.instagram.com/jsem_mach/',
      linkedin: 'LinkedIn',
      linkedinUrl: 'https://www.linkedin.com/in/mach-tomas/',
    },
    footer: 'No ads · No paying',
  },

  pubReminderOnboarding: {
    eyebrow: 'NEW FOR EVENINGS',
    title: "When you sit down in a pub, I'll nudge you.",
    body:
      'The counter reminds you in the evening when you arrive at a pub. Just turn on notifications and background location.',
    introCta: "Show me what I'm allowing",
    detailsTitle: 'What the phone will ask you to allow',
    detailsBody:
      'The compass gets by with location while using the app. The reminder also needs "always" location.',
    notificationTitle: 'Notifications',
    notificationBody: "I only send a short reminder so the night doesn't end without an entry.",
    locationTitle: '"Always" location',
    locationBody:
      'I collect it only for the circle around pubs, even when the app is closed or not in use.',
    privacyTitle: 'No GPS diary',
    privacyBody: "I don't store routes. I only watch whether you're near a pub.",
    cta: 'Turn reminders on',
    ctaBusy: 'Turning on…',
    skip: 'Not now, let me drink in peace',
    backgroundDisclosureTitle: 'Reminders need background location',
    backgroundDisclosureBody:
      'Na pivo will use your location even when the app is closed or not in use. It is only for reminders at the pub: I set up zones around the nearest places on your phone, and when you walk into one, I nudge you to log a beer. I store no route and no GPS points anywhere.',
    backgroundDisclosureConfirm: 'Got it, allow location',
    backgroundDisclosureDeny: 'Not now',
  },

  nicknameNudge: {
    eyebrow: 'FINISH YOUR ACCOUNT',
    title: 'You have no @nickname',
    body:
      "You have an account, but without a nickname the crew can't find you. Pick one and your profile, Crew and leaderboards will run properly.",
    cta: 'Save nickname',
    ctaBusy: 'Saving…',
    savedToast: 'Done, the nickname is yours.',
    skip: 'Not now',
  },

  ugcConsent: {
    title: 'Rules for shared content',
    lines: [
      'What you publish (nights, photos, comments, pubs) is visible to other drinkers.',
      'No hate, no harassment, nothing sexual, no spam. I delete reported content and I can block the account.',
      'The details are in the terms of use.',
    ],
    termsLink: 'Read the terms',
    accept: 'I agree',
    acceptBusy: 'Saving…',
    later: 'Not now',
    laterHint: 'Until you agree, it stays on your phone only.',
    error: "That didn't save. Try again in a moment.",
  },

  report: {
    title: 'Write to me',
    intro: 'Something broken or something missing? Send me a few words, it helps.',
    categoryBug: 'Bug',
    categoryIdea: 'Idea',
    categoryOther: 'Other',
    messagePlaceholder: "Describe what happened or what you're missing…",
    attachmentCaption: 'Photo or screenshot (optional)',
    attachmentAdd: 'Add an attachment',
    attachmentHelper: 'One photo, I shrink it before sending.',
    attachmentReady: 'The attachment is ready',
    attachmentPrivacy: 'I send it only together with this report.',
    attachmentRemove: 'Remove the attachment',
    attachmentPreparing: 'Preparing the photo…',
    attachmentSourceTitle: 'Where will you take the photo from?',
    attachmentCamera: 'Take a photo',
    attachmentLibrary: 'Pick from the gallery',
    attachmentPermissionTitle: "This won't work without permission",
    attachmentPermissionDenied: 'Allow access to the camera or the gallery and try again.',
    attachmentPermissionBlocked: 'Access is off. Turn it on in your phone Settings.',
    attachmentOpenSettings: 'Open Settings',
    attachmentErrorTitle: "The photo didn't work",
    attachmentErrorBody: 'Try picking another photo or send it without one.',
    contactCaption: 'Where can I reply? (optional)',
    contactInstagram: 'Instagram',
    contactEmail: 'Email',
    contactInstagramPlaceholder: '@yourprofile',
    contactEmailPlaceholder: 'you@email.com',
    submit: 'Send',
    versionCaption: (version: string) => `I also send the app version: ${version}`,
    successTitle: 'Thanks!',
    successBody:
      "The message will arrive even if there's no signal right now. I send it as soon as you're online.",
    successClose: 'Close',
  },

  contribute: {
    title: 'Add info',
    unknownPub: 'Pub',
    hoursTab: 'Hours',
    beersTab: 'Beers',
    publicSubmitHint: 'Other drinkers will see this',
    hoursHeader: 'Opening hours',
    hoursOpenNow: (time: string) => `Open now · until ${time}`,
    hoursOpenNoChange: 'Open now',
    hoursClosedNow: (time: string) => `Closed now · opens at ${time}`,
    hoursClosedNoChange: 'Closed now',
    closedToggle: 'Closed',
    addInterval: 'Add a time',
    copyCurrentDayToAll: 'Use for the other days too',
    copyWeek: 'Same all week',
    daySheetTitle: (day: string) => `When is it open on ${day}?`,
    editDayA11y: (day: string, hours: string) =>
      `${day}, ${hours}. Edit the opening hours.`,
    closeSheet: 'Close',
    done: 'Done',
    from: 'From',
    to: 'To',
    days: {
      mo: 'Monday',
      tu: 'Tuesday',
      we: 'Wednesday',
      th: 'Thursday',
      fr: 'Friday',
      sa: 'Saturday',
      su: 'Sunday',
    },
    daysIn: {
      mo: 'on Monday',
      tu: 'on Tuesday',
      we: 'on Wednesday',
      th: 'on Thursday',
      fr: 'on Friday',
      sa: 'on Saturday',
      su: 'on Sunday',
    },
    daysAt: {
      mo: 'Monday',
      tu: 'Tuesday',
      we: 'Wednesday',
      th: 'Thursday',
      fr: 'Friday',
      sa: 'Saturday',
      su: 'Sunday',
    },
    daysShort: {
      mo: 'Mon',
      tu: 'Tue',
      we: 'Wed',
      th: 'Thu',
      fr: 'Fri',
      sa: 'Sat',
      su: 'Sun',
    },
    beersHeader: 'Beers on tap',
    beersEmpty: "I don't know what they have on tap here yet.",
    beersLifecycleHint: 'Leave only what is on tap now. Deleted beers stay in the history.',
    beersLifecycleHintShort: 'Leave only what is on tap now.',
    beerMenuTypeLabel: 'How do the taps work here?',
    beerMenuFixed: 'Fixed line-up',
    beerMenuFixedHint: 'Most beers stay on tap long term.',
    beerMenuRotating: 'Rotating line-up',
    beerMenuRotatingHint: 'Beers change here regularly. Take the list as a snapshot of right now.',
    historicalBeersHeader: 'Used to be here',
    historicalBeersHint: "Back on tap? Tap it and it's back.",
    historicalBeersDoor: (count: number) =>
      `${beerCountLabel(count)} used to be here`,
    beerSuggestionsLoading: 'Looking for beers…',
    addBeerSheetTitle: 'What is on tap here?',
    editBeerSheetTitle: 'Edit the beer',
    beerPriceOptional: 'Price (optional)',
    removeBeer: 'Delete the beer',
    priceMissing: 'no price',
    volumeMissing: 'no volume',
    editBeerA11y: (name: string, meta: string) =>
      `${name}, ${meta}. Edit the beer.`,
    addSmallBeer: 'Add a small one',
    addBeer: 'Add a beer',
    maxBeersNudge: 'Twelve beers is plenty.',
    invalidDayNudge: (day: string) => `The time for ${day} makes no sense.`,
    fix: 'Fix',
    fixHoursA11y: 'Fix the invalid opening hours',
    scanningNudge: 'Reading the menu…',
    scanMenuSecondary: 'Photograph the menu',
    save: 'Save',
    savedToast: 'Thanks! Got it',
    // Mapper reward for a first-time hours/beers contribution to a pub.
    xpToast: (xp: number) => `Thanks for mapping! +${xp} XP`,
    // "Photograph the menu": AI OCR helper that prefills the beer rows from a photo.
    scanMenu: {
      sheetTitle: "I'll scan the menu for you",
      sheetSubtitle: "Photograph the drinks menu and I'll read the drinks off it. Then you check them.",
      camera: 'Take a photo',
      cameraHelper: 'Point the camera at the menu',
      library: 'From the gallery',
      libraryHelper: 'Pick a photo you already have',
      cancel: 'Cancel',
      successToast: (count: number) => `Got ${beerCountLabel(count)} off the menu, take a look`,
      nothingNewToast: 'You already have these beers in the list',
      emptyToast: "I don't see any beer in the photo, get more of it in the shot or add it by hand",
      unavailableToast: "Scanning isn't working right now, add the beers by hand",
      dailyCapToast: 'The scanning limit for today is gone, try again tomorrow',
      rateLimitedToast: 'Too fast one after another, give it a moment',
      badImageToast: "I can't read this photo, try a sharper shot",
      permissionCameraDenied: "I didn't get the camera. Try again.",
      permissionLibraryDenied: "I didn't get into the gallery. Try again.",
      permissionCameraBlocked: 'The camera is off for Na pivo. Allow it in Settings and try again.',
      permissionLibraryBlocked: 'The gallery is off for Na pivo. Allow it in Settings and try again.',
      openSettings: 'Open Settings',
      permissionDenied: 'Allow the camera or the gallery in Settings and try again',
      errorToast: "The scan didn't work, try again",
    },
  },

  addPub: {
    title: 'Add a pub',
    editTitle: 'Fix the pub',
    intro:
      'Fill in the name, town and address and confirm where the pub stands. Once you send it, everyone else sees it too.',
    editIntro:
      'You can fix the name right away. To change the address, confirm a new point at the pub itself.',
    locationHeader: 'Location',
    locationBody: "Add the pub where you're standing right now. I save only this point, no route and no location history.",
    editLocationHeader: 'Location change (optional)',
    editLocationBody: 'I leave the original point alone. Confirm a new address only when the old one really is wrong.',
    useCurrentLocation: 'Use my current location',
    useCurrentLocationHint: 'It fits best right in the pub or in front of it.',
    mapPinLocationBody: 'I save the pub exactly where the pin from the map points. Only this point, no route and no location history.',
    useMapPin: 'Use the pin from the map',
    useMapPinHint: 'If the point is off, go back to the map and aim again.',
    mapPinSelectedTitle: 'The pin from the map will be used',
    editUseCurrentLocation: 'Fix the address and location',
    editUseCurrentLocationHint: 'Turn it on at the pub, then edit the town and address.',
    locating: 'Getting your location…',
    nameLabel: 'Name',
    namePlaceholder: 'e.g. The Community Arms',
    currentLocationSelectedTitle: 'Your current location will be used',
    addressLookingUp: 'Looking up the address…',
    addressLookupUnavailable: "I didn't find the address. Fill it in by hand.",
    searchingPlaces: 'Looking for places nearby…',
    noPlaceSuggestions: 'I found nothing. You can type the name by hand.',
    selectedPlace: 'Selected place',
    loadingPlace: 'Looking up the place…',
    placeLookupUnavailable: "I couldn't load this place. Try picking it again.",
    cityLabel: 'Town',
    cityPlaceholder: 'Prague',
    addressLabel: 'Address',
    addressPlaceholder: 'Street and number',
    locationError: 'Confirm the pub location first.',
    locationPermissionDenied: "Without location permission I can't place the pub. Allow it in Settings and try again.",
    locationUnavailable: "I can't see your location right now. Try outside or closer to a window.",
    retryLocation: 'Try the location again',
    save: 'Add the pub',
    editSave: 'Save the fix',
    saving: 'Saving…',
    savedToast: 'Got it, thanks!',
    queuedToast: 'The pub is waiting for a connection. I saved it on your phone.',
    failedToast: "I couldn't verify the pub. Fix the details or try again.",
    editQueuedToast: "I have the fix on your phone and I'll send it once you're online.",
    editSavedToast: 'The fix is saved.',
    myPubsTitle: 'Pubs I added',
    emptyTitle: 'None here yet.',
    emptyBody: "When a pub is missing from the compass, add it. I'll put it on the map for everyone else too.",
    syncedCaption: 'IN THE COMPASS',
    noneSyncedCaption: 'NOTHING YET',
    latestPub: (name: string) => `Last one: ${name}`,
    allSynced: 'Everything is sent.',
    listLabel: 'Your pubs',
    statusPending: 'Waiting',
    statusSynced: 'In the compass',
    statusFailed: "Didn't go through",
    pendingCount: (count: number) =>
      count === 1
        ? 'One pub is waiting to be sent'
        : `${count} pubs are waiting to be sent`,
    failedCount: (count: number) =>
      count === 1
        ? "One pub didn't go through"
        : `${count} pubs didn't go through`,
    needsFixCount: (count: number) =>
      count === 1
        ? '1 needs fixing'
        : `${count} need fixing`,
    totalCount: (count: number) => `${pubCountLabel(count)} in total`,
    retryingAll: 'Trying to send them…',
    loadFailed: "I couldn't load them right now.",
    retryAll: 'Send the failed pubs again',
    retryLoad: 'Load the added pubs again',
    retry: 'Try again',
    retrying: 'Trying…',
    edit: 'Fix the pub',
    openPubActions: (name: string) => `Open actions for ${name}`,
    addFirstCta: 'Add your first pub',
    addCta: 'Add a pub',
    addCtaHint: "Missing from the compass? I'll add it to the map for everyone else too.",
    editFromDetailHint: 'Only for a pub you added yourself',
    openMyPubs: 'Pubs I added',
    openMyPubsHint: 'Add a pub, track its status, fix details',
  },

  account: {
    // Auth screen (sign in / sign up)
    authTitle: 'Account',
    tabLogin: 'Sign in',
    tabRegister: 'Sign up',
    haveAccount: 'I already have an account.',
    noAccount: 'No account yet?',
    emailLabel: 'Email',
    emailPlaceholder: 'you@email.com',
    passwordLabel: 'Password',
    passwordPlaceholder: 'At least 8 characters',
    nicknameLabel: 'Nickname',
    termsNotePrefix: 'By continuing you agree to the ',
    termsNoteTermsLink: 'terms of use',
    termsNoteMiddle: ' and acknowledge the ',
    termsNotePrivacyLink: 'privacy policy',
    termsNoteSuffix: '.',
    nicknameSetFailedToast: "I didn't save the nickname just now, you can set it in your profile.",
    errorNicknameMissing: "Pick a nickname, without one the crew can't find you.",
    errorNicknameNotReady: "Have another look at the nickname, something's off with it.",
    submitLogin: 'Sign in',
    submitRegister: 'Create an account',
    loading: 'Working…',
    orDivider: 'or',
    continueWithApple: 'Continue with Apple',
    continueWithGoogle: 'Continue with Google',
    forgotPassword: 'Forgotten password?',

    // Inline validation
    errorEmailInvalid: 'Enter a valid email.',
    errorPasswordShort: 'The password must have at least 8 characters.',
    errorGeneric: 'Something went wrong. Try again.',
    sessionExpired:
      'Your sign-in expired. Sign in again, the beers saved on your phone stay put.',

    // Forgot password (inline)
    resetPrompt: "Enter your email and I'll send you a link and a code to reset your password.",
    resetSend: 'Send the link and code',
    resetSentToast: 'If the account exists, I sent a link and a code to reset the password.',

    // Post-register / verification
    verifyEmailSentToast: 'The verification email is on its way.',

    // Account management screen
    accountTitle: 'Account',
    accountLoadError: "I couldn't load the account right now.",
    accountRetry: 'Try again',
    emailVerified: 'Email verified',
    emailUnverified: 'Email not verified',
    emailMissing: 'No email set',
    verifyEmailRequestedToast: 'The verification email is on its way.',
    anonymousName: 'Anonymous account',
    anonymousDataNote: 'Your data is stored on this phone',
    ctaMethods: 'How you sign in',
    moreTitle: 'What else?',
    nudgeVerify: 'Your email is not verified yet.',
    nudgeVerifyCta: 'Send again',
    nudgeSingleMethod: (provider: string) => `You can only sign in with ${provider}.`,
    exportRunning: 'Getting your data ready…',

    // Sign-in methods sheet
    methodEmail: 'Email and password',
    methodGoogle: 'Google',
    methodApple: 'Apple',
    linkCta: 'Link',
    unlinkCta: 'Unlink',
    linkedLabel: 'Linked',
    methodNotLinked: 'Not linked',
    methodOnly: 'Your only sign-in, it cannot be unlinked',
    unlinkConfirmTitle: (provider: string) => `Unlink ${provider}?`,
    unlinkConfirmBody: "You'll then sign in only with the remaining methods.",
    linkedGoogleToast: 'Google is linked.',
    linkedAppleToast: 'Apple is linked.',
    unlinkedToast: 'Unlinked.',
    setPasswordCta: 'Set a password',
    setPasswordHeader: 'Set a password',
    setPasswordSave: 'Save the password',
    setPasswordToast: 'The password is set.',

    // Data export
    exportData: 'Download my data',
    exportDialogTitle: 'Export of my data',
    exportDataToast: 'The data is ready.',
    exportNetworkError:
      'The export did not download. Try again once you catch a signal.',
    exportServerError: "I can't put the export together right now. Try again in a moment.",
    exportRateLimited:
      'The export limit for today is gone. Try tomorrow.',
    exportAccountTransitionError:
      'The account is changing right now. Start the export again.',
    subscriptionTitle: 'Na Pivo+',
    subscriptionFree: 'Free',
    subscriptionPlus: 'Plus',
    subscriptionInactive: 'Inactive',
    subscriptionPending: 'Waiting for verification',
    subscriptionActive: 'Active',
    subscriptionRestore: 'Restore purchases',
    subscriptionRestoreUnavailableTitle: 'Na Pivo+ is not live yet',
    subscriptionRestoreUnavailableBody:
      "Once there's something to restore, you'll find it here.",
    reportProfile: 'Report the profile',
    reportProfileSubtitle: 'The nickname or avatar breaks the rules',

    // Sign out
    logout: 'Sign out',

    // Danger zone
    deleteAccount: 'Delete account',
    deleteConfirmTitle: 'Delete the account?',
    deleteConfirmBody:
      'I switch the account off right away. If you sign in again within 14 days, I cancel the deletion. After that I delete your profile, your private data and your contributions to pubs. Only records needed for moderation and anonymised context of shared games can stay.',
    deleteAnonymousConfirmBody:
      'I switch the anonymous account off right away. In 14 days I delete your profile, your private data and your contributions to pubs. There will be no way to restore it. Only records needed for moderation and anonymised context of shared games can stay.',
    deleteConfirmCancel: 'Cancel',
    deleteConfirmConfirm: 'Delete',
    deleteToast: "The account is off. I'll delete it in 14 days.",

    // Password reset screen (deep link)
    resetTitle: 'Password reset',
    resetCodeLabel: 'Code from the email',
    resetCodePlaceholder: 'Paste the whole code here',
    resetNewPasswordLabel: 'New password',
    resetSubmit: 'Change the password',
    resetDoneToast: 'The password is changed.',
    errorResetCodeMissing: 'Enter the code from the email.',
    resetInvalidTitle: 'Invalid link',
    resetInvalidBody: 'This password reset link is no longer valid. Ask for a new one.',
    resetInvalidCta: 'Back to the app',

    // Email verification screen (deep link)
    verifyTitle: 'Email verification',
    verifyLoading: 'Verifying the email…',
    verifySuccessTitle: 'Email verified',
    verifySuccessBody: 'Thanks! Your email is verified now.',
    verifyErrorTitle: "Verification didn't work",
    verifyErrorBody: 'The link is wrong or it has expired. Have a new one sent to you.',
    verifyInvalidBody: 'The verification code is missing. Open the link from the email again.',
    verifyDoneCta: 'Back to the app',
  },


  tabs: {
    compass: 'Compass',
    counter: 'Counter',
    myBeers: 'My beers',
    // Counter + My beers live behind one tab now, switched by a segment.
    beer: 'Regular',
    friends: 'Crew',
    profile: 'Profile',
    // 3.0 navigation (§17.1). The route names stay as they are so the Live
    // Activity deep link (napivo://beer) and every existing router.replace keep
    // working; only what the bar SAYS changes.
    feed: 'Hangovers',
    pubs: 'Pubs',
    party: 'Party',
    community: 'Community',
    /** The party tab while your own evening is running. */
    partyRunning: 'Night',
  },

  beerCheckins: {
    quickCta: 'Rate it and share with the crew',
    quickDismiss: 'Leave it',
    sheetTitle: 'Log a beer',
    beerLabel: 'Beer',
    beerPlaceholder: "What's in your glass?",
    useSuggestion: (name: string) => `Use the existing beer ${name}`,
    breweryLabel: 'Brewery',
    styleLabel: 'Style',
    optionalPlaceholder: 'Optional',
    ratingLabel: 'Rating',
    ratingA11y: (value: number) => `Rating ${value} out of 5`,
    noteLabel: 'Note',
    notePlaceholder: 'Bitterness, head, mood at the table…',
    // Fast one-tap verdict chips, max 3, replaces the need to type a note.
    tagsLabel: 'Quick verdict',
    // English labels for the fixed wire tag set (keys are the BEER_TAGS values).
    tags: {
      crisp: 'Proper bite',
      great_foam: 'Head like cream',
      smooth: 'Goes down easy',
      watery: 'Watery',
      stale: 'Stale',
      overpriced: 'Overpriced',
      one_more: 'I liked it',
      never_again: 'Never again',
    } as Record<string, string>,
    tagAddA11y: (label: string) => `Add the verdict ${label}`,
    tagRemoveA11y: (label: string) => `Remove the verdict ${label}`,
    visibilityLabel: 'Visibility',
    visibilityPrivate: 'Just for me',
    visibilityFriends: 'Crew',
    submit: 'Save the beer',
    saved: 'Beer logged. Cheers.',
    saveError: "I couldn't save the beer. Try again.",
    feedHeader: 'Crew beers',
    feedEmpty: 'Nobody in the crew has shared a beer yet.',
    detailHeader: 'Beer detail',
    detailLoadError: "I couldn't load the beer detail right now.",
    detailRetry: 'Try again',
    lastBeersHeader: 'Recent beers',
    // Memory strip on the check-in sheet. Known variant is a single low-key line
    // assembled from structured data; missing pieces just drop out.
    memoryKnownLead: 'You know this one.',
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
      const last = [lastDate ? `last on ${lastDate}` : '', lastPub ? `at ${lastPub}` : '']
        .filter(Boolean)
        .join(' ');
      if (last) parts.push(last);
      if (lastRating != null) parts.push(`${lastRating.toFixed(1).replace(/\.0$/, '')}★`);
      return parts.join(' · ');
    },
    memoryFirstTime: 'First time together. Make it count.',
    // Beer-detail relationship hero, "Drinking it since June".
    detailSinceMonth: (month: string) => `Drinking it since ${month}`,
    detailMyTagsLabel: 'My verdict',
  },

  communityEvents: {
    title: "Beers at someone's place",
    kicker: 'SMALL GATHERINGS 18+',
    intro: "Small get-togethers at people's homes nearby. You get the address once the host approves you.",
    safety: "You're going to someone's home. Tell someone close to you where you're going, arrive sober, and leave whenever something feels off.",
    nearby: 'Nearby',
    mine: 'Mine',
    create: 'Start a gathering',
    locate: 'Find gatherings nearby',
    locating: 'Looking around you…',
    noNearby: 'Nobody nearby has opened a table right now.',
    noMine: "No gatherings of your own, and none you've joined.",
    distance: {
      under_1_km: 'under 1 km',
      '1_3_km': '1-3 km',
      '3_8_km': '3-8 km',
      '8_15_km': '8-15 km',
    },
    spots: (count: number) =>
      count === 1
        ? 'last spot'
        : `${count} ${englishPlural(count, { one: 'free spot', other: 'free spots' })}`,
    host: (name: string) => `Hosted by ${name}`,
    addressHidden: 'Exact address after approval',
    addressApproved: 'Address for approved guests',
    join: 'Ask for a spot',
    joinSent: 'Your request is on its way to the host.',
    pending: 'Waiting for approval',
    approved: "You've got a spot",
    leave: 'Leave the gathering',
    cancelRequest: 'Withdraw the request',
    report: 'Report the gathering',
    reportTitle: 'Report the gathering?',
    reportCancel: 'Leave it',
    reported: "Thanks. I'll take a look.",
    cancelEvent: 'Cancel the gathering',
    cancelConfirmTitle: 'Cancel the gathering?',
    cancelConfirmBack: 'Keep it',
    cancelled: 'The gathering is cancelled.',
    statusCancelled: 'Cancelled',
    statusEnded: 'Over',
    statusLive: 'Right now',
    statusAdults: '18+',
    approve: 'Approve',
    reject: 'Decline',
    requestMessage: 'Message for the host',
    requestPlaceholder: 'Who are you and why do you want to come? (optional)',
    requests: 'REQUESTS FOR A SPOT',
    formTitle: 'Name of the gathering',
    formTitlePlaceholder: 'Beer, board games and quiet',
    description: "What's going to happen",
    descriptionPlaceholder: "Describe the night briefly. Don't put the exact address here.",
    city: 'City',
    cityPlaceholder: 'Prague',
    area: 'Neighbourhood or part of town',
    areaPlaceholder: 'Vinohrady',
    exactAddress: 'Exact address',
    exactAddressPlaceholder: 'Street, number and the doorbell if needed',
    exactAddressHint: 'I never show it in the public list. Only the people you approve get it.',
    useLocation: 'Use the location of this place',
    locationReady: 'Location saved for this gathering only',
    start: 'Start',
    today: 'Today',
    tomorrow: 'Tomorrow',
    duration: 'Length',
    durationHours: (hours: number) => `${hours} h`,
    capacity: 'Capacity including you',
    adultsConfirm: "I'm 18+ and the gathering is for adults only.",
    publish: 'Open the table',
    created: 'The table is open. The exact address stays hidden.',
    titleRequired: 'Give the gathering a name.',
    cityRequired: 'Fill in the city.',
    addressRequired: 'Fill in the exact address.',
    locationRequired: 'Confirm where the gathering is.',
    adultsRequired: 'Confirm the gathering is for adults only.',
    startPastError: 'Pick a time that is still ahead.',
    authError: 'Sign in first to use home gatherings.',
    loadError: "I couldn't load the gatherings right now.",
    actionError: "That didn't work. Try again.",
    retry: 'Try again',
    open: "Beers at someone's place",
    openHint: 'Find a small get-together nearby. Address after approval.',
    detailLoading: 'Loading the meet-up',
    detailMissing: 'I cannot find this meet-up any more.',
    detailRetryA11y: 'Try loading the meet-up again',
    hostFallback: 'Host',
    guestFallback: 'Guest',
    stepperDecrease: 'Decrease',
    stepperIncrease: 'Increase',
    attendingCount: (count: number) =>
      `${count} ${englishPlural(count, { one: 'drinker', other: 'drinkers' })}`,
    spotsLeft: (count: number) =>
      `${count} ${englishPlural(count, { one: 'spot', other: 'spots' })} left`,
    goingLine: (people: string, spots: string) => `${people} going · ${spots}`,
    busy: 'Hang on…',

    // Going or not
    hostEnded: 'Your event is over',
    hosting: 'You are hosting',
    eventEnded: 'The event is over',
    going: 'You are going',
    wantToGo: 'I want in',
    leftToast: 'Your spot is cancelled.',
    cancelAttendanceA11y: 'Cancel my spot',
    requestJoinA11y: 'Ask for a spot',
    pendingHint: 'You pick a team once the host lets you in.',

    // Join requests (host side)
    requestsHeading: 'Requests for a spot',
    approveShort: 'Yes',
    rejectShort: 'No',
    approveRequestA11y: (name: string) => `Let ${name} in`,
    rejectRequestA11y: (name: string) => `Turn down ${name}`,
    approvedToast: (name: string) => `${name} is coming with you.`,
    rejectedToast: 'Request turned down.',
    noRequests: 'Nobody is waiting.',
    capacityFull: 'The table is full. You can only turn requests down.',

    // Teams
    teamsTitle: 'Teams',
    teamsAssigned: (assigned: number, total: number) => `${assigned}/${total} on a team`,
    teamsLoadingA11y: 'Loading the teams',
    teamsLoading: 'Putting the teams together…',
    teamsEmpty: 'No team yet. Somebody has to start one.',
    unassigned: (people: string) => `No team yet: ${people}.`,
    teamOf: (members: number, capacity: number) => `${members} of ${capacity}`,
    teamMine: 'Your team',
    teamEmpty: 'Empty table so far.',
    teamJoin: 'Join',
    teamLeave: 'Leave the team',
    teamAlreadyIn: 'You are already on a team',
    teamFull: 'Team is full',
    teamJoined: (name: string) => `You are on team ${name}.`,
    teamLeft: 'You are out of the team.',
    teamCreated: (name: string) => `Team ${name} is up.`,
    teamExists: 'That team is already there.',
    teamNamePlaceholder: 'Team name',
    teamNameA11y: 'Name of the new team',
    teamCreateA11y: 'Start a team',
    teamCreating: 'Starting…',
    teamCreate: 'Start it',
  },

  photoDiary: {
    // Diary section on the profile
    header: 'BEER PHOTOS',
    title: 'Beer photos',
    empty: 'Nothing here yet. Snap your beer and start filling the album.',
    emptyTitle: 'Raise your beer, take a photo',
    emptyProfile: "You haven't snapped a single beer yet.",
    addPhoto: 'Add a photo',
    takePhoto: 'Photograph the beer',
    pickFromLibrary: 'Pick from the gallery',
    contestLink: 'Beer Snap',
    /** Link beside the profile heading, opens the whole album. */
    viewAll: 'See all',
    photoCount: (n: number) => `${n} ${englishPlural(n, { one: 'photo', other: 'photos' })}`,

    // Source sheet
    sheetTitle: 'Snap the beer',
    sheetSubtitle: 'Before the head drops. The photo goes into your diary.',
    cameraHelper: 'Shoot it right at the table',
    libraryHelper: "You already have it on your phone",

    // Compose sheet
    composeTitle: 'Into the diary',
    captionLabel: 'Caption',
    captionPlaceholder: 'What beer was it, and what kind of night?',
    pubLabel: 'Pub',
    pubNone: 'No pub',
    pubNoneNearby: "I didn't find a pub nearby.",
    visibilityLabel: 'Visibility',
    visibilityPrivate: 'Just for me',
    visibilityFriends: 'Crew',
    addToContest: 'Send it straight to Beer Snap',
    addToContestHint: 'Everyone sees it in the contest. It stays in your diary too.',
    save: 'Save to the diary',
    saveAndEnterContest: 'Save and enter',
    saved: 'The photo is in the album. Cheers.',
    savedForContest: 'The photo is in your diary and on its way to the contest.',
    contestEntryFailed: "The photo is saved, but it didn't make it into the contest. Try again from its detail.",
    errorPick: "I couldn't load the photo. Try again.",
    errorSave: "I couldn't save the photo. Try again.",

    // Sync states on a diary tile
    pendingBadge: 'Waiting to upload',
    failedBadge: "Didn't upload",
    syncPendingShort: 'Uploading',
    syncFailedShort: 'Not uploaded',
    retryUpload: 'Try again',
    retryQueuedToast: "Got it. I'll try the upload again.",

    // Photo detail
    detailTitle: 'Beer photo',
    detailMissing: 'This photo is gone.',
    viewerLoadError: "I couldn't load the photo.",
    viewerRetry: 'Try again',
    enterContestCta: 'Enter the contest',
    enterContestHint: 'Once a photo is uploaded, you can send it to the Beer Snap contest.',
    inContestNote: 'This photo is fighting for Beer Snap right now.',
    openContest: 'Open the contest',
    syncBeforeContest: 'It can enter the contest once it uploads.',

    // Delete flow
    deleteConfirmTitle: 'Delete the photo?',
    deleteConfirmBody: "It goes from the album and the contest. I can't undo that.",
    deleteConfirm: 'Delete',
    deleteCancel: 'Keep it',
    deletedToast: "The photo is hidden. It leaves the server as soon as you're online.",
    deleteError: "I didn't delete the photo. Try again.",

    // Failed-upload messages (codes off POST /v1/beer-photos, persisted by
    // the queue as `failureCode` and surfaced on the photo detail)
    errorLimitReached: 'The album is full. Delete an older photo and try again.',
    errorTooLarge: 'This photo is too big. Try another one.',
    errorInvalid: "I can't read this as a beer photo. Try another one.",

    // Permissions (mirrors profile.setup wording)
    permissionCameraBody: "I didn't get the camera. Try again and allow it.",
    permissionLibraryBody: "I couldn't get to your photos. Try again and allow the gallery.",
    permissionBlockedBody: 'Access is blocked. Allow it in system Settings and try again.',
    openSettings: 'Open Settings',

    // Friend gallery (section hides entirely when empty)
    friendHeader: (name: string) => `Beer photos · ${name}`,

    // Counter (Regular) capture pill
    counterCta: 'Camera: beer or menu',
  },

  partaPhotos: {
    // Fresh Crew photo strip on the crew tab (hides entirely when empty)
    header: 'FRESHLY SNAPPED',
    you: 'You',
  },

  photoContest: {
    // Contest screen
    title: 'Beer Snap',
    subtitle: 'A contest for the best beer photo. New round every 14 days.',
    noContest: "Nothing running right now. Go have one in the meantime.",
    emptyEntries: 'Not a single photo here yet. Be the first.',

    // Countdown
    endsInDays: (n: number) => (n === 1 ? 'Ends tomorrow' : `Ends in ${n} days`),
    endsToday: 'Last day! The votes get counted tonight.',
    ended: 'The round is over. Counting the votes.',

    // My entry
    myEntryHeader: 'YOUR PHOTO IN THIS ROUND',
    entriesHeader: "WHO'S COMPETING",
    enterCta: 'Enter a photo',
    enterCardTitle: 'Snap or pick a photo',
    enterCardHint: 'You can take a new one right here. It saves into your diary too.',
    takePhotoCta: 'Take a contest photo',
    pickFromDiary: 'OR PICK FROM THE DIARY',
    enterNoPhotos: 'No uploaded photo in the diary yet.',
    goToDiary: 'To the diary',
    enterConfirmTitle: 'Enter this photo?',
    enterConfirmBody: 'Anyone who opens the contest sees it. One photo per round.',
    withdrawCta: 'Withdraw from the contest',
    withdrawConfirmTitle: 'Withdraw the photo from the contest?',
    withdrawConfirmBody: "You lose the votes it collected. I can't give them back.",
    enteredToast: 'The photo is in the contest. Good luck.',
    withdrawnToast: 'The photo is out of the contest.',
    myEntryBadge: 'Your photo',

    // Reporting an entry
    entryActionsTitle: (name: string) => `Photo by ${name}`,
    openPhotoAction: 'Open the photo',
    openProfileAction: 'Have a look at the profile',
    reportAction: 'Report the photo',
    reportConfirmTitle: 'Report this photo?',
    reportConfirmBody: "It goes off for review. Thanks for watching the taproom.",
    reportedToast: "Reported. I'll take a look.",

    // Results celebration (top 3, shown once per round)
    resultsEyebrow: 'ROUND RESULTS',
    resultsTitleFirst: 'The golden beer mat is yours!',
    resultsTitleSecond: 'Second place!',
    resultsTitleThird: 'Third place!',
    resultsBodyFirst: 'Your photo won the whole round. Hats off, glasses up.',
    resultsBodySecond: 'Silver on the podium. A few votes short of the golden beer mat.',
    resultsBodyThird: 'Bronze on the podium. Next time it clinks higher.',
    resultsStatVotes: 'Votes',
    resultsStatXp: 'XP',
    resultsStatWins: 'Wins',
    resultsCta: 'Open the contest',
    resultsClose: 'Close',

    // Reigning winner strip (next round)
    reigningTitle: 'Reigning Beer Snap',

    // Crew teaser strip
    teaserFallbackSubtitle: 'A contest for the best beer photo every 14 days',
    teaserEmptySubtitle: 'A new round is on and waiting for the first photo',
    teaserResultsSubtitle: 'The round is over and the results are out',
    teaserResultsPodiumSubtitle: "You're on the podium! Have a look at the results",
    teaserVoteSubtitle: (n: number) =>
      n === 1
        ? '1 photo in this round is waiting for your vote'
        : `${n} photos in this round are waiting for your vote`,
    teaserVotedSubtitle: 'Your vote is in, now watch the finish',
    teaserMyEntrySubtitle: (votes: string) => `Your photo is holding ${votes}`,

    // Loading / error
    loadError: "I couldn't load the contest right now. Try again.",
    retry: 'Try again',

    // Voting
    votesCount: (n: number) => `${n} ${englishPlural(n, { one: 'vote', other: 'votes' })}`,

    // Winners (last round)
    winnersHeader: 'LAST ROUND',
    winnerRank: (n: number) => `${n}${n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'} place`,
    winnerBadgeNote: 'The winner wears the Beer Snap badge.',

    // Errors (codes off the contest endpoints)
    errorCannotVoteOwn: "You can't vote for your own photo. Nice try.",
    errorNicknameRequired: 'You need a nickname for the contest. Set one in your profile.',
    errorVote: "The vote didn't count. Try again.",
    errorEnter: "I couldn't get the photo into the contest. Try again.",
    errorGeneric: 'Something went wrong. Try again.',
  },


  friends: {
    title: 'Crew',
    hubTitle: 'Crew',
    peopleTitle: 'Crew',
    addPeopleTitle: 'Add to the crew',
    // "Who you drink with" (replaced the requests and outgoing invites sections)
    togetherHeader: 'Who you drink with',
    togetherEmpty: 'Nobody yet. Anyone you sit down with shows up here.',
    lastSeenTogether: (when: string) => `last time ${when}`,
    // Backend counts shared pub+day pairs, so this is nights, never beers.
    sharedEvenings: (n: number) =>
      n === 0
        ? 'no nights out together yet'
        : `${n} ${englishPlural(n, { one: 'night', other: 'nights' })} out together`,
    notTogetherYet: "you haven't sat down together yet",
    addPersonCta: 'Add someone',
    // one-way following
    followingHeader: 'Following',
    followingLastDrink: (beer: string) => `had a ${beer}`,
    followingQuiet: 'nothing new yet',
    follow: 'Follow',
    unfollow: 'Unfollow',
    followed: "You'll see what they drink.",
    unfollowed: 'Not following any more.',
    followError: "Couldn't follow. Try again.",
    requestsSummary: (n: number) => {
      if (n === 0) return 'No new requests';
      if (n === 1) return '1 request waiting';
      return `${n} requests waiting`;
    },
    requestsEmpty: 'Nobody new is waiting.',
    outgoingEmpty: 'No invite is waiting to be accepted.',
    plansEmpty: 'Nothing on for tonight yet.',
    heroTitle: "Who's up for a beer today?",
    heroBody:
      'Add mates with a code or an invite. Then you can see who is sitting in a pub right now.',
    firstRunOffline: "Quiet for now. I'll load it once you get a signal.",
    refresh: 'Refresh',
    searchPlaceholder: "Mate's nickname",
    searchCta: 'Find',
    addByNickname: 'Invite',
    emptyFriends: "You're drinking solo so far. Find a nickname and send the first invite.",
    emptyActive: 'Nobody from the crew is in a pub right now.',
    activeHeader: 'In a pub now',
    requestsHeader: 'Waiting for you',
    addHeader: 'Add to the crew',
    friendsHeader: 'Mates',
    feedHeader: 'Pings from the crew',
    outgoingHeader: 'Sent invites',
    accept: 'Accept',
    decline: 'Leave it',
    remove: 'Remove',
    removeTitle: 'Remove this mate?',
    removeBody: (name: string) => `${name} stops seeing your pub pings and drops out of the crew.`,
    removeConfirm: 'Remove',
    requestSent: 'Invite is on its way to the table.',
    requestAccepted: 'In the crew.',
    requestDeclined: 'Invite is gone.',
    requestActionError: "Couldn't handle the request. Try again.",
    friendRemoved: 'Not in the crew any more.',
    // One-tap quick broadcast from the counter (rich compose lives on Crew).
    shareHereShort: 'Ping the crew',
    // "signal" is reserved for connectivity; the broadcast is a "ping".
    shareSuccess: 'Pinged!',
    shareError: "Couldn't tell the crew.",
    queueSaveError: "Couldn't save the action. Try again.",
    // Counter "already broadcasting" state once I'm live (drops the re-broadcast).
    counterAlreadyLive: "You're already live",
    sharedCount: (n: number) =>
      n === 0 ? 'No beers together yet' : `${beerCountLabel(n)} together`,
    lastTogether: (pub: string) => `Last time together: ${pub}`,
    // Solo, genderless rewrite (retired the corporate "we").
    noResults: 'Nobody like that here. Try another nickname or send an invite link.',
    // Snapshot-aware: the screen now renders the last-known graph behind this.
    offline: "Couldn't load the crew. Showing the last thing I know.",
    retry: 'Try again',

    // RSVP loop (I'm in / Maybe / Not today)
    rsvpGoing: "I'm in",
    rsvpMaybe: 'Maybe',
    rsvpCant: 'Not today',
    rsvpError: "Couldn't send it. Try again.",
    rsvpClearedToast: 'Answer cleared.',
    rsvpQueued: "I'll tell the crew once you get a signal.",
    // Roster count word only; the numeral renders separately in amber.
    goingLabel: (n: number) => (n === 1 ? 'is in' : 'are in'),
    // Secondary "2 maybe · 1 not today" line; skips zero buckets, '' when both 0.
    maybeCantLine: (maybe: number, cant: number) => {
      const parts: string[] = [];
      if (maybe > 0) parts.push(`${maybe} maybe`);
      if (cant > 0) parts.push(`${cant} not today`);
      return parts.join(' · ');
    },
    rosterEmpty: 'Nobody has said yes yet.',

    // My active activity card ("You're live")
    // Present tense keeps it genderless.
    myActiveTitle: "You're live",
    nobodyYet: 'Waiting for the first yes.',
    whoComing: "Who's coming?",
    // "Wrap up" = pub slang for calling it a night; one verb family across
    // button → confirm → toast (a11y label stays descriptive).
    endActivity: 'Wrap it up',
    endActivityA11y: 'End the ping',
    endActivityConfirmTitle: 'Wrap it up?',
    endActivityConfirmBody: 'The crew stops seeing that you are out for a beer.',
    endActivityConfirmConfirm: 'Wrap up',
    endedToast: 'Glass empty.',
    // Offline end: the DELETE is queued and lands on the next flush (§H4).
    endQueued: "I'll wrap it up once you get a signal.",

    // Crew streak
    streakWeeks: (n: number) =>
      `${n} ${englishPlural(n, { one: 'week', other: 'weeks' })} in a row`,
    streakThisWeek: 'This week is already lit. Keep it going.',
    streakDead: 'The streak dropped. Light it again with a beer with the crew.',
    streakEmpty: 'No streak',

    // Crew leaderboard
    leaderboardHeader: 'Crew leaderboard · 30 days',
    // Nouns only; the numeral renders separately.
    leaderboardVisits: (n: number) => englishPlural(n, { one: 'visit', other: 'visits' }),
    leaderboardBeers: (n: number) => beerNoun(n),
    leaderboardMetricBeers: 'Beers',
    leaderboardMetricVisits: 'Visits',
    leaderboardMe: 'You',
    leaderboardEmpty: 'Nobody to race yet. Add some mates.',
    leaderboardMore: (n: number) => `+${n} more`,

    // Social settings sheet (invisible mode + quiet at night)
    settingsOpen: 'Open crew settings',
    settingsTitle: 'Crew settings',
    settingsClose: 'Close settings',
    ghostTitle: 'Invisible mode',
    ghostSubtitle:
      'The crew cannot see where you are sitting or what you have drunk. Your pings stay with you.',
    shareDrinksTitle: 'Show the crew where I am',
    shareDrinksSubtitle:
      "Your mates see which pub you're in and what you've had tonight. Nobody else does.",
    ghostActive: 'Invisible mode is on',
    ghostChip: 'Hidden',
    quietTitle: 'Quiet at night',
    quietSubtitle: 'No pings reach you at night.',
    quietRange: (a: number, b: number) =>
      `From ${String(a).padStart(2, '0')}:00 to ${String(b).padStart(2, '0')}:00`,
    hourStepperDecrement: 'an hour back',
    hourStepperIncrement: 'an hour forward',
    settingsSaved: 'Saved.',
    settingsError: "Couldn't save the settings.",

    // Hero sub-line variants (priority order in the screen)
    heroLiveMine: (n: number) => `Already ${n} at your table. Get a round in.`,
    // I'm broadcasting but nobody RSVP'd yet, so heroQuiet would contradict it.
    // Wording must not echo the "YOU'RE LIVE" card kicker right below it.
    heroLiveSolo: 'The crew knows about you. Now someone has to say yes.',
    heroStreakRisk: 'The streak is hanging by a thread, nobody has lit it this week.',
    heroFriendLive: (name: string) => `${name} is out in a pub. Coming?`,
    heroManyLive: (n: number) => `${n} from the crew are sitting somewhere. Who's joining?`,
    heroQuiet: 'Quiet in the crew. Someone has to ping first.',

    // Hero pulse panel
    pulseQuietLabel: 'All quiet',
    pulseLiveLabel: 'Sitting right now',
    pulseMineLabel: "You're live",
    pulseQuietTitle: 'Throw the first ping',
    pulseQuietBody: 'Sitting at a table? Ping the crew and let your mates say yes.',
    pulseLiveBody: 'Someone is already holding a table. Tell the crew if you are coming too.',
    pulseMineBody: 'The ping is out. Now you wait for someone to say yes.',
    pulseJoinCta: 'Ping too',
    pulseFriendCount: (n: number) =>
      `${n} ${englishPlural(n, { one: 'mate', other: 'mates' })}`,

    // Beer mat rebuild: one table card, one amber button, the rest behind "…"

    /** Header chip when you have nobody yet. */
    soloChip: 'Solo so far',
    /** Wide caption under the big numeral on the table card. */
    tableCaption: 'OUT FOR A BEER TODAY',
    tableCaptionQuiet: 'ALL QUIET',
    /** Amber door in the card footer. */
    tableLink: "Who's going",
    /** Quiet fact when no streak is running. */
    noStreak: 'No streak',
    /** Quiet fact while the invisible mode hides you from the leaderboard. */
    hiddenRank: 'Under the radar',

    // The one button, by state
    ctaPing: 'Ping the crew',
    ctaPingToo: 'Ping too',
    ctaWhoIsComing: "Who's coming?",
    ctaAddFriend: 'Add a mate',
    ctaSignIn: 'Sign in',
    ctaNickname: 'Add a nickname',
    /** Behind the "…" door, because the footer holds one button only. */
    secondaryAddFriend: 'Add a mate',

    // Doors in the card footer: three surfaces, always visible
    railVycep: 'Taproom',
    railLeaderboards: 'Leaderboards',
    railPhotoContest: 'Beer Snap',

    // "Something to do together": the two other evening formats, on the surface
    planHeader: 'Something to do together',
    planHomePartyTitle: "Beer at someone's place",
    planHomePartyBody: 'A small get-together nearby.',

    // "What else?" rows
    moreTitle: 'What else?',
    moreSettings: 'Crew settings',
    moreMyCode: 'My code',
    moreWholeParty: 'The whole crew',

    // Nudge slot: at most one
    nudgeRequest: (name: string) => `${name} wants to join the crew`,
    nudgeRequestAccept: 'Accept',
    nudgeOffline: 'Showing the last thing I know.',
    nudgeOfflineRetry: 'Try again',
    // "Someone is holding a table" is no longer a nudge: "Who's sitting where"
    // sits right under the card with that friend's own card and its RSVP in it,
    // so the strip was repeating the card a thumb-width below it (§0.3).
    nudgeBroadcasting: 'The ping is out.',
    nudgeBroadcastEnd: 'Wrap it up',
    nudgePush: "I'll ping you when someone sits down.",
    nudgePushEnable: 'Turn on',
    nudgeContest: 'The results of the round are out.',
    nudgeContestOpen: 'Take a look',
    streakRiskFact: 'Not lit yet this week',

    // Who's sitting where: live presence derived from the counter, no ping needed
    presenceHeader: "Who's sitting where",
    presenceMe: 'You',
    presenceSomewhere: 'Out for a beer somewhere',
    presenceBeers: (n: number) => beerCountLabel(n),
    presenceHiddenNote: "You're in invisible mode, so the crew cannot see you at the table.",
    presenceEmpty: 'Nobody from the crew is sitting anywhere right now.',
    /**
     * The card headline. Deliberately without the pub: the row right below the
     * card names the pub anyway. Third person keeps it genderless.
     */
    headlineSitting: (name: string, others: number) => {
      if (others <= 0) return `${name} is out for a beer.`;
      if (others === 1) return `${name} and one more are out for a beer.`;
      return `${name} and ${others} others are out for a beer.`;
    },
    /** Card caption when the number counts people actually sitting somewhere. */
    tableCaptionSitting: 'SITTING IN A PUB',
    /**
     * The shared table, detected instead of declared. Same constraints as
     * headlineSitting: no pub name in the headline, and the verb stays third
     * person so nothing is gendered.
     */
    headlineTogether: (name: string, others: number) => {
      if (others <= 0) return `${name} is at the table with you.`;
      if (others === 1) return `${name} and one more are at the table with you.`;
      return `${name} and ${others} others are at the table with you.`;
    },
    /** Quiet marker on the presence rows that are sitting where I am. */
    presenceSameTable: 'at your table',

    // The automatic evening feed, no hanging-up required.
    //   Deliberately NOT called "Taproom": that name already belongs to the
    //   screen behind the rail door, where you hang a night up on purpose. Two
    //   different things under one name is the confusion this rebuild is
    //   supposed to be removing, not adding.
    sittingsHeader: 'What people drank',
    sittingsEmpty: 'Nobody has drunk anything yet. When that changes, you find out here.',
    sittingsMore: 'Load older',
    sittingsLoading: 'Loading…',
    /** Inline rating on a sitting row: "4.0/5 · Pilsner Urquell". */
    sittingRating: (rating: number, beer: string) =>
      `${rating.toFixed(1)}/5${beer ? ` · ${beer}` : ''}`,

    // The one feed under the card
    streamHeader: "What's going on",
    streamEmpty: 'Quiet so far. Ping the crew and get it going.',

    // ── Crew 3.0 ───────────────────────────────────────────────────────────

    // "WHAT TO EXPECT" cold-start teaser (§J)
    whatIsPartaHeader: 'What to expect',
    whatIsParta1: 'Going for a beer? Ping and the crew knows right away.',
    whatIsParta2: 'Your mates say whether they are coming.',
    whatIsParta3: 'Nights out together hold the streak and move you up the leaderboard.',

    // Growth block "GET A CREW TOGETHER" (§A1)
    growthHeader: 'Get a crew together',
    myCodeCta: 'Show my code',
    scanCta: 'Scan a code',
    inviteShareCta: 'Send an invite',

    // Identity gate (§A2)
    coldStartAnonTitle: 'Join the crew',
    coldStartAnonBody:
      'Sign in or create an account. Then your mates can find you by nickname.',
    coldStartAnonCta: 'Sign in',
    coldStartSetupTitle: 'What should the crew call you?',
    coldStartSetupBody: 'Add a nickname so your mates can find you.',
    coldStartSetupCta: 'Add a nickname',

    // CodeSheet "My code" / QR / invite (§A3)
    codeSheetTitle: 'My code',
    codeSheetHint: 'Show a mate the QR code or send them an invite link.',
    codeShare: 'Share the invite',
    codeCopy: 'Send the link',
    codeCopied: 'Link is ready.',
    codeScan: 'Add a mate',
    codeNoNick: 'Add a nickname so people recognise you.',
    codeNoNickCta: 'Add one',
    codeOffline: 'You get the code once you have a signal.',
    shareMessage: (link: string) =>
      `Add me on Na pivo so you know when I'm going for a beer: ${link}`,

    // Deep-link claim (§A5)
    claimTitle: (name: string) => `${name} is inviting you to the crew`,
    claimBody: "Joining? You'll see which of you is out for a beer.",
    claimCta: 'Add to the crew',
    claimDone: 'Done, waiting to be accepted.',
    claimExpired: 'This invite has expired. Ask your mate for a new one.',
    claimInvalid: "I don't know this invite.",
    claimLoading: 'Loading the invite…',
    claimSelf: "That's your own code.",
    claimBack: 'Back',

    // Compose "Ping the crew" (§B)
    // Infinitive like every other button in the app ("Accept", "Turn on…").
    composeOpen: 'Ping the crew',
    composeTitle: 'Ping the crew',
    planComposeTitle: 'Set up a beer',
    composeAudienceLabel: 'WHO TO',
    recipientAll: 'The whole crew',
    recipientCustom: 'Pick',
    recipientAllSummary: (n: number) =>
      n === 0
        ? 'The ping goes to the whole crew.'
        : `The ping goes to ${n} ${englishPlural(n, { one: 'mate', other: 'mates' })}.`,
    recipientCustomSummary: (n: number) =>
      n === 0
        ? 'Pick who you want to drag out for a beer.'
        : `${n} ${englishPlural(n, { one: 'mate', other: 'mates' })} picked.`,
    recipientNoFriends: 'Add some mates to the crew first.',
    recipientNoSelection: 'Pick who gets the ping.',
    recipientGroupPlaceholder: 'Group name',
    recipientGroupSave: 'Save',
    recipientGroupSaved: 'Group saved.',
    recipientGroupSaveHint: 'Pick your mates and name the group.',
    composePubLabel: 'WHERE',
    composeNearby: 'Nearby',
    composeRecent: 'Recent',
    composeNoNearby: 'Nothing nearby. Try recent ones or search.',
    composeNoRecent: 'No recent pubs yet.',
    composeLocPermCta: 'Turn on location',
    composeTimeLabel: 'WHEN',
    composeNow: 'Now',
    composeLater: 'Later',
    composeMsgLabel: 'MESSAGE (OPTIONAL)',
    composeMsgPlaceholder: "I'm holding a table. Joining?",
    composeSubmitNow: 'Ping',
    composeSubmitPlan: 'Plan it',
    composeNoPub: 'Pick a pub',
    composeQueued: "Saved. I'll ping the crew once you get a signal.",
    composeMeters: (m: number) => `${m} m`,

    // Plans (§B3)
    plansHeader: 'Plan for today',
    planMineTitle: 'Your plan',
    planAt: (t: string) => `Today at ${t}`,
    planCreated: "The plan is off to the crew. If reminders are running, I'll ping you in the afternoon too.",
    planCancel: 'Cancel the plan',
    planCancelConfirmTitle: 'Cancel the plan?',
    planCancelConfirmBody: "The crew will see that you're not going anywhere today after all.",
    planCanceled: 'Plan cancelled.',
    planCancelQueued: "I'll cancel the plan once you get a signal.",

    // Reactions "Cheers" (§C)
    cheers: 'Cheers',
    cheersA11y: (name: string) => `Raise a glass to ${name}`,
    cheersCount: (n: number) => `${n}× cheers`,
    cheersDone: 'Clink! Cheers.',
    cheersUndone: 'Cheers taken back.',
    reactQueued: "You're offline. I'll raise the glass once there's a signal.",
    reactError: "Couldn't send the cheers. Try again.",

    // Offline / stale cues (§H)
    staleNote: 'old data',

    // Cancel outgoing invite (§F5)
    cancelInviteTitle: 'Cancel the invite?',
    cancelInviteConfirm: 'Cancel the invite',
    inviteCanceled: 'Invite cancelled.',

    // Push opt-in strip + toggle (§E)
    pushPromptTitle: "Don't miss the night",
    pushPromptBody: "I'll let you know when the crew heads out or someone invites you.",
    pushPromptCta: 'Turn on notifications',
    pushPromptDismiss: 'Not now',
    pushEnabledToast: "Right, I'll let you know.",
    pushDeniedHint: 'Notifications are switched off in your system settings.',
    pushDeniedCta: 'Turn on',
    pushToggleTitle: 'Crew notifications',
    pushToggleSub: "Pings, invites and who's out for a beer.",
    pushDisableError: "Couldn't turn it off. Try again.",

    // Compass handoff (§F2)
    showOnCompass: 'Show on the compass',
    // The compass "pointing at a friend" banner + escape hatch.
    friendCompassKicker: 'HEADING TO THE CREW',
    friendCompassBack: 'Back to the nearest',

    // Friend profile (§F1)
    statSharedBeers: 'beers together',
    statNightsTogether: 'nights together',
    statRitualsTogether: 'milestones together',
    statStreakTogether: 'weeks in a row',
    profileNoHistory: "You haven't been anywhere together yet. So ping them.",
    profileRecentHeader: 'LAST TIME TOGETHER',
    profileRemove: 'Remove from the crew',
    profileActionsA11y: 'More options',
    profileError: "Couldn't load the profile. Try again in a bit.",

    // Safety: block / report (§G)
    blockTitle: (name: string) => `Block ${name}?`,
    blockBody: 'You disappear from their crew, they cannot see you and cannot invite you.',
    blockConfirm: 'Block',
    blockAction: 'Block',
    blocked: 'Blocked.',
    unblockAction: 'Unblock',
    unblocked: 'Unblocked.',
    profileBlocked: 'This profile is blocked.',
    reportAction: 'Report',
    reportDone: "Thanks, I'll look into it.",
    // Row long-press action sheet title.
    rowActionsTitle: 'What now?',

    // Public (non-friend) profile via /parta/<id>, reached from Leaderboards
    addToParty: 'Add to the crew',
    requestSentToast: 'Request is on its way. Now they have to say yes.',
    requestPendingStrip: 'Crew request is waiting to be accepted.',
    acceptRequest: 'Accept into the crew',
    requestAcceptedToast: 'And they are in the crew.',
    publicStatBeers: (n: number) => `${beerNoun(n)} in the diary`,
    publicStatPubs: (n: number) => englishPlural(n, { one: 'pub', other: 'pubs' }),
    publicStatMapper: 'Mapper level',
    showcaseHeader: 'Badge cabinet',

    // Crew management (Profile → /profile/parta)
    manageTitle: 'Manage the crew',
    // Footer cross-link on Crew → the management screen.
    manageLink: 'The whole crew and invites',
    // Management → Crew cross-link when incoming requests are waiting.
    manageIncomingLink: (n: number) =>
      n === 1
        ? '1 mate is waiting for you in the crew'
        : `${n} mates are waiting for you in the crew`,
    fallbackName: 'Mate',
    pubFallback: 'Pub',
  },


  // Global leaderboards, /leaderboards. Countrywide boards over logged beers,
  // discovered pubs and Mapper XP. Copy measures diary activity (logged beers,
  // pubs found), never litres, no chug-contest energy.
  leaderboards: {
    back: 'Back',
    // The screen owns three boards over three windows, so both switches sit on
    // the screen: a segmented track for the board and a quiet text row for the
    // window. Nothing here hides behind a "…" sheet.
    screenTitle: 'Leaderboards',
    categoryTab: (category: 'beers' | 'pubs' | 'mapper') =>
      category === 'beers' ? 'Drinkers' : category === 'pubs' ? 'Explorers' : 'Mappers',
    periodTab: (period: 'week' | 'year' | 'all') =>
      period === 'week' ? 'Week' : period === 'year' ? 'This year' : 'All time',
    // Mapper XP never resets, so the window row has nothing to switch. It says
    // so instead of showing three chips where two would do nothing.
    mapperPeriodNote: 'Counted since day one',
    selectCategory: (label: string, selected: boolean) =>
      selected ? `${label}, selected` : `Switch to ${label}`,
    selectPeriod: (label: string, selected: boolean) =>
      selected ? `${label}, selected` : `Switch to ${label}`,
    tableTitle: (
      category: 'beers' | 'pubs' | 'mapper',
      period: 'week' | 'year' | 'all',
    ) => {
      if (category === 'mapper') return 'Mappers · all time';
      const categoryLabel = category === 'beers' ? 'Drinkers' : 'Explorers';
      const periodLabel =
        period === 'week' ? 'this week' : period === 'year' ? 'this year' : 'all time';
      return `${categoryLabel} · ${periodLabel}`;
    },
    // Quiet eyebrow inside the hero card names what the board measures.
    subtitle: (category: 'beers' | 'pubs' | 'mapper', period: 'week' | 'year' | 'all') => {
      if (category === 'beers') {
        return period === 'week'
          ? 'Who logged the most beers this week.'
          : period === 'year'
            ? 'Who logged the most beers this year.'
            : 'Hall of fame. Every beer ever logged.';
      }
      if (category === 'pubs') {
        return period === 'week'
          ? 'Who went through the most pubs this week.'
          : period === 'year'
            ? 'Who found the most pubs this year.'
            : 'Who knows the most pubs of all.';
      }
      return 'Who mapped the most for everyone else.';
    },

    // Score units (noun only; the numeral renders separately)
    unitBeers: (n: number) => beerNoun(n),
    unitPubs: (n: number) => englishPlural(n, { one: 'pub', other: 'pubs' }),
    unitXp: 'XP',
    score: (category: 'beers' | 'pubs' | 'mapper', label: string, n: number) => {
      if (category === 'mapper') return `${label} XP`;
      const unit =
        category === 'beers' ? beerNoun(n) : englishPlural(n, { one: 'pub', other: 'pubs' });
      return `${label} ${unit}`;
    },

    // Rows
    rowMe: 'You',
    rowFriend: 'in your crew',
    rowFallbackName: 'Drinker',

    // No standing yet
    // Without a rank there is no numeral and no podium to draw, so the card
    // says what is missing instead of drawing a placeholder for it.
    emptyBoardTitle: 'The board is empty',
    emptyBoardBody: (category: 'beers' | 'pubs' | 'mapper') =>
      category === 'beers'
        ? 'Quiet as a pub before opening. Log one beer and first place is yours.'
        : category === 'pubs'
          ? 'Quiet as a pub before opening. One new pub and first place is yours.'
          : 'Quiet as a pub before opening. One detail added and first place is yours.',
    errorTitle: "I couldn't load the board",
    errorBody: 'The server might be pouring one. Try again in a bit.',
    notRankedTitle: "You're not on the board yet",
    notRankedBody: (category: 'beers' | 'pubs' | 'mapper') =>
      category === 'beers'
        ? "Log a beer and you're in with the rest."
        : category === 'pubs'
          ? "Log a beer at a new pub and you're in with the rest."
          : "Add what you know about your pub and you're in with the rest.",
    weeklyReset: 'New race on Monday',
    blankA11y: (table: string, title: string, body: string) => `${table}. ${title}. ${body}`,
    // The rules of the race. They only show while the card has no rank to draw,
    // where they turn empty space into the one thing a newcomer actually needs.
    rulesCaption: 'HOW IT IS COUNTED',
    rules: (
      category: 'beers' | 'pubs' | 'mapper',
      period: 'week' | 'year' | 'all',
      hasNickname: boolean,
    ) => [
      category === 'beers'
        ? 'Every logged beer is a tally mark.'
        : category === 'pubs'
          ? 'Every new pub is a point.'
          : 'Every detail you add is XP.',
      category === 'mapper'
        ? 'Counted since day one, nothing gets wiped.'
        : period === 'week'
          ? 'The board resets on Monday and starts over.'
          : period === 'year'
            ? 'Everything counts from New Year.'
            : 'Hall of fame. Nothing gets wiped.',
      hasNickname
        ? "You're on the board under your nickname."
        : 'Without a nickname nobody sees you on the board.',
    ],

    // My standing
    rankNoun: 'PLACE',
    noScore: 'No tally marks yet',
    totalInBoard: (count: string | null) => `of ${count ?? '-'} on the board`,
    listLabel: 'Who is ahead',
    heroA11y: (table: string, rank: string, score: string, total: number | null) =>
      `${table}. Rank by score ${rank}. ${score}. There are ${total ?? 0} on the board.`,
    chase: (category: 'beers' | 'pubs' | 'mapper', gap: number) => {
      const unit =
        category === 'beers'
          ? beerNoun(gap)
          : category === 'pubs'
            ? englishPlural(gap, { one: 'pub', other: 'pubs' })
            : 'XP';
      return `You're ${gap} ${unit} short of the board.`;
    },

    // Primary CTA
    // No sub-labels here: the label already says what one tap does, and the
    // second line only repeated it in a quieter voice.
    ghostCta: 'Show yourself',
    ghostAnonCta: 'Pick a nickname',
    ghostNudge: 'Without a nickname nobody sees you',
    ctaBeers: 'Add a tally mark',
    ctaPubs: 'Find a new pub',
    ctaMapper: 'Map the pub',
    retry: 'Try again',

    // Entry points
    entryProfileTitle: 'Leaderboards',
    entryProfileSubtitle: 'Where you stand among drinkers across the country',

    // Rank teaser (Crew hero). The entry point carries data, not a bare link:
    // "This week you are the 47th drinker in the country". Title renders in
    // three parts so the rank can sit in amber. Genderless throughout.
    teaserTitleBefore: "This week you're the ",
    teaserTitleRank: (rank: number) => {
      const tens = rank % 100;
      const ones = rank % 10;
      const suffix =
        tens >= 11 && tens <= 13
          ? 'th'
          : ones === 1
            ? 'st'
            : ones === 2
              ? 'nd'
              : ones === 3
                ? 'rd'
                : 'th';
      return `${rank}${suffix} drinker`;
    },
    teaserTitleAfter: ' in the country',
    teaserFallbackTitle: 'Leaderboards',
    teaserFallbackSubtitle:
      'See how you stack up against drinkers across the country. On Monday it starts again.',
    teaserGhostSubtitle: "You're a ghost right now, nobody sees you on the board",
    teaserTopSubtitle: "You're holding a top 10 spot · new race from Monday",
    teaserResetNote: 'New race every Monday',
    teaserChase: (gap: number) => {
      const unit = beerNoun(gap);
      return `You're ${gap} ${unit} short of the top 10`;
    },

    // Counter chip + post-log rank moment
    // Rendered as `${rank}.` + this suffix (the numeral sits in amber).
    chipLabelSuffix: ' in the country this week',
    rankUpToast: (rank: number) => {
      const tens = rank % 100;
      const ones = rank % 10;
      const suffix =
        tens >= 11 && tens <= 13
          ? 'th'
          : ones === 1
            ? 'st'
            : ones === 2
              ? 'nd'
              : ones === 3
                ? 'rd'
                : 'th';
      return `You moved up the board! You're now the ${rank}${suffix} drinker in the country.`;
    },
  },

  // The merged "Beer" tab. A segmented control flips between counting and the
  // personal history; the two screens below it are unchanged.
  beer: {
    segmentCount: 'Count',
    segmentDiary: 'Diary',
    // Kept so older references keep compiling; the tab now has two segments.
    segmentStats: 'Stats',
    segmentHistory: 'History',
  },

  // "Diary": the merged trail + numbers surface. One card for the last night,
  // a quiet chronology under it, one amber button, and every lifetime number a
  // tap away in the "How many so far?" sheet.
  diary: {
    // Hero card
    running: 'still going',
    // Shown small under the big numeral when the night had no drink at all.
    emptyNoun: 'NOTHING YET',
    noPub: 'No pub',
    // Three facts about the night that the big number cannot hold.
    factSpent: 'Spent',
    factSpan: 'Length',
    factPace: 'Pace',
    // Shown when a night has no price, no span or too few drinks to have a pace.
    factEmpty: '-',

    // Chronology under the card
    olderHeader: 'Older nights',
    manualHeader: 'Beers added later',
    /** Discreet markers on a row, and what a screen reader says about it. */
    privateTag: 'Just for you',
    queuedTag: 'Waiting to send',
    // "12 Jun · 5 beers · 320 Kč"
    nightMeta: (parts: string[]) => parts.filter(Boolean).join(' · '),

    // Nudge slot
    loadFailed: "I couldn't load the diary.",
    retry: 'Try again',
    queued: (count: number) =>
      englishPlural(count, {
        one: '1 entry waiting to send',
        other: `${count} entries waiting to send`,
      }),

    // The one button
    cta: 'Write up a night',

    // Empty state
    emptyTitle: 'Empty diary',
    emptyBody: 'Tap a beer in the Counter, or write up a night you remember.',

    // "How many so far?" sheet: every lifetime number, one tap deep
    statsTitle: 'How many so far?',
    statsTotalCaption: 'BEERS IN TOTAL',
    statsEvenings: 'Nights',
    statsPubs: 'Pubs',
    statsSpent: 'Spent',
    statsThisMonth: 'This month',
    statsMonthBeers: 'Beers',
    statsMonthAvgLabel: 'Average per night',
    // Moved here from the profile's stats grid, numbers have one home now.
    statsRatings: 'Ratings',
    statsWalked: 'Walked',
    statsRecordsTitle: 'Records',
    statsRecordMost: 'Most in one night',
    statsRecordFastest: 'Fastest beer',
    statsRecordLongest: 'Longest night',
    statsEmptyValue: 'Nothing yet',
    statsPubsTitle: 'Your pubs',
    statsYearsTitle: 'Years',
    // Second line under a year: "average 3.4 per night"
    statsYearAvg: (avg: string) => `average ${avg} per night`,
    statsFooter: 'I only count beers, but the spend covers everything.',
    /** Second footer line without an account only. With one I remember it all. */
    statsFooterNoAccount: 'Without an account I remember your last 50 nights.',
    /** The noun under the numeral on a night that held no beer at all. */
    otherNoun: (type: 'wine' | 'soft_drink' | 'shot', count: number) =>
      englishPlural(count, {
        wine: { one: 'wine', other: 'wines' },
        soft_drink: { one: 'soft drink', other: 'soft drinks' },
        shot: { one: 'shot', other: 'shots' },
      }[type]),
  },

  profile: {
    // Tab header
    title: 'Profile',
    diaryTitle: 'Beer diary',
    privateDiary: 'Private beer diary',
    historyFactsHeader: 'Night details',

    // Beer mat rebuild: one card, one amber button, the rest behind "…"

    /** Identity row when there is no account yet. */
    noAccountNick: 'No account yet',
    noAccountCaption: 'I count your beers anyway.',
    /** Wide caption under the big lifetime numeral. */
    lifetimeCaption: 'BEERS IN A LIFETIME',
    lifetimeCaptionEmpty: 'CLEAN BEER MAT',
    /** Amber door in the card footer. */
    badgesLink: 'Badges',
    /** Link beside the Badges heading, opens the full badge cabinet. */
    badgesAll: 'Show all',
    /** Footer facts. */
    levelLine: (level: number, title: string) => `Level ${level} · ${title}`,
    levelToNext: (xp: number) => `${xp} XP to the next level`,
    levelMaxed: "You've got the lot, you're a legend.",
    levelNoAccount: 'Your level kicks in with an account.',
    /** Caption under the level ring while there is no account to have a rung. */
    levelRingCaption: 'Level',
    // Lifetime trio in the card. Shorter than the `stat*` labels of the old
    // stats grid, because each one only gets a narrow share of the card.
    cardStatPubs: 'PUBS',
    cardStatEvenings: 'NIGHTS',
    cardStatSpent: 'SPENT',
    cardStatDailyAverage: 'BEERS A DAY',
    streakUnit: (count: number) =>
      `${englishPlural(count, { one: 'week', other: 'weeks' })} in a row`,
    streakBest: (count: number) =>
      `Best ${count} ${englishPlural(count, { one: 'week', other: 'weeks' })}`,

    // The one button
    ctaCode: 'Show your code',
    ctaCodeSub: "A mate scans it and you're a Crew.",
    ctaSignUp: 'Set up a profile',
    ctaSignUpSub: "So you don't lose your beers when you swap phones.",
    secondaryPhotos: 'Beer photos',

    // "What else?" rows
    moreTitle: 'What else?',
    moreSettings: 'Settings',
    moreLeaderboards: 'Leaderboards',
    moreParta: 'Crew',
    morePartaCount: (friends: string) => friends,
    morePartaEmpty: 'Get yourself a Crew',
    moreFollow: 'Follow Na pivo',

    // Nudge slot: at most one
    nudgePhotoFailed: "The photo didn't upload.",
    nudgePhotoRetry: 'Retry',
    nudgeNickname: "Without a nickname your crew won't know you.",
    nudgeNicknameFix: 'Add one',
    // Count first: the strip truncates from the right, and losing the pub name
    // costs less than losing the number the line exists to show.
    nudgeLastNight: (pub: string, beers: string) => `${beers} · ${pub}`,
    nudgeLastNightOpen: 'Open',
    nudgeEmpty: 'Clean beer mat so far. Log your first beer.',
    nudgeEmptyCta: 'To the beer mat',

    // Identity
    editProfile: 'Edit profile',
    // Fallback name under the avatar when no display name is set.
    noDisplayName: 'No name',

    // Visibility badge
    visibilityPublic: 'Public profile',
    visibilityPrivate: 'Private profile',

    // Stats grid
    statsHeader: 'YOUR NUMBERS',
    statBeers: 'BEERS COUNTED',
    statPubs: 'PUBS VISITED',
    statRatings: 'RATINGS',
    statDailyAverage: 'BEERS A DAY',
    statSpent: 'SPENT',
    // Diary still formats its distance summary with these compatibility labels.
    kmShort: 'km',
    notAvailable: '-',

    // Achievements
    achievementsHeader: 'BADGES',
    badgeCollectionTitle: 'Your cabinet',
    badgeCollectionCta: 'Have a look at all the badges and challenges',
    badgeCollectionIntro: "Every badge is a small pub story. The ones you've got are lit up, the rest come with a hint.",
    creator: {
      header: 'STAY IN THE LOOP',
      title: 'Na pivo outside the app too',
      subtitle: 'News, behind the scenes and the odd beer trip.',
      instagram: 'Instagram',
      instagramUrl: 'https://www.instagram.com/jsem_mach/',
      linkedin: 'LinkedIn',
      linkedinUrl: 'https://www.linkedin.com/in/mach-tomas/',
      discord: 'Discord',
      discordUrl: 'https://discord.gg/EDw8EW7Az8',
    },
    badgeFirstTenTitle: 'First 10 beers',
    badgeFirstTenLocked: 'Count 10 beers',
    badgeRegularTitle: 'Familiar face',
    badgeRegularLocked: 'Visit one pub 5 times',
    badgeReviewerTitle: 'Reviewer',
    badgeReviewerLocked: 'Rate 10 pubs',
    badgeFotoPivarTitle: 'Beer Snap',
    badgeFotoPivarLocked: 'Win a round of the photo contest',
    // Drinker badges (outside-pub drinking wave)
    badgeChatarTitle: 'Cottage dweller',
    badgeChatarLocked: 'Log your first beer outside a pub',
    badgePodSirakemTitle: 'Under the stars',
    badgePodSirakemLocked: 'Log a beer outdoors under the open sky',
    badgeLahvacTitle: 'Bottle philosopher',
    badgeLahvacLocked: 'Log 25 bottles',
    badgePlechTitle: 'Can crusher',
    badgePlechLocked: 'Log 25 cans',
    // Diary/social badges (leaderboards wave)
    badgeFirstBeerTitle: 'First beer',
    badgeFirstBeerLocked: 'Log your first beer',
    badgeCenturyTitle: 'The century',
    badgeCenturyLocked: 'Count 100 beers',
    badgePilgrimTitle: 'Pilgrim',
    badgePilgrimLocked: 'Visit 25 different pubs',
    badgeStamgastTitle: 'Regular',
    badgeStamgastLocked: 'Visit one pub 10 times',
    badgeNightOwlTitle: 'Night owl',
    badgeNightOwlLocked: 'Log a beer after midnight',
    badgeTasterTitle: 'Taster',
    badgeTasterLocked: 'Try 10 different beers',
    badgePartyAnimalTitle: 'Life of the party',
    badgePartyAnimalLocked: 'Have 5 mates in your crew',

    // Recent activity
    recentHeader: 'RECENT ACTIVITY',

    // Account & settings rows
    manageAccount: 'Manage account',
    settingsRow: 'Settings',

    // Crew cross-link (Parta 3.0 §A2 entry point)
    myCode: 'My code',
    partaCount: (n: number) =>
      n === 0
        ? 'Get yourself a Crew'
        : `${n} ${englishPlural(n, { one: 'mate', other: 'mates' })} in your crew`,

    report: {
      button: 'Report',
      profileFallback: 'this profile',
      confirmTitle: 'Report this profile?',
      confirmBody: (profile: string) =>
        `I'll go through the report on ${profile}. Use it for an inappropriate nickname, photo or spam.`,
      confirmSubmit: 'Report',
      sentToast: "Got the report, I'll look into it.",
    },

    // Signed-out hero
    signedOutTitle: 'Set up a profile',
    signedOutBody:
      'Create an account and your beers, ratings, Crew and leaderboards will be there wherever you sign in.',
    signedOutCta: 'Create an account',

    // One-screen privacy choice after registration
    privacy: {
      eyebrow: 'ONE MORE THING',
      title: 'How do you want to be seen?',
      body: 'Pick who can find you in Na pivo. You can change it in your profile any time.',
      publicTitle: 'Public regular',
      publicBody: 'People can find you by name or nickname and will see you on the leaderboards.',
      privateTitle: 'Crew only',
      privateBody: 'Nobody can find you publicly. Only your friends see your profile.',
      promise: 'This choice never publishes your exact location or your private beer diary.',
      confirm: 'Confirm and go for a beer',
      saving: 'Saving…',
      skip: 'Skip, change nothing',
      skipAfterError: 'Carry on without changing',
      error: "I didn't save the setting. Try again, or carry on without changing it.",
    },

    // Shared profile form copy
    form: {
      nicknamePlaceholder: 'nickname',
      nicknameChecking: 'Checking…',
      nicknameAvailable: 'Available',
      nicknameTaken: 'That nickname is taken',
      nicknameInvalid: 'Invalid nickname',
      nicknameTooShort: 'At least 3 characters',
      nicknameTooLong: 'At most 20 characters',
      nicknameCharset: 'Letters without accents, digits, _ and . only',
      nicknameReserved: 'That nickname is not available',
      avatarUploadError: 'The photo did not upload. Try again.',
      permissionBody: 'I need access to your photos to pick one. Allow it in Settings.',
      permissionBlockedBody: 'Access to photos is blocked. Allow it in system Settings and try again.',
      openSettings: 'Open Settings',
    },

    // Edit screen
    edit: {
      title: 'Edit profile',
      avatarHeader: 'PHOTO',
      changePhoto: 'Change photo',
      removePhoto: 'Remove photo',
      removePhotoConfirmTitle: 'Remove your profile photo?',
      removePhotoConfirmBody: 'Your profile goes back to an initial.',
      removePhotoConfirmCancel: 'Keep it',
      removePhotoConfirmAction: 'Remove',
      nicknameHeader: 'NICKNAME',
      displayNameHeader: 'NAME',
      displayNameLabel: 'Name (optional)',
      displayNamePlaceholder: 'What should I call you',
      visibilityHeader: 'VISIBILITY',
      visibilityToggleLabel: 'Public profile',
      // Compact reminder; the post-registration privacy screen carries the full choice.
      consent:
        'A public profile shows your nickname and photo on the leaderboards and in search. I never publish your location or individual beers.',
      consentPrivate: 'Turn it off and only your friends see you.',
      save: 'Save',
      saving: 'Saving…',
      savedToast: 'Profile saved.',
      errorGeneric: 'Something went wrong. Try again.',
    },
    // Four-up strip under the profile chart.
    chartStatBeers: 'Beers',
    chartStatEvenings: 'Nights',
    chartStatPubs: 'Pubs',
    chartStatLongest: 'Longest',
    recordEveningLength: 'Night length',
    firstEntryNone: 'No entry yet',
    firstEntryUnknown: 'Your first entry is already in the diary',
    firstEntrySince: (when: string) => `First entry ${when}`,
    // Tabs and the chart window picker. State holds keys, these are the labels.
    tabStats: 'Stats',
    tabActivity: 'Activity',
    periodWeek: 'Week',
    periodMonth: 'Month',
    periodYear: 'Year',
    handleFallback: 'Your profile',
    createProfileA11y: 'Create a profile',
    statsLoadingA11y: 'Loading your stats',
    statsRetryA11y: 'Load the stats again',
    statsRetry: 'The stats did not pour. Try again',
    myNightsLoadingA11y: 'Loading your nights',
    myNightsRetryA11y: 'Load your nights again',
    myNightsRefreshA11y: 'Refresh your nights',
    myNightsMoreA11y: 'Load older nights',
    nightsError: 'Nights did not load',
    nightsEmpty: 'No published night yet',
    nightsRetry: 'Try again',
    nightsStale: 'Running off the last load · Refresh',
    nightsLoadingMore: 'Loading…',
    nightsMore: 'Older nights',
  },

  party: {
    /** Server rule: a published night needs at least one drink of my own. */
    nothingToPublish: 'Nothing to publish until you log a beer of your own.',
    gamesComingSoon: "I'm still polishing the games. They arrive in the next version.",
    gamesSoonBadge: 'Soon',
    staleEveningClosed: 'I closed the old night.',
    nightTitleOutsidePub: 'A night outside the pub',
    nightTitleAtPub: (pubName: string) => `A night at ${pubName}`,
    nightTitleFallback: 'Beer night',
    gamesTitle: 'Games',
    scoringPoints: 'On points',
    scoringNoPoints: 'No points',
  },

  gameResult: {
    payingSelf: "You're paying",
    payingOther: (name: string) => `${name} is paying`,
    payingNote: 'The next round is settled.',
    winningSelf: "You're winning",
    winningOther: (name: string) => `${name} is winning`,
    winningNote: 'Most points at the table.',
    done: 'Game over',
    doneNote: 'The result stays with the night.',
    closeLabel: 'Close',
  },

  gameHost: {
    loading: 'Loading the game…',
    unavailable: "This game won't run in this version.",
    loadFailed: "I couldn't load the game.",
    stopped: 'The game stopped.',
    timeout: "The game didn't start in time.",
    retry: 'Try again',
    spectator: "You're just watching this game.",
    savingResult: 'Saving the result…',
    waitingForResult: 'Waiting for the result…',
    resultSaveFailed: "I couldn't save the result.",
    /** The page raised the `protocol_mismatch` code (see games/protocol.ts). */
    protocolMismatch: 'The game got a message it does not understand.',
  },


  counter: {
    partyTotalBeersLabel: 'beers total',
    // Permission gate
    permTitle: 'I need your location',
    // Same Google Play prominent-disclosure wording rules as `permissions.body`.
    permBody:
      'Na pivo collects location data so it can tell which pubs are nearby and which place you are sitting in. Your current or approximate location is sent to my server for that. With pub reminders switched on, I check your location even when the app is closed or not in use. I do not store your GPS trail or location history.',
    permCta: 'Allow location',
    permOpenSettings: 'Open Settings',

    // Place chip / picker
    // There is no "detecting" or "no pub nearby" screen any more: both are just
    // states of the place chip, and the picker is where you resolve them.
    detecting: 'Looking for where you are sitting…',
    retry: 'Try again',
    noPubAddPub: 'Add a pub',
    pickerTitle: 'Where are you sitting?',

    // Outside a pub (logging away from one)
    // The picker splits into two sections: nearby pubs + the outside contexts.
    pickerNearbyHeader: 'Pubs nearby',
    pickerOutsideHeader: 'Outside a pub',
    outsideLabel: (context: OutsidePlaceContext) =>
      ({ private: 'Home / cottage', outdoors: 'Outdoors', other: 'Outside a pub' })[context],
    // Entry from the permission gate: counting is never blocked by GPS.
    outsideNoLocationCta: 'Log a beer without location',
    // Caption of the session-drinks group in the pick sheet (outside a pub there
    // is no community menu; the list holds what you've logged tonight).
    outsideMenuHeader: 'Drinking tonight',

    // Coaster meta ("3 beers · 186 Kč · 12 min ago")
    lastDrinkShortJustNow: 'just now',
    lastDrinkShortMinutesAgo: (minutes: number) => `${minutes} min ago`,
    // A local, optional hydration nudge. It makes no health, sobriety, BAC, or
    // driving claim. `count` is the beer that triggered it (4, 8, 12...).
    waterNudge: (count: number) => {
      const lines = [
        'Have a glass of water too, if you fancy.',
        'Small reminder: a glass of water might do you good.',
        'How about a short break and a glass of water?',
      ];
      const index = Math.max(0, Math.round(count / 4) - 1) % lines.length;
      return lines[index];
    },

    // Sync
    // Server hard-rejected a drink over the daily anti-abuse cap ("drink_limited"):
    // the entry stays in the local diary only, so no data is lost, just not synced.
    drinkLimitedToast: 'That is more than the server takes in one day, so this entry stays in your diary only.',

    // ── The coaster surface ─────────────────────────────────────────────────
    // The counter is four blocks: place chip, coaster (tally marks), one nudge
    // slot, one button. The button's label always says exactly what one tap does.

    // Coaster, nothing counted yet: the only line of prose on the screen.
    coasterEmpty: 'Clean coaster',
    // The one button, in each of its states.
    ctaPick: 'What are you having?',
    ctaFirstBeer: 'Log your first beer',
    ctaLogBeer: 'Log a beer',
    repeatCta: 'Log the same beer',
    // The quiet twin of "one more": a different beer, a shot, a Kofola. Lives
    // in the card as a chip, on screen the whole time the CTA is repeating.
    quickOtherBeer: 'A different beer',
    quickMapPub: 'Map it',
    resumeSub: (summary: string) => `Last time here: ${summary}.`,
    // Place chip when GPS found nothing close enough to say "you sit here".
    placeUnknown: 'Where are you sitting?',

    // Nudge slot: one occupant at a time, never stacked.
    // Ordinal, so it stays genderless.
    countedStrip: (n: number) => `Got it. Beer ${n}.`,
    countedStripOther: 'Got it.',
    undo: 'Undo',
    // The rapid-drink guard is inline now: the tap does NOT count until this is
    // confirmed, and letting it time out means "no".
    rapidInline: (minutes: number) => `Last beer was ${minutes} min ago. Is this entry right?`,
    rapidInlineJustNow: 'You logged a beer a moment ago. Is this entry right?',
    rapidInlineConfirm: 'Yes, log it',
    checkinNudge: 'Was it worth it?',
    checkinNudgeCta: 'Rate it',
    dopitoNudge: 'Finished?',
    // One-shot toast after the very first count, ever. The only teaching copy.
    undoHint: 'Tap Bill when you want to take something back.',

    // Toast right after a beer lands. The undo strip below states the fact
    // ("Got it. Beer 3."), so this one only carries the mood: short,
    // genderless, and it rotates so the tenth beer doesn't read like the second.
    // `n` is the beer's ordinal in tonight's tally.
    countedToast: (n: number) => {
      if (n === 1) return 'First one today. Enjoy!';
      const lines = [
        'One more mark on the coaster.',
        'Logged, the night is rolling.',
        'It is in your diary.',
        'And another one in.',
      ];
      return lines[(n - 2) % lines.length];
    },
    // Same moment, but the drink wasn't a beer: no beer-counting flavour.
    countedToastOther: 'Logged, got it.',

    // "Your bill" sheet: the one place that removes and closes.
    receiptTitle: 'Your bill',
    receiptChip: 'Bill',
    receiptStarted: (time: string) => `Opened at ${time}`,
    receiptTotal: 'Total',
    receiptClose: 'Finished, close the bill',

    // "What are you having?" sheet: the one place that adds.
    pickTitle: 'What are you having?',
    pickAddBeer: 'Add a different beer',
    pickNonBeer: 'Soft drink, shot or wine',
    pickEmptyPub: 'Nobody has logged anything here yet.',
    pickEmptyOutside: 'Bottle, can, whatever.',
    pickFirstBeer: 'Log the first beer',

    // "More" sheet: everything that isn't counting sits one tap deeper.
    moreTitle: 'What else?',
    moreStory: 'Sticker for your story',
    moreMapPub: 'Map the pub',

    // Caption of the pub's community menu inside the pick sheet.
    menuHeader: 'What they have here',
    rotatingMenuBadge: 'Rotating taps',
    rotatingMenuHint: 'The beers change here. This is the last confirmed lineup.',
    scanDrinks: 'Photograph the drinks menu',
    scanDrinksLoading: 'Reading the menu…',
    scanDrinksTitle: 'What are you having?',
    scanDrinksHint: 'Pick a drink and you can still edit it before logging.',
    scanDrinksEmpty: 'I could not read a single drink off that photo.',
    cameraTitle: 'What do you want to snap?',
    cameraBeer: 'A beer for the diary',
    cameraMenu: 'The pub menu',
    cameraMenuNeedsPub: 'Pick a pub and tap the camera again',
    // Backdating a drink
    backdateLink: 'Log a drink from earlier',
    backdateTitle: 'When was it?',
    backdateHourAgo: 'An hour ago',
    backdateTwoHoursAgo: 'Two hours ago',
    backdateYesterdayEvening: 'Yesterday evening',
    perBeerCount: (n: number) => `${n}×`,

    // Closing / resuming a night
    // Explicit "I'm done": archives the session to history.
    doneDrinking: 'Finished',
    doneTitle: 'Finished?',
    doneBody: 'I will close this night and you will find it in History.',
    doneConfirm: 'Finished',
    // Offered when a recent night at this pub auto-completed and can continue.
    resumeEvening: 'Carry on with the night',

    // Beer / price modal
    priceModalTitle: 'How much is it?',
    addModalTitle: 'Which beer are you having?',
    addDrinkModalTitle: (type: DrinkType) =>
      ({
        beer: 'Which beer are you having?',
        wine: 'Which wine are you having?',
        soft_drink: 'Which soft drink are you having?',
        shot: 'Which shot went down?',
      })[type],
    drinkTypeLabel: (type: DrinkType) =>
      ({ beer: 'Beer', wine: 'Wine', soft_drink: 'Soft drink', shot: 'Shot' })[type],
    drinkNamePlaceholder: (type: DrinkType) =>
      ({
        beer: 'Beer name, e.g. Pilsner Urquell 12°',
        wine: 'Name, e.g. Welschriesling',
        soft_drink: 'Name, e.g. Kofola',
        shot: 'Name, e.g. Slivovice',
      })[type],
    editModalTitle: 'Edit the price',
    beerNamePlaceholder: 'Beer name, e.g. Pilsner Urquell 12°',
    // Add-form shortcut into the AI menu scan (hands over to the contribute
    // editor). Framed as filling the PUB's menu, not logging your own drinks.
    scanMenuShortcut: 'Snap the menu and I will fill in what they have',
    // Serving type (only asked outside a pub; in a pub it stays unasked)
    servingLabel: 'How is it served?',
    servingTypeLabel: (serving: ServingType) =>
      ({
        unknown: 'Not sure',
        draft: 'Draught',
        bottle: 'Bottle',
        can: 'Can',
        plastic_bottle: 'Plastic bottle',
        other: 'Some other way',
      })[serving],
    // Outside a pub the price is optional: you rarely know it at home.
    outsidePricePlaceholder: 'Price (optional)',
    priceLabel: 'Price for',
    volumeSmall: '0.3 l',
    volumeMedium: '0.4 l',
    volumeLarge: '0.5 l',
    volumeOther: 'Other',
    volumeCustomPlaceholder: 'e.g. 1000',
    volumeUnitMl: 'ml',
    confirmCount: 'Add the beer',
    confirmDrink: (type: DrinkType) =>
      ({ beer: 'Add the beer', wine: 'Add the wine', soft_drink: 'Add the soft drink', shot: 'Add the shot' })[type],
    confirmSave: 'Save',
    cancel: 'Cancel',

    // Formatting helpers
    price: (czk: number) => `${czk} Kč`,
    // "62 Kč · 0.5 l" or just "62 Kč" when no volume.
    beerMeta: (price: string, ml?: number) =>
      ml ? `${price} · ${formatVolume(ml)}` : price,
  },

  // Drinker (drink-logging XP ladder; XP bar strings are shared with Mapper)
  pivar: {
    header: 'YOUR LEVEL',
    level: (n: number, title: string) => `Level ${n} · ${title}`,
  },

  // "Taproom": finished nights from the automatic Crew history and explicitly
  // public stories in World. Prices and raw location history never leave the
  // diary. The one-tap reaction is a round, symbolically bought for the author
  // of a published story.
  vycep: {
    title: 'Taproom',
    deleteCommentTitle: 'Delete the comment?',
    deleteCommentBody: 'The comment disappears for everyone.',
    deleteCommentCancel: 'Keep it',
    deleteCommentConfirm: 'Delete',
    scopeParta: 'Crew',
    scopeWorld: 'World',

    // Crew-tab teaser strip.
    teaserSubtitle: 'Nights posted by your crew and by the rest of the world.',

    // Feed
    emptyPartaTitle: 'Hangovers is empty so far',
    emptyPartaBody: 'When someone in your crew logs a night, it turns up here.',
    emptyWorldTitle: 'The world is quiet',
    emptyWorldBody: 'Nobody has a night up right now. Post yours and get it going.',
    loadError: 'I could not load the Taproom.',
    retry: 'Try again',
    loadMore: 'Load more nights',
    loadMoreError: 'I could not load more nights · Try again',
    loadMoreRetryA11y: 'Try loading more nights',
    publishLatestCta: 'Post your night',
    logBeerCta: 'Log a beer',
    anonymousAuthor: 'Drinker',
    myNightChip: 'Your night',
    visibilityChipFriends: 'Crew only',
    visibilityChipWorld: 'The whole world',
    // "3 h 20 min" pub-to-pub span of the night.
    nightDuration: (hours: number, minutes: number) =>
      hours > 0 ? (minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`) : `${minutes} min`,
    outsidePub: 'Outside a pub',

    // Round (the reaction)
    round: 'Round',
    roundCount: (n: number) =>
      englishPlural(n, { one: '1 round', other: `${n} rounds` }),
    roundSentToast: 'Round sent. Nice move.',
    roundUndoneToast: 'Round taken back off the coaster.',
    roundQueuedToast: 'I will send the round once I catch a signal.',
    roundErrorToast: 'The round did not get through. Try again in a bit.',

    // Publish sheet
    publishTitle: 'Post the night to the Taproom',
    publishBody:
      'I post the number of beers, the pubs, the date and how long the night lasted. I do not send your spend, your location or the individual beers anywhere.',
    visibilityLabel: 'WHO SEES IT',
    visibilityFriendsHint: 'Only your crew sees the night.',
    visibilityWorldHint: 'Anyone who opens the Taproom sees the night, crew or not.',
    publishCta: 'Post it',
    updateCta: 'Post it again',
    publishedToast: 'Your night is up in Hangovers.',
    publishQueuedToast: 'I will post it once you are online.',
    publishErrorToast: 'I could not save the night. Try again.',
    unpublishCta: 'Take it down from Hangovers',
    unpublishConfirmBody: 'The night disappears from Hangovers and from profiles. It stays in your diary.',
    unpublishedToast: 'The night is no longer up in Hangovers.',
    unpublishErrorToast: 'I could not save the takedown. Try again.',
    nicknameNeededTitle: 'You have no nickname',
    nicknameNeededBody:
      'For the whole world to see the night, you need a nickname. You can set one in your profile in a minute.',
    nothingToPublish: 'You cannot post an empty night. Something has to go down first.',

    // Story share (transparent sticker pasted over the user's own photo)
    // Live variant: shared from the counter while still at the pub, as an
    // invite ("come join me") rather than a recap of the finished night.
    storyLiveEntryCta: 'Sticker for your story',
    // Short label for the compact action card right under the counter hero.
    storyEntryShort: 'Sticker',
    storyLiveTopArc: 'RIGHT NOW',
    storyLiveHero: 'OUT FOR A BEER',
    storyLiveCta: 'Drop by!',
    storyModalTitle: 'Sticker for your story',
    storyStickerHint: 'Shoot your own story and stick this on top of it.',
    storyShareCta: 'Share somewhere else',
    storyCopyCta: 'Copy the sticker',
    storyPreparing: 'Getting it ready…',
    storyCopied: 'Copied. Open Instagram and paste it into your story.',
    storyShareError: 'I could not prepare the sticker. Try again.',
    shareNightCta: 'Share the night',
    // Small always-true footer line on the story image itself.
    storyBrand: 'NA PIVO',
    storyStatBeers: (n: number) => beerNoun(n),
    // Compact "and also" line under the hero for non-beer drinks. Empty when
    // the night was beer-only, so the card stays clean.
    storySecondaryLine: (wine: number, shots: number, soft: number): string => {
      const parts: string[] = [];
      if (wine > 0)
        parts.push(`${wine} ${englishPlural(wine, { one: 'wine', other: 'wines' })}`);
      if (shots > 0)
        parts.push(
          `${shots} ${englishPlural(shots, { one: 'shot', other: 'shots' })}`,
        );
      if (soft > 0) parts.push(`${soft}× soft drink`);
      return parts.length > 0 ? `plus ${parts.join(' · ')}` : '';
    },

    // Night detail entry
    sectionTitle: 'Taproom',
    sectionHeader: 'TAPROOM',
    publishEntryTitle: 'Post to the Taproom',
    publishEntryBody: 'Show your crew or the whole world how the night went.',
    publishedState: (visibility: string) => `Up in Hangovers · ${visibility}`,

    // Reporting a public night
    reportNight: 'Report the night',
    reportTitle: 'Report this night?',
    reportBody: 'The report comes to me anonymously. I will take a look.',
    reportConfirm: 'Report it',
    reportSentToast: 'Thanks, got it. I will take a look.',
    reportErrorToast: 'The report did not get through. Try again.',
  },

  myBeers: {
    // Tab label + screen title.
    title: 'My beers',

    // Empty state
    emptyTitle: 'No beer trail yet',
    // Shown when the detail is opened for a night that is no longer there.
    eveningGoneTitle: 'This night is no longer in the diary.',
    emptyBody:
      'Tap a beer in the Counter and the night saves itself here. You will see where it was, what you drank and what it added up to.',

    // Sections
    currentHeader: 'CURRENT NIGHT',
    pastHeader: 'PAST NIGHTS',
    diaryHeader: 'BEER DIARY',
    historicalCta: 'Log an older night',
    historicalCtaBody: 'Fill in the beers, the pub, the time and the price.',
    historicalTitle: 'Add the beers',
    historicalBeersLabel: 'Beers',
    historicalAddBeer: 'Add a beer',
    historicalNextBeerPlaceholder: 'Next beer',
    historicalDateLabel: 'Date',
    historicalDatePlaceholder: '12/06/2026',
    historicalTimeLabel: 'Time',
    historicalTimeFromLabel: 'From',
    historicalTimeToLabel: 'To',
    historicalTimePlaceholder: '19:45',
    historicalTimeToPlaceholder: 'Optional',
    historicalDateError: 'Check the date and the times. I do not pour the future yet.',
    historicalPubLabel: 'Pub',
    historicalPubPlaceholder: 'Where was it?',
    historicalQuantityLabel: 'Count',
    historicalPriceLabel: 'Price each',
    historicalPricePlaceholder: 'Optional',
    historicalCityLabel: 'City',
    historicalVisibilityHint: 'Older entries start out just for you.',
    historicalVisibilityFriendsHint: 'Your crew sees the beers, the pub, the time and the note.',
    historicalVisibilityPrivateHint: 'I keep it in your diary only.',
    historicalSubmit: 'Save the memory',
    historicalSaved: (count: number) =>
      count === 1 ? 'Memory logged.' : `${count} beers logged.`,
    historicalSaveError: 'I could not save the memory. Try again.',
    historicalNoPub: 'No pub',

    // Date labels
    today: 'Today',
    yesterday: 'Yesterday',

    // Night summary
    // "3 beers · 186 Kč"
    summary: (beers: string, spent: string) => `${beers} · ${spent}`,
    lastDrinkJustNow: 'Last beer a moment ago',
    lastDrinkMinutesAgo: (minutes: number) =>
      `Last beer ${minutes} ${englishPlural(minutes, {
        one: 'minute',
        other: 'minutes',
      })} ago`,

    // Detail
    breakdownTitle: 'What went down',
    // Hero stats above the breakdown.
    statBeers: 'Beers',
    statOther: 'Other',
    // Meta shown to the right of a beer name, e.g. "2× · 124 Kč" (count × subtotal).
    // The volume is appended to the name separately in EveningBreakdown.
    breakdownLine: (count: number, price: string) => `${count}× · ${price}`,
    drinkGroupTotal: (price: string) => `Total ${price}`,
    addDrinkToEvening: 'Add a beer',
    addDrinkToEveningTitle: 'What else went down?',
    addDrinkToEveningSubmit: 'Add it to the night',
    addDrinkToEveningSaved: 'Beer added. The night checks out.',
    editDrink: 'Edit',
    deleteDrink: 'Remove one drink',
    editDrinkTitle: 'Fix the drink name',
    editDrinkGroupTitle: (count: number) =>
      count > 1 ? `Rename all ${count} drinks` : 'Fix the drink name',
    editDrinkPlaceholder: 'Drink name',
    editDrinkSave: 'Save',
    editDrinkCancel: 'Cancel',
    editDrinkEmpty: 'It needs a name.',
    deleteDrinkTitle: 'Remove one drink?',
    deleteDrinkBody: 'I will drop the count on that line by one.',
    deleteDrinkConfirm: 'Remove',
    deleteDrinkCancel: 'Cancel',
    totalLabel: 'Total',

    // Personal pub rating ("was it worth coming back for?")
    ratingTitle: 'Was it worth it?',
    ratingHint: 'Just for you. You see it wherever you sign in, nobody else does.',
    verdictLike: 'Good',
    verdictDislike: 'Weak',
    // One-tap memory labels. Values stay stable for older local/server ratings;
    // labels are the copy shown in the UI.
    tagLabel: 'How you felt leaving',
    notePresets: [
      { value: 'Sem se vrátit', label: 'I am coming back' },
      { value: 'Dobrý tankový', label: 'Well kept beer' },
      { value: 'Nic moc', label: 'Next time somewhere else' },
    ] as const,
    // Free-text note in the user's own words.
    noteLabel: 'Your own note',
    notePlaceholder: 'What do you want to remember? Something like "great beer, less great bill".',
  },

  // "Performance" includes practical monthly/yearly trends. Pivní Wrapped
  // remains a separate narrative recap.
  stats: {
    // Empty state
    emptyTitle: 'Nothing to measure yet',
    emptyBody: 'Log a night and you will find a private overview here.',

    // Hero: last performance (the thing you check in the morning)
    heroToday: "TODAY'S PERFORMANCE",
    heroYesterday: "YESTERDAY'S PERFORMANCE",
    // Noun shown small next to the big numeral, e.g. "5  beers".
    heroBeersNoun: (beers: number) => beerNoun(beers),
    // One-liner reacting to last night's tally, picked by PerformanceTone.
    // No emoji: the design system bans them in UI chrome (§12).
    toneStart: 'One to warm up.',
    toneWarmup: 'Decent groundwork.',
    toneSolid: 'A good night.',
    toneBig: 'That was a ride!',
    toneHuge: 'Legendary. Hats off.',
    // Micro-stat captions under the hero (only with 2+ beers).
    heroDuration: 'NIGHT LENGTH',
    heroAvg: 'AVERAGE PER BEER',
    heroFastest: 'FASTEST',

    // Personal records
    recordsHeader: 'PERSONAL RECORDS',
    recordMostBeers: 'Most in one night',
    recordFastest: 'Fastest beer',
    recordLongest: 'Longest night',
    // "9 beers · U Zlatého tygra" (pub optional).
    recordMostBeersValue: (beersLabel: string, pub: string | null) =>
      pub ? `${beersLabel} · ${pub}` : beersLabel,
    recordEmpty: 'Nothing yet',

    // Lifetime totals
    totalsHeader: 'TOTALS',
    totalBeers: 'BEERS TOTAL',
    totalEvenings: 'NIGHTS',
    totalPubs: 'PUBS WITH AN ENTRY',
    totalSpent: 'SPENT',

    // Monthly and yearly trend
    periodsHeader: 'BY PERIOD',
    monthsHeader: 'LAST 12 MONTHS',
    yearsHeader: 'YEARS',
    periodBeers: 'BEERS THIS MONTH',
    periodEvenings: (count: number) =>
      englishPlural(count, { one: '1 beer night', other: `${count} beer nights` }),
    periodAverage: (average: number) =>
      average > 0
        ? `Averaging ${average.toLocaleString('en-GB')} beers a night`
        : 'A dry month so far',
    yearSummary: (beers: number, average: number) =>
      `${beerCountLabel(beers)}, averaging ${average.toLocaleString('en-GB')} a night`,
    monthsA11y: 'Number of beers over the last twelve months',
    monthA11y: (period: string, beers: number) => `${period}: ${beerCountLabel(beers)}`,

    // Top pubs (where you have drunk how much)
    pubsHeader: 'YOUR PUBS',
    pubsSubtitle: 'Pubs by number of entries',

    // Time formatting
    // Night length: "4 h 12 min" / "47 min" / "under a minute".
    span: (ms: number): string => {
      const totalMin = Math.round(ms / 60000);
      if (totalMin < 1) return 'under a minute';
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
    eyebrow: 'UPDATE',
    defaultTitle: "What's new",
    cta: 'Nice!',
    // Version badge shown next to the eyebrow, e.g. "v1.2.0".
    versionLabel: (version: string) => `v${version}`,
  },

  about: {
    // Screen title reuses settings.about.title ("About the app") as the single source.
    tagline: 'Your compass to the nearest beer.',
    whatsNewHeader: "WHAT'S NEW",
    // Shown while this version's release note is being fetched.
    loading: 'Loading the notes…',
    // The backend has no note for this version (404 / empty).
    empty: "I haven't written anything up for this version yet.",
    // Offline / timeout / dormant backend, kept distinct from "empty" so the user
    // knows it's worth trying again later.
    error: "Couldn't load the notes right now. Have a look in a bit.",
    footer: 'No ads · Nothing to pay',
    playStore: 'Na pivo on Google Play',
    playStoreA11y: 'Open Na pivo on Google Play',
  },

  privacy: {
    title: 'Privacy',
    body: [
      'I collect limited operational and product statistics: app opens, views of the main screens, use of the main buttons and controls, results of selected actions, technical errors, the app version and the total metres walked.',
      'Product events carry only fixed, coarse categories. They never include pub or beer names, your text, identifiers of the profiles or posts you view, search queries, GPS points or your route.',
      'I delete individual operational, product and error events on the server automatically, after 90 days at the latest. Aggregate counters can stay for as long as the account exists, and events tied to your account are in the data export.',
      'To download nearby pubs, the app may send your current or approximate location to my server.',
      'Metres walked are counted on your phone and only the total is sent to the server in batches, never GPS points or your route.',
      "I don't store any running GPS history, movement route or individual GPS points.",
      'Pub reminders are an optional feature that uses background location: the app sets up zones around the nearest pubs and your phone tells it when you walk into one. Your phone works it out on its own and sends no coordinates to the server. You can turn the feature off any time.',
      'To show opening hours, the app sends the name and location of the chosen pub to my server, which looks the hours up.',
      'The app creates a random anonymous device identifier and sends it to my server so every device has a temporary account. The identifier holds no personal data and only serves to tell devices apart.',
      'An account is optional. If you sign up with an email, I store the email and the password only in hashed form. Through Google or Apple I get the account identifier, the email and possibly a name; I never see your password from the provider.',
      'A profile can hold a nickname, a name and an avatar. With a public profile, other people can find you by your nickname and photo; your exact location, your diary and individual beers are not shown publicly.',
      'The counter, the history of your nights, pub visits and your private ratings are stored locally and sync only to your account. When you log out or delete the account, the app clears the local private diary, the ratings and the entries waiting to be sent from this device.',
      'Sharing a night with your crew is on by default: friends you have accepted can see that you are in a pub, how many beers you have and your last entry. You can turn it off in the crew settings, or switch on ghost mode. Nobody other than the friends you have accepted sees any of this.',
      'I store beer photos on the server without metadata or GPS location. By default only your crew sees them; the only public ones are the photos you enter into the photo contest.',
      'When you photograph a beer menu with "Snap the menu", the photo goes through my server to an AI model for processing (via the OpenRouter service). I do not store the photo and, under my settings, the provider must not use it for training.',
      'If you allow notifications, I store the device push token and deliver Crew messages through Expo Push Service. Pub reminders show up on the phone itself and are not sent anywhere.',
      'When you add opening hours, beers on tap or a missing pub, the app sends them to my server. These contributions help other people and can be shown publicly, but without your exact location.',
      'In your account you can request a JSON export of your data by email, or delete the account. After deletion I clear the local private data in the app and the server data is deleted according to the privacy policy.',
      'Transactional emails, for example address verification, password reset, data export or confirmation that an account was deleted, go out through Resend. That service gets only the email address and the content needed to send the message.',
    ],
    contactLabel: 'Contact',
    contactEmail: 'tomades1@gmail.com',
    fullPolicyLink: 'Full privacy policy',
  },

  // Social rail in the evening card: three doors to the community half of the
  // product, which was otherwise only reachable from an overflow sheet.
  a11y: {
    onboardingStep: (step: number, total: number) => `Step ${step} of ${total}`,
    celebrationOpenMaps: (pub: string) => `Open ${pub} in maps`,
    celebrationBackToCompass: 'Back to the compass',
    // Taproom
    vycepLink: 'Open the Taproom, the feed of posted nights',
    vycepBack: 'Back',
    roundButton: (owner: string) => `Send a round: ${owner}`,
    nightCard: (owner: string) => `Night by ${owner}`,
    shareNightButton: 'Share the night as an image',
    publishNightButton: 'Post the night to the Taproom',
    nightMenu: 'Night options',

    pubPillHidden: 'Hidden pub, tap to reveal',
    pubPillRevealed: (pubName: string) => `${pubName}, tap to open in maps`,
    openStatus: (status: string) => `Opening hours: ${status}`,
    pubRating: (rating: string, count?: string) =>
      count ? `Rating: ${rating} out of 5, ${count} ratings` : `Rating: ${rating} out of 5`,
    pubGarden: 'Has a beer garden',
    toggleOn: 'on',
    toggleOff: 'off',
    settingsButton: 'Open settings',
    // Crew 3.0
    tabFeedBadge: (requests: number, unread: boolean, live: boolean) => {
      const base = 'Hangovers tab';
      if (requests >= 1)
        return `${base}, ${requests} new ${englishPlural(requests, { one: 'request', other: 'requests' })}`;
      if (live) return `${base}, a friend is in a pub right now`;
      if (unread) return `${base}, something new`;
      return base;
    },
    openParta: 'Open the crew',
    openPartaWithRequests: (n: number) =>
      `Open the crew, ${n} ${englishPlural(n, { one: 'request', other: 'requests' })} waiting`,
    // Back chevron on the Profile > Manage the crew screen.
    manageBack: 'Back to the profile',
    rsvpGroup: 'Are you in?',
    rerollButton: 'Pick a different pub',
    skipButton: 'Skip to the next pub',
    skipButtonHint: 'Skips this pub and finds the next nearest one',
    pubFixButton: 'Pub is missing or wrong',
    renamePubInput: 'New pub name',
    renamePubSaveButton: 'Save the corrected pub name',
    contributeBeersLine: (text: string) => `Beers on tap: ${text}. Tap to fill them in.`,
    contributeDayClosedToggle: (day: string) => `${day}: toggle closed`,
    contributeAddInterval: (day: string) => `${day}: add a time`,
    contributeRemoveInterval: (day: string) => `${day}: remove a time`,
    contributeCopyToAll: 'Copy the times from Monday to every day',
    contributeAddBeer: 'Add a beer',
    contributeBeerMenuType: (label: string) => `Beer menu type: ${label}`,
    contributeRemoveBeer: 'Remove beer',
    contributeRestoreHistoricalBeer: (name: string) => `Put ${name} back on the current list`,
    contributeSaveButton: 'Save the details',
    addPubButton: 'Add a missing pub',
    addPubNameInput: 'Pub name',
    addPubCityInput: 'Pub town',
    addPubAddressInput: 'Pub address',
    addPubSuggestion: (name: string) => `Pick the place ${name}`,
    addPubUseCurrentLocationButton: 'Use my current location for the new pub',
    addPubCurrentLocationSelected: 'The new pub will use your current location',
    addPubMapPinSelected: 'The new pub will use the pin from the map',
    mapPinCancel: 'Cancel adding a pub',
    addPubSaveButton: 'Add the pub',
    feedbackCategory: (label: string) => `Category: ${label}`,
    feedbackContactChannel: (label: string) => `Contact via: ${label}`,
    feedbackContactInput: 'Contact for a reply',
    feedbackSubmitButton: 'Send feedback',
    backButton: 'Back',
    communityChallenge: (title: string, done: number, goal: number) =>
      `${title}. ${done} of ${goal} done. Open the challenge`,
    communityEvent: (title: string, when: string, place: string) =>
      `${title}. ${when}. ${place}. Open the event`,
    modeNearestButton: 'Mode: Nearest pub',
    modeSurpriseButton: 'Mode: Surprise me',
    beerBrandFilterInput: 'Filter pubs by a beer brand from the entries',
    beerBrandFilterSuggestion: (name: string) => `Pick the brand ${name}`,
    clearBeerBrandFilter: 'Clear the beer brand filter',
    toggleOtherTapPlaces: 'Include other places with a tap',
    openBeerBrandFilter: 'Open the beer brand filter',
    beerBrandFilterActive: (name: string) => `Beer filter: ${name}. Tap to change`,
    selectBeerBrand: (name: string) => `Filter to ${name}`,
    closeBeerBrandFilter: 'Close the filter',
    openPubFilters: 'Open the pub filters',
    pubFiltersActive: (count: number) => `Active pub filters: ${count}. Tap to change`,
    closePubFilters: 'Close the pub filters',
    clearPubFilters: 'Clear all pub filters',
    applyPubFilters: 'Apply the selected pub filters',
    togglePubAmenityFilter: (name: string) => `Filter by the feature ${name}`,
    priceFilterMinSlider: 'Lowest beer price',
    priceFilterMaxSlider: 'Highest beer price',
    priceFilterValue: (label: string) => `Price limit: ${label}`,
    pubPriceAge: (price: string, age: string) => `Beer for ${price}, price from ${age}`,
    beerMap: 'Beer map of pubs, places you have visited and friends',
    mapSwitchCompass: 'Switch to the compass',
    mapSwitchCompassSelected: 'Compass is selected',
    mapSwitchMap: 'Map is selected',
    mapSwitchToMap: 'Switch to the map',
    openBeerMap: 'Open the beer map',
    mapLocate: 'Find me on the map',
    mapList: 'Show places as a list',
    mapRefresh: 'Refresh places and the crew',
    mapPub: (name: string, visits: number) =>
      visits > 0
        ? `${name}, visited ${visits} ${englishPlural(visits, { one: 'time', other: 'times' })}`
        : `${name}, not visited yet`,
    mapReportClosed: (name: string) => `Report ${name} as closed down`,
    mapLive: (friend: string, pub: string) => `${friend} is in ${pub} right now`,
    mapCity: (city: string, visits: number) => `${city}, ${visits} beer nights. Zoom in`,
    mapCluster: (count: number) => `${count} places. Zoom in`,

    // "Map the pub" / Mapper
    // `into`/`next` are the into-level XP numbers shown on the visible bar so the
    // spoken progress matches the rendered progress. `next == null` = maxed level.
    mapperLevel: (n: number, title: string, into: number, next: number | null) =>
      next == null
        ? `Mapper level ${n}, ${title}, you have it all`
        : `Mapper level ${n}, ${title}, ${into} of ${next} XP`,
    pivarLevel: (n: number, title: string, into: number, next: number | null) =>
      next == null
        ? `Drinker level ${n}, ${title}, you have it all`
        : `Drinker level ${n}, ${title}, ${into} of ${next} XP`,
    // Mapper badge state (announced after the title so VoiceOver reads e.g.
    // "Explorer, done" or "Explorer, locked, Map 10 pubs").
    badgeUnlocked: (title: string) => `${title}, done`,
    badgeLocked: (title: string, hint: string) => `${title}, locked, ${hint}`,

    // Global leaderboards
    leaderboardRow: (rank: number, name: string, score: number, unit: string) =>
      `${rank}. ${name}, ${score} ${unit}`,
    leaderboardCategory: 'Leaderboard category',
    leaderboardPeriod: 'Leaderboard period',
    leaderboardsOpen: 'Open the leaderboards',

    // Tabs
    tabCompass: 'Compass tab',
    tabBeer: 'Regular tab',
    tabFriends: 'Crew tab',
    // 3.0 navigation (§17.1)
    tabFeed: 'Hangovers tab',
    tabPubs: 'Pubs tab',
    tabParty: 'Party tab',
    tabCommunity: 'Community tab',
    beerSegmentCount: 'Switch to counting beers',
    beerSegmentStats: 'Switch to performance stats',
    beerSegmentHistory: 'Switch to the history of nights',
    counterDone: 'Finished, close this night',
    counterResume: 'Carry on with the previous night',
    tabProfile: 'Profile tab',

    // Counter
    counterCloseModal: 'Close',
    counterPickPub: (name: string, distance: string) =>
      `${name}, ${distance}. Tap to pick.`,
    counterCountBeer: (name: string, price: string) =>
      `Add ${name} for ${price}`,
    counterCountBeerNoPrice: (name: string) =>
      `Add ${name}, enter the price first`,
    counterEditBeer: (name: string) => `Edit the price of ${name}`,
    counterRemoveBeer: (name: string) => `Remove the last ${name}`,
    counterAddBeer: 'Add a new beer',
    counterRequestLocation: 'Allow location',
    counterRetry: 'Look for a pub again',
    counterRepeat: (name: string) => `Log the same beer: ${name}`,
    counterMore: 'More options for this night',
    // Coaster surface
    counterCoaster: (countLabel: string, spent?: string) =>
      `${countLabel}${spent ? `, ${spent} spent` : ''}. Opens your bill.`,
    counterCoasterEmpty: 'Clean coaster, nothing on it yet',
    counterPlaceChip: (place: string) => `Change the place. Now ${place}.`,
    counterUndoStrip: 'Take back the last beer',
    counterRapidConfirm: 'Yes, log it',
    counterCheckinDismiss: 'Close the rating prompt',
    counterReceiptChip: 'Open your bill',
    counterQuickOtherBeer: 'Pick another beer or drink',
    counterQuickMapPub: 'Fill in details about the pub',
    counterRemoveIdentity: (name: string) => `Remove the last ${name} from your bill`,

    // My beers
    myBeersEvening: (pub: string, summary: string) =>
      `Night at ${pub}, ${summary}. Tap for detail.`,
    myBeersAddHistorical: 'Log beers after the fact',
    myBeersAddDrinkToEvening: 'Add a beer to this night',
    myBeersRemoveHistoricalBeer: (beer: string) => `Remove the beer ${beer}`,
    myBeersDiaryEntry: (beer: string, meta: string) =>
      `Entry for ${beer}${meta ? `, ${meta}` : ''}. Tap for detail.`,
    ratingLike: (pub: string) => `Rate ${pub} as good`,
    ratingDislike: (pub: string) => `Rate ${pub} as weak`,
    ratingNote: (note: string) => `Label: ${note}`,
    ratingNoteInput: (pub: string) => `Your own note about ${pub}`,

    // Profile
    profileMore: 'What else? Settings, leaderboards and more',
    profileCard: (beers: string, level: string) =>
      `${beers} in a lifetime. ${level}. Tap for badges.`,
    profileBadges: 'Open the badges',
    profileIdentity: 'Edit the profile',
    profileDiary: 'Open the private beer diary',
    profileParta: 'Open the crew',

    // Crew
    partaMore: 'What else? Settings, leaderboards and more',
    partaChip: (friends: string) => `Your Crew, ${friends}. Tap for the whole Crew.`,
    partaCard: (count: string, headline: string) =>
      `${count} of the crew out for a beer today. ${headline} Tap for the list.`,
    partaTable: "Who's going today",
    presenceRow: (name: string, pub: string) =>
      `${name} is sitting ${pub} right now. Tap for the profile.`,
    presenceRowMine: (pub: string) => `You're sitting ${pub} right now. Tap for the profile.`,
    presenceCompass: (pub: string) => `Show ${pub} on the compass`,
    sittingRow: (name: string, what: string, where: string, when: string) =>
      `${name}, ${what}, ${where}${when ? `, ${when}` : ''}. Tap for the profile.`,
    partyGameBeerCounter: (count: string) =>
      `You have ${count}. Add another.`,

    // Compass
    compassMore: 'What else? Map, filters and more',
    compassCard: (pub: string, distance: string, status: string) =>
      `${pub}, ${distance}${status ? `, ${status}` : ''}. Tap for pub info.`,
    compassCardHidden: "The pub is hidden. Tap and I'll tell you where.",
    compassLoading: 'Looking for the nearest pub',
    compassNavigate: (pub: string) => `Take me to ${pub}, opens navigation`,
    compassAnother: 'Pick me a different pub',
    compassBackToNearest: 'Back to the nearest pub',
    compassClearFilters: 'Clear all filters',

    // Diary
    diarySegment: 'Switch to the diary of nights',
    diaryCard: (count: string, pub: string, when: string) =>
      `Last night out: ${count} at ${pub}, ${when}. Tap for the breakdown.`,
    diaryCardEmpty: 'No night logged yet',
    diaryNight: (pub: string, meta: string) => `Night ${pub}, ${meta}. Tap for detail.`,
    diaryStats: 'Show the all-time numbers',
    diaryStatsClose: 'Close the numbers',
    diaryRetry: 'Load the diary again',

    // Account / sign-in
    accountRow: 'Open the account',
    authEmailInput: 'Email',
    authPasswordInput: 'Password',
    authResetEmailInput: 'Email for the password reset',
    authResetCodeInput: 'Password reset code',
    authNewPasswordInput: 'New password',
    authTabLogin: 'Switch to logging in',
    authTabRegister: 'Switch to signing up',
    authForgotPassword: 'Forgotten password',
    authSignInApple: 'Continue with Apple',
    authSignInGoogle: 'Continue with Google',
    accountVerifyEmail: 'Verify email',
    accountLinkProvider: (provider: string) => `Link ${provider}`,
    accountUnlinkProvider: (provider: string) => `Unlink ${provider}`,
    accountSetPassword: 'Set a password',
    accountExportData: 'Share my data export',
    accountMethods: 'Open the sign-in methods',
    accountMore: 'Open more account options',
    accountIdentity: (name: string, email: string, methods: string) =>
      `${name}. ${email || 'No email set'}. Sign-in: ${methods}.`,
    accountRestorePurchases: 'Restore purchases',
    accountReportProfile: 'Report the profile',
    accountLogout: 'Log out',
    accountRetry: 'Load the account again',
    accountDelete: 'Delete the account',

    // Profile
    profileEdit: 'Edit the profile',
    profileVisibility: 'Change profile visibility',
    profileManageAccount: 'Manage the account',
    accountManageData: 'Manage the account and my data',
    profileSettings: 'Open settings',
    profileSignUp: 'Create an account',
    profileNicknameInput: 'Nickname',
    profilePickPhoto: 'Pick a photo from the library',
    profileRemovePhoto: 'Remove the photo',
    profileDisplayNameInput: 'Name',
    profileVisibilityToggle: (state: string) => `Public profile: ${state}`,
    profileClose: 'Close',

    // Beer photos / Beer Snap
    photoAddTile: 'Add a beer photo',
    photoTile: (label: string) => `Beer photo${label ? `, ${label}` : ''}. Tap for detail.`,
    photoContestLink: 'Open the Beer Snap contest',
    photoAlbumLink: 'Open the beer photo album',
    leaderboardsLink: 'Open the drinkers leaderboard',
    partyLeaderboardMetric: 'Crew leaderboard metric',
    photoCaptionInput: 'Photo caption',
    photoPickPub: 'Tag the pub',
    photoClearPub: 'Clear the tagged pub',
    photoVisibility: (label: string) => `Photo visibility: ${label}`,
    photoContestToggle: 'Send the photo straight into the Beer Snap contest',
    photoDelete: 'Delete the photo',
    photoRetry: 'Try uploading the photo again',
    contestVote: (name: string) => `Vote for the photo by ${name}`,
    contestUnvote: (name: string) => `Take back the vote for the photo by ${name}`,
    contestEntryActions: (name: string) => `Options for the photo by ${name}`,
    contestOpenPhoto: (name: string) => `Open the photo by ${name}`,
    contestOpenProfile: (name: string) => `Open the profile of ${name}`,
    contestPhotoActionsHint: 'Press and hold for more photo options.',
    contestPickMyPhoto: (label: string) =>
      `Enter the photo${label ? ` ${label}` : ''} into the contest`,
    friendPhotoTile: (name: string) => `Photo by ${name}. Tap to enlarge.`,
    partaPhotoTile: (name: string) => `Photo by ${name}. Tap to enlarge.`,
    photoViewerClose: 'Close the photo',
    photoViewerRetry: 'Load the photo again',
    communitySearchButton: 'Search',
    contributeTimeHours: (label: string) => `${label} hours`,
    contributeTimeMinutes: (label: string) => `${label} minutes`,
  },

  startup: {
    lockedTitle: 'Your phone kept the account locked',
    lockedBody: 'Unlock it and try again. I am keeping your data locked until then.',
    lockedRetry: 'Try again',
  },

  challengeDetail: {
    routeLoading: 'Loading the challenge',
    routeLoadError: 'The challenge would not load right now.',
    routeRetry: 'Try again',
  },

  beerDetail: {
    // Month names for the "Drinking it since June" relationship line.
    monthName: (index: number) =>
      [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
      ][index] ?? '',
    statMine: 'mine',
    statMyAverage: 'my average',
    statParty: 'crew',
    partyDrinkersHeader: 'WHO IN THE CREW DRANK IT',
    recentHeader: 'LATEST ENTRIES',
    recentEmpty: 'No entry yet.',
    myHistoryHeader: 'MY HISTORY',
    myHistoryEmpty: 'You have not written this beer down yet.',
    noPub: 'No pub',
  },

  homePoint: {
    title: 'Home point',
    lead: 'Where is your home base?',
    addressLabel: 'Address or town',
    addressPlaceholder: 'Like Vinohradská 12, Prague',
    addressA11y: 'Address or town of your home point',
    findOnMapA11y: 'Find the address on the map',
    findOnMap: 'Find on the map',
    searching: 'Looking for the place…',
    or: 'or',
    useCurrentLocation: 'Use my location',
    privacy:
      'I send the address to a geocoding service once, so I can find it on the map. Only the point you confirm stays on your phone, no location history and no routes.',
    mapA11y: 'Map for picking your home point',
    mapHint: 'Find the place, then tap to nudge it',
    refineHint: 'Is the point right? If not, tap the correct spot on the map.',
    permissionDenied:
      'Location is off. Mark your home by tapping the map, or turn location on in your phone settings.',
    clear: 'Delete home point',
    saveChange: 'Save change',
    save: 'Save home',
    emptyQueryError: 'Write an address or a town for me to find.',
    notFoundError: 'I did not find this place. Try adding the street, number or town.',
    searchFailedError: 'The search failed just now. Try again in a bit.',
  },

  suggestPubEvent: {
    title: 'Suggest an event',
    intro: 'Write what is going on in the pub.',
    nameLabel: 'Event name',
    namePlaceholder: 'A pub quiz, say',
    startLabel: 'Start',
    endLabel: 'End',
    detailsLabel: 'Details (optional)',
    detailsPlaceholder: 'Entry fee, booking or what to expect',
    moderation:
      'I check every suggestion first. Once it passes, it shows up in the pub detail. Nobody else sees unverified or finished events.',
    submitA11y: 'Send the suggestion for review',
    submit: 'Send for review',
    submitting: 'Sending…',
    submitted: 'Your suggestion is at the tap, waiting for review.',
    invalidError: 'Check the name and the times. The end has to be after the start.',
    authError: 'Your login expired. Sign in and try again.',
    rejectedError: 'The server did not take this one. Check the times and how long the event runs.',
    offlineError: 'The server is not answering. Your suggestion stayed in the form, try again in a bit.',
  },

  currency: {
    // The suffix is the currency symbol; CZK always renders as "Kč".
    pricePlaceholder: (suffix: string) => `Price (${suffix})`,
  },

  nearestMap: {
    backA11y: 'Back',
    permissionDenied: 'Turn location on and I will point you at the nearest pub.',
    loadFailed: 'I could not load the pub just now.',
    searching: 'Looking for the nearest pub…',
    allowLocation: 'Allow location',
    retry: 'Try again',
    recentreA11y: 'Centre on the pub',
  },

  publicProfile: {
    relationshipFriend: 'Mate',
    relationshipAccept: 'Accept',
    handleFallback: 'Drinker',
    busy: 'One sec…',
    invite: 'Beer?',
    inviteA11y: (handle: string) => `Invite ${handle} for a beer`,
    removeConfirmTitle: (handle: string) => `Remove ${handle} from the crew?`,
    removeKeep: 'Keep them',
    removeAction: 'Remove',
    loadingA11y: 'Loading the profile',
    loadFailed: 'The profile did not load',
    retry: 'Try again',
    backA11y: 'Back',
    moreA11y: 'More profile options',
    nightsTogether: (count: number) =>
      `You have been for a beer together ${englishPlural(count, { one: 'once', other: `${count} times` })}`,
    nightsTogetherNone: 'You have not been out together yet',
    totalsTitle: 'Total',
    badgesTitle: 'Badges',
    statMapper: 'Mapper',
    nightsLoadingA11y: 'Loading nights',
  },

  pubList: {
    // Opening state on a pub row / compass cell.
    openLoading: 'Loading opening hours',
    open: 'Open',
    openUntil: (time: string) => `Open until ${time}`,
    closed: 'Closed',
    closedUntil: (time: string) => `Closed · opens at ${time}`,
    hoursUnknown: 'Opening hours unknown',
    beerWithPrice: (name: string, czk: number) => `${name}  (${czk} Kč)`,
    beerFrom: (czk: number) => `Beer from ${czk} Kč`,
    addressUnknown: 'Address unknown',
    lastVisitToday: 'today',
    lastVisitYesterday: 'yesterday',
    distanceUnknown: 'distance unknown',
    cellA11y: (badge: string, name: string, distance: string) =>
      `${badge} pub ${name}, ${distance}`,
    carouselA11y: (name: string, distance: string) => `${name}, ${distance}, detail`,
    clusterA11y: (pubs: string) => `${pubs}. Zoom in`,
    // Beer filter sheet.
    filterClearA11y: 'Clear the selection',
    filterClear: 'Clear',
    filterApplyA11y: 'Apply the filter',
    filterShowCount: (count: number) => `Show (${count})`,
    filterShowAll: 'Show all',
    // Sort menu and the badge on the head cell it explains.
    sortTitle: 'Sort',
    sortNearest: 'Nearest',
    sortRating: 'Best rated',
    sortRandom: 'Random nearby',
    badgeNearest: 'Nearest',
    badgeRating: 'Best rated',
    badgeRandom: 'Random',
    // Filter chips.
    toggleOpen: 'Open',
    toggleTank: 'Tank',
    toggleGarden: 'Garden',
    beerChip: 'Beer',
    beerChipCount: (count: number) => `Beer (${count})`,
    beerChipA11y: (names: string) => `Beer: ${names}`,
    beerChipPick: 'Pick beers',
    visitedA11y: 'You know this pub already',
    // Map and list chrome.
    placesList: 'Pub list',
    centreOnMe: 'Centre on me',
    allowLocation: 'Allow location',
    searchA11y: 'Search for a pub or a beer',
    searchPlaceholder: 'Find a pub or a beer',
    staleBanner: 'Showing the last saved pubs.',
    staleRefresh: 'Refresh',
    noLocationBanner: 'Without location I cannot work out the distance.',
    noLocationAllow: 'Allow',
    // List states.
    loadingPubs: 'Looking for pubs…',
    permissionDenied: 'Turn location on and I will show you what is around.',
    loadFailed: 'I could not load the pubs just now.',
    emptyNearby: 'Nothing around here yet.',
    retry: 'Try again',
    noFilterMatch: 'I have nothing for this filter combination.',
    clearFilters: 'Clear filters',
  },

  search: {
    tabPubs: 'Pubs',
    tabBeers: 'Beers',
    tabPeople: 'Drinkers',
    loadingA11y: 'Searching',
    failed: 'The search did not work just now.',
    noResults: 'Found nothing. Try something else.',
    tooShort: 'Type at least two letters.',
    placeholder: 'A pub, a beer or a drinker',
    clear: 'Clear',
    cancel: 'Cancel',
    cancelA11y: 'Cancel the search',
    recent: 'Recent',
    peopleYouMayKnow: 'Drinkers you might know',
  },

  clientErrors: {
    offline: "I can't reach the server right now.",
    account: "Your account isn't ready yet.",
    auth: 'Your login has expired.',
    network: "The network isn't playing along. Try again in a bit.",
    save: "Couldn't save it. Try again.",
    accountChanged: 'The account changed in the meantime.',
    accountChangedDelete: 'The account changed in the meantime. Confirm the deletion again.',
    invalidResponse: 'The data from the server made no sense. Try again.',
    actionFailed: "That didn't work just now.",
    eventsSignIn: 'Sign in first for home meetups.',
    commentIncomplete: "The comment didn't come back whole.",
    eveningMissing: 'No such night here.',
    eveningSaveFailed: "I couldn't save the night to wrap it up.",
    gameSaveFailed: "I couldn't save the game in progress.",
    gameShareRejected: 'The server turned the game share down.',
    gameShareSaveFailed: "I couldn't save the game for sharing.",
    gameShareFailed: "I couldn't share the game with the table.",
    tableCreateFailed: "Couldn't start the table. Try again.",
    tableJoinFailed: "Joining the table didn't work. Try again.",
    inviteAccountChanging: 'Your account is changing right now. Try the invite again in a moment.',
  },

  auth: {
    genericError: 'Something went wrong. Try again.',
    network: "Couldn't reach the server. Check your connection and try again.",
    photoDeletionsPending: 'I need to finish deleting photos first. Get online and try again.',
    photoDeletionsRekeyFailed: "I couldn't carry the half-done photo deletion over. Free up space on your phone and try again.",
    sessionBoundaryFailed: "Signing out didn't finish. Unlock your phone and try again.",
    credentialBoundaryFailed: "I can't finish signing you in until the old data on your phone is gone. Free up space and try again.",
    accountDeletionReceiptFailed: "Deleting the account can't finish on your phone. Free up space, unlock your phone and try again.",
    accountDeletionRecovered: 'I finished the earlier deletion. If you want this account gone too, confirm it again.',
    invalidSession: "The server didn't send a valid login. Try again.",
    sessionStorage: "I couldn't save your login. Unlock your phone and try again.",
    socialUnsupported: "This way of signing in doesn't work on your phone.",
    socialMisconfigured: "Google sign-in isn't set up right now. Use email for the moment.",
    socialPlayServices: 'Google Play services are missing or out of date. Update them, or sign in with email.',
    socialAccountPicker: "I couldn't open the Google account picker. Check the account on your phone, try again, or sign in with email.",
    socialFailed: "Signing in with Google or Apple didn't work. Try again.",
    signInFailed: "Sign-in didn't work.",
  },

  xp: {
    account: {
      rookie: 'Rookie',
      taster: 'Taster',
      journeyman: 'Beer journeyman',
      barkeep: 'Barkeep',
      brewmaster: 'Brewmaster',
      beerMaster: 'Beer master',
      beerLegend: 'Beer legend',
    },
    mapper: {
      newcomer: 'Newcomer',
      noticer: 'Noticer',
      regular: 'Regular',
      connoisseur: 'Connoisseur',
      pubSage: 'Pub sage',
      cartographer: 'Beer cartographer',
      localLegend: 'Local legend',
    },
  },

  amenities: {
    outdoorTap: {
      label: 'Outdoor tap',
      short: 'Tap',
    },
    tankBeer: {
      label: 'Tank beer',
      short: 'Tank',
    },
  },

  liveParty: {
    // People
    you: 'You',
    someone: 'Someone',
    fallbackPlayer: (n: number) => `Player ${n}`,
    // Hub header
    pickPubPlaceholder: 'Pick a pub',
    tapPrice: (price: number) => `${price} CZK`,
    addAction: (label: string) => `Add: ${label}`,
    a11yMinimize: 'Minimise the night',
    a11yOpenBill: 'Open the bill',
    billPill: 'Bill',
    a11yEndNight: 'End the night',
    endPill: 'End',
    a11yChangePub: (pubName: string) => `${pubName}. Change pub.`,
    a11yInvite: 'Invite to the table',
    invitePill: 'Invite',
    a11yTableWith: (names: string) => `At the table: you, ${names}`,
    a11yTableAlone: 'At the table: you',
    a11yJoinWithCode: 'Join a table with a code',
    joinPrompt: 'Someone already started a table?',
    joinLink: 'Join with a code',
    // Before the night
    idlePubLabel: 'Pub',
    idleTableLabel: 'Table',
    idleGamesLabel: 'Games',
    idleGamesMore: (n: number) => `and ${n} more`,
    idleGamesSoon: 'Coming in the next version',
    a11yOpenGames: 'Open games',
    idleSeatedTitle: 'Already at the pub',
    idleLastTitle: 'Last time',
    a11yLastNight: (label: string) => `Last time out, ${label}. Open.`,
    pickPubTitle: 'Where are you sitting?',
    pickPubSearch: 'Find a pub',
    pickPubNearby: 'Around you',
    pickPubPicked: 'picked',
    pickPubNoNearby: "I can't see a pub around you yet. Try searching.",
    pickPubNoResults: 'Nothing found. Try another name.',
    pickPubClear: 'Clear the search',
    // The thread
    threadNightStarted: (pubName: string) => `Night started at ${pubName}`,
    threadMovedTo: (pubName: string) => `Moved to ${pubName}`,
    threadJoined: (name: string) => `${name} is at the table`,
    threadPhoto: 'Photo',
    gamePlacedSelf: (game: string) => `You put ${game} on the table`,
    gamePlacedOther: (name: string, game: string) => `${name} put ${game} on the table`,
    a11yGameResult: (game: string) => `${game}, result`,
    a11yGameStart: (game: string) => `Start ${game}`,
    gamePaying: (name: string) => `Round on ${name}`,
    gameWinner: (name: string) => `${name} won`,
    gamePlayed: 'Played',
    gamePlayedNoWinner: 'Played, nobody won',
    gameTapToPlay: 'Tap and play',
    rowMenuTitle: 'What was it?',
    rowEdit: 'Edit',
    undoLogged: (name: string) => `Logged: ${name}`,
    a11yUndo: (name: string) => `Undo ${name}`,
    undoAction: 'Undo',
    // Controls
    photo: 'Photo',
    photoWithCount: (count: number) => `Photo, ${count}`,
    a11yAddDrink: (name: string) => `Add ${name}`,
    a11yStartNight: 'Start the night with the first drink',
    startNight: 'Start the night',
    a11yPickOtherDrink: 'Pick another drink',
    games: 'Games',
    editDrinkTitle: 'Edit the drink',
    // Stopwatch and the minimised bar
    clockUnit: 'night',
    a11yBar: (pubName: string, beers: string) => `Night running, ${pubName}, ${beers}. Open.`,
    a11yAddBeer: 'Add a beer',
    // Pulse
    pulseIdle: 'Still dry',
    pulseIdleBasis: 'The night starts with the first beer.',
    pulseFirst: 'Getting going',
    pulseFirstBasis: (minutes: number) => `First beer ${minutes} min ago`,
    pulseFirstNow: 'First beer just now',
    pulsePaused: 'Break',
    pulsePausedBasis: (minutes: number) => `No beer for ${minutes} min`,
    pulseSteady: 'Night running',
    pulseSteadyBasis: (minutes: number) => `Last entry ${minutes} min ago`,
    statMyBeers: 'your beers',
    statBeers: 'beers',
    statLoggedBeers: 'beers logged',
  },

  finishNight: {
    errorCloseTablePublished: 'The post is saved, but I could not close the table. Try again.',
    errorLeaveTablePublished: 'The post is saved, but I could not leave the table. Try again.',
    errorCloseTable: 'I could not close the table. Try again.',
    errorLeaveTable: 'I could not leave the table. Try again.',
    errorSavePost: 'I could not save the post. Try again.',
    errorFinish: 'I could not finish the night. Try again.',
    a11yBack: 'Back to the night',
    title: 'End the night',
    statBeers: 'Beers',
    statNight: 'Night',
    statAtTable: 'At the table',
    statKinds: 'Kinds',
    photosLabel: 'Photos',
    a11yAddPhoto: 'Add a photo',
    gamesLabel: 'Games',
    gamePaying: (game: string, name: string) => `${game} · round on ${name}`,
    gameWinner: (game: string, name: string) => `${game} · ${name} won`,
    gamePlayed: (game: string) => `${game} · played`,
    roastLabel: 'Roast of the night',
    a11yRoastSwitch: 'Add the roast to the post',
    titlePlaceholder: 'What do you call it',
    a11yTitleInput: 'Night title',
    previewLabel: 'This is how it goes out',
    visibility: 'Your crew will see it',
    a11yPublish: 'End and publish the night',
    publishing: 'Saving…',
    publish: 'End and publish',
    a11yFinishPrivate: 'End the night without publishing',
    finishPrivate: 'End without publishing',
  },

  partyRecap: {
    recovering: 'Pulling up the last night…',
    empty: 'No finished night yet.',
    failed: 'I cannot load that night right now.',
    a11yShare: 'Share the night',
    statBeers: 'Beers',
    statNight: 'Night',
    statPubs: 'Pubs',
    sectionPeople: 'Who was there',
    sectionStops: 'Stops',
    sectionChart: 'How it went',
    sectionGames: 'Games',
    gamePaying: (name: string) => `Round on ${name}`,
    gameWinner: (name: string) => `${name} won`,
    gamePlayed: 'Played',
  },

  partyDrinkSheet: {
    title: 'What are you having?',
    newDrink: 'New drink',
    scanMenu: 'Scan the menu',
  },

  partyBeers: {
    a11yAdd: (beer: string) => `Have a ${beer}`,
    price: (czk: number) => `${czk} CZK`,
    alreadyCount: (count: number) => `${count}× already`,
    a11yOwnBeer: 'Log your own beer',
    otherBeer: 'Another beer',
    customTitle: 'What are you drinking?',
    customPlaceholder: 'Brand and degrees',
    save: 'Log it',
    sheetTitle: 'What you are drinking',
    sheetSubtitle: 'Fix the counts or have something else.',
  },

  partyInvite: {
    shareWithLink: (link: string, code: string) =>
      `Join my table in Na pivo: ${link}\nCode: ${code}`,
    shareWithoutLink: (code: string) => `Join my table in Na pivo. Code: ${code}`,
    linkCopied: 'Link copied.',
    title: 'Invite to the table',
    hintScanOrRead: 'Scan the code, or read it out loud.',
    hintReadAloud: 'Read the code out loud.',
    creatingCode: 'Making the code. One moment.',
    a11yCopyLink: 'Copy the link',
    friendsSection: 'Friends',
    retry: 'Load again',
    emptyFriends: 'Nobody in your crew yet.',
    friendFallbackName: 'Drinker',
    atTable: 'At the table',
    sent: 'Sent',
    a11ySendCode: (name: string) => `Send the code: ${name}`,
    sendCode: 'Send the code',
    joinTitle: 'Join a table',
    a11yCodeField: 'Table code',
    a11yJoin: 'Join',
    joining: 'Joining…',
    join: 'Join',
  },

  nightChart: {
    empty: 'Nothing to draw yet.',
    barChart: 'Bar chart',
    pieChart: 'Pie chart',
  },

  games: {
    quiz: {
      name: 'Pub quiz',
      blurb: 'Everyone on their own phone. Who knows more.',
      how: 'Same question on every phone. Tap an answer and it locks. Nothing shows until everyone has answered.',
      intro: 'You answer for yourself. Nobody sees your tap until everyone has answered.',
    },
    dice: {
      name: 'Dice',
      blurb: 'Last one left pays.',
      how: "Everyone rolls. Highest takes the round. Win three and you're off the hook. Whoever is left pays the round.",
      intro: "Win three rounds and you're safe.",
    },
    categories: {
      name: 'Categories',
      blurb: 'Stall and you take a point.',
      how: 'Someone names a category. You go round the table, whoever stalls takes a point.',
      intro: 'Stall and you take a sip.',
    },
    never: {
      name: 'Never have I ever…',
      blurb: 'Whoever did it owns up.',
      how: 'You say something you have never done. Anyone who has raises a hand.',
      intro: 'Whoever did it raises a hand.',
    },
    kings: {
      name: 'King’s Cup',
      blurb: 'Cards, and whatever rules you make up.',
      how: 'You draw cards, each one has a rule. King goes in the middle, the fourth one pays the round.',
      intro: 'Draw a card. Whatever is on it, that is the rule.',
    },
    round: {
      name: 'Who pays the round',
      blurb: 'Names run through the drum. Somebody has to pay.',
      how: 'Spin the drum of names. When it slows down and stops, that person pays the round.',
      intro: 'Names run through the drum. Somebody has to pay.',
    },
    bottle: {
      name: 'Bottle',
      blurb: 'It spins, it points, it asks.',
      how: 'Spin it. Whoever it points at answers one question from the table.',
      intro: 'Spin it. Whoever it points at is up.',
    },
    thumb: {
      name: 'Thumb',
      blurb: 'Last one to notice takes a bow.',
      how: 'Put your thumb on the table, quietly. The last one to notice bows to the pub.',
      intro: 'Put your thumb on the table. Quietly.',
    },
    rules: {
      name: 'Rule of the night',
      blurb: 'One rule, and it holds until morning.',
      how: 'Make up a rule, like "no names". Break it and you take a bow.',
      intro: 'One rule, and it holds until morning.',
    },
  },

  gameContent: {
    never: [
      'Never have I ever got the wrong pub and waited half an hour for someone sitting somewhere else.',
      'Never have I ever fallen asleep on the tram and gone past the last stop.',
      "Never have I ever sung something loudly in a pub that I don't know the words to.",
      'Never have I ever ordered a beer I could not read off the tap.',
      'Never have I ever forgotten where my jacket is.',
      'Never have I ever claimed I know my beer and then ordered the cheapest one.',
      "Never have I ever joined a table of people I didn't know.",
      'Never have I ever rung someone at two in the morning "just for a minute".',
      "Never have I ever had something with my beer that doesn't go with it at all.",
      'Never have I ever bet a round and won.',
      'Never have I ever gone out "for just the one".',
      'Never have I ever mixed up two people at the same table all night.',
      'Never have I ever photographed my food in a pub.',
      'Never have I ever gone back to the pub for my phone.',
      'Never have I ever told the landlord this beer was poured differently from last time.',
      'Never have I ever walked home across the whole city because "it is just round the corner".',
      'Never have I ever promised the next round was on me and then regretted it.',
      'Never have I ever pretended I know the band playing on the radio.',
      "Never have I ever sat in a pub without working out how you're meant to order.",
      'Never have I ever turned up first and pretended I was late as well.',
      'Never have I ever had a soft drink and claimed it makes no difference.',
      'Never have I ever argued about which pub has the better tank beer.',
      'Never have I ever lost the bill and acted like it never happened.',
      'Never have I ever let someone pick my beer and then regretted it.',
      'Never have I ever claimed I have an early start tomorrow.',
    ],
    categories: [
      'Czech breweries',
      'Things with foam on them',
      'Reasons to go for just the one',
      'Things you can have with a beer',
      'Pub one-liners',
      'Cities where you have had a beer',
      'Brands you can tell by taste',
      'Things that never belong in beer',
      'Excuses for turning up late',
      'Things you can leave behind in a pub',
      'Types of landlord',
      'Things written on a beer mat',
      'Things a table does while the food is coming',
      'Beer styles',
      "What to say when you don't know what to order",
      'Reasons to go home',
      'Things every pub has',
      'Pub sounds',
      'Things people say in a toast',
      'Things you cannot explain in the morning',
    ],
    rules: [
      'No names. Call someone by their name and you take a bow.',
      'You hold your beer in your left hand only.',
      'Nobody says "beer". Call it what you like, just not that.',
      'Before every toast you have to thank someone.',
      'Look at your phone and you pay the next round.',
      'Everyone gets a nickname and nobody may be called anything else.',
      'Say "no" and you stand up and take a bow.',
      'Nobody may point.',
      'Move seats and a new night begins.',
      'Every sentence has to start with "apparently".',
      'Laugh out loud and you make the next toast.',
      'No talking about work. Try it and you take a bow.',
    ],
    thumb: [
      'Put your thumb on the table, quietly. The last one to notice bows to the pub.',
    ],
    kings: {
      ace: {
        title: 'Toast',
        rule: 'Raise your glass. The whole table joins in and drinks to the night.',
      },
      two: {
        title: 'You',
        rule: 'Pick one person. Until the round ends they repeat everything you say.',
      },
      three: { title: 'Me', rule: 'Make up a new name. That is who you are until the game ends.' },
      four: {
        title: 'Floor',
        rule: 'Everyone touches the floor. The last one bows to the whole pub.',
      },
      five: { title: 'Lads', rule: 'The lads at the table sing one chorus.' },
      six: { title: 'Girls', rule: 'The girls at the table sing one chorus.' },
      seven: { title: 'Sky', rule: 'Hands up, everyone. The last one takes a bow.' },
      eight: {
        title: 'Mate',
        rule: 'Pick a partner. From now on you are a team and you say everything together.',
      },
      nine: {
        title: 'Rhyme',
        rule: 'Say a word. Go round rhyming, whoever stalls takes a bow.',
      },
      ten: {
        title: 'Category',
        rule: 'Call out a category. Anyone who comes up with nothing takes a bow.',
      },
      jack: {
        title: 'Rule',
        rule: 'Make up a rule that holds until the game ends.',
      },
      queen: { title: 'Questions', rule: 'Until the next queen you answer only with a question.' },
      king: { title: 'King', rule: 'Into the middle. The fourth king pays a round for the table.' },
    },
  },

  quiz: {
    questions: {
      qPlzen: {
        text: 'What year was Pilsner Urquell first brewed?',
        options: ['1842', '1869', '1795', '1901'],
      },
      qStupne: {
        text: 'What do the degrees on a Czech beer tell you?',
        options: ['The alcohol content', 'The sugar in the wort', 'The fermentation temperature', 'The amount of hops'],
      },
      qChmel: {
        text: 'Which region is best known for growing Czech hops?',
        options: ['Around Znojmo', 'Around Mělník', 'Around Žatec', 'Around Kladno'],
      },
      qSpotreba: {
        text: 'Where does Czechia rank in the world for beer drunk per head?',
        options: ['Third', 'Eighth', 'Fifteenth', 'First'],
      },
      qTank: {
        text: 'What does "tank beer" mean?',
        options: [
          'Beer poured straight from a large tank',
          'Beer from a metal keg',
          'Beer served at higher pressure',
          'Beer brewed to order',
        ],
      },
      qLezak: {
        text: 'How long is a lager traditionally left to mature?',
        options: ['A few hours', 'A few days', 'A few weeks', 'A few years'],
      },
      qCistonos: {
        text: 'What do you call the foam left on the glass after each sip?',
        options: ['Cap', 'Lacing', 'Wreath', 'Hat'],
      },
      qSvetle: {
        text: 'Which beer style was born in Plzeň?',
        options: ['Wheat beer', 'Stout', 'Porter', 'Pale lager'],
      },
      qHospoda: {
        text: 'What is a "šnyt"?',
        options: [
          'A small beer with a tall head',
          'A beer with no head',
          'A small beer for the driver',
          'Beer with lemonade',
        ],
      },
      qMlyn: {
        text: 'Which town has the oldest working brewery in Czechia?',
        options: ['Žatec', 'Broumov', 'Rakovník', 'Plzeň'],
      },
      qSvatek: {
        text: 'When is Czech Beer Day?',
        options: ['1 May', '17 November', '27 September', '6 January'],
      },
      qSlad: {
        text: 'What is malt made from?',
        options: ['Hops', 'Yeast', 'Potato starch', 'Sprouted grain'],
      },
    },
  },

  gameShell: {
    fallbackTitle: 'Game',
    whoPlays: 'Who is playing',
    invite: 'Invite to the table',
    startWithCount: (count: number) => `Start, ${count} of you playing`,
    startWithCountA11y: (count: number) => `Start, ${count} playing`,
    needTwo: "Two at least, or it's not a game",
    needTwoA11y: 'You need at least two players',
    unknownPlayer: 'Player',
    playerNumber: (index: number) => `Player ${index}`,
    nameJoiner: ' and ',
    diceTwelve: (name: string) => `${name} rolled twelve!`,
    diceSnakeEyes: (name: string) => `${name}… two. Ouch.`,
    diceHigh: (name: string, sum: number) => `${name} ${sum}`,
    roundWinner: (name: string) => `${name} takes the round`,
    roundWinners: (names: string) => `${names} take the round`,
    lowestRoll: (name: string) => `${name} rolled lowest.`,
    yourTurnRoll: 'Your roll',
    turnRoll: (name: string) => `${name} is rolling`,
    nextRound: 'Next round',
    roll: 'Roll',
    rollFor: (name: string) => `Roll for ${name}`,
    spin: 'Spin',
    spinAgain: 'Spin again',
    drawCard: 'Draw a card',
    again: 'Again',
    againAction: (action: string) => `${action} again`,
    deckDone: 'All done',
    cardsLeft: (count: number) => `${count} left`,
    next: 'Next',
    promptA11y: (prompt: string) => `${prompt} Tap for the next one.`,
    quizWaiting: (names: string) => `Locked in. Waiting on ${names}`,
    quizCorrect: (answer: string) => `${answer}, correct`,
    quizSkipWait: "Don't wait",
    quizSkipWaitA11y: 'Show the answer without waiting',
    quizResults: 'Results',
    quizNextQuestion: 'Next question',
    drumA11y: 'Drum of player names',
    roundForTable: 'A round for the table.',
    backToNight: 'Back to the night',
    backToNightScreen: 'Back to the night',
    turnPick: (name: string) => `${name} is up`,
    scoreA11y: (name: string, score: number) => `Point for ${name}. Now ${score}`,
    localOnlyGame: (detail: string) => `The game is running on this phone only. ${detail}`,
    endGame: 'End',
    endGameA11y: 'End the game',
    tapScorer: 'Tap whoever scored.',
    tapSipper: 'Tap whoever got the point.',
  },

  community: {
    loading: 'Loading the community',

    // Sections and pickers (state uses English keys; these are the labels)
    sectionBoards: 'Leaderboards',
    sectionChallenges: 'Challenges',
    sectionEvents: 'Events',
    metricPubs: 'Pubs',
    metricMapper: 'Mapper XP',
    periodWeek: 'Week',
    periodYear: 'This year',
    periodAll: 'All time',
    metricChipTitle: 'Sort by',
    periodChipTitle: 'Which period',

    // Leaderboards
    boardFailed: 'The leaderboard did not load. Pull down and try again.',
    boardRank: (rank: number) => {
      const lastTwo = rank % 100;
      const suffix =
        lastTwo >= 11 && lastTwo <= 13
          ? 'th'
          : rank % 10 === 1
            ? 'st'
            : rank % 10 === 2
              ? 'nd'
              : rank % 10 === 3
                ? 'rd'
                : 'th';
      return `${rank}${suffix} place`;
    },
    boardEmpty: 'Nobody is on this board yet.',

    // Challenges
    challengesFailed: 'The challenges did not load. Pull down and try again.',
    challengesEmpty: 'No challenge is running right now.',
    challengeMeta: (deadline: string, done: number, goal: number) =>
      `Until ${deadline} · ${done} of ${goal}`,
    challengeDeadline: (date: string) => `Until ${date}`,
    challengeGoal: (goal: number, unit: string) => `of ${goal} ${unit}`,
    challengeGoalShort: (goal: number) => `of ${goal}`,
    challengeRules: 'What counts',
    challengeRivals: 'Who else is in',

    // Events
    eventsFailed: 'The events did not load. Pull down and try again.',
    eventsEmpty: 'No events near you right now.',
    eventsSignIn: 'Sign in for events',
    eventsMine: 'My events and a new meetup',

    // People suggestions
    suggestionsLoading: 'Loading suggested drinkers',
    suggestionSharedPubs: (count: number) =>
      count === 1 ? 'One pub in common' : `${count} pubs in common`,
    suggestionSharedFriends: (count: number) =>
      count === 1 ? 'One friend in common' : `${count} friends in common`,
  },

  feed: {
    retryA11y: 'Try loading Hangovers again',
    refreshA11y: 'Try loading new nights',
    searchA11y: 'Search',
    profileA11y: (name: string) => `Profile of ${name}`,
    nightMenuA11y: 'Night options',
    momentsA11y: 'Moments from the night',
    openNightA11y: (title: string) => `Open the night ${title}`,
    commentsA11y: (count: number, noun: string) => `${count} ${noun}. Open the night.`,

    // Played game tile
    gamePlayed: 'PLAYED',
    gamePoints: 'For points',
    gameNoPoints: 'No points',

    // Facts on the night card
    factBeers: 'Beers',
    factNight: 'Night',
    published: 'Published',
    nightTitleFallback: 'A night on the beer',

    // Loading states
    accountError: 'I could not get your account ready. Try again in a bit.',
    loadError: 'Hangovers did not load.',
    staleWithError: 'You are on the last load. Newer nights did not come through.',
    staleChecking: 'Last load · checking for newer nights…',
    errorTitle: 'Hangovers did not load',
    errorBody: 'The entries on your phone are safe. Try again in a bit.',
    emptyWorldTitle: 'The world is suspiciously sober',
    emptyWorldBody: 'Nobody has put their night up yet.',
  },

  nightDetail: {
    back: 'Back',
    title: 'Night',
    comments: 'Comments',
    commentsEmpty: 'Quiet so far. Drop the first note.',
    composerPlaceholder: 'Say something about the night',
    composerA11y: 'Comment on the night',
    sendA11y: 'Send comment',
    sending: 'Sending…',
    send: 'Send',
    deleteCommentA11y: 'Delete comment',
    goneTitle: 'This night went into hiding',
  },

  roast: {
    noPhotos: (pubs: string) => `${pubs} and not one photo`,
    noPhotosBasis: 'Tomorrow you will remember none of it',
    noWins: (games: string) => `${games}, not one win`,
    noWinsBasis: 'At least you paid for the round',
    samePub: 'The same pub again',
    samePubBasis: (visits: number) => `Visit number ${visits}. Explorer of the year this is not`,
    slowPace: (duration: string, beers: string) => `${duration} and ${beers}`,
    slowPaceBasis: 'That is not drinking, that is a meeting',
    durationMinutes: (minutes: number) => `${minutes} minutes`,
    durationHours: (hours: number) =>
      `${hours} ${englishPlural(hours, { one: 'hour', other: 'hours' })}`,
    durationHoursMinutes: (hours: number, minutes: number) => `${hours}h ${minutes}m`,
  },

  relativeTime: {
    now: 'now',
    minutesAgo: (minutes: number) => `${minutes} min ago`,
    hoursAgo: (hours: number) => `${hours} h ago`,
    daysAgo: (days: number) => `${days} d ago`,
    soon: 'a moment left',
    hoursMinutesLeft: (hours: number, minutes: number) => `${hours} h ${minutes} min left`,
    hoursLeft: (hours: number) => `${hours} h left`,
    minutesLeft: (minutes: number) => `${minutes} min left`,
    today: 'today',
    todayShort: 'today',
    yesterday: 'yesterday',
    dayBeforeYesterday: 'the day before yesterday',
    daysAgoLong: (days: number) => `${days} days ago`,
  },

  partaFeed: {
    drinkFallback: 'drink',
    placePrivate: 'At someone\'s place',
    placeOutdoors: 'Outside',
  },

  liveActivity: {
    pubFallback: 'Beer night',
    beerFallback: 'Beer',
    beerWord: (count: number) => beerNoun(count),
    beerCountA11y: (count: number) => beerCountLabel(count),
    total: (amount: string) => `Total ${amount}`,
    latestBeerFallback: 'Last beer',
    latestAt: (time: string) => `last one at ${time}`,
    firstBeerPouring: 'Still pouring the first one',
    addBeer: 'Same again',
    addBeerA11y: 'Log the same beer',
    openCounter: 'Open the counter',
  },

  notifications: {
    pubReminderChannel: 'Pub reminders',
    pubReminderTitle: (pubName: string) => `Still at ${pubName}?`,
    pubReminderBody: 'Tap the counter and add up tonight\'s rounds.',
    beerCountChannel: 'Counter reminders',
    beerCountTitle: 'Have a look at your diary',
    beerCountBody: 'Does tonight\'s entry look right?',
  },
};
