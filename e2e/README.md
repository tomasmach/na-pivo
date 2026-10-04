# Lokální mobilní E2E

Testy řídí skutečný iPhone 17 v iOS simulátoru a skutečný Django backend. Používají pouze vlastní SQLite a syntetická data. Výchozí runner je Maestro 2.11.0; důvod přechodu z TesterArmy a původní měření ChatGPT replay jsou v COVERAGE.md. Běžný `dev-local` runner se nepoužívá, protože vybírá `backend/db.sqlite3`.

## První spuštění na macOS

Použij Node.js 24 a Javu 17 nebo novější. Runner před startem vyžaduje alespoň 30 GiB volného místa a při poklesu pod 20 GiB zastaví pouze vlastní běh s kódem 75. Rezerva chrání i ostatní práci na stroji; neplánuj souběžné mobilní buildy. Pro více simulátorů je nutná větší rezerva; dva běhy zde později vyčerpaly i 5 GiB kvůli souběžné spotřebě systému. Takové přerušení není selháním produktu. Lokální kontroler načítá TypeScript přímo přes podporu Node.js.

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
npm run e2e:blocked
npm run e2e:critical -- e2e/tests/spike/ --stability
npm run e2e:full -- --no-cache
E2E_SLOT=2 npm run e2e:critical -- e2e/tests/spike/
```

`--stability` požaduje tři zelené průchody. Maestro nepoužívá model ani replay cache, proto `--no-cache` nic nemění a replay metriky jsou `null`. Pro oblast používej adresářový filtr. Původní TesterArmy spike lze diagnosticky spustit přes `E2E_ENGINE=testerarmy npm run e2e:critical -- e2e/tests/spike/persist-drink.e2e.ts --stability`; vyžaduje `E2E_TELEMETRY_DISABLED=1 npx e2e login openai` a druhý/třetí průchod v něm nadále vynucují úplný replay.

`critical` a `full` vynechávají výslovně označené `blocked` scénáře. Ty se spouštějí samostatně přes `e2e:blocked` a nejsou započítané mezi ověřené průchody. Každý musí mít konkrétní důvod v COVERAGE.md. Aktuálně jde o registraci: Maestro vyplní nativní formulář, ale aplikace při odeslání hlásí příliš krátké heslo; příčina není prokázaná. Tento blokátor současně brání navazujícímu ověření e-mailu, claimu anonymních dat a exportu v daném průchodu.

## Izolace a úklid

Sloty 1–3 mají API `18121–18123`, Metro `18221–18223`, místní kontroler `18321–18323`, vlastní iPhone 17 a DB v `.e2e/runs/<id>/test.sqlite3`. Zámky jsou ve společném git adresáři, proto platí i mezi worktrees. Obsazený port znamená konec, nikoliv ukončení cizího procesu. Nevyužitý vlastní simulátor lze znovu použít; běžící simulátor se nikdy nepřebírá. `E2E_APP_PATH=/absolute/Napivo.app` dovoluje sdílet ověřenou binárku mezi worktrees, každý však má svoje Metro.

Runner eviduje PID a čas spuštění, po skončení zastaví vlastní procesy a vlastní simulátor. `Ctrl-C` vyvolá stejný úklid. Po násilném ukončení nejdřív ověř `owner.json`, `processes.json` a odpovídající slot lock; nikdy nepoužívej `killall`. Databáze, metriky a bezpečné screenshoty zůstávají v gitignorované `.e2e/`. Maestro raw debug reporty obsahují pouze povolené jednorázové testovací údaje a runner je po běhu smaže. ChatGPT přihlášení ani skutečné bearer tokeny do nich nevstupují. `E2E_MAESTRO_PATH=/absolute/maestro/bin/maestro` dovoluje mezi worktrees sdílet lokálně ověřenou CLI verzi.

První příprava nativního enginu je mezi worktrees krátce serializovaná přes `boot.lock`. Samotné testy mohou běžet souběžně. Na stroji použitém při vývoji se po doložení dvou izolovaných spike běhů pokračuje pouze jedním simulátorem kvůli nedostatku disku a růstu systémového swapu. Důvodem je sdílený agent-device daemon: souběžné studené starty tří iPhonů opakovaně vyčerpaly jeho 90s timeout a zasáhly ostatní sessions. Runner nejdřív dokončí nativní boot přes simctl a teprve potom pustí framework; zámek uvolní při začátku lokálních služeb.

Backend se spouští zvláštním settings modulem mimo produkční Docker context. Vyžaduje `DEBUG=True`, explicitní flag a vlastněný adresář běhu. Zachytává skutečně vykreslené e-maily v paměti, blokuje externí Python sockety a nepoužívá testovací přihlášení. Mobilní fake registrace push tokenu vyžaduje zároveň development build, explicitní flag a loopback API.

## Přidávání testů

- Oblast vlastní `e2e/tests/<oblast>/*.yaml`, případné vlastní assertion `.js` a svůj `e2e/seeds/<scenario>.py`. `seed()` připraví data; `observe()` vrací potřebná syntetická DB pole, nikdy tokeny, e-maily nebo GPS.
- Flow začne `../../maestro/reset.yaml`, případný `SCENARIO` předá v `env`. Následuje `skip-onboarding.yaml` a `login.yaml`. Reset vyčistí skutečnou DB, Keychain a data appky, konfigurace launchApp určuje oprávnění. Runner nastaví pevnou syntetickou polohu a dark mode.
- `output.local.offline()` skutečně zastaví backend; `online()` ho obnoví. Potom `../../maestro/foreground.yaml` ověří foreground flush bez ukončení appky a zachová výslovně nastavená oprávnění. Helper porovnává skutečný PID před návratem, na pozadí i po návratu; v testu potom ověř konkrétní viditelný obsah appky. Restart uprostřed výpadku používá `../../maestro/restart.yaml`.
- `output.local.state()` čte skutečnou DB přes místní kontroler. `output.local.observe(account, route)` čte skutečný `/v1/` endpoint pod fixture účtem a vrací sanitizované `{status, body}`. Observer používá normální přihlášení a token drží v paměti. Při testu smazání nebo jiných citlivých zápisů stejného účtu vytvoř observer ještě před přihlášením v UI. Každý normální login mění deletion epoch; observer přihlášený až po appce by zneplatnil její oprávnění k citlivému zápisu. Po smazání používej již přihlášený observer, aby nový login neaktivoval účet v ochranné lhůtě.
- Asynchronní doručení ověřuj přes `output.local.poll(function () { /* načíst stav a přesně jej porovnat */ })`. Opakuje jen čtecí kontroly po 500 ms, nejvýš 15 s (volitelný druhý argument, nejvýš 30 s). UI zápisy do něj nepatří. Samotné Maestro `retry` nemá potřebný časový odstup.
- `output.local.request('/mail/verify', {})` otevře skutečný odkaz zachyceného e-mailu. `/mail/reset` otevře lokální app deep link, token nevstupuje do Maestro. `/mail/export` vrací pouze status a počet příloh.
- `output.local.screenshot('safe-name')` volej na zkontrolovaném konečném stavu bez přihlašovacích údajů či souřadnic. Poslední kontrola testu musí porovnat skutečná data po restartu nebo přes API/DB. Nevydávej samotný úspěšný tap za ověření.
- `output.local.debugScreenshot('safe-name')` ukládá diagnostický obrázek do neveřejného `private-debug`, který se po běhu smaže. Platí stejná výjimka jen pro jednorázové fixture účty. Obrázek s kontaktem nepublikuj ani nevypisuj do trvalých logů.
- `/capability/discover` najde jedinou veřejnou tour podle přesného fixture názvu přes skutečný anonymní katalog. Vrací jen identitu a obsah; token uloží pod aliasem v paměti kontroleru. Používá se pro kontrolu publikace a odvolání, nikoli jako důkaz nativního Copy.
- `/capability/status` čte skutečný veřejný endpoint odkazu bez přihlášení. Vrací jen status a případně porovnání aliasů; nevytváří observer session a nevrací token odkazu.
- `output.local.request('/home-point')` čte pouze domovský bod z uložených nastavení vlastní appky. Vrací `present` a `matchesFixture`, nikoli souřadnice; druhý příznak porovná bod s pevnou simulovanou polohou. Ověř jej po uložení a restartu, po zrušení rozpracované změny i po smazání.
- Sdílené helpery, config, adaptéry a produkční `testID` mění hlavní agent. Každý test musí chytat pojmenovanou regresi z COVERAGE.md a projít třikrát.

Oprávnění jsou výslovně `all: deny`, poloha `inuse` a fotky povolené, kamera a notifikace zakázané. Pro scénář zamítnutí použij konkrétní override v `launchApp`; při návratu nastav celý očekávaný stav. Případné nativní potvrzení odmítni. Lokální fake navíc brání registraci skutečného push tokenu.

Aktuální důkazy a omezení jsou v [COVERAGE.md](COVERAGE.md), produktové chyby v [BUGS.md](BUGS.md). Sada není připojená do GitHub Actions.

`attempt-*/metrics.json` měří jednotlivá spuštění Maestra. `command-metrics.json` navíc obsahuje čas celého příkazu včetně přípravy a úklidu prostředí a jeho návratový kód.


## Pokračování před sloučením PR

Společná větev `test/e2e-integration` skládá infra PR #208 a oblasti #216, #217 a #218. Oblastní PR samotné obsahují jen testy a seed data. Vlastní lokální dev build z původního worktree lze dál použít přes `E2E_APP_PATH`; při změně nativních vstupů jej sestav znovu. Oblasti ověřuj postupně a zachovej diskovou rezervu runneru. Účet a média už mají tři úspěšné průchody; stav zbývajících oblastí a celé sady uvádí COVERAGE.md.

```sh
npm run e2e:full -- e2e/tests/identity/ --stability
npm run e2e:full -- e2e/tests/diary/ --stability
npm run e2e:full -- e2e/tests/places-social/ --stability
npm run e2e:full
npm run e2e:full
npm run e2e:blocked
```

Oblasti spouštěj postupně. Pro závěrečný první čistý simulátor archivuj vlastní `.e2e/simulator-1.json` pod jiným názvem; runner vytvoří nový jednoznačně pojmenovaný iPhone 17. Starý simulátor nemaž ani nepřebírej cizí. Oba poslední běhy celé sady mají zaznamenat `command-metrics.json`; druhý je opakovaný běh Maestra, ne AI replay cache. Registrovaný Android Pixel 10 je dostupný, ale Android runner a ověření čekají na zelené iOS.

## Android, připraveno k nativnímu ověření

Android se spouští až po zelené dostupné iOS sadě. Příprava používá místní SDK s ARM64 obrazem `system-images;android-36.1;google_apis_playstore;arm64-v8a` a profilem `pixel_10`. Nevhodný nebo chybějící obraz runner sám nestahuje. Vytvoří vlastní pojmenovaný Pixel 10, při dalších bězích použije pouze svůj neobsazený AVD. Běh používá stejný slot, samostatné API/Metro/DB a navíc vlastní konzolový a gRPC port.

```sh
npm run e2e:build:android
E2E_PLATFORM=android npm run e2e:critical -- e2e/tests/spike/
E2E_PLATFORM=android npm run e2e:full
```

Tyto Android příkazy zatím nemají doložený nativní výsledek. Oblastní flow ještě potřebují dokončit přizpůsobení systémového pickeru a oprávnění. Stav zůstává v COVERAGE.md; příprava kódu není zelená Android sada.

Build používá lokální Expo prebuild a `assembleDebug` pouze pro ARM64, nejvýš dva Gradle workery a 2 GiB JVM heap. Nečte skutečný `google-services.json`: explicitní místní E2E konfigurace jej vynechá, v produkčním režimu a EAS skončí chybou. Výchozí konfigurace vydané appky se nemění. APK zůstane v `.e2e/build/na-pivo-debug.apk` a mezi běhy se znovu používá. Build i test vyžadují 30 GiB volného místa a pod 20 GiB zastaví pouze vlastní procesy.

Android reset používá skutečné `pm clear`, restart otevírá Expo bundle na `10.0.2.2` a návrat do popředí nemění oprávnění, protože jejich odebrání by ukončilo proces. Fotky vybírá systémový picker bez širokého oprávnění ke galerii. Skutečnou schránku čte lokální gRPC vlastního emulátoru; jeho token i zkopírovaný obsah zůstávají v paměti kontroleru. Domovský bod se čte ze skutečné AsyncStorage DB včetně WAL a ven vrací pouze dvě booleovské hodnoty. Dočasná kopie DB se smaže po čtení i při úklidu běhu.
