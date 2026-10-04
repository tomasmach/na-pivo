# Pokrytí skutečného mobilního E2E

Průzkum začal na čerstvém `origin/dev` `e72d145c` (3. 10. 2026); infrastruktura a integrační větev byly 4. 10. aktualizované na `2e7a120e`. Tři nezávislé read-only průzkumy prošly routy, klienty, backend a Jest. Tabulka popisuje ověřované uživatelské výsledky, nikoli počet jednotlivých kliknutí. `Plán` není důkaz proběhlého testu.

Jest dál ověřuje kombinatoriku validací, výpočty, wire payloady, retry/drop klasifikaci, poškozenou storage a mockované závody. E2E přidává skutečný routing, nativní vstupy, SecureStore, AsyncStorage, restart procesu a lokální HTTP. Backendové oracles čtou skutečnou testovací DB přes místní kontrolní endpoint; nevyměňují odpovědi aplikačního API.

Není-li výslovně uvedený Android, tabulka uvádí doložené výsledky iOS. Android má samostatné výsledky a omezení níže.

| Oblast | Průchod | Selhání, které test zachytí | Priorita | Stav |
|---|---|---|---|---|
| Přihlášení | Přihlásit účet, zapsat konkrétní pivo, restartovat a porovnat UI a DB | Ztracená session/zápis nebo dvojí doručení po restartu | P0 | `spike/persist-drink.yaml`: 3× zelené na iOS i Androidu v Maestro; původní TesterArmy spike má doložený replay níže |
| Registrace | Anonymní online i offline zápis, registrace, soukromý profil, restart | Claim ztratí historii nebo předá frontu jinému účtu | P0 | `identity/registration.yaml`: `blocked`; klient odmítá heslo zadané přes Maestro, příčina nedoložená. Claim proto není ověřen, viz omezení registrace níže |
| Ověření e-mailu | Odkaz z lokální schránky, návrat do appky, obnovit účet | Skutečný e-mailový odkaz a stav profilu se rozcházejí | P0 | `identity/email-export.yaml`: 3× po sobě zelené, skutečný lokální ověřovací odkaz, spotřebovaný token a ověřený účet po restartu |
| Reset hesla | Žádost v UI, lokální e-mail, nové heslo, staré odmítnuté, nové přihlásí | Reset neodvolá staré přihlášení nebo neuloží nové heslo | P0 | `identity/password-reset.yaml`: 3× po sobě zelené; skutečný lokální reset, odvolaná relace, staré heslo odmítnuté a nové přijato |
| Odhlášení a změna účtu | A s offline zápisem, odhlášení, restart, login B | Soukromá historie nebo čekající zápis A se objeví u B | P0 | `identity/logout.yaml`: 3× po sobě zelené s opravou NP-E2E-011 v PR #215; historie a offline fronta A nepřešly pod B |
| Smazání účtu | Zrušit potvrzení, potom smazat, restart; ověřit DB a lokální vyčištění | Smazání jen v UI, neodvolaná session, mazání po zrušení | P0 | `identity/delete.yaml`: 3× po sobě zelené; zrušení potvrzení nic nesmazalo, potvrzené DELETE 204, odvolané session a GET 401 po restartu |
| Offline počítadlo | Zastavit vlastní backend, zapsat další pivo, restart offline, obnovit a foreground | Fronta nepřežije restart, výpadek odhlásí, sync duplikuje | P0 | `diary/evening.yaml`: třikrát po sobě zelený, včetně skutečného výpadku, restartu a následného syncu. Claim v `identity/registration.yaml` je samostatně blokovaný |
| Soukromí profilu | Nastavit soukromí v UI, ověřit pohled cizího účtu | Přepínač se neuloží nebo cizí účet dostane soukromý profil | P0 | `identity/profile.yaml`: 3× po sobě zelené včetně skutečného pohledu druhého účtu |
| Soukromí party | Vypnout sdílení, ghost, blokování; obnovit druhý účet | Aktivita zůstane ve feedu, mapě nebo detailu cizího účtu | P0 | `places-social/party-privacy.yaml`: 3× po sobě zelené, skutečný pohled druhého účtu; rozlišuje automatické a ruční sdílení, NP-E2E-005 vysvětluje omezení textu |
| Soukromí fotek | Soukromá versus friends fotka, pohled druhého účtu | Galerie či feed vrátí fotku nepovolenému publiku | P0 | `identity/photos.yaml`: 3× po sobě zelené s opravou NP-E2E-010 v PR #214; skutečné soubory, přesná ID povoleného feedu, odmítnutý cizí účet, smazání a restart |
| Komunitní akce | Host schválí žádost a pak zruší akci | Přesná adresa unikne před schválením nebo po odchodu | P0 | `places-social/community-privacy.yaml`: 3× po sobě zelené, API před schválením a po zrušení odmítá přesnou adresu; NP-E2E-002 opraven v PR #209 |
| Přidání hospody | Offline potvrdit pin a uložit, restart, online foreground | Nová hospoda se ztratí nebo vznikne vícekrát | P0 | `places-social/pub-create-offline.yaml`: 3× po sobě zelené, jediná hospoda se zachovaným potvrzeným pinem a identitou |
| Nahlášení hospody | Zrušit potvrzení, offline nahlásit, sync; druhý účet stále vidí hospodu | Jedno hlášení skryje komunitní hospodu všem | P0 | `places-social/report-offline.yaml`: 3× po sobě zelené, jediný doručený report a nadále veřejná hospoda |
| Report appky | Text/příloha offline, restart a doručení | Falešné odeslání, ztráta textu či dočasného souboru | P0 | `places-social/feedback-offline.yaml`: 3× po sobě zelené, skutečný uložený soubor a jediný doručený report |
| Offline katalog | Načíst, zastavit backend, restart a hledat známou hospodu | Snapshot zmizí, skryté místo se vrátí | P0 | `places-social/catalogue-offline.yaml`: známé selhání NP-E2E-014, po offline restartu chybí nabídka piv; bezpečná oprava persistence přesahuje malý fix. Výběr mapového řádku opraven v PR #223 |
| Domovský bod | Zrušit ruční pin, uložit současnou polohu, restart a odstranit | Neodsouhlasený bod se uloží, restart jej ztratí nebo unikne na server | P0 | `places-social/home-persistence.yaml`: 3× po sobě zelené, skutečná místní storage po uložení, zrušení změny a smazání; souřadnice neopouštějí kontroler |
| Fotosoutěž | Výslovný souhlas se zveřejněním, hlasování a stažení | Zveřejnění bez souhlasu nebo změna původní visibility fotky | P0 | `places-social/contest-privacy.yaml`: 3× po sobě zelené, přesné veřejné příspěvky a hlasy, soukromá fotka se nezveřejní |
| Tours | Offline plán se dvěma zastávkami, restart a dokončení | Ztráta uloženého plánu nebo běhu | P0 | `diary/private-tour.yaml`: třikrát po sobě zelený, uložený offline plán po restartu a dokončený běh |
| Tours sdílení | Soukromý/public odkaz, přijetí a zrušení | Odvolaný odkaz dál odhaluje plán nebo import vytvoří duplicitní kopii | P0 | `diary/shared-tour.yaml`: třikrát po sobě zelený; jednorázový import, skutečné odvolání obou odkazů a zachovaný plán po restartu. Omezení nativního Copy a nabídky níže |
| Onboarding | Dokončení/přeskočení a restart; restart v průběhu | Onboarding se opakuje nebo označí nedokončený flow za dokončený | P1 | `identity/onboarding-complete.yaml` a `onboarding-interrupt.yaml`: oba 3× po sobě zelené, dokončení i přerušení ověřené po restartu |
| Kompas | Nejbližší seeded hospoda, odhalení, detail, jiná hospoda | Špatný cíl nebo rozpojená identita detailu | P1 | `places-social/catalogue-offline.yaml`: online nejbližší hospoda, výběr druhé a její přesná nabídka prošly; celý test má navazující známé offline selhání NP-E2E-014 |
| Kompas bez polohy | Odepřít oprávnění, otevřít ruční mapu a hledání | Nekonečné hledání nebo zablokovaný vstup do mapy | P1 | `places-social/permissions-denied.yaml`: 3× po sobě zelené, skutečně zakázaná poloha a funkční ruční hledání |
| Prázdný/chybový katalog | Prázdný výsledek versus výpadek, retry a vymazat dotaz | Chyba se vydává za prázdné okolí, není cesta dál | P1 | `places-social/permissions-denied.yaml`: 3× po sobě zelené v `be2685c6`, včetně přesného rozlišení výpadku, úspěšného retry a vymazání dotazu; rozšířený průchod prošel také na Androidu |
| Mapa a hledání | Vybrat konkrétní výsledek, detail, zamířit kompas | Jiné místo v detailu, nefunkční návrat a zacílení | P1 | `places-social/catalogue-offline.yaml`: skutečný druhý řádek a jeho odlišná nabídka online prošly s PR #223; celý průchod má známé navazující offline selhání NP-E2E-014 |
| Večer | Dopito, archiv, úprava a smazání piva offline, restart a sync | Úprava jiného večera, návrat smazaného piva, znovuotevřená návštěva | P1 | `diary/evening.yaml`: třikrát po sobě zelený včetně NP-E2E-006 s opravou PR #213 |
| Výčep | Publikovat offline, obnovit pouze foreground, potom restart | Publikace zůstane ve frontě nebo se doručí dvakrát | P0 | `diary/vycep.yaml`: třikrát po sobě zelený na iOS i Androidu s opravou NP-E2E-007 v PR #212; skutečný foreground sync a kontrola po restartu |
| Detail piva | Ohodnotit pivo offline a po syncu otevřít jeho detail | Route nebo agregace patří jinému pivu | P1 | `diary/checkin.yaml`: třikrát po sobě zelený, skutečný offline BeerCheckIn a agregace po restartu; známá lokalizace čísel NP-E2E-015 zůstává neopravená |
| Statistiky | Po zápisu/úpravě/smazání porovnat přesný baseline UI a serveru | Dvojí započítání remote/local nebo nezohledněné smazání | P1 | `diary/evening.yaml`: třikrát po sobě přesné 2 piva / 1 večer / 1 hospoda / 84 Kč po úpravě a smazání |
| Moje přidané hospody | Čekající/potvrzená hospoda, oprava názvu, zachování potvrzeného pinu | Editace vytvoří další hospodu nebo uloží starý pin | P1 | `places-social/pub-create-offline.yaml`: 3× po sobě zelené, čekající i potvrzený stav a přejmenování stejné hospody |
| Návrh akce | Navrhnout akci v hospodě, ověřit pending stav | Návrh je veřejný bez ověření nebo se retry duplikuje | P1 | `places-social/pub-event-moderation.yaml`: 3× po sobě zelené, chyba při výpadku a jediný neveřejný návrh po retry |
| Komunitní empty/error | Nepřihlášený, žádné akce, denied, chyba vytvoření a retry | Nekonečný spinner, duplikace vytvoření | P1 | `places-social/community-create-retry.yaml`: 3× po sobě zelené, zachovaná pole při chybě a jediná akce po retry. Nepřihlášený prázdný stav a odmítnutá poloha s nezměněnými daty v `permissions-denied.yaml` mají nově také 3× zelené iOS ověření `be2685c6`; restart draftu produkt neslibuje |
| Parta pozvánka/detail | Pozvánkový odkaz, vědomé přijetí, detail a blokování | Ztracená pozvánka, automatické přijetí, špatný profil | P1 | `places-social/invite-offline.yaml` a `party-privacy.yaml`: oba 3× po sobě zelené, přijetí odkazu a detail; NP-E2E-008 ověřen s opravou PR #219 |
| Přátelé offline | Dashboard snapshot a queued soukromá srdcovka, restart a sync | Prázdná Parta nebo duplicita doručené akce | P1 | `places-social/invite-offline.yaml` a `favorite-offline.yaml`: oba 3× po sobě zelené, uložená Parta i soukromá srdcovka, jediné doručení a odebrání |
| Profil úprava | Obsazená a volná přezdívka, jméno, uložit, restart | Formulář zavře neúspěšný PATCH nebo profil neodpovídá DB | P1 | `identity/profile.yaml`: 3× po sobě zelené, přesná uložená data po restartu |
| Avatar/fotky | Skutečný galerijní picker, upload, restart, výměna/mazání | Multipart selže, starý obrázek v cache, ztracený lokální soubor | P1 | `identity/avatar.yaml` a `photos.yaml`: oba 3× po sobě zelené; skutečný upload, výměna avataru s jiným SHA-256, odstranění a fotodeník |
| Žebříčky | Známé skóre/perioda, soukromý a blokovaný účet | Chybné skóre nebo únik profilu přes teplou cache | P0 | `places-social/leaderboard-privacy.yaml`: 3× po sobě zelené, přesné skóre a ID bez soukromého či blokovaného účtu; NP-E2E-009 zůstává nejasností textu |
| Nastavení | Změnit serverové i lokální preference, restart | Toggle pouze vizuální nebo server přepíše místní hodnotu | P1 | `identity/settings.yaml`: 3× po sobě zelené funkční preference po restartech; vizuální zkrácení anglického textu zůstává NP-E2E-012 |
| Jazyk | CZ → EN s restartem JS, plný restart a zpět | Jazyk nepřetrvá nebo přepnutí poškodí účet/deník | P1 | `identity/settings.yaml`: celý průchod CZ → EN → CZ 3× po sobě zelený; známý vizuální nález NP-E2E-012 |
| Export účtu | Neověřený kontakt odmítnut, ověřený dostane lokální export | Export cizích dat nebo odeslání neověřenému účtu | P1 | `identity/email-export.yaml`: 3× po sobě zelené, skutečný POST 403 před ověřením a POST 202 po něm, jediná JSON příloha s původními ID bez cizích dat |
| Kamera a galerie denied | Odmítnutí/cancel, návrat do formuláře | Odmítnutí oprávnění zablokuje další práci | P1 | `identity/media-denied.yaml`: 3× po sobě zelené; denied kamera, zrušený skutečný picker a žádný nový záznam v DB. Simulátor neověří fyzickou kameru |
| Odznaky | Seed známého odemčeného a zamčeného odznaku, restart | Profil renderuje jiný stav než server | P2 | `identity/badges-information.yaml`: 3× po sobě zelené; přesný odemčený a zamčený stav proti API |
| Oslava | Příchod k vybrané hospodě a návrat | Jiná hospoda, ztracený výběr nebo automaticky přidané pivo | P2 | P2, nepokryto; rozsah upřednostnil P0/P1 a skutečné offline/soukromé zápisy |
| About/privacy | Obě navigační cesty, obsah a offline návrat | Prázdná obrazovka, nekonečné načítání, rozbitá navigace | P2 | `identity/badges-information.yaml`: skutečné lokální novinky, offline text o GPS a návrat 3× po sobě zelené |
| Příspěvky | Hodiny a pivo měněné offline, restart, doručit obě části | Druhý zápis přepíše první část fronty, opakované XP | P1 | `places-social/contributions-offline.yaml`: 3× po sobě zelené, přesné hodiny i 500 ml / 52 Kč pivo a jediná odměna za každý příspěvek |
| Starý společný stůl | Legacy party-live link a návrat do Party | Prázdný legacy route nebo oživení odstraněného flow | P2 | P2, zatím nepokryto; legacy route není současný společný stůl |

