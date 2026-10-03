# Pokrytí skutečného mobilního E2E

Průzkum vychází z čerstvého `origin/dev` na `e72d145c` (3. 10. 2026). Tři nezávislé read-only průzkumy prošly routy, klienty, backend a Jest. Tabulka popisuje ověřované uživatelské výsledky, nikoli počet jednotlivých kliknutí. `Plán` není důkaz proběhlého testu.

Jest dál ověřuje kombinatoriku validací, výpočty, wire payloady, retry/drop klasifikaci, poškozenou storage a mockované závody. E2E přidává skutečný routing, nativní vstupy, SecureStore, AsyncStorage, restart procesu a lokální HTTP. Backendové oracles čtou skutečnou testovací DB přes místní kontrolní endpoint; nevyměňují odpovědi aplikačního API.

| Oblast | Průchod | Selhání, které test zachytí | Priorita | Stav |
|---|---|---|---|---|
| Přihlášení | Přihlásit účet, zapsat konkrétní pivo, restartovat a porovnat UI a DB | Ztracená session/zápis nebo dvojí doručení po restartu | P0 | `spike/persist-drink.e2e.ts`: 3× zelené; druhý a třetí úplný replay |
| Registrace | Anonymní online i offline zápis, registrace, soukromý profil, restart | Claim ztratí historii nebo předá frontu jinému účtu | P0 | Plán |
| Ověření e-mailu | Odkaz z lokální schránky, návrat do appky, obnovit účet | Skutečný e-mailový odkaz a stav profilu se rozcházejí | P0 | Plán |
| Reset hesla | Žádost v UI, lokální e-mail, nové heslo, staré odmítnuté, nové přihlásí | Reset neodvolá staré přihlášení nebo neuloží nové heslo | P0 | Plán |
| Odhlášení a změna účtu | A s offline zápisem, odhlášení, restart, login B | Soukromá historie nebo čekající zápis A se objeví u B | P0 | Plán |
| Smazání účtu | Zrušit potvrzení, potom smazat, restart; ověřit DB a lokální vyčištění | Smazání jen v UI, neodvolaná session, mazání po zrušení | P0 | Plán |
| Offline počítadlo | Zastavit vlastní backend, zapsat další pivo, restart offline, obnovit a foreground | Fronta nepřežije restart, výpadek odhlásí, sync duplikuje | P0 | Plán |
| Soukromí profilu | Nastavit soukromí v UI, ověřit pohled cizího účtu | Přepínač se neuloží nebo cizí účet dostane soukromý profil | P0 | Plán |
| Soukromí party | Vypnout sdílení, ghost, blokování; obnovit druhý účet | Aktivita zůstane ve feedu, mapě nebo detailu cizího účtu | P0 | Plán |
| Soukromí fotek | Soukromá versus friends fotka, pohled druhého účtu | Galerie či feed vrátí fotku nepovolenému publiku | P0 | Plán |
| Komunitní akce | Žádost, host schválí, účastník odejde | Přesná adresa unikne před schválením nebo po odchodu | P0 | Plán |
| Přidání hospody | Offline potvrdit pin a uložit, restart, online foreground | Nová hospoda se ztratí nebo vznikne vícekrát | P0 | Plán |
| Nahlášení hospody | Zrušit potvrzení, offline nahlásit, sync; druhý účet stále vidí hospodu | Jedno hlášení skryje komunitní hospodu všem | P0 | Plán |
| Report appky | Text/příloha offline, restart a doručení | Falešné odeslání, ztráta textu či dočasného souboru | P0 | Plán |
| Offline katalog | Načíst, zastavit backend, restart a hledat známou hospodu | Snapshot zmizí, skryté místo se vrátí | P0 | Plán |
| Domovský bod | Ruční pin, zrušit/uložit, restart a odstranit | Neodsouhlasený bod se uloží, restart jej ztratí nebo unikne na server | P0 | Plán |
| Fotosoutěž | Výslovný souhlas se zveřejněním, hlasování a stažení | Zveřejnění bez souhlasu nebo změna původní visibility fotky | P0 | Plán |
| Tours | Offline plán se dvěma zastávkami, restart a dokončení | Ztráta uloženého plánu nebo běhu | P0 | Plán |
| Tours sdílení | Soukromý/public odkaz, přijetí a zrušení | Odvolaný odkaz dál odhaluje plán či soukromý čas srazu | P0 | Plán |
| Onboarding | Dokončení/přeskočení a restart; restart v průběhu | Onboarding se opakuje nebo označí nedokončený flow za dokončený | P1 | Plán |
| Kompas | Nejbližší seeded hospoda, odhalení, detail, jiná hospoda | Špatný cíl nebo rozpojená identita detailu | P1 | Plán |
| Kompas bez polohy | Odepřít oprávnění, otevřít ruční mapu a hledání | Nekonečné hledání nebo zablokovaný vstup do mapy | P1 | Plán |
| Prázdný/chybový katalog | Prázdný výsledek versus výpadek, retry a zrušit filtr | Chyba se vydává za prázdné okolí, není cesta dál | P1 | Plán |
| Mapa a hledání | Vybrat konkrétní výsledek, detail, zamířit kompas | Jiné místo v detailu, nefunkční návrat a zacílení | P1 | Plán |
| Večer | Dopito, archiv, úprava a smazání piva offline, restart a sync | Úprava jiného večera, návrat smazaného piva, znovuotevřená návštěva | P1 | Plán |
| Výčep | Publikovat offline, obnovit pouze foreground, potom restart | Publikace zůstane ve frontě nebo se doručí dvakrát | P1 | Plán; hypotéza chybějícího foreground flush, zatím nereprodukováno |
| Detail piva | Otevřít seedované check-iny přes profil kamaráda | Route nebo agregace patří jinému pivu | P1 | Plán; detail čte BeerCheckIn, ne DrinkLog |
| Statistiky | Po zápisu/úpravě/smazání porovnat přesný baseline UI a serveru | Dvojí započítání remote/local nebo nezohledněné smazání | P1 | Plán; součást deníkových testů |
| Moje přidané hospody | Čekající/potvrzená hospoda, oprava názvu/pinu, retry | Editace vytvoří další hospodu nebo uloží starý pin | P1 | Plán |
| Návrh akce | Navrhnout akci v hospodě, ověřit pending stav | Návrh je veřejný bez ověření nebo se retry duplikuje | P1 | Plán; nemá offline frontu |
| Komunitní empty/error | Nepřihlášený, žádné akce, denied, chyba vytvoření a retry | Nekonečný spinner, duplikace vytvoření | P1 | Plán; nemá persistovaný draft ani offline frontu |
| Parta pozvánka/detail | Cold i warm link, potvrzení, přijetí druhým účtem, detail | Ztracená pozvánka, automatické přijetí, špatný profil | P1 | Plán |
| Přátelé offline | Dashboard snapshot, queued akce, restart a sync | Prázdná Parta nebo duplicita doručené akce | P1 | Plán |
| Profil úprava | Obsazená a volná přezdívka, jméno, uložit, restart | Formulář zavře neúspěšný PATCH nebo profil neodpovídá DB | P1 | Plán |
| Avatar/fotky | Skutečný galerijní picker, upload, restart, výměna/mazání | Multipart selže, starý obrázek v cache, ztracený lokální soubor | P1 | Plán |
| Žebříčky | Známé skóre/perioda, soukromý a blokovaný účet | Chybné skóre nebo únik profilu přes teplou cache | P0 | Plán |
| Nastavení | Změnit serverové i lokální preference, restart | Toggle pouze vizuální nebo server přepíše místní hodnotu | P1 | Plán; serverový PATCH nemá offline frontu |
| Jazyk | CZ → EN s restartem JS, plný restart a zpět | Jazyk nepřetrvá nebo přepnutí poškodí účet/deník | P1 | Plán |
| Export účtu | Neověřený kontakt odmítnut, ověřený dostane lokální export | Export cizích dat nebo odeslání neověřenému účtu | P1 | Plán |
| Kamera a galerie denied | Odmítnutí/cancel, návrat do formuláře | Odmítnutí oprávnění zablokuje další práci | P1 | Plán; fyzickou kameru iOS simulátor neověřuje |
| Odznaky | Seed známého odemčeného a zamčeného odznaku, restart | Profil renderuje jiný stav než server | P2 | Plán |
| Oslava | Příchod k vybrané hospodě a návrat | Jiná hospoda, ztracený výběr nebo automaticky přidané pivo | P2 | Plán |
| About/privacy | Obě navigační cesty, obsah a offline návrat | Prázdná obrazovka, nekonečné načítání, rozbitá navigace | P2 | Plán |
| Příspěvky | Hodiny a pivo měněné offline, restart, doručit obě části | Druhý zápis přepíše první část fronty, opakované XP | P1 | Plán |
| Starý společný stůl | Legacy party-live link a návrat do Party | Prázdný legacy route nebo oživení odstraněného flow | P2 | Plán; společné stoly již nejsou mobilní funkcí |

