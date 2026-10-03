# Pokrytí skutečného mobilního E2E

Průzkum vychází z čerstvého `origin/dev` na `e72d145c` (3. 10. 2026). Tři nezávislé read-only průzkumy prošly routy, klienty, backend a Jest. Tabulka popisuje ověřované uživatelské výsledky, nikoli počet jednotlivých kliknutí. `Plán` není důkaz proběhlého testu.

Jest dál ověřuje kombinatoriku validací, výpočty, wire payloady, retry/drop klasifikaci, poškozenou storage a mockované závody. E2E přidává skutečný routing, nativní vstupy, SecureStore, AsyncStorage, restart procesu a lokální HTTP. Backendové oracles čtou skutečnou testovací DB přes místní kontrolní endpoint; nevyměňují odpovědi aplikačního API.

| Oblast | Průchod | Selhání, které test zachytí | Priorita | Stav |
|---|---|---|---|---|
| Přihlášení | Přihlásit účet, zapsat konkrétní pivo, restartovat a porovnat UI a DB | Ztracená session/zápis nebo dvojí doručení po restartu | P0 | `spike/persist-drink.yaml`: 3× zelené v Maestro; původní TesterArmy spike má doložený replay níže |
| Registrace | Anonymní online i offline zápis, registrace, soukromý profil, restart | Claim ztratí historii nebo předá frontu jinému účtu | P0 | `identity/registration.yaml`: připraveno, oprava druhého offline zápisu čeká na runtime |
| Ověření e-mailu | Odkaz z lokální schránky, návrat do appky, obnovit účet | Skutečný e-mailový odkaz a stav profilu se rozcházejí | P0 | `identity/registration.yaml`: skutečný lokální odkaz a export; celý průchod zatím neprošel |
| Reset hesla | Žádost v UI, lokální e-mail, nové heslo, staré odmítnuté, nové přihlásí | Reset neodvolá staré přihlášení nebo neuloží nové heslo | P0 | `identity/password-reset.yaml`: celý průchod jednou zelený včetně odvolané relace a změněného hesla; stabilita čeká |
| Odhlášení a změna účtu | A s offline zápisem, odhlášení, restart, login B | Soukromá historie nebo čekající zápis A se objeví u B | P0 | `identity/logout.yaml`: blokoval potvrzený NP-E2E-011; malá oprava čeká na stejný nativní průchod |
| Smazání účtu | Zrušit potvrzení, potom smazat, restart; ověřit DB a lokální vyčištění | Smazání jen v UI, neodvolaná session, mazání po zrušení | P0 | `identity/delete.yaml`: jednou zelený celý průchod, DELETE 204, odvolané session a GET 401 po restartu; stabilita čeká |
| Offline počítadlo | Zastavit vlastní backend, zapsat další pivo, restart offline, obnovit a foreground | Fronta nepřežije restart, výpadek odhlásí, sync duplikuje | P0 | `diary/evening.yaml`, `identity/registration.yaml`: připraveno; stabilita čeká |
| Soukromí profilu | Nastavit soukromí v UI, ověřit pohled cizího účtu | Přepínač se neuloží nebo cizí účet dostane soukromý profil | P0 | `identity/profile.yaml`: celý průchod jednou zelený včetně skutečného pohledu druhého účtu; stabilita čeká |
| Soukromí party | Vypnout sdílení, ghost, blokování; obnovit druhý účet | Aktivita zůstane ve feedu, mapě nebo detailu cizího účtu | P0 | `places-social/party-privacy.yaml`: rozlišuje automatické a ruční sdílení; NP-E2E-005 vysvětluje omezení textu |
| Soukromí fotek | Soukromá versus friends fotka, pohled druhého účtu | Galerie či feed vrátí fotku nepovolenému publiku | P0 | `identity/photos.yaml`: blokoval NP-E2E-010; ověření opravy čeká |
| Komunitní akce | Host schválí žádost a pak zruší akci | Přesná adresa unikne před schválením nebo po odchodu | P0 | `places-social/community-privacy.yaml`: celý průchod jednou zelený, stabilita čeká; NP-E2E-002 opraven v PR #209 |
| Přidání hospody | Offline potvrdit pin a uložit, restart, online foreground | Nová hospoda se ztratí nebo vznikne vícekrát | P0 | `places-social/pub-create-offline.yaml`: oprava formuláře a přesnější kontrola pinu čeká na runtime |
| Nahlášení hospody | Zrušit potvrzení, offline nahlásit, sync; druhý účet stále vidí hospodu | Jedno hlášení skryje komunitní hospodu všem | P0 | `places-social/report-offline.yaml`: opraven popis akce, runtime čeká |
| Report appky | Text/příloha offline, restart a doručení | Falešné odeslání, ztráta textu či dočasného souboru | P0 | `places-social/feedback-offline.yaml`: skutečná příloha a offline fronta; oprava scrollu čeká na runtime |
| Offline katalog | Načíst, zastavit backend, restart a hledat známou hospodu | Snapshot zmizí, skryté místo se vrátí | P0 | `places-social/catalogue-offline.yaml`: oprava výběru řádku čeká na runtime |
| Domovský bod | Zrušit ruční pin, uložit současnou polohu, restart a odstranit | Neodsouhlasený bod se uloží, restart jej ztratí nebo unikne na server | P0 | `places-social/home-persistence.yaml`: jednou zelený; nová kontrola uloženého bodu čeká na runtime |
| Fotosoutěž | Výslovný souhlas se zveřejněním, hlasování a stažení | Zveřejnění bez souhlasu nebo změna původní visibility fotky | P0 | `places-social/contest-privacy.yaml`: jednou zelený, stabilita čeká |
| Tours | Offline plán se dvěma zastávkami, restart a dokončení | Ztráta uloženého plánu nebo běhu | P0 | `diary/private-tour.yaml`: celý průchod jednou zelený, stabilita čeká |
| Tours sdílení | Soukromý/public odkaz, přijetí a zrušení | Odvolaný odkaz dál odhaluje plán či soukromý čas srazu | P0 | `diary/shared-tour.yaml`: import a veřejná publikace prošly; celý průchod čeká, omezení nativního Copy níže |
| Onboarding | Dokončení/přeskočení a restart; restart v průběhu | Onboarding se opakuje nebo označí nedokončený flow za dokončený | P1 | `identity/onboarding-complete.yaml` a `onboarding-interrupt.yaml`: oba jednou zelené, stabilita čeká |
| Kompas | Nejbližší seeded hospoda, odhalení, detail, jiná hospoda | Špatný cíl nebo rozpojená identita detailu | P1 | `places-social/catalogue-offline.yaml`: skutečné seeded cíle, runtime čeká |
| Kompas bez polohy | Odepřít oprávnění, otevřít ruční mapu a hledání | Nekonečné hledání nebo zablokovaný vstup do mapy | P1 | `places-social/permissions-denied.yaml`: opraveno iOS oprávnění `never`, runtime čeká |
| Prázdný/chybový katalog | Prázdný výsledek versus výpadek, retry a zrušit filtr | Chyba se vydává za prázdné okolí, není cesta dál | P1 | `places-social/permissions-denied.yaml` ověřuje prázdné hledání; `catalogue-offline.yaml` dostupnost uloženého katalogu při výpadku; runtime čeká |
| Mapa a hledání | Vybrat konkrétní výsledek, detail, zamířit kompas | Jiné místo v detailu, nefunkční návrat a zacílení | P1 | `places-social/catalogue-offline.yaml`: připraveno, runtime čeká |
| Večer | Dopito, archiv, úprava a smazání piva offline, restart a sync | Úprava jiného večera, návrat smazaného piva, znovuotevřená návštěva | P1 | `diary/evening.yaml`: celý průchod jednou zelený včetně NP-E2E-006 s opravou PR #213; stabilita čeká |
| Výčep | Publikovat offline, obnovit pouze foreground, potom restart | Publikace zůstane ve frontě nebo se doručí dvakrát | P0 | `diary/vycep.yaml`: NP-E2E-007 potvrzen; s opravou PR #212 celý průchod jednou zelený, stabilita čeká |
| Detail piva | Ohodnotit pivo offline a po syncu otevřít jeho detail | Route nebo agregace patří jinému pivu | P1 | `diary/checkin.yaml`: celý průchod jednou zelený, skutečný offline BeerCheckIn a agregace po restartu; stabilita čeká |
| Statistiky | Po zápisu/úpravě/smazání porovnat přesný baseline UI a serveru | Dvojí započítání remote/local nebo nezohledněné smazání | P1 | `diary/evening.yaml`: jednou zelené přesné 2 piva / 1 večer / 1 hospoda / 84 Kč po úpravě a smazání; stabilita čeká |
| Moje přidané hospody | Čekající/potvrzená hospoda, oprava názvu, zachování potvrzeného pinu | Editace vytvoří další hospodu nebo uloží starý pin | P1 | `places-social/pub-create-offline.yaml`: pending stav a přejmenování při zachování identity; runtime čeká |
| Návrh akce | Navrhnout akci v hospodě, ověřit pending stav | Návrh je veřejný bez ověření nebo se retry duplikuje | P1 | `places-social/pub-event-moderation.yaml`: chyba při výpadku a pending stav po retry; runtime čeká |
| Komunitní empty/error | Nepřihlášený, žádné akce, denied, chyba vytvoření a retry | Nekonečný spinner, duplikace vytvoření | P1 | `places-social/community-create-retry.yaml`: připraveno a nezávisle zkontrolováno, runtime čeká; restart draftu produkt neslibuje |
| Parta pozvánka/detail | Pozvánkový odkaz, vědomé přijetí, detail a blokování | Ztracená pozvánka, automatické přijetí, špatný profil | P1 | `places-social/invite-offline.yaml` a `party-privacy.yaml`: přijetí odkazu a detail; první průchod pozvánkou zelený, zpřesnění NP-E2E-008 čeká |
| Přátelé offline | Dashboard snapshot a queued soukromá srdcovka, restart a sync | Prázdná Parta nebo duplicita doručené akce | P1 | `places-social/invite-offline.yaml`: uložený dashboard; `favorite-offline.yaml`: skutečný queued zápis a odebrání; stabilita čeká |
| Profil úprava | Obsazená a volná přezdívka, jméno, uložit, restart | Formulář zavře neúspěšný PATCH nebo profil neodpovídá DB | P1 | `identity/profile.yaml`: celý průchod jednou zelený, data ověřena po restartu; stabilita čeká |
| Avatar/fotky | Skutečný galerijní picker, upload, restart, výměna/mazání | Multipart selže, starý obrázek v cache, ztracený lokální soubor | P1 | `identity/avatar.yaml`: skutečný upload, výměna s jiným SHA-256 a odstranění jednou zelené; fotodeník čeká na NP-E2E-010 |
| Žebříčky | Známé skóre/perioda, soukromý a blokovaný účet | Chybné skóre nebo únik profilu přes teplou cache | P0 | `places-social/leaderboard-privacy.yaml`: soukromí jednou zelené; nové přesné UI kontroly čekají; NP-E2E-009 zůstává nejasností textu |
| Nastavení | Změnit serverové i lokální preference, restart | Toggle pouze vizuální nebo server přepíše místní hodnotu | P1 | `identity/settings.yaml`: celý průchod jednou zelený včetně obou jazyků a preference po restartech; stabilita čeká |
| Jazyk | CZ → EN s restartem JS, plný restart a zpět | Jazyk nepřetrvá nebo přepnutí poškodí účet/deník | P1 | `identity/settings.yaml`: celý průchod CZ → EN → CZ jednou zelený; stabilita čeká |
| Export účtu | Neověřený kontakt odmítnut, ověřený dostane lokální export | Export cizích dat nebo odeslání neověřenému účtu | P1 | `identity/registration.yaml`: obsah skutečné přílohy a oprávnění; celý průchod zatím neprošel |
| Kamera a galerie denied | Odmítnutí/cancel, návrat do formuláře | Odmítnutí oprávnění zablokuje další práci | P1 | `identity/media-denied.yaml`: celý průchod jednou zelený, denied kamera a zrušený skutečný picker; places čeká. Simulátor neověří fyzickou kameru |
| Odznaky | Seed známého odemčeného a zamčeného odznaku, restart | Profil renderuje jiný stav než server | P2 | `identity/badges-information.yaml`: jednou zelený, stabilita čeká |
| Oslava | Příchod k vybrané hospodě a návrat | Jiná hospoda, ztracený výběr nebo automaticky přidané pivo | P2 | P2, zatím nepokryto; přednost mají nedokončené P0/P1 |
| About/privacy | Obě navigační cesty, obsah a offline návrat | Prázdná obrazovka, nekonečné načítání, rozbitá navigace | P2 | `identity/badges-information.yaml`: skutečné lokální novinky, offline text o GPS a návrat jednou zelené |
| Příspěvky | Hodiny a pivo měněné offline, restart, doručit obě části | Druhý zápis přepíše první část fronty, opakované XP | P1 | `places-social/contributions-offline.yaml`: hodiny i pivo ve stejné frontě; opraven vstup do editoru, runtime čeká |
| Starý společný stůl | Legacy party-live link a návrat do Party | Prázdný legacy route nebo oživení odstraněného flow | P2 | P2, zatím nepokryto; legacy route není současný společný stůl |

