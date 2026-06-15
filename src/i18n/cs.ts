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
    detailsLoading: 'Načítám info',
    contribute: 'Doplnit info',
    // The leading beer glyph is a line-art icon rendered next to this text in
    // the pub card (see RevealedPubPill), not an emoji baked into the string.
    beerWithPrice: (name: string, price: string) => `${name} · ${price}`,
    beerNoPrice: (name: string) => name,
    beerAndMore: 'a další',
    ratingCount: (count: string) => `${count} hodnocení`,
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
    savedToast: 'Díky! Uloženo',
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
    profile: 'Profil',
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

    // — Signed-out hero —
    signedOutTitle: 'Založ si profil',
    signedOutBody:
      'Vytvoř si účet a měj svá piva, hodnocení a odznaky synchronizované na všech zařízeních. Brzy přibydou i kamarádi a žebříčky.',
    signedOutCta: 'Vytvořit účet',

    // — Onboarding wizard —
    setup: {
      // STEP 1 — nickname
      step1Eyebrow: 'KROK 1 ZE 3',
      step1Title: 'Vyber si přezdívku',
      step1Body: 'Pod touhle přezdívkou tě uvidí ostatní. Můžeš ji později změnit.',
      nicknamePlaceholder: 'prezdivka',
      nicknameChecking: 'Ověřuji…',
      nicknameAvailable: 'Volné',
      nicknameTaken: 'Tahle přezdívka je zabraná',
      nicknameInvalid: 'Neplatná přezdívka',
      nicknameTooShort: 'Aspoň 3 znaky',
      nicknameTooLong: 'Nejvíc 20 znaků',
      nicknameCharset: 'Jen písmena bez diakritiky, číslice, _ a .',
      nicknameReserved: 'Tahle přezdívka není dostupná',
      continue: 'Pokračovat',

      // STEP 2 — avatar
      step2Eyebrow: 'KROK 2 ZE 3',
      step2Title: 'Přidej fotku',
      step2Body: 'Fotka je nepovinná. Můžeš ji kdykoli změnit v profilu.',
      pickPhoto: 'Vybrat fotku',
      changePhoto: 'Změnit fotku',
      skip: 'Přeskočit',
      avatarUploadError: 'Fotku se nepodařilo nahrát. Zkus to prosím znovu.',
      permissionTitle: 'Přístup k fotkám',
      permissionBody: 'Pro výběr fotky potřebujeme přístup ke knihovně fotek. Povol ho v Nastavení.',
      // Shown when the OS won't re-prompt (canAskAgain=false) — the only path is Settings.
      permissionBlockedBody: 'Přístup k fotkám je zakázaný. Povol ho v systémovém Nastavení a zkus to znovu.',
      openSettings: 'Otevřít Nastavení',

      // STEP 3 — visibility
      step3Eyebrow: 'KROK 3 ZE 3',
      step3Title: 'Viditelnost profilu',
      visibilityToggleLabel: 'Veřejný profil',
      // The GDPR consent copy the user MUST see on the visibility step (locked).
      consentPublic:
        'Veřejný profil znamená, že tě podle přezdívky a fotky najdou ostatní v žebříčcích a vyhledávání. Tvoje přesná poloha ani jednotlivá piva se nikdy nezveřejňují. Kdykoli to vypneš v nastavení profilu.',
      consentPrivate: 'Když vypneš, uvidí tě jen tví kamarádi.',
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

    // — Beer / price modal —
    priceModalTitle: 'Kolik stojí?',
    addModalTitle: 'Jaké pivo si dáváš?',
    editModalTitle: 'Uprav cenu',
    beerNamePlaceholder: 'Název piva, např. Pilsner Urquell 12°',
    pricePlaceholder: 'Cena (Kč)',
    priceLabel: 'Cena za',
    volumeSmall: '0,3 l',
    volumeLarge: '0,5 l',
    volumeOther: 'Jiné',
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
      'Sbíráme jen omezené anonymní provozní statistiky: otevření aplikace, technické chyby a součet nachozených metrů.',
      'Pro stažení okolních hospod může aplikace poslat aktuální nebo přibližnou polohu na náš server, který pro vyhledávání využívá Mapy.cz.',
      'Nachozené metry se počítají v telefonu a na server se posílá jen součet po dávkách, nikdy GPS body ani trasa.',
      'Průběžnou GPS historii, trasu pohybu ani jednotlivé GPS body neukládáme.',
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
    pubRating: (rating: string, count?: string) =>
      count ? `Hodnocení: ${rating} z 5, ${count} hodnocení` : `Hodnocení: ${rating} z 5`,
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

    // — Tabs —
    tabCompass: 'Záložka Kompas',
    tabCounter: 'Záložka Počítadlo',
    tabMyBeers: 'Záložka Moje piva',
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
