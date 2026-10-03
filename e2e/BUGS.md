# Nálezy ze skutečných E2E průchodů

## NP-E2E-001: volby piva jsou sloučené do jediného přístupného prvku

- Základ: `origin/dev` `e72d145c`, iPhone 17 / iOS 26.5, Expo development build.
- Kroky: přihlásit lokální fixture, otevřít počítadlo a „Co si dáš?“, vybrat pivo z nabídky hospody.
- Očekávání: tlačítko „Připsat E2E Ležák za 0,5 l · 41 Kč“ je samostatně dostupné pro nativní automatizaci a asistivní ovládání.
- Skutečnost: v nativním stromu se celá karta s hlavičkou i volbami sloučí do jednoho prvku. TesterArmy vrací `AUTOMATION_UNSUPPORTED`; backend neobsahuje žádné pivo.
- Příčina: vnější `Pressable` v `DrinkPickSheet` nemá `accessible={false}`. Minimální oprava ponechá přístupné jednotlivé potomky. Vizuální layout se nemění.
- Regrese: `tests/spike/persist-drink.e2e.ts` před opravou nedokáže zapsat, po opravě třikrát projde včetně přesného DB oracle a restartu.
- [Screenshot ověřeného výsledku po opravě](https://files.tmach.dev/spike-persisted-drink-e8ee0ea9ec4b4277ada3.png). Před opravou framework po secret fill uchoval pouze redigovaný accessibility dump, screenshot záměrně nevytvořil.
- Stav: malá oprava připravená pro samostatný `fix/` PR. Test aktuálně prochází s opravou; na původním dev jde o známé selhání.

Nový nález musí mít stabilní ID, revizi, kroky na lokálním backendu, očekávaný a skutečný výsledek, screenshot a odkaz na test. Produktové opravy patří do samostatného malého PR s regresním testem.
