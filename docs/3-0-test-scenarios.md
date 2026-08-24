# Na pivo 3.0 — testovací scénáře

## Release QA — 23. srpna 2026

Aktuální větev už nepoužívá jen mocky. Mobilní klient, lokální backend, offline
fronty i sdílený večer jsou propojené a prošly reálným průchodem na iOS a Androidu.

- `npm run typecheck`, `npm test -- --runInBand` a `npm run lint` prošly.
- `uv run pytest`, Ruff, kontrola migrací a Django deploy check prošly.
- Čistý iOS build včetně widgetu i Android release build prošly.
- Android push notifikace prošly v popředí, na pozadí, po studeném startu i po klepnutí.
- Studený start Android release buildu bez sítě skončil v použitelné offline appce, ne na černé obrazovce.
- Offline zápis piva se po návratu sítě odeslal právě jednou.
- Export účtu otevřel systémové sdílení a lokální smazání účtu odstranilo soukromá data.
- Sdílený večer `YHNGRK` vznikl na iOS, Android se připojil deep linkem, oba účastníci zapsali pivo a host večer zveřejnil.
- Android po studeném deep linku zobrazil jedinou hospodu, dva účastníky a dvě piva bez chyby navigace.
- Všech devět her proběhlo na dvou klientech; ovládání i hlavička byly zkontrolované na obou platformách.
- PostgreSQL 17 prošel migrací ze starého schématu i z čisté databáze a reálným create/join/start party flow.

Před vydáním zbývají kroky mimo repozitář: produkční `api-*` deploy, lidský EAS build,
kontrola textů a screenshotů ve storech a odeslání buildu do review. OTA ani produkční
deploy nejsou součástí tohoto průchodu.

## Původní UX checklist

Následuje původní ruční checklist mocků. Položky označené `❌ Bug` jsou historické
nálezy z návrhové fáze, ne aktuální seznam release blockerů.

**Původní omezení mocků:**

- Kompas se v simulátoru **netočí** — simulátor nemá magnetometr. Na zařízení se točí.
- Avatary (`pravatar.cc`) a fotky (`picsum.photos`) jsou placeholdery a **potřebují síť**.
- Nativní segmented control má **systémově šedý** indikátor. Apple ho přes SwiftUI nevystavuje (§18.1).
- Koláčový graf a liquid glass potřebují **iOS 17+ / iOS 26+**. Pod tím se přepínač schová a sklo je plná plocha.
- Mockovaný večer má **hodiny na počítadle minut**, ne reálné. Čas se hne, jen když něco uděláš.

---

## 1. Party hub — celý večer (hlavní scénář)

Tohle je jediný scénář, který drží celou smyčku *večer → výstupy → post*. Projdi ho vcelku.

### 1.1 Před prvním pivem

1. Ťukni na **Party** ve středu tabbaru.
   - ✅ Otevře se **zdola** jako fullscreen modal, tabbar zmizí.
   - ✅ Nahoře je **hospoda + `180 m · otevřeno do 23:00 · Flekovský ležák 13°`**.
   - ✅ **Žádná čtyři čísla** — před prvním pivem tam nuly nepatří.
   - ✅ U názvu hospody **není zelená tečka** (nic neběží).
   - ❌ Bug: prázdné místo mezi mapou a obsahem.
2. Ťukni na název hospody.
   - ✅ Vyjede **seznam** hospod se vzdáleností, otevírací dobou a pivem, ne holé menu.
   - ✅ Aktuální má fajfku.
3. Vyber jinou hospodu → zavře se, název i meta řádek se změní.
4. Ťukni na **Začni**.

### 1.2 Během večera

5. ✅ Mapa se **smrskne na pruh**, obsah dostane obrazovku.
6. ✅ Objeví se **čtyři čísla** — hodnota nahoře, jednotka pod ní.
7. ✅ Hlavička drží **hospodu + tváře u stolu**, poslední tvář je „+".
8. ✅ Vpravo nahoře **Ukončit**, co nejdál od „+1 pivo".
9. Ťukni **+1 pivo** čtyřikrát.
   - ✅ Roste „Tvoje" i „U stolu", čas jde nahoru.
   - ✅ Pod tlačítkem je chip s názvem piva; po druhém druhu se změní na `2 druhy`.
10. Ťukni na ten chip.
    - ✅ Sheet **Co piješ** — řádek na druh, counter `− N +`.
    - ✅ Zbytek výčepu jako chipy vedle, plus **Jiné pivo**.
11. **Jiné pivo** → napiš „Kozel 10°" → Zapsat.
    - ✅ Přibyde jako nový řádek s počtem 1.
12. Ubírej `−` na jednom druhu až na nulu → řádek zmizí.

### 1.3 Statistiky

13. Tab **Statistiky**.
    - ✅ Jeden řádek: **chip vlevo** (V čase / Podle piva / U stolu), **dvě ikony vpravo** (sloupce / koláč).
    - ✅ Graf je nativní — sloupce mají mřížku, koláč legendu.
