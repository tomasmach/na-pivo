# Na pivo

Na pivo je mobilní aplikace pro lidi, kteří mají rádi hospody, pivo, večery s kamarády a malé rituály okolo toho všeho.

Původní MVP bylo jednoduché a silné: kompas tě namíří do nejbližší hospody. To je zatím pořád hlavní rozpoznatelná věc produktu. Směr produktu se ale posouvá k modernímu mobilnímu pivnímu deníčku: zaznamenávání piv a večerů, navštívené hospody, profily, statistiky, komunita, objevování a hravá gamifikace.

Produkt má být český, hospodský, lehce vtipný a lidský. Ne korporátní wellness aplikace, ne suchý tracker a ne enterprise software. Má působit jako chytrý deníček do kapsy pro české a slovenské pivaře.

## Current status

Toto repo je Expo / React Native mobilní aplikace.

Backend žije v sousedním repozitáři `../na-pivo-backend`. Mobilní aplikace se serverem řeší účty, profily, komunitní data, hospody, hodnocení, návštěvy, piva, telemetry a další syncované funkce. Část zážitku musí fungovat lokálně a bez internetu, ale produkt už není čistě offline kompas.

Mechanické příkazy jsou v `package.json` a README. Tento soubor je hlavně produktový a agentický kompas.

## Letter to the agent

Stavíš produkt se solo indie vývojářem.

To znamená, že čas, pozornost a provozní náklady jsou reálná omezení. Autor pracuje hodně agenticky a iterativně. Nápady mohou přicházet rychle, ve vlnách a bez finální roadmapy. Tvoje práce není jen psát kód, ale pomáhat z té energie dělat stabilní, dokončené a udržitelné změny.

Buď proaktivní. Čti existující systém, ptej se, když produktové rozhodnutí není jasné, upozorni na náklady a rizika, navrhni menší dokončitelný krok a nenech každou inspiraci okamžitě nabobtnat do zbytečně složité architektury.

Chraň autorův čas. Nenechávej rozdělané refaktory. Neotevírej pět směrů najednou. Preferuj řešení, která se dají pochopit, otestovat, pustit a dál ručně nehlídat.

## Product direction

Na pivo má být moderní mobilní pivní deníček pro tři přirozené skupiny uživatelů:

- běžné české a slovenské pivaře, kteří chtějí jednoduše zaznamenat večer, piva a hospody;
- pivní nadšence, kteří chtějí historii, značky, styly, statistiky a objevování;
- party kamarádů, pro které je důležitý komunitní a sociální rozměr.

Není potřeba mezi těmito skupinami vždy vybírat jednu. Když ale vzniká produktový tradeoff, preferuj jednoduchý mobilní zážitek, který člověk zvládne použít v hospodě u stolu, ne těžký katalogový systém.

## Tone and copy

UI copy je česky a uživateli tyká.

Tón má být hospodský, lehce vtipný a lidský. Klidně trochu hravý. Vyhýbej se sterilnímu SaaS jazyku, zbytečnému vysvětlování a dlouhým textům. Uživatel často stojí venku, jde městem, sedí v hospodě nebo rychle zapisuje večer. Rozhraní musí být jasné hned.

Kód, názvy proměnných, názvy souborů a kódové komentáře piš anglicky. Produktové texty v aplikaci piš česky.

## Design and UX

Směr je premium deníček se statistikami, profily a komunitou, ale pořád hravý a český. Nemá to být levná pivní sranda ani šedý formulář.

Kompas je zatím hlavní funkce a ikonický prvek. Nové funkce ho nemají zbytečně rozbít, i když dlouhodobě už nebude celý produkt stát jen na něm.

Komunita má být spíš otevřená a discovery-first. Profily, veřejné aktivity, kamarádi, objevování hospod a piv mají být součástí energie produktu. Viditelnost ale musí být v UI jasná, protože pracujeme s osobními záznamy, místy a alkoholem.

Gamifikace je důležitá pro retention. Body, odznaky, žebříčky, statistiky, série, objevování, hodnocení, komunitní příspěvky i počet vypitých piv mohou být součástí hry. Má to být sranda a pivní kultura, ne moralizování.

## Privacy and data

Poloha, hospody, alkoholová historie, profily a sociální vazby jsou citlivá data.

Neukládej surovou GPS historii ani trasy, pokud k tomu není explicitní produktové rozhodnutí. Preferuj uživatelem potvrzené návštěvy, navštívené hospody, lokální výpočty, agregace, coarse polohu nebo geohash tam, kde to stačí.

Nikdy neloguj bearer tokeny, raw GPS, e-maily, kontakty, cookies, proxy URL s heslem ani request body s osobními daty. Telemetrie má být užitečná pro provoz a produkt, ne invazivní.

## Offline and sync

Core aplikace se nesmí rozpadnout bez internetu. Lokální stav, fronty, optimistic UI a graceful fallback jsou důležité.

Komunitní, profilové a serverové funkce samozřejmě vyžadují sync. Když sync selže, uživatel má pochopit, co se stalo, a aplikace má držet jeho lokální práci, pokud to jde.

## Monetization

Nepředpokládej, že všechno musí být navždy zdarma. Aplikace má reálné uživatele a serverové náklady, včetně drahých datových a proxy částí.

Konkrétní free/pro hranice zatím není daná. Když navrhuješ novou náročnou funkci, mysli na provozní cenu, limity, caching a možnost budoucího paywallu. Paywall ale nenavrhuj náhodně bez produktového rozhodnutí.

## API compatibility

Backend API musí zůstat kompatibilní s vydanými mobilními verzemi. Mobilní appku nejde všem uživatelům okamžitě updatnout.

Nerušte existující response fields, request fields ani význam stavů bez migrační cesty. Nová pole přidávej aditivně. Když je breaking change opravdu potřeba, navrhni verziování nebo přechodné období.

## Development

Základní lokální příkazy:

```bash
npm install
npm run start
npm run ios:local
npm run typecheck
npm test
npm run lint
```

Pro lokální test proti backendu se backend obvykle spouští v `../na-pivo-backend`:

```bash
uv run python manage.py runserver 0.0.0.0:8000
```

Mobilní lokální build proti lokálnímu backendu spouštěj hlavně přes:

```bash
npm run ios:local
```

Respektuj existující Expo Router, React Native, store, queue a theme strukturu. Nezaváděj nový state management, navigační pattern nebo design systém bez silného důvodu.

## Git and deployment

Po dokončení coherent změny commitni a pushni.

Commit message musí být jednorádková conventional commit zpráva bez scope, například `feat: add profile badges` nebo `fix: preserve queued drinks offline`.

Produkční deployment nedělej bez explicitního požadavku člověka. Commit a push jsou běžné; release, EAS build, App Store/TestFlight kroky nebo zásahy do produkčního backendu jsou separátní rozhodnutí.

## General rules

- buď proaktivní, ale drž změny malé a dokončitelné;
- chraň čas solo indie autora;
- preferuj jednoduchý mobilní flow před katalogovou komplexitou;
- zachovej český, hospodský, hravý tón;
- piš kód a komentáře anglicky, UI copy česky tykáním;
- nepřidávej serverově drahou funkci bez přemýšlení o cache, limitech a budoucí monetizaci;
- drž API kompatibilitu s vydanými aplikacemi;
- chraň polohu, tokeny, osobní data a alkoholovou historii;
- respektuj existující architekturu a lokální patterny;
- testuj změny podle reálného rizika, ne pro coverage theater.
