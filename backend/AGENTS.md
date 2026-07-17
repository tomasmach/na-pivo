# Na pivo Backend

Na pivo je mobilní aplikace pro lidi, kteří mají rádi hospody, pivo, večery s kamarády a malé rituály okolo toho všeho.

Původní MVP mobilní aplikace bylo jednoduché: kompas tě namíří do nejbližší hospody. Produkt se ale posouvá k modernímu mobilnímu pivnímu deníčku: zaznamenávání piv a večerů, navštívené hospody, profily, statistiky, komunita, objevování a hravá gamifikace.

Tento adresář (`backend/` v monorepu na-pivo) je backendová vrstva pro tento produkt. Má být nudně spolehlivá, levná na provoz, šetrná k datům a kompatibilní s mobilními verzemi, které už jsou venku.

## Current status

Backend je Django + Django REST Framework aplikace spravovaná přes `uv` a Python 3.14.

Mobilní appka žije v kořeni tohoto monorepa (o adresář výš). Branching a deploy model je popsaný v kořenovém `AGENTS.md`: všechna práce jde do `dev`, backend se nasazuje z `api-*` tagů, nikdy z `main`. Backend obsluhuje API pro účty, profily, hospody, otevírací dobu, komunitní data, hodnocení, návštěvy, pivní záznamy, telemetry, feedback a další syncované funkce.

Mechanické detaily jsou v README, `pyproject.toml`, settings a testech. Tento soubor je hlavně produktový a agentický kompas.

## Letter to the agent

Stavíš produkt se solo indie vývojářem.

To znamená, že čas, pozornost a provozní náklady jsou reálná omezení. Autor pracuje hodně agenticky a iterativně. Nápady mohou přicházet rychle, ve vlnách a bez finální roadmapy. Tvoje práce není jen psát kód, ale pomáhat z té energie dělat stabilní, dokončené a udržitelné změny.

Buď proaktivní. Čti existující systém, ptej se, když produktové rozhodnutí není jasné, upozorni na náklady a rizika, navrhni menší dokončitelný krok a nenech každou inspiraci okamžitě nabobtnat do zbytečně složité architektury.

Chraň autorův čas. Nenechávej rozdělané refaktory. Neotevírej pět směrů najednou. Preferuj řešení, která se dají pochopit, otestovat, nasadit a dál ručně nehlídat.

## Backend responsibility

Backend není jen technická podpora mobilní appky. Je to místo, kde se chrání data, náklady, kompatibilita a důvěra produktu.

Aplikace má reálné uživatele. Serverové změny proto posuzuj podle provozního dopadu: počet requestů, caching, rate limits, databázové dotazy, migrace, možnost rollbacku, abuse scénáře, citlivá data a cena externích služeb.

Když existuje jednoduché řešení, které je dost dobré a levné na provoz, preferuj ho před komplikovanou platformovou abstrakcí.

## Product direction

Na pivo má být moderní mobilní pivní deníček pro:

- běžné české a slovenské pivaře, kteří chtějí jednoduše zaznamenat večer, piva a hospody;
- pivní nadšence, kteří chtějí historii, značky, styly, statistiky a objevování;
- party kamarádů, pro které je důležitý komunitní a sociální rozměr.

Backend má umožnit premium deníček se statistikami, profily a komunitou, ale nepřidávej těžkou katalogovou nebo sociální architekturu dřív, než ji mobilní produkt opravdu potřebuje.

Komunita má být spíš otevřená a discovery-first. Zároveň musí být jasné, která data jsou veřejná, která soukromá a která jsou jen provozní.

Gamifikace je důležitá pro retention. Body, odznaky, žebříčky, statistiky, série, objevování, hodnocení, komunitní příspěvky i počet vypitých piv mohou být součástí produktu. Backend má tyto mechaniky modelovat tak, aby šly vysvětlit, auditovat a upravovat.

## Language and code style

Kód, názvy proměnných, názvy souborů, API internals a kódové komentáře piš anglicky.

Produktové texty, které se zobrazují v mobilní aplikaci, jsou česky a uživateli tykají. Backend by neměl zbytečně generovat dlouhé UI texty, ale když už vrací user-facing copy, drž český hospodský, lehce vtipný a lidský tón.

## API compatibility

Backend API musí zůstat kompatibilní s vydanými mobilními verzemi. Mobilní appku nejde všem uživatelům okamžitě updatnout.

Nerušte existující response fields, request fields ani význam stavů bez migrační cesty. Nová pole přidávej aditivně. Když je breaking change opravdu potřeba, navrhni verziování, feature flag, dual-write, fallback nebo přechodné období.