## Prostředí a měření

- Framework: výchozí Maestro `2.11.0`; původní spike `e2e 0.16.0` / `@e2e-dev/mobile 0.9.1`. Stabilní verze byly ověřené před instalací.
- Model původního spike: ChatGPT předplatné přes `chatgpt('gpt-6.1-sol')`; přihlášení je mimo repo.
- iOS: pouze explicitně vytvořený iPhone 17, vlastní Metro/API/SQLite na každý slot; maximálně tři sloty.
- E-mail: skutečně vykreslená zpráva v lokálním paměťovém backendu. Žádný testovací login ani změna API kontraktu.
- Backendové externí sockety jsou blokované; klíče a produkční `.env` se nenačítají. Mapový klíč je neplatná fixture. iOS 26.5 nepodporuje notifications přes simctl privacy; případný dialog test odmítá a lokální adaptér zabraňuje registraci skutečného push tokenu.
- Naměřený studený běh: zatím neproběhl.
- Cache celé sady: Maestro replay cache nemá. Při integraci se změří první a opakovaný celý příkaz; původní TesterArmy replay spike je doložen níže.
- Souběh dvou běhů: ověřený zeleným spike ve slotech 1 a 2, vlastní simulátory, API/Metro porty a odlišné účty v oddělených DB. V každé DB právě jedno pivo. Po skončení všechny čtyři porty volné.
- Android: dostupnost zatím nezjištěna, spustit až po zelené iOS sadě.
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