## Prostředí a měření

- Framework: výchozí Maestro `2.11.0`; původní spike `e2e 0.16.0` / `@e2e-dev/mobile 0.9.1`. Stabilní verze byly ověřené před instalací.
- Model původního spike: ChatGPT předplatné přes `chatgpt('gpt-6.1-sol')`; přihlášení je mimo repo.
- iOS: pouze explicitně vytvořený iPhone 17, vlastní Metro/API/SQLite na každý slot; maximálně tři sloty.
- E-mail: skutečně vykreslená zpráva v lokálním paměťovém backendu. Žádný testovací login ani změna API kontraktu.
- Backendové externí sockety jsou blokované; klíče a produkční `.env` se nenačítají. Mapový klíč je neplatná fixture. iOS 26.5 nepodporuje notifications přes simctl privacy; případný dialog test odmítá a lokální adaptér zabraňuje registraci skutečného push tokenu.
- První dokončená celá iOS sada `bbf6501c`: 32 úspěšných / 1 známé selhání, engine 3 258,192 s, celý příkaz 3 293,575 s (54 min 54 s), modelová volání a tokeny 0. Podrobnosti a hranice měření níže.
- Cache celé sady: Maestro replay cache nemá. Celý příkaz `bbf6501c` trval 3 293,575 s na novém vlastním simulátoru, nikoli při prvním studeném startu OS; původní TesterArmy replay spike je doložen níže.
- Souběh dvou běhů: ověřený zeleným spike ve slotech 1 a 2, vlastní simulátory, API/Metro porty a odlišné účty v oddělených DB. V každé DB právě jedno pivo. Po skončení všechny čtyři porty volné.
- Android: místní SDK, Google Pixel 10 / API 36.1. Lokální ARM64 debug build prošel za 5 min 31 s. Spike `3ea54c13` a offline publikace večera `8a754f4c` mají každý tři úspěšné průchody. Celá Android sada `645f3dd9` dokončila 20 PASS / 13 FAIL za 64 min 18 s v enginu. Po cílených opravách má 30 z 33 dostupných scénářů úspěšný Android průchod. Jde o souhrn více běhů, nikoli o zelenou celou Android sadu; zbývají NP-E2E-014, NP-E2E-016 a neověřená poloha domova. Příprava začala až po dokončení dostupné iOS sady.
- Po úspěšném důkazu souběhu nyní širší dávky běží jednotlivě: dva simulátory později vyčerpaly dostupné místo na disku. Selhání přípravy z nedostatku místa se nepočítá jako produktový bug.

