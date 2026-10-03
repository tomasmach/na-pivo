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
- Reprodukce: `tests/places-social/social.e2e.ts`, průchod `host approval reveals the event address only to the approved guest`. Vizuální kontrola zrušeného stavu selhala; samostatné kontroly autorizace adresy a DB prošly.
- Stav: oprava v samostatném [PR #209](https://github.com/tomasmach/na-pivo/pull/209). Celý průchod jednou prošel za 44,17 s včetně kontroly DB, oprávnění adresy a [výsledného screenshotu](https://files.tmach.dev/social-event-cancelled-3b85cf888c7a496f80e5.png). Tři stabilitní běhy oblasti ještě nejsou dokončené.

## NP-E2E-003: nabídka počítadla a vnitřní zkratky nejsou přístupné

- Priorita: P1. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5.
- Kroky: přihlásit fixture, zapsat E2E Ležák za 41 Kč, zkusit „Jiné pivo“ a otevřít „Co ještě?“ pro ukončení večera.
- Očekávání: nativní ovládání najde jednotlivé volby, včetně „Vybrat jiné pivo nebo drink“ a „Dopito, zavřít tenhle večer“.
- Skutečnost: vnitřní zkratky tácku pohltí rodičovské tlačítko. Po otevření další nabídky má strom jen tři prvky a neobsahuje její řádky, přestože jsou vizuálně přítomné. Přesný locator pro Dopito skončí timeoutem; předtím backend potvrdil právě jedno pivo.
- Příčina: `CoasterCard` slučuje interaktivní potomky a `CounterMoreSheet` skrývá celý podstrom přes `accessibilityElementsHidden`.
- Screenshoty: [tácek s nedostupnými zkratkami](https://files.tmach.dev/diary-counter-surface-ed73ae5140ef4e629077.png), [nabídka s nedostupným Dopito](https://files.tmach.dev/diary-counter-overflow-cc5b9181418c446ab413.png).
- Reprodukce: `tests/diary/counter-menu.repro.e2e.ts`, rozpracovaný širší průchod `tests/diary/evening.e2e.ts`.
- Stav: opraveno v samostatném [PR #211](https://github.com/tomasmach/na-pivo/pull/211). Maestro v běhu `a62c5714` otevřelo nabídku, zvolilo Dopito a potvrdilo ukončení. DB oracle potvrdil právě jedno pivo a jednu návštěvu s `closed_at`. [Nabídka po opravě](https://files.tmach.dev/diary-counter-dopito-menu-b00c716d604a4581b591.png), [uzavřený večer](https://files.tmach.dev/diary-closed-evening-before-publication-8f8331e3b4cb46fcb502.png). Typecheck, 45 stávajících Jest testů a nezávislé review prošly. Širší deníková sada ještě není dokončená.

## NP-E2E-004: karta party pohltí nastavení soukromí

- Priorita: P0 pro blokovaný průchod soukromí, samotná chyba přístupnosti P1. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5.
- Kroky: přihlásit fixture s jedním kamarádem, otevřít Partu a zkusit otevřít nastavení přes její horní ovládání.
- Očekávání: počet kamarádů a nabídka mají vlastní dostupné ovládací prvky.
- Skutečnost: kompletní nativní strom s 29 prvky obsahuje pouze přístupné tlačítko celé karty; viditelné horní ovládání není samostatně dostupné. Test proto nedokáže vypnout sdílení a ověřit druhý účet.
- Příčina: `PartyCard` vkládá `topRow` s vlastními tlačítky do přístupného rodičovského `Pressable`, zatímco spodní zkratky již má mimo něj.
- [Screenshot nedostupného horního ovládání](https://files.tmach.dev/social-party-settings-before-9885d34c116d4428a91d.png).
- Reprodukce: `tests/places-social/social.e2e.ts`, průchod soukromí/ghost/blokování.
- Stav: opraveno v samostatném [PR #210](https://github.com/tomasmach/na-pivo/pull/210). Maestro v běhu `2d7eb19c` otevřelo nabídku i nastavení a změnilo přepínač; skutečná DB potvrdila vypnuté sdílení. [Karta po opravě](https://files.tmach.dev/social-party-settings-after-d161bffa9c59435ca8c0.png). Typecheck a nezávislé review prošly. Celý privacy průchod zatím nemá tři zelená opakování.

## NP-E2E-005: text přepínače nerozlišuje automatické sdílení a ruční cinknutí

- Typ: doložená nejasnost nastavení soukromí, nikoli potvrzená chyba autorizace. Priorita P1 pro vysvětlení výsledku uživateli.
- Kroky: fixture má aktivní ruční cinknutí; vypnout „Ukazovat partě, kde sedím“ v Nastavení party a načíst `/v1/friends/live` druhým účtem.
- Skutečnost: DB má `share_drinks_with_parta=false`, ale dřívější ruční aktivita zůstává v `active_friends`. Samostatná automatická presence a drink-feed používají tento přepínač; ghost režim skrývá i ruční aktivitu.
- Očekávání: text nastavení srozumitelně odliší, co se po vypnutí přestane sdílet. Dokument `docs/decisions/one-write-two-readers.md` a existující kontraktové testy rozlišují automatický feed a vědomé sdílení přítomnosti; E2E proto nesmí bez produktového rozhodnutí změnit význam API.
- Důkaz: skutečný běh `2d7eb19c` uložil přepínač a následný API oracle našel ruční aktivitu. Screenshot otevřeného přepínače se doplní při příštím plánovaném průchodu; existující snímek karty tento stav sám nedokazuje.
- Stav: bez produktové změny. `tests/places-social/party-privacy.yaml` nyní rozlišuje automatickou presence, drink-feed a explicitní aktivitu; finální runtime tohoto upřesnění ještě čeká.

## NP-E2E-006: formulář vlastního piva slučuje jednotlivé vstupy

- Priorita P1. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5, Maestro 2.11.0.
- Kroky: přihlásit fixture, zapsat pivo z nabídky, otevřít „Vybrat jiné pivo nebo drink“ a „Přidat nové pivo“.
- Očekávání: samostatně dostupné pole názvu a ceny umožní vyplnit a uložit další nápoj.
- Skutečnost: formulář je viditelný a pole má focus, ale přesný nativní identifikátor `beer-form-name` není dostupný. Průchod skončí před druhým zápisem; první pivo zůstává skutečně uložené.
- Příčina: obalový `Pressable` uvnitř `BeerFormModal` slučuje své interaktivní potomky do jednoho přístupného prvku.
- [Screenshot formuláře před neúspěšným vstupem](https://files.tmach.dev/diary-beer-form-before-input-d94c0a902fc844c8ab18.png). Reprodukce `fc97c485` trvala 73,793 s a skončila selháním `tests/diary/evening.yaml`.
- Stav: jednořádková oprava ve větvi `fix/accessible-beer-form`, commit `a1a1851a`, nezávislé review bez nálezů. Nativní ověření opravy a samostatný PR ještě čekají.

## NP-E2E-007: offline publikace večera se po návratu neodešle

- Priorita P0 pro nedoručený offline zápis. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5, Maestro 2.11.0.
- Kroky: zapsat pivo, uzavřít večer, zastavit vlastní backend, publikovat večer pro partu, restartovat appku offline, spustit backend a vrátit appku z plochy do popředí.
- Očekávání: uložená publikace se odešle právě jednou bez dalšího restartu či nového zápisu.
- Skutečnost: UI ukazuje „Visí ve Výčepu · Jen parta“, ale po 15 s zůstává v DB 0 publikovaných nocí, 1 pivo a 1 uzavřená návštěva. Stejný PID před Home, na ploše i po návratu a kontrola aktivního detailu vylučují nechtěný restart nebo test na pozadí.
- Příčina: `flushNightsQueue()` se spouští při mountu a enqueue, ale chybí v obsluze `AppState` pro návrat do popředí. Ostatní fronty v ní mají opakované doručení.
- Reprodukce: `tests/diary/vycep.yaml`, běh `c099c714`, 118,561 s, 0/1 úspěšných testů. [Screenshot aktivního detailu bez doručené publikace](https://files.tmach.dev/diary-vycep-foreground-not-synced-9fddd7abd89e4850bb1e.png).
- Stav: jednořádková oprava ve větvi `fix/sync-nights-on-foreground`, commit `89b4cc93`. Nativní ověření stejného průchodu po opravě a samostatný PR ještě čekají.

Nový nález musí mít stabilní ID, revizi, kroky na lokálním backendu, očekávaný a skutečný výsledek, screenshot a odkaz na test. Produktové opravy patří do samostatného malého PR s regresním testem.