Aktuálně je připraveno 33 Maestro průchodů: 1 spike, 12 identity, 5 diary a 15 places/social. Tento počet není počet třikrát ověřených testů.

Infrastrukturní fault check `4db92e24` simuloval pokles volného místa během skutečné přípravy simulátoru a samostatně chybu ENOSPC při zápisu závěrečných metrik. Skutečný disk se neplnil. Runner skončil očekávaným kódem 75; všechny tři vlastní porty byly volné, zaznamenané procesy skončily, simulátor byl Shutdown a slot/boot locky i raw debug byly odstraněné. Jde o ověření úklidu, nikoli o aplikační průchod.

### Omezení nativního veřejného sdílení tour

Běh `1ee2a0ca` doložil, že Maestro na iOS 26.5 najde nativní `Copy`, klepnutí zavře share sheet a appka znovu ukáže detail veřejné tour. `simctl pbpaste` přesto dalších 15 s vracel předchozí soukromý odkaz. Veřejná publikace v DB existovala. Stejný krok předtím jednou uspěl, takže další čekání není stabilní kontrola. Není prokázáno, zda je příčina v nativním kopírování nebo ve čtení schránky simulátoru; nejde o potvrzený produktový bug.

Běžný test dál kopíruje a přijímá soukromý odkaz přes UI. Veřejnou tour vytvoří přes UI, najde ji skutečným anonymním katalogovým API a zkontroluje identitu, dvě zastávky, odlišný veřejný odkaz a následné 404 po odvolání. Nativní veřejné Copy zůstává neověřené. Tato změna neprokazuje jeho opravu.