Testy API kontraktů jsou důležité hlavně tam, kde mobilní aplikace závisí na konkrétních tvarech odpovědí.

## Privacy and sensitive data

Poloha, hospody, alkoholová historie, profily a sociální vazby jsou citlivá data.

Neukládej surovou GPS historii ani trasy, pokud k tomu není explicitní produktové rozhodnutí. Preferuj uživatelem potvrzené návštěvy, navštívené hospody, lokální výpočty v mobilní appce, agregace, coarse polohu nebo geohash tam, kde to stačí.

Nikdy neloguj bearer tokeny, raw GPS, e-maily, kontakty, cookies, proxy URL s heslem ani request body s osobními daty. Logy mají pomáhat s provozem a debuggingem, ne vytvářet druhou databázi citlivých údajů.

Tokeny ukládej jen jako hash nebo jinou bezpečnou reprezentaci podle existujících patternů. Nová per-user data navazuj na stabilní account model, ne na tokeny nebo jiné tajné hodnoty.

## Costs, limits, and abuse

Každá nová serverová funkce musí myslet na:

- caching a invalidaci;
- rate limits a throttling;
- databázové indexy a počet dotazů;
- náklady externích služeb;
- provozní limity a failure modes;
- abuse scénáře;
- jednoduchou observability.

Nepřidávej serverově drahou funkci s předpokladem, že provoz je zdarma. Aplikace má reálné uživatele a některé části, včetně datových zdrojů a proxy, mohou být drahé.

Konkrétní free/pro hranice zatím není daná. Když navrhuješ náročnou backendovou funkci, mysli na možnost budoucího paywallu, ale nezaváděj monetizační pravidla bez produktového rozhodnutí.

## Data sources and scraping

Hospody, otevírací doba, externí katalogy a scraping jsou citlivá část produktu.

Bez explicitní domluvy nezvyšuj objem crawlování, neobcházej ochrany, nesnižuj intervaly, nevypínej limity a nepřepisuj cache strategii. Respektuj aktuální stav README, settings, skriptů a produkční reality.

Když měníš scraping nebo enrichment, mysli na právní riziko, cenu proxy, opakovatelnost, deduplikaci, cache, idempotenci, možnost pokračovat po pádu a dobré logování bez citlivých údajů.

## Development

Základní lokální příkazy:

```bash
uv sync
uv run python manage.py migrate
uv run python manage.py runserver
uv run python manage.py runserver 0.0.0.0:8000
uv run pytest
uv run ruff check
```

Používej `uv` pro dependency management a Python 3.14. Před přidáním nové dependency ověř aktuální nejnovější verzi a přidej jen dependency, která opravdu snižuje komplexitu nebo riziko.

Testy nesmí sahat na síť, pokud to není explicitní integrační test oddělený od běžného test suite. Externí služby mockuj nebo používej fixtures.

Respektuj existující Django, DRF, settings, throttling, model, serializer, view a management command patterny. Nepřidávej novou architekturu jen proto, že lokální pattern je obyčejný.

## Deployment

Produkční backend běží mimo tento lokální proces. Produkční deploy, SSH zásahy, Docker Compose na serveru, migrace na produkci a manipulace s produkčními daty dělej jen na explicitní požadavek člověka.

Commit a push jsou běžné. Deployment je separátní rozhodnutí.

Před změnou migrací, datových modelů, autentizace, tokenů, throttlingu, scraping pipeline nebo API kontraktu zvaž rollback a kompatibilitu s existující mobilní appkou.

## Git

Po dokončení coherent změny commitni a pushni.

Commit message musí být jednorádková conventional commit zpráva bez scope, například `feat: add profile badges` nebo `fix: preserve queued drinks offline`.

Nesahej na cizí rozdělané změny v pracovním stromu. Když už v repu existují unrelated změny, stageuj a commituj jen vlastní soubory.

## General rules

- buď proaktivní, ale drž změny malé a dokončitelné;
- chraň čas solo indie autora;
- chraň produkční kompatibilitu s vydanými mobilními appkami;
- piš kód a komentáře anglicky;
- drž user-facing copy česky, tykáním a v lidském hospodském tónu;
- nepřidávej drahou funkci bez cache, limitů a provozního uvažování;
- neukládej a neloguj citlivá data bez jasné potřeby;
- nesnižuj scraping ochrany bez explicitní domluvy;
- respektuj existující Django/DRF architekturu;
- testuj změny podle reálného rizika, ne pro coverage theater.
