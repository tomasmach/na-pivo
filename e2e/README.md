# Lokální mobilní E2E

Testy řídí skutečný iPhone 17 v iOS simulátoru a skutečný Django backend. Používají pouze vlastní SQLite, syntetická data a ChatGPT předplatné. Běžný `dev-local` runner se nepoužívá, protože vybírá `backend/db.sqlite3`.

## První spuštění na macOS

```sh
npm ci
(cd backend && uv sync --locked --extra prod)
E2E_TELEMETRY_DISABLED=1 npx e2e login openai
npm run e2e:build
npm run e2e:critical
```

Build je lokální `expo run:ios` s lokálním backend mode, vypnutými widgety a neplatným mapovým klíčem. Nevolá EAS. Runtime nenačítá `.env`. Přihlášení frameworku zůstává v jeho uživatelském úložišti mimo repo. Při změně nativních závislostí build zopakuj.

```sh
npm run e2e:full
npm run e2e:critical -- e2e/tests/spike/ --stability
npm run e2e:full -- --no-cache
E2E_SLOT=2 npm run e2e:critical -- e2e/tests/spike/
```

`--stability` požaduje tři zelené průchody. Druhý a třetí používají strict cache a runner navíc odmítne jakýkoliv missed nebo handed off krok. `agent.assert` vždy volá model, i při úplném replay `agent.act`. `--no-cache` a `--stability` se nekombinují. Pro oblast používej adresářový filtr; více `--tag` se ve frameworku standardně spojuje jako OR.

## Izolace a úklid

Sloty 1–3 mají API `18121–18123`, Metro `18221–18223`, vlastní iPhone 17 a DB v `.e2e/runs/<id>/test.sqlite3`. Zámky jsou ve společném git adresáři, proto platí i mezi worktrees. Obsazený port znamená konec, nikoliv ukončení cizího procesu. Nevyužitý vlastní simulátor lze znovu použít; běžící simulátor se nikdy nepřebírá. `E2E_APP_PATH=/absolute/Napivo.app` dovoluje sdílet ověřenou binárku mezi worktrees, každý však má svoje Metro.

Runner eviduje PID a čas spuštění, po skončení zastaví vlastní procesy a vlastní simulátor. `Ctrl-C` vyvolá stejný úklid. Po násilném ukončení nejdřív ověř `owner.json`, `processes.json` a odpovídající slot lock; nikdy nepoužívej `killall`. Databáze, reporty, cache i bezpečné screenshoty zůstávají v gitignorované `.e2e/`.

Backend se spouští zvláštním settings modulem mimo produkční Docker context. Vyžaduje `DEBUG=True`, explicitní flag a vlastněný adresář běhu. Zachytává skutečně vykreslené e-maily v paměti, blokuje externí Python sockety a nepoužívá testovací přihlášení. Mobilní fake registrace push tokenu vyžaduje zároveň development build, explicitní flag a loopback API.

## Přidávání testů

- Importuj `test` z `e2e/helpers/test`. Fixture zavře appku, vyčistí Keychain i aplikační data, resetuje DB a nastaví syntetickou polohu a tmavý režim.
- Oblast vlastní `e2e/tests/<oblast>/` a svůj `e2e/seeds/<scenario>.py`. `seed()` připraví data; volitelný `observe()` vrací jen potřebná syntetická DB pole pod `local.state<T>().scenario`. Nikdy nevrací tokeny, e-maily ani GPS.
- Sdílené helpery, config, adaptéry a produkční `testID` mění hlavní agent. Každá změna scope má vlastní skutečný oracle, nikoliv jen úspěšný tap.
- `local.offline()` skutečně zastaví tento backend. Po restartu appky ověř lokální práci; `local.online()` a `device.home()` → `app.open()` ověří foreground sync.
- `observer()` přihlásí fixture přes běžný password endpoint a vrací pouze čtení API. Bearer drží v paměti. U negativních kontrol vrací skutečný HTTP status. V testu smazání jej vytvoř před akcí: nové přihlášení během ochranné lhůty účet znovu aktivuje. Žádný testovací auth endpoint se nepřidává.
- Finální `local.screenshot('safe-name')` volej až na zkontrolované obrazovce bez přihlašovacích údajů a souřadnic. Nezveřejňuj celé modelové reporty. Naměřené souhrny jsou v `attempt-N/metrics.json`.

Na iOS 26.5 neumí `simctl privacy` nastavit notifications. Config proto určuje polohu, kameru a fotky; test systémový notification dialog odmítne, pokud se objeví. První nový simulátor tím může jednorázově předat replay modelu. Další stabilitní průchody už předání nepovolují. `mobile 0.9.1` váže clear-state na otevřenou session: fixture nejdřív explicitně otevře správný telefon a proces appky zastaví přes jeho UDID, aniž by ztratila vazbu session.

Aktuální důkazy a omezení jsou v [COVERAGE.md](COVERAGE.md), produktové chyby v [BUGS.md](BUGS.md). Sada není připojená do GitHub Actions.
