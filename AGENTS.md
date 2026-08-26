# Na pivo

Na pivo je česká mobilní appka pro lidi, kteří mají rádi hospody, pivo a večery s kamarády. Začala jako kompas na nejbližší hospodu, dnes je to pivní deníček a verze 3.0 z něj dělá společníka celého večera: pět tabů, večer jako jádro, parta a hry u stolu. Zhruba: něco jako Untappd, ale české, hospodské a pro partu u jednoho stolu — míň katalog, víc večer.

Monorepo: Expo / React Native appka v kořeni, Django backend v `backend/`. Designový zákon je `DESIGN.md`, produktová rozhodnutí `docs/decisions/`, serverový deploy runbook `backend/README.md`. Tenhle soubor je jediný AGENTS.md v repu a říká, jak se tady mění věci.

## Co dělá Na pivo výjimečným

Appka má reálné uživatele v českých a slovenských storech. Tohle jsou vlastnosti, které jim nikdy nesmíme vzít:

### 1. Offline jádro

Uživatel stojí v hospodě se špatným signálem a zapisuje pivo. Zápis, který produkt slibuje offline (pivo, večer, návštěva), musí projít bez internetu a doručit se frontou později. Appka bez backendu vypadá jako bez sítě, ne rozbitě.

### 2. Vydané verze fungují dál

Appku ve storech nejde updatnout všem hned; staré verze žijí měsíce. API se mění jen aditivně — pole se přidávají, význam stavů se nemění, `/v1/` je jediná verze a kompatibilita se drží disciplínou, ne mechanismem.

### 3. Soukromí

Poloha, alkoholová historie, profily a sociální vazby jsou citlivá data. Žádná surová GPS historie ani trasy; bearer token jen v secure store; telemetry přes server-side whitelist; nikdy neloguj tokeny, GPS, e-maily ani request body s osobními daty.

### 4. Český hospodský tón

UI tyká, mluví lidsky a lehce vtipně, texty píše solo autor v první osobě. Pivo se čepuje, netočí (hospoda ale klidně „točí Plzeň“). Ne korporátní wellness, ne suchý tracker, ne SaaS fráze.

### 5. Jednoduchost u stolu

Všechno musí zvládnout člověk u stolu v hospodě po třetím pivu. Když vzniká tradeoff, vyhrává jednoduchý mobilní flow nad katalogovou komplexitou.

## Dopis od Macha

Stavíš produkt se solo indie vývojářem. Čas, pozornost a serverové náklady jsou reálná omezení. Nápady chodí rychle a ve vlnách; tvoje práce je dělat z nich malé, dokončené, ověřené změny — ne otevírat pět směrů najednou a nechávat rozdělané refaktory.

Malá featura = malý diff. Žádný nový store, abstrakce ani plánovací dokument, pokud si o ně nikdo neřekl. YAGNI. Serverově drahou funkci stav s cache a limity; free/pro hranice není rozhodnutá, tak paywall sám nezaváděj.

Zbytek dokumentu ber jako dobré defaulty, ne tvrdá pravidla. Když prompt říká něco jiného, vyhrává prompt. Když si nejsi jistý produktovým rozhodnutím, zeptej se jednou — a pak jeď bez průběžných žádostí o potvrzení; výjimka je produkce, release do storů a mazání dat.

## Slovník

- **ty** — agent, který čte tenhle soubor a mění Na pivo.
- **večer** — jádro 3.0: jeden záznam večera, ze kterého se odvozuje počítadlo, vlákno i statistiky („jeden zápis, dva čtenáři“).
- **parta** — skupina kamarádů, společný stůl, hry.
- **Mapér / Pivař XP** — gamifikace mapování hospod / pití.
- **„nasaď“, „deploy“** — bez další kvalifikace vždy backend přes `api-*` tag. Nikdy to neznamená OTA.
- **„od nuly“, „skreplni to“** — smaž starý layout a postav nový. Když v diffu zůstávají původní bloky, zadání jsi nesplnil. Chování ale zůstává: deep linky, offline flow, telemetry a accessibility se od nuly nedělají.
- **api-\* tag** — `api-YYYY.MM.DD.N`, jediné, z čeho se nasazuje backend.

## Tři způsoby, jak si ublížit