## Prostředí a měření

- Framework: `e2e 0.16.0`, `@e2e-dev/mobile 0.9.1`, stabilní npm verze ověřené před instalací.
- Model: ChatGPT předplatné přes `chatgpt('gpt-6.1-sol')`; přihlášení je mimo repo.
- iOS: pouze explicitně vytvořený iPhone 17, vlastní Metro/API/SQLite na každý slot; maximálně tři sloty.
- E-mail: skutečně vykreslená zpráva v lokálním paměťovém backendu. Žádný testovací login ani změna API kontraktu.
- Backendové externí sockety jsou blokované; klíče a produkční `.env` se nenačítají. Mapový klíč je neplatná fixture. iOS 26.5 nepodporuje notifications přes simctl privacy; případný dialog test odmítá a lokální adaptér zabraňuje registraci skutečného push tokenu.
- Naměřený studený běh: zatím neproběhl.
- Naměřený replay: zatím neproběhl. `agent.assert` vždy volá model; replay se vztahuje na `agent.act`.
- Souběh dvou běhů: ověřený zeleným spike ve slotech 1 a 2, vlastní simulátory, API/Metro porty a odlišné účty v oddělených DB. V každé DB právě jedno pivo. Po skončení všechny čtyři porty volné.
- Android: dostupnost zatím nezjištěna, spustit až po zelené iOS sadě.

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