14. Přepni **V čase**.
    - ✅ Jsou tam **i hodiny bez piva**, ne jen ty, ve kterých se pilo.
15. Přepni na **koláč** → jednotlivé výseče mají různé odstíny, ne jednu jantarovou.
16. Přepni **Podle piva** a **U stolu** → graf se překreslí, typ zůstane.
17. Ťukni na řádek čísel nahoře.
    - ✅ Fullscreen s obřími číslicemi a **stavovou větou** („Zrychlilo se to" apod.).
    - ✅ Křížek zavře.

### 1.4 Hry

18. Ťukni **Hry**.
    - ✅ **Mřížka** dlaždic, ne seznam.
19. Vyber **Pub kvíz**.
    - ✅ Sheet se zavře, přepne se na **Log**, hra je na stole s časem a „ťukni a hraj".
    - ✅ Otevři Hry znovu → Pub kvíz má **fajfku** a nejde přidat dvakrát.
20. Ťukni na hru v Logu.
    - ✅ **Fullscreen**, nahoře zůstává **tvůj počet piv a `+1`**.
21. Ťukni na jména, ať mají body. Ťukni **`+1`** v horní liště.
    - ✅ Počet naskočí, aniž bys opustil hru.
22. **Konec — vyhrává X**.
    - ✅ Zpátky v hubu, karta hry teď nese **žebříček**.

### 1.5 Ostatní akce

23. **Foto** → počet u popisku roste, v Logu přibývá řádek.
24. **Pozvat** → QR (opravdový, ne kreslený), kód, deeplink, kamarádi. Přizvi Kláru.
    - ✅ Přibyde mezi tváře v hlavičce i do Logu.
25. Tab **Log** → chronologie odspodu, hry **nad** ní.

### 1.6 Minimalizace a konec

26. Šipka dolů vlevo nahoře.
    - ✅ Nad tabbarem **hnědá skleněná lišta** s hospodou, počtem a `+1`.
    - ❌ Bug: lišta nebo tabbar vypadají jako plný hnědý pás — sklo pod sebou nemá obsah.
27. Ťukni `+1` přímo na liště → počet naskočí bez otevření hubu.
28. Ťukni na lištu → hub se otevře zpátky.
29. **Ukončit** → finish screen.
    - ✅ Čísla večera, **Roast toggle zapnutý**, pod ním vygenerovaná věta a její důvod.
    - ✅ Vypni toggle → objeví se pole **Jak to nazveme**; zapni → pole zmizí.
    - ✅ Dole je náhled popisku, který se opravdu zveřejní.
30. **Zveřejnit** → recap večera, lišta i běžící stav zmizí.

---

## 2. Hospody

31. Tab **Hospody**.
    - ✅ Mapa přes celou obrazovku, sheet **přes celou šířku** (ne odsazený od krajů).
32. Táhni sheet nahoru a dolů — tři polohy, v peeku jeden řádek.
33. Chip **Nejbližší**.
    - ✅ Menu vyjede **z chipu**, ne zespodu obrazovky, s fajfkou u aktuální volby.
    - ❌ Bug: chip je holý text s šipkou vlevo a bez kapsle.
34. Vyber **Náhodně v okolí**.
    - ✅ Seznam se zamíchá, **kompasová buňka nahoře ukazuje první hospodu z toho pořadí**, odznak se změní na „Náhodná".
    - ✅ Vyber to znovu → zamíchá se jinak.
    - ✅ Scrolluj — pořadí se **nepřehazuje**.
35. **Nejlépe hodnocené** → seřazeno podle hvězdiček, odznak „Nejlíp hodnocená".
36. Ťukni na kompasovou buňku.
    - ✅ Otevře **detail hospody přímo v kartě**, sheet se zvedne.
    - ✅ Vlevo nahoře křížek, **žádná druhá mapa** uvnitř detailu.
37. Křížek → zpátky na seznam se zachovaným řazením.
38. Ťukni na řádek hospody i na špendlík na mapě — obojí otevře detail v kartě.
39. V detailu: **Statistiky / Aktivita**.
    - ✅ Buttony **Navigovat / Začít tu večer** jsou podlouhlé, netáhnou se přes celou šířku.
    - ✅ „Na čepu" je oddělené **tmavým pásem**.
40. Šipka vpravo nahoře nad sheetem (lokace).
    - ✅ **Mapa se přesune**, neotevře se jiná obrazovka.
    - ✅ Ikona má při stisku jelly deformaci (iOS 26).
41. Vyhledávací pole v sheetu → otevře **fullscreen search**, nepíše se do něj na místě.

---

## 3. Kocoviny (feed)

42. Tab **Kocoviny**.
    - ✅ Velký nadpis, který se při scrollu smrskne do lišty; **lupa vpravo nahoře**.
    - ✅ **Nad prvním postem není tmavý pás**, jen vzduch. Mezi dalšími pás je.
43. První post.
    - ✅ Hlavička je **parta** (tváře + jména), ne jeden autor.
    - ✅ **Žádná pilulka „TEĎ"** vpravo.
    - ✅ Titulek je roast, pod ním jednořádkové odůvodnění.
    - ✅ Čísla mají **popisek pod sebou**, ne nad.
44. Hero pod čísly.
    - ✅ **Vodorovný pás dlaždic**, další vždy zpola kouká.
    - ✅ Táhni do strany — projedeš mapu, fotky, tabulku hry.
    - ❌ Bug: tah do strany otevře detail postu.
45. Patička.
    - ✅ Cheers jsou **dva ťuknuté půllitry**, čitelné, ne šmouha.
    - ✅ Vedle počet a komentáře.
46. Ťukni na post → detail večera.
    - ✅ Nahoře **ta samá hlavička s fotkami** jako v postu.
    - ✅ „6h 42m" **není oseknuté** na „6h 4…".
    - ✅ „Kdo tam byl" je **pódium + pořadí**, stejné jako v Komunitě.

---

## 4. Komunita

47. Tab **Komunita** → nadpis „Komunita", pod ním **vzduch**, pak taby přes celou šířku.
48. **Žebříčky** jsou první.
    - ✅ Dva chipy s nativním menu, pódium pro první tři.
    - ✅ Skóre má **jednotku** a mění se s chipem (piv / hospod / XP).
49. **Výzvy** → karty, ne řádky. Ťukni na jednu.
    - ✅ Detail: pitch, velké „4 z 10 hospod", track, deadline, odměna.
    - ✅ **Co se počítá** jako věty, **Kdo ještě jede** s postupem.
    - ❌ Bug: 404 nebo prázdná obrazovka.
50. **Akce** → seznam událostí.

---

## 5. Profil

51. Tab **Profil** → **Statistiky** jsou výchozí.
52. Nahoře **čtyři čísla za vybrané okno**, pod nimi graf, **segment až pod grafem**.
53. Přepni **Rok**.
    - ✅ Graf i čísla se změní; poslední sloupec je zvýrazněný.
54. **Podrž prst na sloupci** a táhni po grafu.
    - ✅ Čtyři čísla nahoře se mění na ten měsíc, štítek nad nimi ukazuje který.
    - ✅ Pusť → vrátí se celé okno.
55. **Série**.
    - ✅ Velké číslo, **žádný jantarový kotouč s ikonou**.
    - ✅ Sloupečky po týdnech — výška = počet večerů, mezera = vynechaný týden, pod nimi datum.
56. **Rekordy** — hodnota vpravo jantarově, pod titulkem kdy.
57. **Aktivita** → **ty samé karty jako ve feedu**.

---

## 6. Search

58. Lupa z Kocovin, Komunity i Profilu.
    - ✅ Otevře se **zdola přes celou obrazovku**, s vlastním „Zrušit".
59. Prázdný stav.
    - ✅ **Nedávno** + **Pivaři, co bys mohl znát** s důvodem u každého.
    - ❌ Bug: prázdná obrazovka, ze které se musíš vypsat.
60. Napiš „mat".
    - ✅ Objeví se taby **Hospody / Piva / Pivaři**, filtruje se živě.
61. Napiš nesmysl → **„Nic. Zkus to jinak."**, ne ilustrace.
62. Ťukni na hospodu → otevře detail.

---

## 7. Průřezové věci

Tyhle se testují na **každé** obrazovce, ne zvlášť:

63. **Spodní chrome plave.** Obsah pod tabbarem prosvítá, sklo láme, co je pod ním.
    - ❌ Bug: plný hnědý pás pod lištou nebo kolem ní.
64. **Poslední řádek** každé scrollovatelné obrazovky je nad tabbarem čitelný (řídí `TAB_CHROME`).
65. **Jeden půllitr = jedno pivo, dva = cheers.** Nikde ne naopak, nikde emoji.
66. **Popisek je pod číslem** ve všech statech (feed, hub, recap, profil, detail hospody, finish).
67. **Radiusy** — nic se nikde neořezává do ostrého rohu.
68. Otoč zařízení do **Dynamic Type XL** (Nastavení → Displej → Velikost textu).
    - ✅ Popisky se zalomí, čísla zůstanou čitelná, nic nepřeteče.

---

## 8. Offline

69. Zapni letadlový režim.
    - ✅ Mapy zšednou, avatary a fotky zmizí — **appka nespadne**.
    - ✅ Party hub funguje dál: pivo, hry, log jsou lokální stav.
70. Vypni letadlový režim → obrázky se dotáhnou.

---

## Co tenhle průchod netestuje

- Původní body výše vznikly nad designovými mocky. Aktuální backend, sync, fronty a party flow pokrývá release QA v úvodu dokumentu.
- **Roast z AI.** Věta je pravidlová (`src/feed/roast.ts`, 8 testů), ne z modelu.
- Fyzický Android telefon a fyzický iPhone. Průchod proběhl v čistých simulátorech; senzory a výkon na reálném hardwaru zůstávají součástí předstore smoke testu.