1. **Spustit `eas update`.** Nikdy sám. „Nasaď“ znamená backend; OTA je separátní lidské rozhodnutí. Když ho dostaneš, jede **jen z `main`**: nejdřív `--channel preview`, ověřit, pak `eas update:republish --destination-channel production`. OTA z feature větve už jednou shodila produkci a rollback stál večer.
2. **Rozbít vydanou appku ze serveru.** Klientské offline fronty mají `400/422 = drop navždy` — zpřísnění validace existujícího pole tiše smaže data uživatelů starých verzí.
   - Špatně: staré pole je nově `required`; payload vydané appky dostane 422 a fronta ho zahodí.
   - Správně: starý payload dál projde, nové pole je optional s defaultem, a kontraktový test v `pubs/api/tests/` posílá payload vydané verze.
   Kontrakty hlídej testy v `backend/pubs/api/tests/`. A datový zdroj, API klíč nebo fallback odstraň až poté, co jsi doložil, že na něm nezávisí žádná podporovaná vydaná verze — vytržení Mapy.cz bez téhle kontroly stálo několik dní a nucenou migraci map.
3. **Zapsat data do produkce omylem.** Ověřuj proti lokálnímu backendu. Před prvním write requestem vypiš efektivní base URL — když to není `localhost`, `127.0.0.1`, `10.0.2.2` nebo explicitní dev LAN host, zastav. Verifikace už jednou běžela proti produkci a testovací účet se musel mazat z ostré databáze.

## Zasáhni každou plochu

Nejčastější defekt v tomhle repu: změna funguje na cestě, kterou jsi testoval, a chybí všude jinde. Než řekneš hotovo, projdi seznam a řekni, které položky se tě týkaly:

- **Offline i online.** Offline-slíbený zápis má frontu a flush v `app/_layout.tsx`; bez toho je funkce rozbitá v hospodě.
- **Anonym, přihlášený a přechod mezi nimi.** `privateAccountBoundary` zmrazuje zápisy během claimu a mazání účtu; fronta, která ho obejde, zapíše data pod špatný účet.
- **Staré vydané verze.** Nové pole je aditivní, staré chování se nemění.
- **iOS i Android.** Bundle id se liší: `com.tomasmach.na-pivo` (iOS, pomlčka) vs. `com.tomasmach.na_pivo` (Android, podtržítko).
- **Vstupní body.** Stejná akce bývá dostupná z více míst — taby, deep linky (`napivo://`, `https://na-pivo.cz/p/*`), push cold start, widget/Live Activity. Projdi call sites (`rg` na komponentu a `router.push`) a vyjmenuj, které vstupy jsi ověřil.
- **Nativní hranice.** Nový modul, config plugin nebo nativní dependency = rebuild, ne OTA. Napiš to.
- **Persisted data.** Změna tvaru lokálně uložených dat musí načíst starý tvar (validovaná storage v `createQueue`) a přežít malformed obsah.
- **Globální destruktivní akce nad komunitními daty** (skrytí/smazání hospody) jedou přes potvrzení a práh hlasů — jedno klepnutí na vlaječku už jednou mazalo hospody všem. Vlastní obsah si uživatel maže rovnou, s potvrzením.
- **Texty.** Appka běží česky (i pro Slováky) a anglicky podle jazyka telefonu. Každý text pro lidi patří do `src/i18n/cs.ts` **a zároveň** do `src/i18n/en.ts` (stejný tvar, typecheck a `src/i18n/__tests__/en.test.ts` to hlídají); obrazovky čtou jen `t` z `@/i18n`, datumy a čísla formátují přes `intlLocale`, plurály přes `plural(...)`. Backend má Czech msgid + `backend/locale/en/LC_MESSAGES/django.po`; nový serverový text obal do `gettext` a doplň anglický `msgstr`. Angličtina bez pomlček typu em dash. Text musí přesně popisovat akci a neměnit fakta ani čísla („přidali si kamarády“ není „našli kamarády“). Každý nový nebo změněný text pro lidi prožeň humanizerem sám od sebe; netriviální texty mi navíc ukaž v chatu, než je commitneš — překlep tím neblokuj.

## Dev prostředí

