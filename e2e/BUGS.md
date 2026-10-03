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
- Stav: potvrzené známé selhání zobrazení. Produktová oprava zatím neprovedena.

## NP-E2E-003: nabídka počítadla a vnitřní zkratky nejsou přístupné

- Priorita: P1. Základ `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5.
- Kroky: přihlásit fixture, zapsat E2E Ležák za 41 Kč, zkusit „Jiné pivo“ a otevřít „Co ještě?“ pro ukončení večera.
- Očekávání: nativní ovládání najde jednotlivé volby, včetně „Vybrat jiné pivo nebo drink“ a „Dopito, zavřít tenhle večer“.
- Skutečnost: vnitřní zkratky tácku pohltí rodičovské tlačítko. Po otevření další nabídky má strom jen tři prvky a neobsahuje její řádky, přestože jsou vizuálně přítomné. Přesný locator pro Dopito skončí timeoutem; předtím backend potvrdil právě jedno pivo.
- Příčina: `CoasterCard` slučuje interaktivní potomky a `CounterMoreSheet` skrývá celý podstrom přes `accessibilityElementsHidden`.
- Screenshoty: [tácek s nedostupnými zkratkami](https://files.tmach.dev/diary-counter-surface-ed73ae5140ef4e629077.png), [nabídka s nedostupným Dopito](https://files.tmach.dev/diary-counter-overflow-cc5b9181418c446ab413.png).
- Reprodukce: `tests/diary/counter-menu.repro.e2e.ts`, rozpracovaný širší průchod `tests/diary/evening.e2e.ts`.
- Stav: malá oprava přístupnosti připravena pro [PR #207](https://github.com/tomasmach/na-pivo/pull/207). Typecheck a 45 stávajících Jest testů prošly; nativní ověření opravy právě běží.

Nový nález musí mít stabilní ID, revizi, kroky na lokálním backendu, očekávaný a skutečný výsledek, screenshot a odkaz na test. Produktové opravy patří do samostatného malého PR s regresním testem.
