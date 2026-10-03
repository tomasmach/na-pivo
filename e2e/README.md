# Lokální mobilní E2E

Testy řídí skutečný iPhone 17 v iOS simulátoru a skutečný Django backend. Používají pouze vlastní SQLite a syntetická data. Výchozí runner je Maestro 2.11.0; důvod přechodu z TesterArmy a původní měření ChatGPT replay jsou v COVERAGE.md. Běžný `dev-local` runner se nepoužívá, protože vybírá `backend/db.sqlite3`.

## První spuštění na macOS

Použij Node.js 24 a Javu 17 nebo novější. Lokální kontroler načítá TypeScript přímo přes podporu Node.js.

```sh
npm ci
(cd backend && uv sync --locked --extra prod)
npm run e2e:maestro:install
npm run e2e:build
npm run e2e:critical
```

Build je lokální `expo run:ios` s lokálním backend mode, vypnutými widgety a neplatným mapovým klíčem. Nevolá EAS. Runtime nenačítá `.env`. Maestro běží lokálně bez modelu a bez přihlášení do cloudu. Analytika je vypnutá a interní API pro kontrolu verze či hlášení chyb míří přes `MAESTRO_API_URL` na loopback. Případné přihlášení TesterArmy k ChatGPT zůstává v uživatelském úložišti mimo repo. Při změně nativních závislostí build zopakuj.

```sh
npm run e2e:full
npm run e2e:critical -- e2e/tests/spike/ --stability
npm run e2e:full -- --no-cache
E2E_SLOT=2 npm run e2e:critical -- e2e/tests/spike/
```

`--stability` požaduje tři zelené průchody. Maestro nepoužívá model ani replay cache, proto `--no-cache` nic nemění a replay metriky jsou `null`. Pro oblast používej adresářový filtr. Původní TesterArmy spike lze diagnosticky spustit přes `E2E_ENGINE=testerarmy npm run e2e:critical -- e2e/tests/spike/persist-drink.e2e.ts --stability`; vyžaduje `E2E_TELEMETRY_DISABLED=1 npx e2e login openai` a druhý/třetí průchod v něm nadále vynucují úplný replay.

## Izolace a úklid

Sloty 1–3 mají API `18121–18123`, Metro `18221–18223`, místní kontroler `18321–18323`, vlastní iPhone 17 a DB v `.e2e/runs/<id>/test.sqlite3`. Zámky jsou ve společném git adresáři, proto platí i mezi worktrees. Obsazený port znamená konec, nikoliv ukončení cizího procesu. Nevyužitý vlastní simulátor lze znovu použít; běžící simulátor se nikdy nepřebírá. `E2E_APP_PATH=/absolute/Napivo.app` dovoluje sdílet ověřenou binárku mezi worktrees, každý však má svoje Metro.

Runner eviduje PID a čas spuštění, po skončení zastaví vlastní procesy a vlastní simulátor. `Ctrl-C` vyvolá stejný úklid. Po násilném ukončení nejdřív ověř `owner.json`, `processes.json` a odpovídající slot lock; nikdy nepoužívej `killall`. Databáze, metriky a bezpečné screenshoty zůstávají v gitignorované `.e2e/`. Maestro raw debug reporty obsahují pouze povolené jednorázové testovací údaje a runner je po běhu smaže. ChatGPT přihlášení ani skutečné bearer tokeny do nich nevstupují. `E2E_MAESTRO_PATH=/absolute/maestro/bin/maestro` dovoluje mezi worktrees sdílet lokálně ověřenou CLI verzi.

První příprava nativního enginu je mezi worktrees krátce serializovaná přes `boot.lock`. Samotné testy běží souběžně. Důvodem je sdílený agent-device daemon: souběžné studené starty tří iPhonů opakovaně vyčerpaly jeho 90s timeout a zasáhly ostatní sessions. Runner nejdřív dokončí nativní boot přes simctl a teprve potom pustí framework; zámek uvolní při začátku lokálních služeb.

Backend se spouští zvláštním settings modulem mimo produkční Docker context. Vyžaduje `DEBUG=True`, explicitní flag a vlastněný adresář běhu. Zachytává skutečně vykreslené e-maily v paměti, blokuje externí Python sockety a nepoužívá testovací přihlášení. Mobilní fake registrace push tokenu vyžaduje zároveň development build, explicitní flag a loopback API.

## Přidávání testů

- Oblast vlastní `e2e/tests/<oblast>/*.yaml`, případné vlastní assertion `.js` a svůj `e2e/seeds/<scenario>.py`. `seed()` připraví data; `observe()` vrací potřebná syntetická DB pole, nikdy tokeny, e-maily nebo GPS.
- Flow začne `../../maestro/reset.yaml`, případný `SCENARIO` předá v `env`. Následuje `skip-onboarding.yaml` a `login.yaml`. Reset vyčistí skutečnou DB, Keychain a data appky, konfigurace launchApp určuje oprávnění. Runner nastaví pevnou syntetickou polohu a dark mode.
- `output.local.offline()` skutečně zastaví backend; `online()` ho obnoví. Potom `../../maestro/foreground.yaml` ověří foreground flush bez ukončení appky a zachová výslovně nastavená oprávnění. Restart uprostřed výpadku používá `../../maestro/restart.yaml`.
- `output.local.state()` čte skutečnou DB přes místní kontroler. `output.local.observe(account, route)` čte skutečný `/v1/` endpoint pod fixture účtem a vrací sanitizované `{status, body}`. Observer používá normální přihlášení a token drží v paměti. Před smazáním účtu jej vytvoř předem, aby pozdější login neaktivoval účet v ochranné lhůtě.
- Asynchronní doručení ověřuj přes `output.local.poll(function () { /* načíst stav a přesně jej porovnat */ })`. Opakuje jen čtecí kontroly po 500 ms, nejvýš 15 s (volitelný druhý argument, nejvýš 30 s). UI zápisy do něj nepatří. Samotné Maestro `retry` nemá potřebný časový odstup.
- `output.local.request('/mail/verify', {})` otevře skutečný odkaz zachyceného e-mailu. `/mail/reset` otevře lokální app deep link, token nevstupuje do Maestro. `/mail/export` vrací pouze status a počet příloh.
- `output.local.screenshot('safe-name')` volej na zkontrolovaném konečném stavu bez přihlašovacích údajů či souřadnic. Poslední kontrola testu musí porovnat skutečná data po restartu nebo přes API/DB. Nevydávej samotný úspěšný tap za ověření.
- `output.local.debugScreenshot('safe-name')` ukládá diagnostický obrázek do neveřejného `private-debug`, který se po běhu smaže. Platí stejná výjimka jen pro jednorázové fixture účty. Obrázek s kontaktem nepublikuj ani nevypisuj do trvalých logů.
- Sdílené helpery, config, adaptéry a produkční `testID` mění hlavní agent. Každý test musí chytat pojmenovanou regresi z COVERAGE.md a projít třikrát.

Oprávnění jsou výslovně `all: deny`, poloha `inuse` a fotky povolené, kamera a notifikace zakázané. Pro scénář zamítnutí použij konkrétní override v `launchApp`; při návratu nastav celý očekávaný stav. Případné nativní potvrzení odmítni. Lokální fake navíc brání registraci skutečného push tokenu.

Aktuální důkazy a omezení jsou v [COVERAGE.md](COVERAGE.md), produktové chyby v [BUGS.md](BUGS.md). Sada není připojená do GitHub Actions.