- `npm run dev` je jediná standardní cesta: migrace → lokální backend (uvicorn na portu 8012) → prebuild → iOS simulátor. Samostatné Metro, `expo run:ios` nebo ruční backend jen při cílené diagnostice jedné vrstvy.
- Background běh: `npm run dev:detached` / `npm run dev:stop`; `NAPIVO_KEEP_SIM=1` nechá simulátor žít.
- `ios/` a `android/` jsou gitignorované, prebuild je pokaždé regeneruje. `postinstall` patchuje `node_modules` — instalace s `--ignore-scripts` je rozbitý build.
- Backend potřebuje ASGI (party hry jedou přes SSE) — proto uvicorn, ne `runserver`.
- Prázdná databáze je špatný test: `cd backend && uv run python manage.py seed_dev_3_0` naseje dev data.
- Nespouštěj druhý simulátor ani druhý dev server vedle běžícího. Po práci **zastav všechno, co jsi sám spustil**; cizí procesy nech být. Když mi necháváš běžící appku k proklikání, napiš to do handoffu včetně stop příkazu. Pozor: `dev:stop` čte globální `/tmp/napivo-dev.pid` — v jiném worktree může zabít cizí běh, ověř si PID, než ho použiješ.

## Verifikace

- Vizuální nebo runtime změna je hotová, až když jsi ji viděl běžet v simulátoru a podíval ses na screenshot očima uživatele. Přetékající text, useknutý glow, nevycentrovaný label, karta v kartě — to musíš vidět ty, ne já. Zelený typecheck a testy nejsou ověření.
- Ověř celý flow, ne jeho první krok. „Otevřela se kamera“ není „sken funguje“. Slovo „ověřeno“ bez proběhlého ověření je lež, ne optimismus.
- Backendová změna je hotová až po reálném requestu na lokální endpoint: ukaž metodu, URL, status i tělo odpovědi; u zápisu ověř následný read nebo stav v DB.
- Bug nejdřív zreprodukuj a příčinu dolož daty (u UI screenshot, jinak log, databáze, request). Teprve pak opravuj — a odpověď pro reálného uživatele („opraveno“) navrhuj až po ověření stejným flow, kterým si stěžoval. Falešné „opraveno“ už jednou dostal člověk, který zůstal zamčený z účtu.
- Testy cíleně podle rizika: `npm run typecheck`, `npm test`, `npm run lint`; backend `cd backend && uv run pytest`, `uv run ruff check`. CI na `dev` jede totéž plus `audit-ci`, `pip-audit` a dependency-review.
- Backend testy běží na SQLite, produkce je Postgres 17 — migraci závislou na PG chování (indexy, constrainty) ověř proti Postgresu z `backend/docker-compose.yml`, ne jen pytestem.

## Jak to funguje

Obrazovky žijí ve feature adresářích `src/<feature>/`; `app/*` má být tenký routing wrapper (starší routes to porušují — nový kód je nekopíruje). Stav drží Zustand stores v `src/stores/`, jeden na doménu — žádný Redux, žádný React Query.

Síť nemá centrální klient. Každá feature má vlastní `src/data/xxxClient.ts`, takže wire contract se čte na jednom místě; sdílené je jen `apiFetch.ts` a `backendConfig.ts`. Nový klient nesmí pustit výjimku do UI — vrací result nebo graceful fallback. Offline zápisy jedou přes fronty postavené na `createQueue.ts` (storage, lock, koalescovaný flush); HTTP klasifikaci (`401` keep, `400/422` drop, jinak retry) dává `classifyQueueHttpFailure` v `apiFetch.ts` — starší fronty se v detailech liší a slepě se nekopírují. Flush se pouští ze startu a foregroundu.

Backend je jedna Django app `pubs`. DRF má `DEFAULT_AUTHENTICATION_CLASSES` prázdné — **nový endpoint musí explicitně rozhodnout autentizaci (`AccountTokenAuthentication`), permissions a throttle (`ScopedRateThrottle`), jinak je veřejný a bez limitu.** Tokeny jen jako SHA-256 hash. Throttling stojí na `LocMemCache`, reálný limit je rate × počet gunicorn workerů.

## Kde co žije