### Spike, 3. 10. 2026

| Průchod | Čas runneru | Tokeny | Volání modelu | Replayed | Handed off | Missed |
|---|---:|---:|---:|---:|---:|---:|
| Stabilita 1 | 100,8 s | 13 717 | 6 | 1 | 0 | 1 |
| Stabilita 2 | 86,1 s | 1 728 | 2 | 2 | 0 | 0 |
| Stabilita 3 | 77,3 s | 1 720 | 2 | 2 | 0 | 0 |
| Souběžný slot 2, nový simulátor | 133,3 s | 10 324 | 5 | 1 | 1 | 0 |

Nejde o měření studené celé sady. První průchod již znal část cache; nový simulátor navíc odmítl systémový notification dialog. [Zkontrolovaný konečný screenshot](https://files.tmach.dev/spike-persisted-drink-e8ee0ea9ec4b4277ada3.png) ukazuje jediné pivo a 41 Kč. DB oracle potvrzuje E2E Ležák, 500 ml, hospodu a stejný účet po restartu. Spike prošel v TesterArmy; širší sada později narazila na níže popsaný blokátor.

### Proč následuje Maestro

TesterArmy `e2e 0.16.0` / `@e2e-dev/mobile 0.9.1` na Expo SDK 56 dev buildu a iOS 26.5 opakovaně nedokáže přečíst otevřenou nabídku počítadla. Po opravě skutečných accessibility problémů NP-E2E-003 zůstává `snapshotQuality.state=sparse`, `backend=private-ax`, `reasonCode=budget`, `truncated=true`; strom obsahuje jen jediný prvek Application. Nabídka je na screenshotu normálně viditelná. Přesný locator Dopito proto skončí timeoutem.

Zkouška proběhla samostatně na jediném iPhonu 17, s aktuálním bundlem, sekundovým čekáním po otevření nabídky, výchozím i `forceFull` capture a konfigurací `settle: 350`, `transition: 1000`. Poslední dokumentovaný restart vlastního simulátoru výsledek nezměnil: obě capture měly jeden prvek a shodný důvod, pořízení trvalo 322/307 ms. Finální repro `42b0163c` trvalo 95 s, spotřebovalo 8 929 tokenů ve třech modelových voláních a skončilo selháním. Globální daemon cizích sessions nebyl zastaven. Nativní engine nemá dokumentované nastavení rozpočtu snapshotu; jeho zdroj navíc nepoužívá nakonfigurovaný settle pro deterministické tap/fill.

Podle zadání proto následuje deterministický Maestro `2.11.0`, nejnovější stabilní vydání ověřené v oficiálním GitHub release 3. 10. 2026. Původní TesterArmy průchody a jejich naměřená cache nejsou vydávány za důkaz nové sady. Maestro nepoužívá model ani replay cache: modelová spotřeba je nula, replayed/handed off/missed jsou nepoužitelné. Každý nový Maestro průchod stále musí projít třikrát a skončit skutečným datovým oracle.

Maestro neumí vypnout zápis vyhodnocených vstupů do debug reportů. Mach 3. 10. 2026 výslovně povolil výjimku pouze pro jednorázové účty `@example.test`: debug reporty jsou neveřejné, gitignorované a po každém běhu odstraněné, včetně selhání a přerušení. Skutečné údaje a přihlášení k ChatGPT se do Maestro prostředí nepředávají. Bearer tokeny a tokeny e-mailových odkazů drží místní Node kontroler v paměti. Zůstávají pouze naměřené souhrny a zkontrolované screenshoty konečných stavů.

### Maestro spike, 3. 10. 2026

Přihlášení skutečným heslem, zapsání piva, restart procesu, kontrola přihlášeného profilu a počítadla i přesného DB záznamu prošly třikrát za sebou. Běh `b611a7f9` používá finální konfiguraci nativních argumentů Expa bez překrývajícího vývojářského menu.

| Opakování | Čas Maestra | Testů prošlo | Volání modelu / tokeny | Replayed / handed off / missed |
|---|---:|---:|---:|---|
| 1 | 80,004 s | 1 | 0 / 0 | nepoužitelné |
| 2 | 71,117 s | 1 | 0 / 0 | nepoužitelné |
| 3 | 79,918 s | 1 | 0 / 0 | nepoužitelné |

Čas zde nezahrnuje přípravu simulátoru, migrace a start Metra; měření celé sady musí uvést i celkový čas příkazu. [Zkontrolovaný screenshot stejného průchodu](https://files.tmach.dev/spike-persisted-drink-e809635aa01240709133.png) ukazuje jedno pivo, 41 Kč a konkrétní fixture hospodu.

Přerušení `5410f2e3` při běžícím Maestro CLI skončilo kódem 130. Vlastní CLI skončilo, porty 18122/18222/18322 se uvolnily a raw reporty byly odstraněny. Druhý slot přitom dál odpovídal na všech třech portech a jeho test následně prošel. Tato kontrola není vydávána za úspěšný aplikační test.

## Odkazy na zdroje frameworku

[TesterArmy](https://github.com/tester-army/e2e), [mobilní Expo konfigurace](https://e2e.tester.army/docs/mobile), [replay cache](https://e2e.tester.army/docs/cache), [předplatné](https://e2e.tester.army/docs/subscriptions). Použitá přesná dokumentace je součástí zamčeného balíčku v `node_modules/e2e/docs`.

Maestro souběh `d5c433a2` / `d63a4229`: oba celé příkazy skončily kódem 0, 88,279 / 80,923 s. V obou oddělených DB právě jedno pivo a odlišné účty; po skončení všech šest portů volných a oba raw debug adresáře odstraněné.

### Průběžné úplné dávky oblastí

Tyto výsledky dokazují průzkum a reprodukce, nikoli dokončenou zelenou sadu. Opravené testy čekají na další ověření.

| Oblast / běh | Výsledek | Čas Maestra | Celý příkaz | Model |
|---|---|---:|---:|---|
| Identity `e7987064` | 4/12 prošly, 8 selhalo | 863,715 s | 909,090 s | 0 volání / 0 tokenů |
| Places/social `0292bfec` | 6/14 prošlo, 8 selhalo | 855,317 s | ještě nebyl měřen | 0 volání / 0 tokenů |
| Diary `76ba5706` | 2/5 prošly, 3 selhaly | 555,164 s | 581,775 s | 0 volání / 0 tokenů |

Replay, handed off a missed jsou pro Maestro nepoužitelné. Soukromé raw reporty byly po uvedených dávkách automaticky odstraněné.

Dávka identity `bf533099` byla po 217,116 s přerušená s kódem 130 kvůli nedostatku místa, přestože startovala s více než 5 GiB. Mazání účtu před přerušením dokončilo celý průchod; pro zbytek dávky chybí engine souhrn a nelze odvodit výsledky. Souběžný diary běh `bf0e5e7d` dokončil večer, ale zaznamenal ENOSPC během dalších scénářů. Obě tour se proto opakují samostatně. Další nativní souběh na tomto stroji se neprovádí.

V této fázi bylo připraveno 33 Maestro průchodů: 1 spike, 12 identity, 5 diary a 15 places/social. Tento historický počet není počet třikrát ověřených testů.

Infrastrukturní fault check `4db92e24` simuloval pokles volného místa během skutečné přípravy simulátoru a samostatně chybu ENOSPC při zápisu závěrečných metrik. Skutečný disk se neplnil. Runner skončil očekávaným kódem 75; všechny tři vlastní porty byly volné, zaznamenané procesy skončily, simulátor byl Shutdown a slot/boot locky i raw debug byly odstraněné. Jde o ověření úklidu, nikoli o aplikační průchod.

### Omezení nativního veřejného sdílení tour

Běh `1ee2a0ca` doložil, že Maestro na iOS 26.5 najde nativní `Copy`, klepnutí zavře share sheet a appka znovu ukáže detail veřejné tour. `simctl pbpaste` přesto dalších 15 s vracel předchozí soukromý odkaz. Veřejná publikace v DB existovala. Stejný krok předtím jednou uspěl, takže další čekání není stabilní kontrola. Není prokázáno, zda je příčina v nativním kopírování nebo ve čtení schránky simulátoru; nejde o potvrzený produktový bug.

Běžný test dál kopíruje a přijímá soukromý odkaz přes UI. Veřejnou tour vytvoří přes UI, najde ji skutečným anonymním katalogovým API a zkontroluje identitu, dvě zastávky, odlišný veřejný odkaz a následné 404 po odvolání. Nativní veřejné Copy zůstává neověřené. Tato změna neprokazuje jeho opravu.

Dávka identity `9cc075a2` ověřila čtyři ze sedmi opravovaných průchodů: reset hesla, profil, nastavení a zamítnutá média. Maestro 771,589 s, celý příkaz 813,603 s, 0 modelových volání a tokenů. Registrace a fotky potřebují opravu ovládání testu; offline účet odhalil NP-E2E-011. Tento běh není stabilitní ani úplná sada identity.

Dávka identity `39ad9a48` dokončila odhlášení a soukromé fotky; registrace skončila klientskou validací příliš krátkého hesla ve formuláři testu. Maestro 415,170 s, celý příkaz 463,221 s, 0 modelových volání a tokenů. Z 12 identity scénářů má 11 celý průchod zelený, žádný ještě tři po sobě. Kontrola fokusování registrace `4997af54` zatím pouze diagnostikuje chování vstupů; nedokazuje chybu produktu.


### Omezení registrace a pokračování ověření

Registrace `7d706376` vyplnila přesnou fixture adresu a volnou přezdívku, ale po odeslání aplikace hlásila „Heslo musí mít alespoň 8 znaků.“ a skutečná DB neměla registrovaný účet. Změna zadání na stejný strukturovaný `inputText` jako u fungujícího loginu, vynechání `eraseText` u prázdného pole a zavření klávesnice klepnutím na label problém neodstranily. Secure accessibility hodnota obsahovala jediný maskovací znak před i po blur. Z toho nelze odvodit délku hesla v React stavu ani tvrdit, že je blur smazal. Dřívější komplexní inline diagnostika se navíc neprovedla správně a není důkazem plného vstupu.

Jde o konkrétní blokátor automatizace, nikoli o prokázaný produktový bug. Kompletní průchod zůstává s tagem `blocked` pro `npm run e2e:blocked`; běžné `critical` a `full` jej vynechávají. Claim anonymní historie a registrace tím nejsou prohlášeny za pokryté. Ověření e-mailu a export mají nově samostatný průchod existujícího neověřeného účtu; jeho stav uvádí tabulka. Diagnostika `15eb6f6d` dne 4. 10. použila pouze development/flag/loopback testID na existujícím labelu. React stav měl kategorii `one` po zadání, po blur i před submit, validace `password_short`, DB `registered=false`. Prokázána je délka jednoho znaku, nikoli jeho obsah. [Maestro 2.11.0](https://github.com/mobile-dev-inc/maestro/blob/cli-2.11.0/maestro-ios-xctest-runner/maestro-driver-iosUITests/Routes/Helpers/TextInputHelper.swift#L26) zadává první znak samostatně a zbytek rychlostí 30 znaků/s. Navazující celý registrační průchod `13eeec41` zadal fixture po jednotlivých znacích a znovu skončil s kategorií `one`, ještě před submit. Engine 168,641 s, celý příkaz 191,943 s, 0 modelových volání/tokenů. Příčina mezi Maestrem, iOS a React Native zatím není izolovaná. Neúspěšná pomalá varianta se neudržuje; plná reprodukce zůstává `blocked`. Dočasná metadata diagnostiky hesla byla po získání důkazu odstraněná, stejně jako neúčinná kontrola masky zabezpečeného pole. Diagnostický běh trval 104,956 s v enginu, 164,114 s celý příkaz, nepoužil model. Dočasné flow a soukromé reporty byly odstraněné.

První stabilitní dávku ostatních 11 identity testů `ff585be9` po 246,804 s ukončil disk guard kódem 75. Startovala s 4,37 GiB, ale i při jediném simulátoru kleslo místo pod 1 GiB; následná kontrola systému ukázala 14 GiB použitého swapu. Avatar před přerušením prošel, zbytek dávky nemá úplný engine report. Vlastní procesy skončily, tři porty se uvolnily, simulátor byl Shutdown a soukromé debug reporty byly odstraněné. Žádný nový test tím nezískal tři po sobě jdoucí průchody. Tento tehdejší běh čekal na uvolnění prostředků; cizí session nebyly ukončeny. Dne 4. 10. práce pokračovala s více než 90 GiB volnými a jediným simulátorem.


Android registrační pokus `0562a52f` na Pixel 10 došel přes vyplnění formuláře k submit a následná DB kontrola nenašla registrovanou původní identitu. Nezachytil konkrétní validační zprávu; po dokončení zůstával počet účtů s očekávanou registrační přezdívkou nulový. Engine 138,215 s, celý příkaz 173,791 s, exit 1. Tento výsledek nepotvrzuje stejnou příčinu jako iOS. Registrace a claim zůstávají blokované i pro Android; privátní report byl odstraněný.

### Doložené pokrytí oblastí na iOS

| Oblast | Připravené scénáře | Celý průchod alespoň jednou v dosavadních revizích | Tři po sobě | PR |
|---|---:|---:|---:|---|
| Spike / infrastruktura | 1 | 1 | 1 | [#208](https://github.com/tomasmach/na-pivo/pull/208) |
| Účet, profil, média | 13, z toho 1 `blocked` | 12 | 12 | [#216](https://github.com/tomasmach/na-pivo/pull/216) |
| Deník a tour | 5 | 5 | 5 | [#217](https://github.com/tomasmach/na-pivo/pull/217) |
| Hospody a Parta | 15, z toho 1 známé selhání | 14 | 14 | [#218](https://github.com/tomasmach/na-pivo/pull/218) |

Z 34 připravených scénářů má 32 tři úspěšné iOS průchody. Integrovaná sada `bbf6501c` následně dokončila 32 PASS a jediné známé selhání offline nabídky NP-E2E-014 za 54 min 54 s; registrace s claimem zůstává `blocked`. Podmínky nového simulátoru a měření jsou popsané níže. Čas a spotřeba replay cache celé Maestro sady jsou nepoužitelné, protože engine tuto cache nemá. Android build, spike a offline publikace večera už prošly, oba cílené scénáře třikrát po sobě. Výsledek celé Android sady a navazující ověřování popisuje závěrečná část dokumentu.

Nezávislé review opravilo slabou kontrolu soukromého feedu na přesná ID a kontrolu starého hesla na konkrétní serverové odmítnutí. Úklid procesů má tři lokální regresní kontroly: neznámý/ukončený PID nedostane signál, vlastní potomek se ukončí i po zániku leadera před nebo během úklidu. Všechny tři prošly za 10,2 s. Krátký nativní průchod `15eb6f6d` ověřil konec runneru, volné porty, Shutdown vlastního simulátoru a smazání soukromých reportů; dlouhá dávka `4b32cc73` následně dokončila úklid za 3,696 s, měřeno od vytvoření engine metrik do dokončení celého příkazu. Nejde o další mobilní testy v tabulce.

Dřívější auditní blokátory opravil samostatný upstream PR #221. Po aktualizaci na `2e7a120e` prošel backend, dependency review i GitGuardian v infra CI; mobilní job odhalil rozdíl TypeScript prostředí čistého checkoutu a lokálně vygenerovaných Expo typů. Verzovaná reference Expo typů nyní určuje stejné prostředí i bez startu Expa; lokální kontrola přes stejný TypeScript compiler měla bez generovaných Expo souborů před opravou 12 chyb a po ní 0. Běžný lokální typecheck také prošel. CI infrastruktury na `47df6ca5` dokončilo Mobile checks, Backend checks, Dependency review a GitGuardian úspěšně; totéž prošlo po rebase u zbývajících dvanácti PR na jejich tehdejších commitech. Existující CI tento E2E úkol nemění. Deset malých produktových oprav má samostatné PR; NP-E2E-005 a NP-E2E-009 zůstávají nejasnostmi textu k produktovému rozhodnutí, viz BUGS.md.


Čerstvý nezávislý reviewer po integraci prošel všech 33 scénářů, assertion JS, seed data, helpery a produkční pojistky. Jediný další nález byl příliš široký slib kontroly termínu veřejné tour: UI termín nevyplňovalo a test četl jen DB snapshot. Tato slabá kontrola i tvrzení byly odstraněné. Scénář dál ověřuje přesné zastávky, identity, jednorázový import a skutečné odvolání obou odkazů. Ochranu vyplněného termínu při serializaci veřejné tour pokrývá existující backendový `test_tour_publications.py`; E2E si tento důkaz nepřisvojuje. Cílená syntaxe JS a Ruff po opravě prošly. Žádný nový nativní běh tím nebyl nahrazen.

Společná integrační větev je `test/e2e-integration`, nikoli samostatný PR. Oblastní PR proti `dev` obsahují pouze svoje scénáře a seed data a vyžadují infra PR #208. Nativní ověřování je dokončené v rozsahu výsledků a omezení níže; žádný PR nebyl mergnut a nic nebylo nasazené.


### Pokračování 4. 10. a ochrana SSD

Runner od revize `aa90ad3d` odmítne start pod 30 GiB volného místa a zastaví pouze vlastní běh při poklesu pod 20 GiB. Kontrola s nasimulovanými 25 GiB skončila před získáním slotu a bootem. Používá se jeden simulátor a společný již hotový iOS klient; další nativní build se kvůli JS změnám nevytváří.

Dávka identity `6c95df96` dokončila 10 z 11 dostupných průchodů, Maestro 1 094,896 s, celý příkaz 1 312,170 s, 0 modelových volání/tokenů. Selhal pouze výběr fotky přes pevnou souřadnici; není to zatím prokázaný produktový bug. Minimum volného místa bylo 96,042 GiB. Deset nezměněných testů má započítané první stabilitní opakování. Nastavení má vedle funkčního výsledku známou vizuální chybu NP-E2E-012.

Dlouhý běh odhalil pomalý úklid: seznam vlastních procesů držel i tisíce již ukončených dětí. Revize `55e66635` průběžně vyřazuje ukončené identity podle úplného snapshotu, zachovává živé potomky po ukončení rodiče a před každým signálem znovu ověřuje PID i čas vzniku. Tři regresní kontroly prošly za 10,458 s a cílené nezávislé review nemělo další nález. Po krátké registrační diagnostice skončil úklid za 3,661 s od zápisu engine metrik; nelze to vydávat za srovnání stejně dlouhých dávek.

### Dokončená stabilita účtu a médií, 4. 10. 2026

Všech 11 dostupných identity scénářů prošlo třikrát po sobě. Deset nezměněných testů začalo dávkou `6c95df96`; fotky po opravě výběru miniatury ve skutečném nativním pickeru začaly samostatným `d473edbc`. Poslední dvě celé dávky běžely na revizi `bf16f59f` a obě skončily 11/11. Registrace zůstává samostatně označená `blocked` a není zahrnutá v těchto číslech.

| Běh | Úspěšné průchody | Maestro | Celý příkaz | Modelová volání / tokeny |
|---|---:|---:|---:|---:|
| `6c95df96` | 10/11, původní locator fotky selhal | 1 094,896 s | 1 312,170 s | 0 / 0 |
| `d473edbc` | 1/1, první fotky po opravě locatoru | 158,947 s | 190,557 s | 0 / 0 |
| `4b32cc73` | 11/11, druhý úspěch každého testu | 1 101,154 s | 1 132,314 s | 0 / 0 |
| `433554f2` | 11/11, třetí úspěch každého testu | 1 106,058 s | 1 137,938 s | 0 / 0 |

Replayed, handed off a missed jsou u Maestra nepoužitelné. Každý úspěšný průchod dokončil svůj skutečný DB/API oracle. [Smazaný účet](https://files.tmach.dev/identity-account-deleted-6da562502be14425a317.png), [izolovaný další účet](https://files.tmach.dev/identity-next-account-isolated-89533f4b2e2646faaacf.png) a [jediná zbývající fotka pro přátele](https://files.tmach.dev/identity-photo-private-isolated-c20d5c7c127d470699a8.png) jsou zkontrolované konečné screenshoty druhého kola. Poslední obrázek ukazuje stav po smazání soukromé fotky; oracle zároveň odmítá přístup cizímu účtu. Funkční úspěch nastavení neruší známý vizuální nález NP-E2E-012.

Úklid po dlouhé dávce `4b32cc73` trval 3,696 s. Měření začíná původním vytvořením `metrics.json`, protože úspěšný runner soubor po části úklidu přepisuje. Vlastní služby skončily, porty se uvolnily a soukromé debug reporty byly odstraněné. V době této dávky celá integrovaná sada a Android ještě čekaly na dokončení ostatních oblastí; jejich pozdější výsledky jsou uvedené níže.


### Stabilita deníku, 4. 10. 2026

Všech pět diary scénářů má tři úspěšné průchody po sobě. `checkin`, `evening` a `private-tour` navázaly na své předchozí jednotlivé úspěchy dávkami `1e640a8e` a `1e43ee2e`. `vycep` završil předchozí dva úspěchy dávkou `1e640a8e`. Každý dokončil skutečný DB/API oracle a bezpečný screenshot. Sdílená tour dokončila samostatný stability běh `148adc63`.

| Běh | Výsledek | Maestro | Celý příkaz | Modelová volání / tokeny |
|---|---:|---:|---:|---:|
| `1e640a8e` | 4/4 | 513,569 s | 550,690 s | 0 / 0 |
| `1e43ee2e` | 3/3 | 401,895 s | 437,260 s | 0 / 0 |
| `148adc63` | sdílená tour 3× po sobě | 254,222 / 251,389 / 251,532 s | 794,871 s | 0 / 0 |

Večerní statistiky obsahují přesně dvě piva, jeden večer, jednu hospodu a 84 Kč. Detail skutečného piva má hodnocení 4,0 a „Má říz“. Soukromá tour zachová dvě zastávky, první dokončenou a druhou přeskočenou, a jediné zapsané pivo; nevytvoří veřejný ani soukromý odkaz.

Při odvolávání sdílené tour se po zrušení veřejné publikace opakovaně ztratila dostupnost další nabídky pro nativní automatizaci, přestože screenshot ukazoval správnou nabídku a viditelný odkaz. Locator textu i testID selhaly ve stejném místě. Upravený průchod po skutečném veřejném 404 restartuje appku, znovu otevře zachovaný plán a teprve potom odvolá soukromý odkaz. Tím navíc ověřuje zachování plánu při restartu; nedokazuje opravu dostupnosti nabídky ve stejném procesu. Není doložený produktový bug.


[Statistiky po offline synchronizaci](https://files.tmach.dev/diary-offline-reconciled-stats-a4247e070e5040ad8b88.png) a [zachovaný plán po odvolání obou odkazů](https://files.tmach.dev/diary-tour-links-withdrawn-7056174cb9914b06b9ec.png) byly prohlédnuté. Čerstvý reviewer prověřil finální restart mezi odvoláními i skutečné oracles bez nálezů. Shared-tour běží na novém společném základu; předchozí čtyři dokončené streaky předcházely poslednímu merge infrastruktury. Následná celá integrační sada `bbf6501c` potvrdila všech pět scénářů. Vlastní simulátor i procesy skončily, reporty a nepotřebné závislosti diary worktree jsou odstraněné. Sdílená appka a CLI zůstaly zachované.

### Dokončená stabilita hospod a Party, 4. 10. 2026

Čtrnáct zdravých scénářů prošlo třikrát po sobě. Katalogový scénář zůstává známým selháním NP-E2E-014 a není mezi úspěšnými. Poslední dávky dokončily skutečné DB/API kontroly i prohlédnuté konečné screenshoty.

| Běh | Výsledek | Maestro | Celý příkaz | Modelová volání / tokeny |
|---|---:|---:|---:|---:|
| `3bd48f79` | 10/15, první dokončené průchody | 1 220,537 s | 1 265,227 s | 0 / 0 |
| `0b7023a7` | 3/5, opravené formuláře | 510,655 s | 543,732 s | 0 / 0 |
| `4b691cf0` | 1/2, zakázaná poloha | 153,216 s | 188,835 s | 0 / 0 |
| `a8970dc4` | 13/13 | 1 130,508 s | 1 163,962 s | 0 / 0 |
| `72159c27` | 12/12, poslední třetí průchody | 1 055,308 s | 1 088,098 s | 0 / 0 |

Komunitní soukromí dokončilo tři úspěchy v `2d7eb19c`, `0292bfec` a `3bd48f79`; soukromá srdcovka v `0292bfec`, `3bd48f79` a `a8970dc4`. Příspěvky, hlášení appky a přidání hospody začaly v `0b7023a7`, oprávnění v `4b691cf0`; všem potom prošly `a8970dc4` a `72159c27`. Zbývajících osm zdravých scénářů má tři úspěchy v `3bd48f79`, `a8970dc4` a `72159c27`. Replayed / handed off / missed jsou nepoužitelné.

[Zapsané pivo a zavřené pondělí](https://files.tmach.dev/places-public-contribution-82a0bbe65ce04fd1a9b7.png), [přejmenovaná vlastní hospoda](https://files.tmach.dev/places-published-owner-edit-5af9064977944dbea9ec.png) a [Parta po offline restartu](https://files.tmach.dev/social-offline-party-0666993abb3b46e09ab8.png) byly prohlédnuté. Jediné vlastní služby skončily, simulátor je Shutdown, porty i zámky se uvolnily. Soukromé reporty a nepotřebné závislosti oblasti byly odstraněné; bezpečné důkazy zůstávají mimo Git. SSD po úklidu mělo přibližně 88 GiB volných.

### Ověření e-mailu a export, 4. 10. 2026

Nový samostatný scénář `identity/email-export.yaml` dokončil tři úspěšné průchody v `c3e06a39`: 89,607 / 87,617 / 87,660 s v Maestru, celý příkaz 306,374 s, exit 0. Modelová volání i tokeny jsou 0, replay metriky nepoužitelné. Existující neověřený účet nejprve skutečným UI vyvolá POST `/v1/account/export` s odpovědí 403. Žádný job ani příloha nevznikne. UI vyžádá jeden lokální e-mail, kontroler otevře skutečný ověřovací odkaz a appka po restartu ukáže ověřený účet. Druhý UI export dostane 202 a doručí jediný skutečný JSON soubor s původní identitou účtu, ID soukromého piva, 500 ml a 30 Kč. Soubor neobsahuje kontakty ani piva druhého účtu. Další restart a skutečné API čtení potvrdí původní účet.

Původní kontrola krátkého toastu třikrát selhala; není doložená produktová příčina. Nahrazuje ji přesný záznam skutečných odpovědí v již existujícím lokálním observeru. Ten drží pouze metodu a status, bez request body, kontaktů či tokenů. Reset jej vyčistí. Čerstvé nezávislé review observeru i finálních assertions nemělo nález. [Původní profil po ověření a exportu](https://files.tmach.dev/identity-email-verified-exported-70d8b34fb2fa4b878480.png) byl prohlédnutý; obrázek neobsahuje kontaktní údaje. Registrace a claim tím nejsou prohlášené za ověřené.

### Celá iOS integrace, 4. 10. 2026

První dokončený celý průchod `bbf6501c` na integrační revizi `d1e31603` spustil 33 scénářů. **32 prošlo**, jediným selháním byl přesně chybějící „E2E Jantar druhé hospody“ po offline restartu, tedy známý NP-E2E-014. Registrace zůstává samostatně označená jako `blocked` a do výsledku nevstupuje. Maestro trvalo 3 258,192 s, celý příkaz včetně přípravy a úklidu 3 293,575 s, návratový kód 1. Volání modelu i tokeny jsou 0; replayed / handed off / missed jsou nepoužitelné.

Běh použil vlastní nově vytvořený iPhone 17 / iOS 26.5. Před dokončeným průchodem proběhly dvě neúspěšné přípravy a cílená diagnostika na témže simulátoru; nejde proto o měření prvního studeného startu OS. Každý test samostatně resetoval appku, Keychain i DB. Celá sada nepoužívala modelovou replay cache. Další celý Maestro běh by údaj o modelové cache neposkytl, takže nebyl spuštěn jen kvůli tomuto srovnání.

První pokus `9f5e4224` nenašel flow v podadresářích (0 aplikačních testů, engine 1,140 s / celý příkaz 44,680 s). Doplněná dokumentovaná konfigurace `flows: ["**"]` opravila discovery. Druhý pokus `bfb9f4f9` ztratil nativní XCTest spojení při prvním scénáři; dalších 32 scénářů skončilo na stejném nedostupném driveru (engine 85,737 s / celý příkaz 109,391 s). To není 33 produktových chyb. Cílený průchod nastavení `41859303` na stejném simulátoru s novou nativní session prošel bez změny aplikace (149,209 / 170,467 s). Následující celá sada výše doběhla; příčina předchozího pádu driveru zůstává nedoložená.

Po dokončení byl vlastní simulátor `Shutdown`, API/Metro/kontrolní porty volné a privátní debug reporty odstraněné. SSD mělo 85,4 GiB volných. Nezávislá vizuální kontrola prohlédla všech 63 bezpečných snímků, zopakovala známé NP-E2E-005, 009, 012 a 014 a doplnila drobnou lokalizaci hodnocení NP-E2E-015; funkční úspěch příslušných testů tyto vizuální nálezy neuzavírá.

Po review byl spike zpřesněn o skutečnou uloženou hospodu, reset nejprve zastavuje starou appku a runner chrání vlastnictví procesů i po smrti rodiče. Šest cílených regresních kontrol vlastnictví a nezávislé review prošly. Nativní běh `837b06cf` následně třikrát prošel zpřesněným spike a dočasnou diagnostikou prázdné Party (111,739 / 107,664 / 107,243 s za dvojici scénářů, celý příkaz 356,733 s, exit 0). Ve všech třech kolech se zapsalo právě jedno pivo do E2E U Testera a prázdná karta s nulou sedících umožnila otevřít Nastavení party. Zdrojová domněnka o nepřístupné prázdné kartě se tedy nepotvrdila, produktový kód se kvůli ní neměnil. Všech devět bezpečných snímků bylo prohlédnutých. Dočasná diagnostika není součástí počtu 34 trvalých scénářů.

### Android, lokální build a první stabilní průchod

Lokální `expo prebuild` a ARM64 `assembleDebug` prošly za 5 min 31 s, APK má 103,3 MiB. Běh `3ea54c13` na vlastním Pixel 10 / API 36.1 třikrát dokončil přihlášení, výběr E2E Ležáku, uložení přesně 500 ml za 41 Kč v E2E U Testera a kontrolu stejného účtu i záznamu po restartu. Časy enginu byly 99,748 / 98,239 / 99,033 s; celý příkaz 338,992 s. Modelová volání a tokeny 0, replay nepoužitelný. Všechny tři screenshoty prošly vizuální kontrolou a soukromé reporty byly smazané.

Expo na Androidu vyžaduje vlastní `adb reverse` pro loopback URL Metra a studený start `MainActivity`. První pokusy zůstávaly v launcheru; jsou to selhání přípravy, nikoli produktu. Reset nastavuje pouze tři preference vývojové nabídky Expa před spuštěním procesu, aby neotevírala menu ani nezakrývala ovládání plovoucím tlačítkem. Následný spike v `18499f44` s touto konfigurací znovu prošel; [zkontrolovaný Android screenshot](https://files.tmach.dev/android-persisted-drink-407747f48f97477f903a.png).

První Android kontrola DB byla příliš časná: appka záměrně čeká šest sekund kvůli vrácení zápisu. Test nyní místo osmi okamžitých opakování kontroluje přesně stejná data každých 500 ms, nejvýš 15 s. Nemění produkt ani požadovaný výsledek.

Cílený Android průchod `18499f44` navíc doložil NP-E2E-007 při návratu z lišty oznámení: UI zachovalo publikovaný večer, backend publikaci nedostal. Dávka měla 1 PASS / 1 FAIL, engine 229,265 s, celý příkaz 264,218 s. Rozšíření opravy PR #212 (`cd1b9940`) doplňuje `flushNightsQueue()` do Android obsluhy `focus`; regrese PR #217 (`abc60025`) používá skutečnou lištu oznámení a zachovává iOS větev. Po opravě čekání na navigaci při Android restartu dokončil běh `8a754f4c` tři úspěšné průchody: 153,143 / 146,852 / 146,460 s v enginu, celý příkaz 487,137 s. Oracle před dalším restartem potvrdil právě jeden publikovaný večer, jedno pivo a uzavřenou návštěvu, správnou hospodu, soukromí a nezměněný PID. Následný restart zachoval stejnou publikaci. Všech 19 bezpečných snímků prošlo vizuální kontrolou bez nového produktového nálezu; jeden zachytil probíhající přechod obrazovek. Oba commity jsou pushnuté a jejich CI prošlo. Pozdější výsledek celé Android sady je uvedený níže.


### Android, celá sada 4. 10. 2026

Integrovaný commit `f262237b`, Pixel 10 / API 36.1, běh `645f3dd9`: všech 33 dostupných scénářů se spustilo, **20 PASS / 13 FAIL**, engine 3 858,479 s (64 min 18 s). Registrace zůstala vynechaná explicitním tagem `blocked`. Modelová volání i tokeny 0; Maestro nemá replay cache. Celkový čas příkazu není doložený: při přerušení session zanikl rodičovský runner a soubor `command-metrics.json` nevznikl. Engine dokončil report a odstranil privátní debug soubory; po obnovení práce byly podle PID a času vzniku zastavené jeho dva zbývající vlastní procesy emulátoru. API, Metro a kontroler už neběžely.

Nezávislé review prohlédlo všech 52 bezpečných snímků. Potvrdilo známé NP-E2E-005, 014, 015 a Android omezení NP-E2E-016; poslední jmenované není důkaz produkčního pádu. Zkrácená výzva na prázdném profilu po onboardingu je drobná vizuální poznámka, akce zůstává čitelná. Obrázky během prolínání nebo spinneru se nepoužívají jako důkaz dokončené publikace.

Třináct selhání není zelená Android sada. Dvě byla ve změně jazyka a velikosti písmene testovacího jména, jedno v čekání na hlavní tab před dokončením onboardingu. Ověření e-mailu a reset hesla odmítl lokální helper kvůli Android aliasu hostu; screenshot profilu ukázal hlášku překrytou klávesnicí. Tyto úpravy testů a infrastruktury se ověřují cíleně. Katalog selhal přesně na známém NP-E2E-014 a profil po smazání na NP-E2E-016. U komunitní polohy, domovského bodu, obnovení žebříčku a atributů přidané hospody je potřeba další důkaz; jednorázový neúspěch přeskočení onboardingu v testu večera nemá prokázanou příčinu. Výsledek tohoto běhu se nepřepisuje podle pozdějších oprav.


### Android, cílená stabilita nastavení a obnovy

Běh `02844663` na integračním commitu `ef9638ad` třikrát dokončil všechny tři scénáře nastavení, zamítnutých médií a přerušeného onboardingu. Každé kolo skončilo **3 PASS / 0 FAIL**, engine 398,846 / 389,831 / 384,696 s; celý příkaz 1 215,581 s, exit 0. Modelová volání a tokeny 0, replay metriky nepoužitelné. Změna jazyka čeká na nový hlavní tab před dalším deep linkem, Android test respektuje automatická velká písmena jména a restart rozlišuje hlavní obrazovku od dosud nedokončeného onboardingu.

Všech 12 bezpečných snímků prohlédl nezávislý reviewer. Nový P0/P1/P2 nález nevznikl; známé zkrácení anglického vysvětlení vody NP-E2E-012 přetrvává. Některé snímky nastavení zachycují formulář nebo přechod, proto uložené preference prokazují až dokončené assertions po restartu. Soukromé debug reporty byly odstraněné.


### Android, diagnostika zbývajících průchodů

Běh `7addd7bd` na commitu `f8775c5d` dokončil 1 PASS / 8 FAIL za 1 104,355 s v enginu, celý příkaz 1 138,583 s, exit 1. Ověření e-mailu a export prošly s opravou lokálního Android hostu. Reset hesla přerušil pozdní návrat po odhlášení; profil ukázal změnu přezdívky klávesnicí při Enter. Komunitní a domovskou polohu překryl systémový dialog Location Accuracy. Žebříčková kontrola běžela ještě na profilu kamaráda po nedokončeném návratu, proto tento výsledek není důkaz úniku přes cache. Nové hledání ponechalo za kurzorem konec starého dotazu. Opravy zachovávají přesné UI a DB kontroly a čekají na další nativní průchod.

Přidaná hospoda skutečně vznikla jednou pod správným účtem, ale její pin neodpovídal pevné fixture. Bez zaznamenaného středu nativní kamery nelze původní výsledek označit za produktovou ztrátu bodu. Test nově používá běžný vstup z nabídky kompasu, který mapě předává aktuální polohu; tolerance kontroly zůstává stejná. Offline večer dokončil skutečný sync a screenshot ukazuje 2 piva / 1 večer / 1 hospodu / 84 Kč. Selhala až iOS podoba společného accessibility textu na Androidu, proto Android větev ověří stejné čtyři hodnoty po jednotlivých řádcích.


### Android, ověření opravených vstupů

Dávka `ba03417e` na commitu `e258ae45` dokončila **6 PASS / 3 FAIL**: engine 1 298,139 s, celý příkaz 1 332,035 s, exit 1, model 0 volání / 0 tokenů. Prošly rozšířené zakázané oprávnění, přidání a přejmenování hospody se stejným přesným bodem, úprava a soukromí profilu, žebříček po blokování, offline večer se statistikami a ověření e-mailu s exportem. Poslední z nich má druhý úspěch po sobě.

Nové rozlišení chybového hledání, skutečný retry, nepřihlášená prázdná komunita a zachovaný draft bez povolené polohy mají první Android důkaz. [Chyba hledání](https://files.tmach.dev/places-search-unavailable-f2c005156e8542a38a86.png) a [zachovaný nepublikovaný formulář](https://files.tmach.dev/places-denied-community-draft-9b5636732815404c95b6.png) byly prohlédnuté. Přesný obsah původních komunitních akcí zůstal stejný; závěrečná kontrola prokázala jedinou textovou zprávu bez fotky.

Domovský a komunitní průchod zastavila koncová mezera v nativním textu Google Location Accuracy. Opravený locator ověřuje přesné systémové ID i text s povolenými koncovými bílými znaky. Reset hesla změnil skutečné heslo a odmítl staré přihlášení; při posledním UI přihlášení však mazání odprostřed pole ponechalo část předchozího vstupu. Test nově vybere celý text a smaže výběr podle dokumentace Maestra. Následné nativní ověření těchto tří testů ještě není součástí uvedeného výsledku.

### Android, čekání na deep link a dodání polohy

Dávka `ddbf93a2` měla 1 PASS / 2 FAIL za 368,804 s v enginu, celý příkaz 404,261 s. Komunitní vytvoření včetně chyby a retry prošlo. Domovský bod se po potvrzení Google dialogu nedočkal polohy; reset hesla kontroloval absenci ručního kódu ještě před načtením tokenu z odkazu. Test nyní čeká na stejnou přesnou podmínku nejvýš 20 sekund.

Dávka `adedd257` měla 0 PASS / 3 FAIL za 423,882 s v enginu, celý příkaz 458,330 s. Průběžné `geo fix` nepomohlo: síťový provider neměl údaj a GPS/fused údaj byl při kontrole přes minutu starý. Home i komunitní formulář zobrazily dostupnou chybu polohy a zachovaly formulář. Reset došel k odmítnutí starého hesla, ale Android secure input nenabídl očekávané „Select all“. Následující verze testu používá nový přihlašovací formulář po restartu. Tyto výsledky nejsou tři nové produktové chyby. Všech osm bezpečných snímků první dávky i oba chybové snímky druhé prošly nezávislou vizuální kontrolou; citlivé debug reporty byly odstraněné.

Poslední omezený pokus `ede781a4` dodával stejný syntetický bod i přes vestavěný Android testovací síťový provider. Kontrola poskytovatele ukázala čerstvý údaj, ale původní přesný home test znovu selhal na nedostupné poloze (111,744 s engine / 147,551 s celý příkaz, exit 1). Pouhá čerstvost simulovaného údaje tedy není doloženou příčinou. Neúčinný provider i interval byly odstraněné, produktový kód se kvůli tomu nemění. Domovský bod na Androidu zůstává neověřený; příčinu v Expo/Google fused provideru se v omezeném čase nepodařilo izolovat. iOS průchod má tři úspěchy. Další změny polohy se v tomto úkolu neprovádějí.

### Android, dokončené cílené ověření

Poslední dávka `9796b619` na `1a2f12d9` měla **3 PASS / 0 FAIL**: reset hesla se skutečným odmítnutím starého hesla a novým přihlášením, ověření e-mailu s izolovaným exportem a vytvoření komunitní akce po skutečném výpadku backendu. Engine 497,776 s, celý příkaz 532,861 s, exit 0. Export tak má třetí úspěšný Android průchod. Všech šest bezpečných snímků prošlo nezávislou kontrolou, privátní debug byl odstraněný. Resetový obrázek zachytil přechod zavírání úpravy profilu; změnu hesla a konečný stav prokazují datové oracles, nikoli samotný obrázek.

Souhrn celé Android sady `645f3dd9` a posledních cílených výsledků `02844663`, `ba03417e`, `9796b619` a `ede781a4`: **30 dostupných scénářů prošlo alespoň jednou, tři neprošly**. Jde o výsledky více běhů, nikoli o nově spuštěnou celou zelenou sadu ani o tři opakování všech Android testů. Neúspěšné jsou přesná offline nabídka NP-E2E-014, chybové okno po skutečném smazání účtu NP-E2E-016 a uvedené omezení polohy domova. Registrace zůstává samostatně `blocked`. Další celá Android sada se bez změny těchto příčin neopakuje.

Dodatečné nezávislé review infrastruktury odhalilo neobnovitelný zámek přerušeného Android buildu. Oprava znovu používá evidenci PID/času vzniku i potomků; neověřitelný stav odmítá. Všech deset cílených testů obnovy a vlastnictví prošlo za 1,627 s, následné nezávislé review nemělo blokující nález. Kvůli této změně správy procesů nebyl spuštěn další objemný mobilní build.

### Rozšířené chybové a prázdné stavy na iOS

Rozšířený `permissions-denied.yaml` na integrační revizi `1a2f12d9` prošel v dávce `be2685c6` třikrát po sobě: **161,775 / 155,826 / 154,651 s**, celý příkaz **517,241 s**, exit 0. Ověřuje nepřihlášenou komunitu bez úniku seedovaných akcí, skutečný výpadek hledání odlišený od prázdného výsledku, retry po návratu backendu, vymazání dotazu a zachování rozepsané akce po zamítnuté poloze a návratu z Nastavení ve stejném procesu. Pokus o vytvoření bez polohy nezmění přesný digest komunitních dat. Závěr ověřuje skutečně uložené textové hlášení po zamítnuté kameře. Všechna měření mají 0 modelových volání/tokenů a nepoužitelné replay metriky.

Další dvě drobné opravy infrastruktury chrání existující nativní iOS konfiguraci a selhání mazání privátních artefaktů. Dva skutečné filesystem testy potvrdily odmítnutí a zachování existujícího `ios/` i dangling symlinku. Injektované selhání mazání při no-app CLI průchodu zachovalo slot; další CLI invokace odstranila zbytek privátního testovacího souboru a slot uvolnila. Oba příkazy správně skončily 1 kvůli záměrně chybějící appce, bez spuštění simulátoru či backendu. Čerstvé review nemělo nález.

### Závěrečné cílené iOS ověření a uzavření

Dávka `454d9627` na integrační revizi `e209be8d` dokončila **5 PASS / 0 FAIL**: přidání hospody offline, reset hesla, zamítnutá média, offline večer a nastavení. Engine **701,669 s**, celý příkaz **736,860 s**, exit 0, model **0 volání / 0 tokenů**. Ověřuje změněné sdílené kroky po Android úpravách a čekání na dokončení animace resetového screenshotu. Další celá sada se bez změny ostatních scénářů neopakovala.

Nezávislý reviewer prohlédl všech 12 bezpečných snímků této dávky i 12 snímků rozšířených oprávnění `be2685c6`. Nový nález nevznikl; známý NP-E2E-012 zůstává. Resetový obrázek zachycuje dokončený profil, statistiky přesně 2 piva / 1 večer / 1 hospodu / 84 Kč. Privátní reporty jsou odstraněné, vlastní simulátor je Shutdown a všechny testovací porty jsou volné.

Závěrečné připomínky k runneru doplnily potvrzení konce vlastních procesů po SIGKILL, odmítnutí opakovaného buildu nad existujícím nativním stromem na obou platformách a odmítnutí přepínačů jiného enginu ještě před vytvořením slotu. Nativní projekty se automaticky nemažou. Čtrnáct cílených testů ověřuje vlastnictví a zachování nativních souborů včetně symlinků; čtyři skutečné CLI invokace s nepodporovanými přepínači nevytvořily běh ani zámek. Další mobilní build kvůli těmto pojistkám nebyl potřeba.

Výsledný rozsah je 34 trvalých scénářů: 32 má tři úspěšné iOS průchody, jeden drží známé selhání NP-E2E-014 a registrace s claimem zůstává blokovaná. Každá P0/P1 položka výše má důkaz nebo konkrétní důvod omezení. Android má 30 úspěšných scénářů napříč běhy; zbývající tři a registrace jsou výslovně popsané. Oslava a legacy stůl zůstávají nepokryté P2. Deset malých oprav je připravených v samostatných PR, šest z šestnácti zaznamenaných bugů zůstává otevřených. PR jsou určené proti `dev`; merge ani produkční vydání nebyly součástí provedených akcí.
