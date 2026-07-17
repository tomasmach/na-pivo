# Na pivo

Na pivo je mobilní aplikace pro lidi, kteří mají rádi hospody, pivo, večery s kamarády a malé rituály okolo toho všeho.

Původní MVP bylo jednoduché a silné: kompas tě namíří do nejbližší hospody. To je zatím pořád hlavní rozpoznatelná věc produktu. Směr produktu se ale posouvá k modernímu mobilnímu pivnímu deníčku: zaznamenávání piv a večerů, navštívené hospody, profily, statistiky, komunita, objevování a hravá gamifikace.

Produkt má být český, hospodský, lehce vtipný a lidský. Ne korporátní wellness aplikace, ne suchý tracker a ne enterprise software. Má působit jako chytrý deníček do kapsy pro české a slovenské pivaře.

## Current status

Toto monorepo obsahuje Expo / React Native mobilní aplikaci v kořeni a Django backend v `backend/`.

Mobilní aplikace se serverem řeší účty, profily, komunitní data, hospody, hodnocení, návštěvy, piva, telemetry a další syncované funkce. Část zážitku musí fungovat lokálně a bez internetu, ale produkt už není čistě offline kompas.

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
npm run dev
npm run typecheck
npm test
npm run lint
```

Pro kompletní lokální spuštění projektu vždy používej:

```bash
npm run dev
```

Tento příkaz v `backend/` stejného repozitáře spustí databázové
migrace a lokální backend a následně sestaví a otevře mobilní aplikaci v iOS
simulátoru. Backend ani simulátor proto běžně nespouštěj separátními příkazy;
udělej to jen při cílené diagnostice jedné vrstvy nebo na explicitní žádost.

Respektuj existující Expo Router, React Native, store, queue a theme strukturu. Nezaváděj nový state management, navigační pattern nebo design systém bez silného důvodu.

### Klávesnice a formuláře

Každé scrollovatelné UI s `TextInput` musí používat `KeyboardAwareScrollView` z
`src/components/shared/KeyboardAwareScrollView`. Komponenta po focusu posune
aktivní pole nad klávesnici a přidá spodní inset; funguje i v edge-to-edge
Androidu a v native modalech. Pro krátký ne-scrollovatelný dialog zachovej
keyboard lift na jeho obalu (`KeyboardAvoidingView` nebo explicitní výška
klávesnice). Nevracej do nových formulářů samotný `ScrollView` +
`KeyboardAvoidingView` bez tohoto focus-aware chování.

## Git and deployment

Po dokončení coherent změny commitni a pushni.

Commit message musí být jednorádková conventional commit zpráva bez scope, například `feat: add profile badges` nebo `fix: preserve queued drinks offline`.

`dev` je default branch a patří na něj všechna běžná práce pro mobil i backend. Krátké větve `feat/*` a `fix/*` vždy zakládej z `dev` a po dokončení je vrať zpátky do `dev`.

`main` je přesně to, co je vydané v App Store a Google Play. Hýbe se jen při mobilním releasu (merge `dev` → `main`) nebo mobilním hotfixu (merge `fix/*` → `main`); nikdy do něj necommituj přímo. Backend se z `main` nedeployuje. Teče průběžně z `dev` a každý deploy dostane tag `api-YYYY.MM.DD.N`, protože backend nemá jednu „vydanou verzi“ a běží zhruba ve stovce commitů měsíčně proti asi dvěma mobilním releasům.

Když bumpneš mobilní verzi, změň společně `package.json` a `app.config.ts` a drž odpovídající tag `vX.Y.Z` (například `v1.2.1`) v souladu s marketing verzí. Tag je součást releasu, ale vytvoř ho až ve chvíli, kdy je verze skutečně venku jako Ready for Sale / published, ne při submitu. Jinak by `main` během review nebo po zamítnutí lhal.

Mobilní hotfix založ z `main` přes `git worktree add ../napivo-hotfix -b fix/neco main`, oprav ho, merge zpět do `main`, udělej build a submit a po vydání vytvoř mobilní tag. Pak povinně vrať fix do vývoje přes `git checkout dev && git merge main`. Tohle je jediná systémová daň modelu; když na merge zapomeneš, `dev` fix nemá.

Backend hotfix založ z posledního nasazeného API tagu, například `git worktree add ../napivo-apifix -b fix/neco api-2026.07.17.1`. Oprav ho, vytvoř další `api-YYYY.MM.DD.N` tag se zvýšeným pořadovým číslem, nasaď ho a změnu merge zpět do `dev`. Větev vzniká z tagu, aby hotfix nezávisel na tom, co je zrovna rozdělané v `dev`.

OTA přes `eas update` publikuj jen z `main`, nikdy z `dev` ani feature větve. Nejdřív ověř update přes `--channel preview`, potom použij `eas update:republish --destination-channel production`. OTA z feature větve už v minulosti shodila produkci.

Produkční server má v `/opt/na-pivo` sparse checkout jen pro `backend/` (nutně `--no-cone`, protože cone mode vždy vysype i root soubory) a stojí na detached `api-*` tagu. Deploy je `git fetch origin --tags --filter=blob:none`, `git checkout --detach api-YYYY.MM.DD.N` a z `backend/` pak `docker compose -p na-pivo up -d --build`. Jméno projektu drží `name: na-pivo` přímo v `docker-compose.yml` a volumes jsou pojmenované, takže přesun compose souboru je nerozbije; `-p na-pivo` je jen pojistka. Ve `/opt/na-pivo.pre-monorepo-2026-07-17` leží starý checkout archivovaného backend repa — odtud nikdy nedeployuj, vrátil bys produkci zpátky.

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