- `src/data/` — síťová a sync vrstva (klienti, fronty, auth, `privateAccountBoundary`); i těžiště testů (`src/data/__tests__`).
- `src/components/shared/` — sdílené komponenty; scrollovatelný formulář s inputy = `KeyboardAwareScrollView`.
- `src/i18n/cs.ts` + `src/i18n/en.ts` — UI texty (cs je zdroj, en zrcadlo), `src/i18n/locale.ts` volba jazyka; `src/theme/` + `src/mocks/mockTheme.ts` — designové tokeny.
- `src/games/` + `npm run build:games` — party hry jako WebView bundly v `assets/games/`.
- `modules/beer-live-activity/`, `plugins/` — nativní modul a config pluginy; sahat na ně = rebuild.
- `backend/pubs/` — modely, `api/` (routy pod `/v1/`), `migrations/`, `management/commands/`, `enrichment/` (Firmy.cz scraping — právně citlivé, nezvyšuj objem ani neobcházej ochrany; denní capy jsou v env).
- Jest jede bez jest-expo presetu, ruční mocky v `src/__mocks__/`. Pozor: `src/mocks/` (bez podtržítek) jsou designové mocky 3.0, ne testovací.

## Design

`DESIGN.md` je zákon a etalonem je mockový jazyk 3.0. Hodnoty se z něj kopírují, ne odhadují. Mock rozhoduje vizuální záměr, DESIGN.md číselný kontrakt; když se rozejdou, nahlas to a oprav dokument i kód v jednom diffu — žádné lokální výjimky.

Nové UI skládej z komponent, tokenů a interakcí, které v appce už jsou. Když se ti hodí vzor bez precedentu v appce — jiný rating, jiný dialog, jiný typ ovládání — znamená to, že jsi nenašel ten existující, ne že máš zavést nový.

Netriviální UI změna začíná statickými variantami A/B/C vedle sebe; produkční komponentu měň až po mém výběru. Kosmetiku dělej rovnou.

## Git a dopad změn

- Hotovou koherentní změnu commitni a pushni bez ptaní. „Chceš to commitnout?“ je zakázaná věta. Napiš, kde práce leží (větev, worktree, PR), a nenechávej uncommitnuté soubory.
- Commity: jednořádkový conventional commit bez scope, anglicky (`fix: preserve queued drinks offline`).
- Fix, který má vidět uživatel, patří na `dev`. Po dokončení ověř `git merge-base --is-ancestor <commit> origin/dev` — fix na odhlašování takhle ležel týdny v zapomenuté větvi.
- `dev` je default pro všechnu práci. `main` je přesně to, co je ve storech — hýbe se jen releasem (merge `dev` → `main`) nebo hotfixem, nikdy přímým commitem. Backend se nasazuje z `api-*` tagů, nikdy z `main`; serverový runbook je v `backend/README.md`.
- Hotfixy: mobilní `main` → `fix/*` → merge do `main` → build a submit (člověk) → tag `vX.Y.Z` po vydání → **merge `main` do `dev`**. Backendový: poslední nasazený `api-*` tag → `fix/*` → nový `api-*` tag → deploy → **merge do `dev`**. Zapomenutý merge zpět znamená, že příští release fix nemá.
- Verze appky: `package.json` + `app.config.ts` vždy společně; tag `vX.Y.Z` až když je verze skutečně venku ve storech.
- Před vygenerováním backend migrace fetchni a rebasni na `origin/dev` a zkontroluj, že migration graf má jediný leaf (`cd backend && uv run python manage.py makemigrations --check --dry-run`) — jinak vzniknou dvě hlavy jako u kolize 0082.
- U každé změny řekni jednou větou, netechnicky, tři plochy dopadu: **lokálně hned / po `api-*` deployi / až s novým mobilním buildem či OTA.** Migrace ani nativní změna nesmí zůstat bez téhle věty.
- Artefakty tvého běhu (screenshoty, dumpy, poznámkové `.md`) nepatří do commitu — důkazy přilož do PR nebo chatu, soubory ukliď.
- EAS build dělá člověk. Release do storů, OTA a produkční server jen na explicitní pokyn v aktuální zprávě.

## Vkus

- Síť, persistence a sync patří do `src/data`; doménová logika do feature modelů; obrazovka orchestruje a renderuje.
- Když píšeš víc kódu, než úkol potřebuje, děláš to špatně.
- Výsledky říkej v důsledcích, ne v žargonu: „načte se to o polovinu rychleji“, ne názvy migrací.
- Když pravidlo z tohohle souboru bojuje s úkolem před tebou, řekni to nahlas a nech rozhodnout člověka.
