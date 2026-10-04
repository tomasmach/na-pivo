# Nálezy ze skutečných E2E průchodů

## NP-E2E-001: volby piva jsou sloučené do jediného přístupného prvku

- Základ: `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5, Expo development build.
- Kroky: přihlásit lokální fixture, otevřít počítadlo a „Co si dáš?“, vybrat pivo z nabídky hospody.
- Očekávání: tlačítko „Připsat E2E Ležák za 0,5 l · 41 Kč“ je samostatně dostupné pro nativní automatizaci a asistivní ovládání.
- Skutečnost: v nativním stromu se celá karta s hlavičkou i volbami sloučí do jednoho prvku. TesterArmy vrací `AUTOMATION_UNSUPPORTED`; backend neobsahuje žádné pivo.
- Příčina: vnější `Pressable` v `DrinkPickSheet` nemá `accessible={false}`. Minimální oprava ponechá přístupné jednotlivé potomky. Vizuální layout se nemění.
- Regrese: `tests/spike/persist-drink.e2e.ts` před opravou nedokáže zapsat, po opravě třikrát projde včetně přesného DB oracle a restartu.
- [Screenshot ověřeného výsledku po opravě](https://files.tmach.dev/spike-persisted-drink-e8ee0ea9ec4b4277ada3.png). Před opravou framework po secret fill uchoval pouze redigovaný accessibility dump, screenshot záměrně nevytvořil.
- Stav: opraveno v samostatném [PR #207](https://github.com/tomasmach/na-pivo/pull/207). Test aktuálně prochází s opravou; na původním dev jde o známé selhání.

## NP-E2E-002: zrušená komunitní akce vypadá jako aktivní

- Priorita: P2. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5.
- Kroky: otevřít Moje akce jako pořadatel, u E2E Večer u hosta schválit E2EKamos a poté akci zrušit.
- Očekávání: karta jasně ukazuje zrušení a neslibuje hostovi místo.
- Skutečnost: databáze obsahuje `status=cancelled`, ale karta dál zobrazuje „18+“, „poslední místo“ a „Máš místo“. Jen zmizí akce pro zrušení.
- Dopad: uživatel z karty nepozná, že se setkání nekoná. Kontrola skutečného API současně potvrdila, že schválenému hostovi se po zrušení přestane vracet přesná adresa; tento průchod neprokázal únik adresy.
- [Screenshot zrušené akce](https://files.tmach.dev/social-event-cancelled-312c4184569a4c1a9733.png). Viditelná adresa je syntetická fixture a obrazovka patří pořadateli.
- Reprodukce: `tests/places-social/community-privacy.yaml` (původně TesterArmy průchod `host approval reveals the event address only to the approved guest`). Vizuální kontrola zrušeného stavu selhala; samostatné kontroly autorizace adresy a DB prošly.
- Stav: oprava v samostatném [PR #209](https://github.com/tomasmach/na-pivo/pull/209). Celý průchod jednou prošel za 44,17 s včetně kontroly DB, oprávnění adresy a [výsledného screenshotu](https://files.tmach.dev/social-event-cancelled-3b85cf888c7a496f80e5.png). Stejný community privacy test má nyní tři po sobě jdoucí úspěchy; poslední z nich v běhu `3bd48f79` dne 4. 10. 2026.

## NP-E2E-003: nabídka počítadla a vnitřní zkratky nejsou přístupné

- Priorita: P1. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5.
- Kroky: přihlásit fixture, zapsat E2E Ležák za 41 Kč, zkusit „Jiné pivo“ a otevřít „Co ještě?“ pro ukončení večera.
- Očekávání: nativní ovládání najde jednotlivé volby, včetně „Vybrat jiné pivo nebo drink“ a „Dopito, zavřít tenhle večer“.
- Skutečnost: vnitřní zkratky tácku pohltí rodičovské tlačítko. Po otevření další nabídky má strom jen tři prvky a neobsahuje její řádky, přestože jsou vizuálně přítomné. Přesný locator pro Dopito skončí timeoutem; předtím backend potvrdil právě jedno pivo.
- Příčina: `CoasterCard` slučuje interaktivní potomky a `CounterMoreSheet` skrývá celý podstrom přes `accessibilityElementsHidden`.
- Screenshoty: [tácek s nedostupnými zkratkami](https://files.tmach.dev/diary-counter-surface-ed73ae5140ef4e629077.png), [nabídka s nedostupným Dopito](https://files.tmach.dev/diary-counter-overflow-cc5b9181418c446ab413.png).
- Reprodukce: `tests/diary/evening.yaml` (původní TesterArmy reprodukce byla nahrazena Maestro průchodem).
- Stav: opraveno v samostatném [PR #211](https://github.com/tomasmach/na-pivo/pull/211). Maestro v běhu `a62c5714` otevřelo nabídku, zvolilo Dopito a potvrdilo ukončení. DB oracle potvrdil právě jedno pivo a jednu návštěvu s `closed_at`. [Nabídka po opravě](https://files.tmach.dev/diary-counter-dopito-menu-b00c716d604a4581b591.png), [uzavřený večer](https://files.tmach.dev/diary-closed-evening-before-publication-8f8331e3b4cb46fcb502.png). Typecheck, 45 stávajících Jest testů a nezávislé review prošly. Všech pět deníkových testů následně dokončilo tři úspěšné průchody; přesné běhy uvádí COVERAGE.md.

## NP-E2E-004: karta party pohltí nastavení soukromí

- Priorita: P0 pro blokovaný průchod soukromí, samotná chyba přístupnosti P1. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5.
- Kroky: přihlásit fixture s jedním kamarádem, otevřít Partu a zkusit otevřít nastavení přes její horní ovládání.
- Očekávání: počet kamarádů a nabídka mají vlastní dostupné ovládací prvky.
- Skutečnost: kompletní nativní strom s 29 prvky obsahuje pouze přístupné tlačítko celé karty; viditelné horní ovládání není samostatně dostupné. Test proto nedokáže vypnout sdílení a ověřit druhý účet.
- Příčina: `PartyCard` vkládá `topRow` s vlastními tlačítky do přístupného rodičovského `Pressable`, zatímco spodní zkratky již má mimo něj.
- [Screenshot nedostupného horního ovládání](https://files.tmach.dev/social-party-settings-before-9885d34c116d4428a91d.png).
- Reprodukce: `tests/places-social/party-privacy.yaml`, průchod soukromí/ghost/blokování.
- Stav: opraveno v samostatném [PR #210](https://github.com/tomasmach/na-pivo/pull/210). Maestro v běhu `2d7eb19c` otevřelo nabídku i nastavení a změnilo přepínač; skutečná DB potvrdila vypnuté sdílení. [Karta po opravě](https://files.tmach.dev/social-party-settings-after-d161bffa9c59435ca8c0.png). Typecheck a nezávislé review prošly. Celý zpřesněný privacy průchod následně jednou prošel v `3bd48f79`; další dvě stabilitní opakování čekají.

## NP-E2E-005: text přepínače nerozlišuje automatické sdílení a ruční cinknutí

- Typ: doložená nejasnost nastavení soukromí, nikoli potvrzená chyba autorizace. Priorita P1 pro vysvětlení výsledku uživateli.
- Kroky: fixture má aktivní ruční cinknutí; vypnout „Ukazovat partě, kde sedím“ v Nastavení party a načíst `/v1/friends/live` druhým účtem.
- Skutečnost: DB má `share_drinks_with_parta=false`, ale dřívější ruční aktivita zůstává v `active_friends`. Samostatná automatická presence a drink-feed používají tento přepínač; ghost režim skrývá i ruční aktivitu.
- Očekávání: text nastavení srozumitelně odliší, co se po vypnutí přestane sdílet. Dokument `docs/decisions/one-write-two-readers.md` a existující kontraktové testy rozlišují automatický feed a vědomé sdílení přítomnosti; E2E proto nesmí bez produktového rozhodnutí změnit význam API.
- Důkaz: skutečný běh `2d7eb19c` uložil přepínač a následný API oracle našel ruční aktivitu. Následný běh `0292bfec` ověřil uložený stav a zachytil [vypnuté sdílení v nastavení](https://files.tmach.dev/social-sharing-off-settings-bc576d996a4c4f588361.png).
- Stav: bez produktové změny. `tests/places-social/party-privacy.yaml` nyní rozlišuje automatickou presence, drink-feed a explicitní aktivitu; upřesněný celý průchod poprvé prošel v `3bd48f79`. To neřeší nejasnost uživatelského textu.

## NP-E2E-006: formulář vlastního piva slučuje jednotlivé vstupy

- Priorita P1. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5, Maestro 2.11.0.
- Kroky: přihlásit fixture, zapsat pivo z nabídky, otevřít „Vybrat jiné pivo nebo drink“ a „Přidat nové pivo“.
- Očekávání: samostatně dostupné pole názvu a ceny umožní vyplnit a uložit další nápoj.
- Skutečnost: formulář je viditelný a pole má focus, ale přesný nativní identifikátor `beer-form-name` není dostupný. Průchod skončí před druhým zápisem; první pivo zůstává skutečně uložené.
- Příčina: obalový `Pressable` uvnitř `BeerFormModal` slučuje své interaktivní potomky do jednoho přístupného prvku.
- [Screenshot formuláře před neúspěšným vstupem](https://files.tmach.dev/diary-beer-form-before-input-d94c0a902fc844c8ab18.png). Reprodukce `fc97c485` trvala 73,793 s a skončila selháním `tests/diary/evening.yaml`.
- Stav: oprava v samostatném [PR #213](https://github.com/tomasmach/na-pivo/pull/213), nezávislé review bez nálezů. Běh `76ba5706` samostatně vyplnil název i cenu, uložil offline pivo a po restartu doručil přesný DB výsledek: dvě zbývající piva za 41 a 43 Kč, jedna uzavřená návštěva. [Vyplněný formulář](https://files.tmach.dev/diary-beer-form-filled-c236a3bdde1b44f38d4a.png), [výsledné statistiky](https://files.tmach.dev/diary-stats-opened-aa0aed84c1684d4395cf.png). Následný celý test `bf0e5e7d` prošel za 2 min 47 s včetně přesného UI statistik a posledního DB oracle po restartu. Dotčený deníkový test následně dokončil tři úspěšné průchody; přesná měření uvádí COVERAGE.md.

## NP-E2E-007: offline publikace večera se po návratu neodešle

- Priorita P0 pro nedoručený offline zápis. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5, Maestro 2.11.0.
- Kroky: zapsat pivo, uzavřít večer, zastavit vlastní backend, publikovat večer pro partu, restartovat appku offline, spustit backend a vrátit appku z plochy do popředí.
- Očekávání: uložená publikace se odešle právě jednou bez dalšího restartu či nového zápisu.
- Skutečnost: UI ukazuje „Visí ve Výčepu · Jen parta“, ale po 15 s zůstává v DB 0 publikovaných nocí, 1 pivo a 1 uzavřená návštěva. Stejný PID před Home, na ploše i po návratu a kontrola aktivního detailu vylučují nechtěný restart nebo test na pozadí.
- Příčina: `flushNightsQueue()` se spouští při mountu a enqueue, ale chybí v obsluze `AppState` pro návrat do popředí. Ostatní fronty v ní mají opakované doručení.
- Reprodukce: `tests/diary/vycep.yaml`, běh `c099c714`, 118,561 s, 0/1 úspěšných testů. [Screenshot aktivního detailu bez doručené publikace](https://files.tmach.dev/diary-vycep-foreground-not-synced-9fddd7abd89e4850bb1e.png).
- Stav: oprava v samostatném [PR #212](https://github.com/tomasmach/na-pivo/pull/212). Stejný celý průchod po opravě prošel v běhu `051e9968` za 2 min 16 s: skutečná DB obsahovala právě jednu publikovanou noc, jedno pivo a uzavřenou návštěvu; po dalším restartu se noc zobrazila i ve Výčepu. [Výsledný screenshot](https://files.tmach.dev/diary-vycep-published-e1e795908295499da217.png). Kontrola typů, 16 souvisejících Jest testů a nezávislé review prošly. Dotčený deníkový test následně dokončil tři úspěšné průchody; přesná měření uvádí COVERAGE.md.
- Android 4. 10.: Pixel 10 / API 36.1, běh `18499f44` potvrdil stejný nedoručený zápis po otevření a zavření lišty oznámení. Proces se nezměnil, detail byl aktivní, po 15 s bylo v DB 0 publikovaných večerů při zachovaném jednom pivu a návštěvě. [Android před opravou](https://files.tmach.dev/android-night-not-synced-f768531e81194472b2b1.png). Tato cesta emituje `focus` bez změny stavu aplikace. PR #212 (`cd1b9940`) doplnil stejný flush i sem; regrese PR #217 (`abc60025`) používá skutečnou lištu a porovnává PID i následný stav DB. Běh `8a754f4c` po opravě třikrát prošel, včetně doručení jediné publikace před dalším restartem a zachování stejného večera po něm. [Android po opravě](https://files.tmach.dev/android-night-synced-38e0e7df897b44969a61.png). Přesná měření uvádí COVERAGE.md. Oba commity jsou pushnuté, CI prošlo a cílené nezávislé review nemělo nález.

## NP-E2E-008: offline Parta žádá již vyplněnou přezdívku

- Priorita P1. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5.
- Kroky: přihlásit účet E2EPivar se dvěma kamarády, načíst Partu, zastavit backend a restartovat appku.
- Očekávání: uložená Parta zachová dostupné akce a nenačtený profil nevydává za nevyplněnou přezdívku.
- Skutečnost: karta ukazuje dva kamarády a uloženou vlastní aktivitu, ale nabídne „Doplnit přezdívku“. Skutečný účet již přezdívku má.
- Příčina: CTA používá `nickname == null`, přičemž `selectNickname` vrací `null` i pro nenačtený profil. Existující `selectNeedsNickname` správně rozlišuje nenačtený profil a potvrzenou chybějící přezdívku.
- Reprodukce: `tests/places-social/invite-offline.yaml`, běh `0292bfec`; [screenshot offline Party](https://files.tmach.dev/social-offline-party-1b89f217326a4d1fa103.png). Původní kontrola snapshotu a API prošla, vizuální kontrola odhalila tento rozpor. Regresní kontrola výzvy je součástí PR #218; po opravě celý průchod poprvé prošel v `3bd48f79`.
- Stav: minimální oprava v samostatném [PR #219](https://github.com/tomasmach/na-pivo/pull/219), nezávislé review bez nálezů. První celý nativní průchod `3bd48f79` potvrdil správnou offline Partu a konečný DB oracle; [prohlédnutý screenshot po opravě](https://files.tmach.dev/social-offline-party-0666993abb3b46e09ab8.png). Další dva celé průchody `a8970dc4` a `72159c27` také prošly, včetně offline restartu, správné nabídky akcí a přesných vazeb v DB.

## NP-E2E-009: žebříček po blokování ukazuje dvě různá pořadí

- Typ: rozpor ve vysvětlení pořadí, nikoli potvrzený únik soukromého účtu. Priorita P2.
- Kroky: otevřít Mapéry jako E2EPivar s 10 XP, zahřát žebříček s E2EKamos na prvním místě, kamaráda zablokovat a žebříček obnovit.
- Očekávání: uživatel pozná, proč se liší jeho osobní a globální pořadí.
- Skutečnost: hero uvádí „1. místo“ a „z 2 v tabulce“, jediný viditelný řádek Ty má pořadí 2. Soukromý ani blokovaný účet není v seznamu ani v odpovídajícím API payloadu.
- [Screenshot rozdílného pořadí](https://files.tmach.dev/social-private-blocked-board-47d8b88bd9a640ba99a5.png), `tests/places-social/leaderboard-privacy.yaml`, běh `0292bfec`.
- Existující kontraktové testy záměrně zachovávají globální pořadí `entries` po blokování a současně přepočítávají osobní `me.rank`. Nejde proto napravit rozpor změnou backendu bez rozhodnutí o významu zobrazeného pořadí. Navazující zpřesnění E2E porovná oba údaje s jejich skutečnými API hodnotami; nebude vynucovat změnu kontraktu.
- Stav: ponecháno k produktovému rozhodnutí o vysvětlení pořadí. Kontrola soukromí prošla; to neznamená, že je popis pořadí srozumitelný.

## NP-E2E-010: výběr zdroje fotky slučuje své akce

- Priorita P1. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5, Maestro 2.11.0.
- Kroky: přihlásit fixture, otevřít fotky a nabídku „Cvakni pivo“, zkusit vybrat fotku z galerie.
- Očekávání: galerie, fotoaparát a zavření mají samostatně dostupné ovládací prvky.
- Skutečnost: nativní strom obsahuje jediný sloučený prvek s nadpisem, popisem a všemi třemi akcemi. Přesný locator galerie selže, přestože je tlačítko vidět.
- Příčina: vnější a vnitřní `Pressable` v `BeerPhotoSourceSheet` slučují přístupné potomky. Minimální oprava nastavuje oběma obalům `accessible={false}`; samostatná tlačítka si ponechávají role, popisy a callbacky.
- Reprodukce: `tests/identity/photos.yaml`, běh `e7987064`; [screenshot nabídky před opravou](https://files.tmach.dev/identity-photo-source-accessibility-488cefaeca6c47c4a8c3.png).
- Stav: oprava v samostatném [PR #214](https://github.com/tomasmach/na-pivo/pull/214), nezávislé review bez nálezů. Celý `identity/media-denied.yaml` v běhu `9cc075a2` prošel za 1 min 58 s: dostupná zamítnutá kamera, skutečný picker galerie, Cancel, restart a skutečná DB bez nechtěné fotky či avataru. [Zkontrolovaný konečný stav](https://files.tmach.dev/identity-media-denied-recovered-575a4d3c98014b76b644.png). Následný celý `identity/photos.yaml` v běhu `39ad9a48` prošel za 2 min 38 s: skutečné soubory, offline fronta, caption a visibility, soukromý přístup, odstranění i restart. Všech 11 dostupných identity testů následně dokončilo tři úspěšné průchody; přesná měření uvádí COVERAGE.md.

## NP-E2E-011: po offline restartu není dostupné odhlášení

- Priorita P1; blokuje P0 průchod oddělení účtů. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5, Maestro 2.11.0.
- Kroky: přihlásit účet, zapsat jedno pivo online, zastavit lokální backend, zapsat druhé pivo a restartovat appku offline. Počítadlo drží dvě piva za 82 Kč. Otevřít Účet.
- Očekávání: přihlášený uživatel se může místně odhlásit i bez dostupného profilu ze serveru.
- Skutečnost: obrazovka ukazuje pouze Účet a Zpět. Akce Odhlásit se chybí i v nativním stromu. [Zkontrolovaný screenshot](https://files.tmach.dev/identity-account-offline-empty-before-5643c3a985bb4592bfcc.png).
- Příčina: přihlášená session se správně obnoví ze SecureStore; vzdálený profil zůstane při výpadku `null`. `AccountScreen` v této větvi předčasně vrací samotnou hlavičku, přestože existující `auth.logout` podporuje místní odhlášení při síťové chybě.
- Reprodukce: `tests/identity/logout.yaml`, běh `9cc075a2`. Dvě offline piva a jejich přetrvání po restartu byly ověřené před selháním.
- Stav: malá oprava v samostatném [PR #215](https://github.com/tomasmach/na-pivo/pull/215) zachovává stávající tlačítko podle přihlášené session. Kontrola typů, lint, 99 souvisejících Jest testů a nezávislé review prošly. Stejný celý průchod `39ad9a48` prošel za 2 min 24 s: odhlášení offline, anonymní restart, login B a další restart, přesná kontrola oddělené historie a fronty v UI i DB. [Odhlášení dostupné offline](https://files.tmach.dev/identity-account-offline-logout-after-7d53be37cdeb482a98ab.png). Test odhlášení následně dokončil tři úspěšné průchody; přesná měření uvádí COVERAGE.md.
- Hranice kontraktu: úmyslné offline odhlášení místně vymaže soukromá data včetně nedoručené fronty; neslibuje doručení ani vzdálené odvolání tokenu. E2E následně ověřuje, že fronta účtu A nepřejde pod účet B.

## NP-E2E-012: anglické nastavení vody ořízne vysvětlení

- Priorita P2, vizuální chyba. Základ `origin/dev` `e72d145c`, testovaná větev `6e4ab7bd`, iPhone 17 / iOS 26.5.
- Kroky: přihlásit fixture, v Nastavení zapnout připomínku vody, přepnout na angličtinu a po restartu otevřít dolní část Nastavení.
- Očekávání: vysvětlení připomínky je celé čitelné včetně věty o odhadu střízlivosti.
- Skutečnost: popis končí „It doesn't estimate how sober yo...“. `SwitchRow` omezuje popis na dva řádky; nejde o chybějící překlad.
- Důkaz: `tests/identity/settings.yaml`, běh `6c95df96`, první pokus. [Zkontrolovaný screenshot](https://files.tmach.dev/identity-settings-truncated-water-help-ec7deb9d5c18465fb488.png).
- Stav: neopraveno. Průchod ověřil uložení nastavení a změnu jazyka, nikoli úplnou čitelnost popisu. Jeho funkční úspěch tento vizuální nález neuzavírá.



## NP-E2E-013: seznam hospod v mapě slučuje jednotlivé řádky

- Priorita P1. Základ `origin/dev` `2e7a120e`, iPhone 17 / iOS 26.5, Maestro 2.11.0.
- Kroky: přihlásit místní fixture, přepnout kompas na mapu, najít vlastní polohu, otevřít seznam podniků a zvolit E2E Druhá hospoda.
- Očekávání: samostatně přístupný řádek otevře vybranou hospodu.
- Skutečnost: screenshot ukazuje všechny tři správné hospody, ale nativní strom vrací celou kartu včetně nadpisu, zavření a řádků jako jediný prvek. Přesný existující accessibilityLabel řádku proto nelze použít.
- Příčina: obalový `Pressable` v `BeerMapScreen` má prázdný `onPress` a automaticky slučuje přístupné potomky.
- Reprodukce: `tests/places-social/catalogue-offline.yaml`, běhy `3bd48f79` a `0b7023a7`. [Prohlédnutý screenshot před opravou](https://files.tmach.dev/places-map-catalogue-list-b009ac0db45f4f9f8f45.png). Prázdný mapový podklad odpovídá záměrně neplatnému místnímu mapovému klíči; tento nález se týká dostupnosti konkrétních řádků.
- Stav: známé selhání katalogového testu na původním dev. Minimální oprava `51c46221` nastavuje pouze `accessible={false}` na obalu; jednotlivá tlačítka a jejich handlery zůstávají stejné. Nezávislé review bez nálezů, ESLint a 28 stávajících mapových Jest testů prošly (2,779 s). Oprava je v [PR #223](https://github.com/tomasmach/na-pivo/pull/223). Stejný nativní průchod už vybral druhý řádek a otevřel jeho správnou nabídku. Navazující offline kontrola odhalila samostatný NP-E2E-014; celý katalogový test zatím není zelený.

## NP-E2E-014: nabídka otevřené hospody zmizí po offline restartu

- Priorita P1. Integrační základ s mapovým fixem `51c46221`, iPhone 17 / iOS 26.5, Maestro 2.11.0.
- Kroky: otevřít z mapy E2E Druhá hospoda s vlastní nabídkou, ověřit E2E Jantar druhé hospody / 0,3 l / 67 Kč, namířit kompas, zastavit vlastní backend, restartovat appku a stejnou hospodu otevřít přes hledání.
- Očekávání: dříve načtená nabídka zůstane dostupná spolu se zbytkem uloženého katalogu.
- Skutečnost: hospoda i otevírací doba zůstávají, ale celá sekce Na čepu chybí. Zmapovanost klesne z 15 % na 8 %. Cílený scroll k přesné položce ji nenajde; nejde jen o položku mimo viewport. Serverová data nebyla smazaná.
- Reprodukce: `tests/places-social/catalogue-offline.yaml`, vlastní odlišný seed `places_catalogue`, běh `ff4cf78f`, engine 95,396 s. [Online nabídka](https://files.tmach.dev/places-online-catalogue-c08c60be9d724cd68757.png), [stejný detail po offline restartu](https://files.tmach.dev/places-offline-catalogue-top-d3bc75f9b58249399650.png). Oba snímky byly prohlédnuté.
- Příčina: nearby API záměrně vrací malé katalogové preview bez nabídky (`backend/pubs/api/views.py`). `PubPageScreen` doplní výsledek `/pub-hours` pouze do stavu obrazovky; `hoursClient` ani kompas jej neukládají na disk. Hledání po restartu správně předá celý uložený záznam, který nabídku nikdy neobsahoval.
- Stav: potvrzené známé selhání, bez opravy v tomto úkolu. Bezpečná oprava potřebuje novou operaci obohacení existujícího snapshotu podle totožnosti hospody a řešení souběhu zápisů. `upsertLocalPub` nepersistuje a slučuje podle společné geohash buňky, takže není bezpečnou zkratkou. Změna přesahuje povolenou malou opravu; samostatné produktové řešení musí ověřit katalog bez nabídky, online detail, restart a offline hledání. Katalogový test zůstává přísný a nepočítá se mezi úspěšné průchody.

## NP-E2E-015: český detail piva používá desetinnou tečku

- Priorita P2, lokalizace čísel. Integrační revize `d1e31603`, iPhone 17 / iOS 26.5.
- Kroky: v české appce zapsat hodnocení 4,0, doručit offline zápis a po restartu otevřít detail stejného piva.
- Očekávání: český detail ukáže „4,0“ a „4,0 / 5“.
- Skutečnost: průměr, poslední zápis i historie ukazují „4.0“. Uložená číselná hodnota i přiřazení piva jsou správné.
- Důkaz: `tests/diary/checkin.yaml`, celý integrační běh `bbf6501c`. [Prohlédnutý detail](https://files.tmach.dev/diary-rated-beer-detail-267aae0e5ee144ad97d1.png). `app/beer-detail.tsx` formátuje hodnocení přímo přes `toFixed(1)` bez jazyka.
- Stav: neopraveno. Funkční test ověřuje skutečné hodnocení a agregaci, jeho úspěch nepotvrzuje správnou lokalizaci zobrazení. Stejný formát používá také formulář hodnocení a detail kamaráda; sjednocení patří do samostatné úpravy.

Nový nález musí mít stabilní ID, revizi, kroky na lokálním backendu, očekávaný a skutečný výsledek, screenshot a odkaz na test. Produktové opravy patří do samostatného malého PR s regresním testem.
