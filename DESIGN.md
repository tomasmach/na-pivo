# Na pivo — DESIGN

Jeden dokument pro celý design Na pivo: **co produkt je** (Část I), **podle
jakých pravidel se kreslí a staví** (Část II) a **co je rozpracované nebo
nerozhodnuté** (Část III). Vznikl v srpnu 2026 sloučením `design-system.md`,
`product-spec-3-0.md` a `design-brief-3-0.md`. Jednotlivá rozhodnutí
s odůvodněním jsou v `docs/decisions/`.

> **Tenhle dokument je závazný.** Když stavíš nebo přestavuješ obrazovku,
> hodnoty se neopisují „přibližně“ — kopírují se. Když ti nějaké pravidlo brání,
> řekni to nahlas a navrhni změnu dokumentu; netiš to lokální výjimkou v jednom
> souboru. Rozhodnutí (barvy, pravidla, kde co je) se zapisují sem — rozpor se
> řeší změnou dokumentu, ne výjimkou v kódu.
>
> Kód, tokeny a identifikátory anglicky. UI copy česky, tykáním.
> Viz `src/i18n/cs.ts`.

**Etalon:** mockový jazyk 3.0 (rozhodnuto 11. 8. 2026 — mocky jsou kánon).
Soubory: `src/mocks/mockTheme.ts` (jediný zdroj `MockType` / `MockColors` /
`MockLayout`), `src/party/LivePartyMockScreen.tsx`, `src/pubs/PubListMockScreen.tsx`,
`src/pubs/PlacesSheet.tsx`, `src/mocks/StatGrid.tsx`, `src/mocks/SectionBreak.tsx`,
`src/mocks/Leaderboard.tsx`, `src/mocks/LivePartyBar.tsx`,
`src/components/shared/TabBar.tsx`, `src/profile/ProfileMockScreen.tsx`,
`src/feed/FeedScreen.tsx`.

Starý etalon 2.x (`src/counter/*`, `CardSurface`, `DoorRail`) zůstává v kódu,
dokud ho 3.0 obrazovky nenahradí, ale **nové UI se z něj nekopíruje**. Konkrétně
`amberGlow*` a `CardSheen` do nového UI nepatří vůbec.

Tři pravidla, která rozhodují o všem ostatním:

- **Zákon zjednodušení** (§0) je nadřazený zbytku. Když je něco v rozporu, mění
  se dokument, ne se dělá lokální výjimka.
- **Jedna svítící věc na obrazovce** (§6.1). Jantar je akcent, ne barva pozadí.
- **Pohyb kopíruje prst, ne sám sebe** (§10). Nekonečné smyčky, dýchající prvky
  a ambientní animace jsou zakázané; povolené jsou jen stavové výjimky z §10.

Podklad je stout (tmavě hnědá), akcent jantar. Světlý režim je **vědomě
odložený** — zdvojil by práci na každé obrazovce.

---

# ČÁST I — Produkt 3.0

Stav k 7. 8. 2026.

## Co se mění

2.x byl **pivní deníček s kompasem**. 3.0 je **companion celého večera**:

```
PŘED          BĚHEM                     PO
kam jít   →   večer u stolu s lidmi  →  recap a příspěvek
kompas        piva, hry, fotky          statistiky, rekordy, feed
```

Kompas nezmizel — je první buňkou seznamu hospod a pořád je to nejrozpoznatelnější
věc produktu. Přestal ale být celou appkou.

## Navigace

Pět tabů, Party uprostřed:

| tab | co tam je |
|---|---|
| **Kocoviny** | Parta: automatická historie večerů; Svět: veřejně zveřejněné večery |
| **Hospody** | kompas v hlavě seznamu, hledání, filtry, detail hospody |
| **Party** | běžící večer: piva, lidi, hry, fotky, vlákno |
| **Komunita** | žebříčky, výzvy, akce |
| **Profil** | statistiky, rekordy, aktivita, účet a nastavení |

Pravidla tab baru, rout a deep-linků: §17.

## Večer — jádro produktu

### Jeden zápis, dva čtenáři

**Nejdůležitější pravidlo celé 3.0.** Pivo se zapisuje **jednou**, do deníčku
(`DrinkLog`), tam kde vždycky. Když u toho běží sdílený večer, řádek se jen
**označí** jeho kódem. Sdílený stůl je čtenář těch řádků, ne druhé místo zápisu.

Předchozí party se v červenci 2026 mazala právě proto, že chtěla každé pivo
podruhé. Detail v `docs/decisions/one-write-two-readers.md`.

Důsledek: „+1 pivo“ v hubu, v minimalizované liště i během hry je **to samé +1**
jako v počítadle — stejný store, stejná offline fronta, stejný řádek.

### Sdílený stůl

Jeden člověk večer založí a přečte přes stůl **šestimístný kód**; ostatní
přisednou. Kód nemá O, I, L, S, Z ani 0, 1, 5 — znaky, které si hospoda mezi
sebou plete. Od té chvíle na kódu visí všechno sdílené: členové, hry, kvíz.

- Přisednutí je souhlas se sdílením. Kdo má vypnuté „kamarádi vidí můj
  automatický pivní feed“, tomu se pivo k večeru **nenaváže** — zapíše se do
  deníčku a v cizí časové ose se neobjeví.
- Odejít ≠ ukončit. Stůl hraje dál, jen ten telefon je venku.
- Neúspěšné načtení večera **nezavře stůl**. Projít sklepem není odchod.

### Večer jako data

Jeden tvar (`NightRecord`), ze kterého čte hub, recap i příspěvek. Všechna čísla
jsou **čisté funkce** nad ním — nic se neukládá ani neinkrementuje, takže když se
pivo vezme zpátky, změní se všude.

Pravidla, která jsou produktová, ne matematická:

1. **Pivo je pivo.** Nealko, panák a víno se počítají, ale nikdy jako piva.
2. **Remíza je remíza.** MVP je `null`, když se o špičku dělí dva.
3. **Prázdná hodina dostane sloupec.** Jinak se večer nakreslí klidnější, než byl.
4. **Vyrovnat rekord není překonat rekord.**
5. Ceny, útrata, promile a čas do řízení se v datech večera **neobjevují nikdy**
   (`docs/decisions/no-bac-or-driving-estimates.md`).

Zdroje jsou řádky, které už existují: `DrinkLog`, `PartyEveningMember`,
`PubVisit`, `PartyGame`, `BeerPhoto`. Pro party se neukládá nic nového.

### Vlákno

Log večera je **odvozený**, ne ukládaný: pivo, fotka, hra, přisednutí, přesun —
seřazené v čase a podepsané. U stolu pro čtyři je nepodepsaný řádek appka, která
mluví sama se sebou. Když se pivo vezme zpátky, zmizí i z vlákna.

## Hry

Devět her v katalogu. Hra je **obsah plus skořápka**, ne vlastní obrazovka —
desátá hra má být řádek v `gameCatalog.ts`, ne nová složka.

| hra | jak se hraje | skóre |
|---|---|---|
| Pub kvíz | každý na svém telefonu | body |
| Kostky | 3D, fyzika, telefon koluje | body → kdo platí |
| Kdo platí rundu | 3D kolo se jmény | doušky |
| Flaška | 3D láhev | doušky |
| Nikdy jsem…, Kategorie, Palec, Pravidlo večera | balíček karet | doušky |
| King's Cup | tažení karty | doušky |

### Platforma a hra

Fyzické hry běží v **WebView** (three.js + cannon-es), textové v React Native.
Mezi nimi je pevný protokol (`src/games/protocol.ts`) a tři pravidla:

1. Plátno smí **zdobit, ne vyprávět** — narativní text je vždycky nativní. Krátký label
   namalovaný na fyzické rekvizitě (jméno na výseči kola) je součást rekvizity a smí dovnitř.
2. **Hra je zdroj náhody.**
3. **Hra s definovaným koncem končí tím, že to řekne** — `result`, ne domněnka platformy.
   Nekonečná rekvizita (Flaška) konec nemá a emituje opakované eventy (`picked`).

Konec kreslí platforma (`GameResult`) a **tvar se odvozuje z dat**, ne z příznaku:
je tam `payingId` → někdo platí; je tam `winnerId` → někdo vyhrál; víc skóre →
žebříček. Hra na pití nikdy nekorunuje vítěze — jediná tabulka, kterou by mohla
vyrobit, je kdo nejvíc pil.

Stavební pravidla her (skořápky, WebView, protokol, konec hry): §21.

### Sdílení

Hra položená na stůl je řádek `PartyGame`, všechno v ní je **append-only
událost**. Každý telefon skládá stejný seznam do stejného obrazu — žádný merge,
žádný last-writer-wins. Dva lidi, kteří odpoví ve stejnou vteřinu, oba dorazí.

Kvíz: odpovědi jdou frontou ven a streamem dovnitř. **Odpověď týmu je ta první**,
takže tvoje vlastní odpověď vrácená serverem složí na stejný výsledek jako
lokální kopie — idempotence padá z pravidel hry, ne z infrastruktury. Kvíz je
**samospádem**: každý telefon má svůj index otázky a odhalení je po otázce,
jakmile odpověděly všechny týmy.

## Po večeru

**Recap** — velká čísla, kdo tam byl a co vypil, štace, tempo po hodinách, hry,
a „Padlo tenhle večer“ jen tehdy, když opravdu něco padlo. Rekordy se měří proti
**tvé vlastní** historii, nikdy proti ostatním; pijácký den (04:00) je jeden
večer, i když jsi prošel tři hospody.

**Příspěvek** jde na `POST /v1/nights` — endpoint, který už má feed, reakce i
offline frontu. Klíčem je **pijácký den**, takže večer publikovaný z hubu a ten
samý z Výčepu je jeden příspěvek, který se aktualizuje. Ven jdou počty a jména
hospod. **Nikdy ceny, souřadnice telefonu ani konkrétní piva.**

## Provozní pravidla

- **Offline first.** Počítadlo, vlákno a hry fungují bez signálu; sdílení je
  best-effort navrch. Kód, který se nepodařilo doručit, nikdy nesmí zablokovat
  zápis piva.
- **Fronty jsou idempotentní** přes `client_id`. Retry nezdvojí nic.
- **API zůstává kompatibilní** s vydanými appkami — nová pole jen aditivně.
- **SSE má strop 10 minut** a pak řekne klientovi, ať se vrátí. Klient umí spadnout
  na polling, takže rollback backendu appku nerozbije.

## Stav (k 7. 8. 2026)

| oblast | stav |
|---|---|
| Navigace, pět tabů | hotové |
| Večer: založit, přisednout, odejít, ukončit | hotové |
| Piva jedním zápisem, s kódem večera | hotové |
| `NightRecord` + statistiky + vlákno | hotové |
| Devět her | hratelné |
| Sdílené hry (řádek, události, výsledek) | hotové, klient i backend |
| Kvíz na víc telefonů | hotové |
| Recap na reálných datech | hotové včetně fotek, historie a offline cache |
| Příspěvek na `/v1/nights` | hotové včetně detailu, komentářů a reakcí |
| Fotky večera | hotové — picker, upload, offline fronta i pozdější napojení na příspěvek |
| Cizí příspěvky ve feedu | hotové — serverový feed, stránkování, detail, komentáře a reakce |
| Týmy pro komunitní eventy | hotové, klient i backend |
| Skeleton loadingy | hotové pro serverové obrazovky 3.0 |
| Placeholder fotky (`pravatar`, `picsum`) | odstraněné z runtime kódu |
| **ASGI/SSE na produkci** | zacommitované, **nenasazené** |

---

# ČÁST II — Design systém (závazný)

## 0. Zákon zjednodušení (nadřazený všemu ostatnímu)

**Hlavní cíl přestavby není přemalovat appku, ale zjednodušit ji.** Když je spor mezi „vypadá to
podle etalonu“ a „je toho na obrazovce míň“, vyhrává „je toho míň“.

Zjednodušení znamená **prázdnější plochu, ne chudší produkt**. Tácek je důkaz: nepřišel o jedinou
funkci, jen přestal ukazovat všechno naráz. Postup je vždycky stejný:

1. **Jedna primární akce.** Na obrazovce právě jedna věc, která svítí. Zbytek ztiš nebo přesuň.
2. **Tři bloky nad ohybem, víc ne.** Co se nevejde, patří níž, do sheetu nebo o obrazovku dál.
3. **Jedna cesta k jedné věci.** Tři způsoby, jak udělat totéž, byly hlavní problém starého
   počítadla. Když najdeš duplicitní cestu, **zruš ji** — nezachovávej ji „pro jistotu“.
4. **Okrajové akce do jednoho `…` sheetu.** Ne do headeru, ne do karty, ne do plovoucí pilulky.
   **Rovnocenný povrch ale okrajová akce není.** Mapa je dvojče kompasu, ne položka menu — proto
   sedí v headeru jako polovina titulku (`ExploreSwitch`, `variant="flat"`) a v `…` sheetu už
   není. Když povrch pustíš do headeru, **musíš** jeho řádek ze sheetu smazat (§14.4).
5. **Zruš dekoraci, která nic neříká.** Rozmazané záře na pozadí, jantarové kickery nad každou
   sekcí, rámečky kolem rámečků, emoji v chromu, ikona u každého řádku.
6. **Slučuj sekce.** Dvě sekce, které uživatel čte jako jednu věc, mají být jeden blok.

### Co „nesmí zmizet ani jedna funkce“ znamená

Funkce se **nesmí ztratit**, ale skoro jistě se **má přestěhovat**. Povolené přesuny:

| Z | Do |
|---|---|
| trvale viditelná sekundární akce | `…` sheet |
| tři chipy vedle sebe | jeden sheet s jedním záměrem |
| dvě sekce se stejným nadpisem | jeden blok |
| pole formuláře uprostřed scrollu | sheet, který ho vlastní |
| údaj, který nikdo nečte | pryč z povrchu, zůstává v detailu |

Zakázané je jen jedno: **funkci potichu smazat**. Každý přesun musí být v závěrečném reportu
vypsaný jako „odkud → kam“.

---

## 1. Filosofie

Vizuální jazyk Na pivo je **tácek pod pivem v tmavé hospodě**. Pozadí je stout — skoro černá s teplým
hnědým podtónem — a všechno, co na něm leží, je papírově světlé nebo jantarové. Na obrazovce je vždycky
**jedno velké číslo nebo jedna velká věc, jedna jantarová akce a nic dalšího, co svítí**.

Obsah **leží přímo na ploše obrazovky** — řádky oddělené hairlinem, sekce oddělené tmavým pásem
(`SectionBreak`), ne karta v kartě. Karta je výjimka pro věci, které opravdu plavou nad obsahem
(§5). Osobnost nesou skutečné věci — velká čísla, reálná mapa, nativní grafy, hospodská copy — ne
dekorace, ne animace a rozhodně ne emoji v chromu.

---

## 2. Barvy

### 2.1 Tokeny (`src/theme/colors.ts`)

| Token | Hex | K čemu to je |
|---|---|---|
| `Colors.stout` | `#15120F` | Zem obrazovky **i intent sheetu** (§7). Plochý seznam leží přímo na ní. |
| `Colors.stout2` | `#1C1815` | Karta (výjimka, §5.3) a filtrační chip. O stupeň světlejší než zem. |
| `Colors.stout3` | `#262019` | Tichá sekundární pilulka (§6.2), textové pole (`MockColors.field`), karta rozehrané hry. |
| `Colors.border` | `#3A322A` | Jazyk 2.x. Nové UI odděluje hairliny z pěny (§2.2), ne plným okrajem. |
| `Colors.amber` | `#E8A317` | Akcent. Primární tlačítko, aktivní stav, akcentované akce a ikony. Číslice jsou pěna (§3.2). |
| `Colors.amberLight` | `#F5B642` | Jen uvnitř ilustrací (horní stop gradientu piva). |
| `Colors.glow` | `#FF7A1A` | Jazyk 2.x (`amberGlow*`). **V novém UI se nepoužívá vůbec** (§6.1). |
| `Colors.neon` | `#FFD27A` | Rezerva pro zvýrazněné stavy. Na etalonu se nepoužívá. |
| `Colors.foam` | `#FBF3E0` | Primární text a světlé hairliny (s alfou). |
| `Colors.foamMuted` | `#E8DCC0` | Sekundární text, popisek pod číslem, ikona zavírání. |
| `Colors.mutedText` | `#A8896A` | Terciární text, meta řádky, neaktivní stav, „…“ ikona. |
| `Colors.success` | `#7DD66B` | Potvrzení. Používej střídmě; jantar většinou stačí. |
| `Colors.open` | `#F0BE5C` | Otevřeno (otevírací doba) — text i stavová tečka. |
| `Colors.closed` | `#A8896A` | Zavřeno. Nikdy červená — nemáme na uživatele křičet. |
| `Colors.black` | `#000000` | Jen backdrop (`withAlpha(Colors.black, 0.6)`) a `softDrop()`. |
| `Colors.white` | `#FFFFFF` | Nepoužívat na text. Text je `foam`. |

> **Změna 3.0.** Čtyři stouty byly teplejší hnědé (`#1F1308` / `#2B1A0E` / `#3A2515` /
> `#5A3A20`). Proti referencím — Strava i Packeta sedí na skoro černé — ta hnědá
> nečetla jako hloubka, ale jako tint přes celou appku, a je z velké části důvod,
> proč rané návrhy působily levněji, než byly. **Hnědá z produktu nezmizela**,
> jen se přestěhovala z pozadí do světla: žije v gradientech (§16).
>
> Nikdy ne čistě černá. Na appce s teplým akcentem čte jako díra a OLED smear
> při scrollu stojí víc, než kolik ten tint ušetří.

`withAlpha(hex, alpha)` z `@/theme/colors` přidá alfa kanál k šestimístnému hexu. Alfu píšeme vždycky
přes něj, nikdy ručně `'#FBF3E01A'` a nikdy `opacity` na kontejneru s textem.

**Mimo `colors.ts` žijí tři pojmenované barvy mockového jazyka** (druhou paletu nezavádějí —
`MockColors` je jinak čistý alias na `Colors`):

| Konstanta | Hex | Kde žije | K čemu |
|---|---|---|---|
| `MockColors.live` | `#35D07F` | `src/mocks/mockTheme.ts` | Běžící večer (live stav). Jediná zelená v appce mimo `success`. |
| `BAND_COLOR` | `#0F0A05` | `src/mocks/SectionBreak.tsx` | Pás mezi sekcemi a mezi posty — tmavší než každá zem v appce. |
| `HEADER_GRADIENT` / `LIVE_GRADIENT` | `['#5A3418','#2A1A0C', bg]` / `['#0F4429','#122A1B', bg]` | `src/mocks/mockTheme.ts` | Shader hlavičky; zelená varianta, když běží večer (§16.3). |

### 2.2 Pravidla užití

**Plná jantarová plocha smí být v obsahu obrazovky nejvýš jednou** (čtecí obrazovka nemusí mít CTA). Patří primárnímu tlačítku
(`backgroundColor: Colors.amber`). Druhá plná jantarová plocha v obsahu je bug. **Chrome se počítá
zvlášť:** jantarový disk Party v tab baru (§17.2) a `+1` CTA v live baru (§20.5) jsou trvalé
kotvy chromu a s obsahem nesoupeří — právě proto v obsahu platí pravidlo o to přísněji.

**Jantar jako text/ikona** patří aktivnímu stavu, akcentovaným akcím („Zkusit znovu“, „Obnovit“)
a aktivnímu kusu baseline. Hlavní číslice jsou **pěna**, ne jantar (§3.2). Malé stavové prvky —
`PR` kapsle, jantarový medailonek pod ikonou, podium bloky na alfě — se za „plochu“ nepočítají;
plocha znamená velký plný jantarový panel nebo tlačítko.

**Sekundární akce = tichá `stout3` pilulka, bez okraje** (§6.2). Jantarový 6% outline byl jazyk
2.x a do nového UI nepatří.

**Neutrální chrome (dráhy, hairliny, grabbery) = pěna na 6–26 %:**

| Použití | Hodnota |
|---|---|
| Podklad stale-data baru | `withAlpha(Colors.foam, 0.06)` |
| Dráha segmentu / track grafu | `withAlpha(Colors.foam, 0.07)` |
| Track žebříčku, hairline rekordu | `withAlpha(Colors.foam, 0.08)` |
| Klidná baseline pod podtržítkovými taby | `withAlpha(Colors.foam, 0.09)` |
| **Hairline mezi řádky seznamu — hlavní dělítko** | `withAlpha(Colors.foam, 0.10)` |
| Vodicí linka threadu, okraj `PlacesSheet`, hairline nad fakty | `withAlpha(Colors.foam, 0.12)` |
| Okraj plovoucí pilulky / live baru | `withAlpha(Colors.foam, 0.14)` |
| Grabber sheetu | `withAlpha(Colors.foam, 0.22–0.26)` |
| Placeholder v poli (`fieldHint`) | `withAlpha(Colors.foam, 0.55)` |
| Medailonek pod ikonou / tint skla / podklad varovného pruhu | `withAlpha(Colors.amber, 0.10–0.12)` |
| Okraj aktivního filtračního chipu | `withAlpha(Colors.amber, 0.5)` |
| Aktivní kus baseline (`UnderlineTabs`) | `withAlpha(Colors.amber, 0.85)` |
| Fallback plovoucí pilulky pod sklem | `withAlpha(Colors.stout, 0.92)` / `withAlpha(Colors.stout2, 0.96)` |

**Segmentovaný přepínač je nativní** (§18): SwiftUI `Picker` se `pickerStyle('segmented')`. Ruční
RN fallback (Android) má dráhu `withAlpha(Colors.foam, 0.07)` a **aktivní segment plný
`Colors.amber`** se `stout` labelem — aktivní stav je odpověď, ne odstín pěny.

**Rozpad 60 / 30 / 10.** 60 % plochy je `stout` + `stout2` (pozadí a karta), 30 % je text v odstínech
`foam` / `foamMuted` / `mutedText`, 10 % je jantar. Když se při návrhu dostaneš přes ~10 % jantaru,
něco jsi udělal plochou místo textem.

---

## 3. Typografie

Typografie je **systémové písmo** (San Francisco), všude. `src/theme/fonts.ts`
exportuje `FontScaleCap` a jedinou vlastní rodinu: `Fonts.numeral`.

Váha se píše jako `fontWeight`, nikdy jako název rodiny. Dřív ji nesl název
(`Baloo2-ExtraBold`), takže `fontFamily` a `fontWeight` si na jednom stylu
odporovaly.

**Proč:** 3.0 stojí na skutečných systémových prvcích — segmented picker,
kotvená menu, SwiftUI grafy, nativní velké titulky (§18). Vlastní rodina vedle
nich staví na jednu obrazovku dvě abecedy. SF navíc nese optical sizing a
škáluje s Dynamic Type, což přibalená TTF neumí.

**Jedna výjimka: `Fonts.numeral` — Baloo 2 ExtraBold, jen na display hodnoty** (číslice a krátké
formátované údaje ve statistickém bloku: „2 h 41 m“, „3×“, cena).

SF je záměrně neutrální. To je správně pro řádek v nastavení a špatně pro číslo,
které říká, jak dopadl večer — v SF čtou jako tabulka, v Baloo jako tahle appka.
Ta čísla jsou nejblíž tomu, co má produkt místo tváře.

Platí to **jen pro display hodnoty** (`StatGrid`, hero čísla, série, postup výzvy) a dvě
pojmenované výjimky: wordmark „Na pivo“ v hlavičce feedu a výsledek hry („Platí
Honza“) — věci, které mají znít. Ostatní body text, popisky, nadpisy a tlačítka
zůstávají systémové — dvě abecedy v odstavci je přesně to, co jsme odstranili.

Baloo 2 ExtraBold **přetéká svůj řádkový box**, takže každý styl, který ho
používá, potřebuje `lineHeight` kolem 1,24× velikosti (§3.2). Bez toho se číslo
ořízne shora.

Zbylé TTF zůstávají v `assets/fonts/` nenačtené.

Jednoduché rozhodovací pravidlo: **když to má znít, je to Baloo. Když se to má
číst, je to systémové písmo.**

> **Dluh po přechodu na systémové písmo.** Deset a víc míst kompenzuje metriku
> Baloo 2 — `lineHeight: size * 1.24`, protože ExtraBold přetéká, a odhad šířky
> číslice `0.62 × fontSize` v `CoasterCard`. SF má jinou metriku: řádkové boxy
> jsou teď volnější a odhad šířky konzervativnější, než je potřeba. Nic
> rozbitého, ale při dalším zásahu do těch souborů to přepočítej.

### 3.1 Škála (`MockType`, `src/mocks/mockTheme.ts`)

| Token | Velikost / váha | Tracking | Kde |
|---|---|---|---|
| `MockType.titleXL` | 30 / 700 | **−0.5** | Titulek obrazovky, vlevo nahoře |
| `MockType.titleS` | 18 / 700 | **−0.2** | Nadpis sekce — **sentence case, nikdy verzálky** |
| `MockType.body` | 16 / 500 | — | Titulek řádku |
| `MockType.bodySemibold` | 16 / 600 | — | Název hospody / handle v řádku |
| `MockType.bodySmall` | 14 / 500 | — | Druhá řádka, sekundární text |
| `MockType.label` | 12 / 600 | — | Kapsle, caption |
| `MockType.buttonLabel` | 16 / 700 | — | Label tlačítka |

Displejové stupně nad škálou: hero číslice `34/42` (`StatGrid`), streak `40/50`, handle `24/800`,
recap titulek `32/800`. Rodina je u číslic `Fonts.numeral` (Baloo 2 ExtraBold), jinak systémová.

**Negativní tracking roste s velikostí:** −0.2 u titulků sekcí a zvýrazněných názvů, přes
−0.4/−0.5 u titulků obrazovek, po −0.7 u největších displejových stupňů. Běžný body text jede bez
trackingu. Jediný **pozitivní** tracking mají verzálkové mikro-labely (+0.2 label tab baru a `PR`;
caption typu „ODEHRÁNO“ až +1.2).

**Verzálkové mikro-kickery jsou zakázané.** Nadpis sekce je 18pt bold v sentence case
(`MockType.titleS`), ne 11pt verzálky s prostrkáním — přesně ty dělaly z mocků „starou appku“
(`mockTheme.ts:20–24`). Páté a šesté stupně nezaváděj; když ti škála nestačí, uprav tenhle
dokument.

**Číslo se nezvětšuje podle karty — zmenšuje se podle místa.** Hero číslo je `34/42`
s `adjustsFontSizeToFit` + `minimumFontScale={0.7}`; label vedle něj má `flexShrink: 1` +
`minWidth: 0` a `minimumFontScale={0.75}`. **Shrink, ne truncate** — useknutý label je fail,
zmenšený je v pořádku (`StatGrid.tsx`).

### 3.2 Povinná pravidla pro velká čísla

```tsx
<Text
  style={styles.value}
  numberOfLines={1}
  allowFontScaling={false}
  adjustsFontSizeToFit
  minimumFontScale={0.7}
>
  {count}
</Text>
```

```ts
value: {
  fontFamily: Fonts.numeral,        // Baloo2-ExtraBold, jen displejové číslice
  fontSize: 34,
  lineHeight: 42,                   // ≈ 1.24× — jinak iOS ořízne vršek cifer
  letterSpacing: -0.6,
  color: Colors.foam,               // číslice jsou pěna; jantar je akce a aktivní stav
  includeFontPadding: false,
  fontVariant: ['tabular-nums'],
},
```

- **`lineHeight ≈ fontSize × 1.24` je povinné u displejových stupňů.** Baloo 2 ExtraBold má
  výrazný overshoot horních partií číslic. Když `lineHeight` chybí (RN dopočítá zhruba
  `fontSize`), **iOS svisle ořízne vršek cifer** — u „8“ zmizí horní oblouk. Doložené páry:
  22/27, 19/24, 34/42, 40/50. Menší `Fonts.numeral` použití bez `lineHeight` (wordmark, výsledek
  hry) jsou dluh, ne vzor.
- **`fontVariant: ['tabular-nums']` je povinné** u čehokoliv, co se v čase mění (počty, časy,
  skóre). Bez toho číslo při každé změně poskočí do stran.
- **`allowFontScaling={false}` na číslicích v pevných buňkách** (`StatGrid`, žebříček, tikající
  hodiny) — jsou to sloupce, ne věty; škálování rozbije mřížku. Běžný text má místo toho
  `maxFontSizeMultiplier` (§3.3).
- **`includeFontPadding: false`** dávej **na každý `<Text>`** s vlastním `fontFamily`. Android jinak
  přidává neviditelné odsazení a rozbíjí svislé zarovnání proti ikonám.

### 3.3 Dynamic Type

**Každý `<Text>` má buď `maxFontSizeMultiplier`, nebo — u číslic v pevných buňkách —
`allowFontScaling={false}` (§3.2).** Nikdy obojí a nikdy nic. Bez stropu Samsung škáluje až ~2.0×
a rozbije kompozici. Používej `FontScaleCap` z `@/theme/fonts`:

| Cap | Hodnota | Pro co |
|---|---|---|
| `FontScaleCap.display` | `1.1` | Velká čísla, label primárního tlačítka, badge s počtem |
| `FontScaleCap.heading` | `1.2` | Titulky sheetů, název místa, labely pilulek |
| `FontScaleCap.body` | `1.3` | Běžný text, meta řádky, popisky |

Když se label i tak nevejde, přidej `adjustsFontSizeToFit` + `minimumFontScale={0.8}` (viz label CTA).
Nikdy ne `numberOfLines` bez `flexShrink: 1` na rodiči — jinak text netruncuje, ale vytlačí sourozence.

---

## 4. Mezery a grid

Pojmenovaná spacing škála (`src/theme/layout.ts`): `Spacing.xs 4`, `sm 8`, `md 14`, `lg 20`,
`xl 28`, `xxl 40`, plus `MockLayout.screenPad 20`, `controlGap 24`, `sectionGap 32`. Layout se
skládá z tokenů; malé optické hodnoty uvnitř komponenty (2, 6, 10…) jsou v pořádku, ale nový
layoutový odstup si nevymýšlej — vezmi token.

Konkrétní hodnoty z etalonu:

```ts
// jedna šířka skrz celou app — obrazovky i sheety (§20.1)
screen: { paddingHorizontal: MockLayout.screenPad },   // 20
// horní okap obrazovky: paddingTop: insets.top — bez přídavku
// detail s vlastním headerem: paddingTop: insets.top + 52
```

- **Boční okap: `MockLayout.screenPad` (20), všude.** Obrazovka, sheet i detail. Soukromých 16
  nebo 24 „protože je to sheet“ neexistuje.
- **Nad headerem nic navíc: `paddingTop: insets.top`.** Status bar je na telefonu s ostrovem sám o
  sobě ~60 pt hnědého čela; každý přidaný bod se pak čte jako prázdné čelo, ne jako vzduch.
- **Spodní okap scrollovatelné obrazovky s tab barem: `paddingBottom: insets.bottom + TAB_CHROME`**
  (`TAB_CHROME = 132`, `src/components/shared/TabBar.tsx`). Bar je absolutně pozicovaný a scénu
  neinsetuje, takže rezervu si přidává každá obrazovka sama — a rezervuje se vždycky vyšší hodnota
  (bar + safe area + live pilulka), protože obsah, který se vejde jen když nikdo nepije, není
  layout, ale náhoda. Obrazovky bez tab baru: `paddingBottom: Math.max(insets.bottom, Spacing.sm)`.
- **Nadpis → jeho obsah: `MockLayout.controlGap` (24).** Sekce → sekce: `MockLayout.sectionGap`
  (32), nebo `SectionBreak` (§5.2).

**Relationship-based spacing.** Vzdálenost = vztah. Věci, které patří k sobě, mají 2–8 (hodnota
a její popisek: 2, `StatGrid`; ikona a text: 6–8). Věci ve stejné skupině 12–14. Různé bloky 20–24.
Nikdy nedávej stejnou mezeru mezi „ikona ↔ její label“ a „blok ↔ blok“ — kompozice se pak čte jako
seznam náhodných prvků.

### 4.1 Hustota: co dělá „lacině“ (3.0)

Tři věci, které se opakovaně vracely a pokaždé to vypadalo levněji, než produkt
je. Všechny jsou rozměrové, takže nejsou věc vkusu.

| Prvek | Minimum | Proč |
|---|---|---|
| Řádek seznamu | **60 pt**, u dvouřádkového **68** | 44 je minimum pro *dotyk*, ne pro čtení. Seznam natěsnaný na dotykové minimum čte jako tabulka. |
| Vnitřní okraj sheetu | `MockLayout.screenPad` (20) | Sheet je obrazovka, ne popup. Menší okraj tlačí obsah na sklo. |
| Nadpis → jeho obsah | `MockLayout.controlGap` (24) | Nadpis nalepený na první řádek se čte jako jeho součást. |
| Sekce → sekce | `SectionBreak` | Mezera sama nestačí — 10pt tmavý pás (§5.2). |

**Pravidlo:** když se ptáš, jestli je něčeho moc, je ho málo. Tenhle produkt se
používá v hospodě, jednou rukou, v šeru — vzduch není luxus, je to čitelnost.

A dvě věci, které se pojí s tím samým dojmem:

- **Zavírací křížek** je `CloseButton`, 44 pt, na skle (§7.2c). 32pt ploška je
  pod dotykovým minimem a na skleněném povrchu čte jako díra.
- **Ovládací prvky mají být systémové**, kde existují (§18). Ruční nápodoba
  nativního prvku je nejlevněji vypadající věc, kterou lze na iOS udělat.

---

## 5. Plocha, řádky a karty

**Default je plochý seznam přímo na zemi obrazovky. Karta je výjimka.** Obalit každý řádek
vlastním ohraničeným obdélníkem znamená obdélník v obdélníku v sheetu — tři rámy hluboko, a přesně
to zabíjí §14.10 (`PubListMockScreen.tsx:906–910`).

### 5.1 Kanonický řádek

```ts
row: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: Spacing.sm,                        // 8
  paddingVertical: Spacing.sm + 2,        // 10
  borderTopWidth: StyleSheet.hairlineWidth,
  borderTopColor: withAlpha(Colors.foam, 0.1),
},
rowFirst: { borderTopWidth: 0 },
```

- Řádek leží na `Colors.stout`, drží ho jen hairline **nahoře** a vlastní vertikální padding.
  Žádný podklad, žádný okraj, žádný radius.
- **`first` prop je povinný mechanismus:** první řádek nemá horní hairline, protože hairline pod
  plnou plochou čte jako podtržítko, ne jako oddělovač. Stejný vzor drží `PubListMockScreen`,
  `CommunityMockScreen` i `FeedScreen`.
- Výšky: `MockLayout.rowHeight` (68) pro dvouřádkový řádek s ovládacím prvkem, 64 pro thread,
  56 pro žebříček a recap. Vzdálenostní dlaždice 56 v seznamu hospod, jinak
  `MockLayout.thumb` (48).
- Hierarchie v řádku hospody (`PubListMockScreen`): **vzdálenost v 56bodové dlaždici → název +
  hodnocení + srdce → adresa → otevírací doba barvou (`Colors.open` / `Colors.closed`, bez
  tečky) → pivo.** Vzdálenost se nikdy neořezává první; bez dostupné polohy ji nahradí ikona.
- Post ve feedu není karta, je to **pás**: `borderTopWidth: 10`, `borderTopColor: '#0F0A05'` —
  stejná myšlenka jako `SectionBreak` (tmavý pás místo dělítka), zapečená do řádku. Feed dnes
  přetéká jen o `-Spacing.md` (−14) místo plných −20; sjednocení na screen padding je dluh
  (Část III).

### 5.2 SectionBreak

Sekce se neoddělují mezerou ani 1px linkou — linka mezi dvěma plochami stejné barvy je jen
škrábanec přes jeden dlouhý panel. Odděluje je **pás tmavší barvy**, který čte jako prostor mezi
dvěma povrchy (`src/mocks/SectionBreak.tsx`):

```ts
band:  { height: 10, backgroundColor: '#0F0A05', marginTop: Spacing.xl },  // BAND_COLOR
title: { ...MockType.titleS, color: Colors.foam, marginTop: Spacing.lg, marginBottom: Spacing.md },
```

- Pás **záměrně přetéká přes screen padding** (`marginHorizontal: -inset`) — mezera, která končí
  před hranou, je dělítko, a dělítko je přesně to, co tenhle prvek nahrazuje.
- **Nadpis je POD pásem**, ne nad ním — nadpis patří k tomu, co po něm následuje.
- Lehčí varianta bez pásu (uvnitř jedné plochy): nadpis `MockType.titleS` s `marginTop:
  MockLayout.sectionGap` (32).

### 5.3 Kdy je karta správně

Karta (`stout2` nebo `stout3`, radius z tabulky níž) zůstává jen pro věci, které opravdu **plavou
nad obsahem nebo nesou vlastní svět**: karta akce v Komunitě (`stout2`, radius 28), karta rozehrané
hry (`stout3`, radius 22), plovoucí pilulky chromu (§20.5). `CardSurface` a `CardSheen` jsou jazyk
2.x — **nové UI je nepoužívá**.

Radiusy (`Radius`, `src/theme/layout.ts`): `small 10`, `medium 20` (stripy, stale bar),
`card 28` (karty, sheet večera), `cardLarge 34` (`PlacesSheet`), `pill 999` (tlačítka, chipy,
avatary). Mimo tokeny žijí v mocích 16/18 (thumby, covery) a 22 (karta hry) — drž se hodnot
z etalonních souborů, nevymýšlej mezistupně.

### 5.4 Nikdy dva `flex: 1` sourozenci

Na jedné úrovni smí být **maximálně jeden** prvek s `flex: 1`. Ten je „ten, co dýchá“. Ostatní mají
pevnou výšku nebo `flexShrink: 1`. Dva `flex: 1` sourozenci znamenají, že se prostor dělí půl na půl
bez ohledu na obsah, a na malém telefonu se oba useknou uprostřed.

### 5.5 Obsah se dimenzuje z kontejneru, ne naopak

Nikdy nedávej velkému prvku pevnou velikost s nadějí, že se okolí přizpůsobí. Změř kontejner
(`onLayout` + clamp + fallback pro první frame) a odvoď velikost obsahu z něj. Na iPhonu SE se
prvek zmenší, na Pro Maxu naroste na strop, nikdy nepřeteče. Pro čísla platí totéž přes
`adjustsFontSizeToFit` + `minimumFontScale` (§3.1).

---

## 6. Tlačítka

### 6.1 Primární — jedno na obrazovku, bez glow

```ts
button: {
  height: MockLayout.buttonHeight,        // 48; v sheetu sheetButtonHeight 56
  borderRadius: Radius.pill,
  backgroundColor: Colors.amber,
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: Spacing.lg,
},
pressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
label: {
  ...MockType.buttonLabel,               // 16 / 700, systémové písmo
  color: Colors.stout,
},
```

- **Žádný glow, žádný `topLight`.** `amberGlow*` je jazyk 2.x — v žádném etalonním souboru se
  nevyskytuje. Tlačítko je plná jantarová pilulka a to stačí.
- Výšky: **48** na obrazovce, **56** v sheetu, **60** dělená primární kapsle večera („+1 pivo“ +
  picker `52 × 60`, mezera 2, vnitřní radius švu 6 — `LivePartyMockScreen`).
- **Label vždycky říká, co jeden tap udělá** („Ještě jedno“, „Co si dáš?“, „Zapiš první pivo“).
  Nikdy generické „Pokračovat“ nebo „OK“.
- **Tap, který zapisuje, má debounce** (`useRef`, žádný state — spolknutý tap nesmí nic
  překreslit; při změně labelu se debounce resetuje, nový label = nová akce).

### 6.2 Sekundární — tichá pilulka, nikdy outline

```ts
secondary: {
  minHeight: 48,                          // menší varianta 44
  borderRadius: Radius.pill,
  backgroundColor: Colors.stout3,         // žádný okraj
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: Spacing.lg,
},
secondaryLabel: { fontSize: 14, fontWeight: '700', color: Colors.foam },
```

Jantarový 6% outline (`CounterSecondary`, `GlowButton`) je jazyk 2.x. Další tvary z etalonu:
**filtrační chip** (`height: MockLayout.pillHeight` 32, `stout2`, okraj `transparent` →
`withAlpha(amber, 0.5)` aktivní, label 13–14/600 `mutedText` → `amber`), **kruhové sekundární**
(48 × 48, sklo, fallback `stout3`), **plovoucí pilulka v chromu** (výška 40, `stout @ 0.92`,
hairline `foam 0.14`), **textový odkaz** (14/800 `Colors.amber`).

**Pressed slovník:** default `opacity: 0.65`; tělo plovoucího baru `0.85`; jantarová CTA
`0.9 + scale 0.97`. Pro nový kód jsou tohle defaulty — nevymýšlej další hodnoty; drobné odchylky
ve starším kódu (0.62, 0.7) se srovnávají při dalším zásahu.

### 6.3 Pravidlo jedné akce

Na obrazovce je **jedna primární akce** — jedna plná jantarová plocha v obsahu (§2.2). Sekundární
tlačítko je nanejvýš jedno a je vždy tichá `stout3` pilulka. Cokoli dalšího jde o tap hlouběji do
pojmenovaného sheetu. Když se ti na obrazovku tlačí třetí rovnocenná akce, je to signál, že tam
patří overflow („…“ → sheet), ne třetí pilulka.

---

## 7. Bottom sheet — kanonický recept

V appce existují **dva druhy spodních panelů** a nezaměňují se:

1. **Tažený povrchový sheet** — `src/pubs/PlacesSheet.tsx`. Trvalý povrch nad mapou/kompasem se
   třemi detenty: `DETENT_TOP = { peek: 1, half: 0.48, full: 0.08 }` (hodnota = podíl obrazovky
   **nad** sheetem; `peek: 1` znamená sheet úplně pryč, ne jednořádkový pruh — lišta, jejímž jediným
   obsahem je vlastní název, je chrome navíc). Edge-to-edge na každém detentu, radius **34** jen na
   horních rozích, sklo `stout @ 0.82` s hairline okrajem `foam 0.12`, grabber `40 × 5` (`foam
   0.26`). **Pan gesto je na madle, ne na celém sheetu**; tělo táhne jen pod `full`, na `full` jen
   dolů a jen když je list nahoře. Throw: `projected = translateY + velocityY * 0.12` → nejbližší
   detent, spring `{ damping: 22, stiffness: 190, mass: 0.7 }`.
2. **Intent sheet** — modal s jedním záměrem (§8), přes `BottomSheetModal` wrapper. Mechanika
   níže. Vizuálně: zem sheetu je **`Colors.stout`** — stejná zem jako obrazovka, ne `stout2`
   („sheet je obrazovka, ne popup“) — radius **28** na horních rozích, `paddingHorizontal:
   MockLayout.screenPad` (jedna šířka appky, ne soukromých 16), grabber `44 × 4` (`foam 0.22`).

Zbytek téhle sekce je mechanika intent sheetu. Modal, ne knihovna.

### 7.1 Co vlastní wrapper a co volající

Mechaniku modalu vlastní `src/components/shared/BottomSheetModal.tsx` (API:
`{ visible, onClose, children }`): `Modal` s `animationType="none"`, scrim `black 0.6` s prolnutím,
kartu s příjezdem na springu, Android back gesture a dismiss target za kartou
(`accessibilityElementsHidden`, aby VoiceOver nehlásil „Zavřít“ dvakrát). **Nestav si vlastní
`Modal`.**

Volající dodává jen kartu:

| Rozhodnutí | Důvod |
|---|---|
| `cardWrap` má `maxHeight: '92%'` (strop), **žádnou výchozí `minHeight`**, a `marginBottom: -insets.bottom` | Krátký sheet končí hned pod posledním řádkem, inputem nebo tlačítkem. Nevzniká prázdná „brada“, akce zůstávají u palce a dlouhý obsah přesto nezakryje celou obrazovku. |
| Karta má `paddingBottom: insets.bottom + Spacing.lg` | Obsah se nedostane pod home indicator. Jde vždycky spolu s `marginBottom` výše. |
| Sloupec **pevná hlavička → `ScrollView` s `flexGrow: 0`, `flexShrink: 1` → pevná patka MIMO scroll** | Krátký obsah určí výšku sheetu; dlouhý se u stropu zmenší a scrolluje. Patka (akce, součet) neodscrolluje ani se nenechá ustřihnout. |
| Karta je obyčejný `View` | Dismiss target je sourozenec **za** kartou (ve wrapperu), takže karta nemusí nic polykat — a no-op `Pressable` by celý sheet seskupil do jednoho nepojmenovaného ovladače (§11). |
| Grabber `44 × 4`, `foam 0.22` | Vizuální afordance „tohle je sheet“. (`PlacesSheet` má vlastní `40 × 5`, `foam 0.26`.) |

### 7.2 Kostra k překopírování

```tsx
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { cs } from '@/i18n/cs';
import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';

export function ExampleSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        {/* Plain View: the dismiss target is a sibling BEHIND the card (wrapper),
            so the card does not need to swallow presses — and a no-op Pressable
            would group the whole sheet into one unnamed control (§11). */}
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />

          {/* 1 — fixed header */}
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {/* cs.<screen>.sheetTitle */}
            </Text>
            <CloseButton onPress={onClose} label={cs.a11y.counterCloseModal} />
          </View>

          {/* 2 — the only scrolling part */}
          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {/* rows */}
          </ScrollView>

          {/* 3 — pinned footer, OUTSIDE the ScrollView */}
          <View style={styles.actions}>{/* primary/secondary actions */}</View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  // Výškové meze patří SEM, ne na kartu — viz §7.5.
  cardWrap: {
    width: '100%',
    maxHeight: '92%',
  },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,          // stejná zem jako obrazovka (§7 úvod)
    borderTopLeftRadius: Radius.card,       // 28
    borderTopRightRadius: Radius.card,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad, // 20 — jedna šířka appky
    ...softDrop(),
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,                     // 18 / 700 / −0.2, sentence case
    color: Colors.foam,
  },
  // Bounded so a long list scrolls instead of pushing the pinned footer out.
  list: { flexGrow: 0, flexShrink: 1, marginTop: Spacing.sm },
  listContent: { paddingBottom: Spacing.sm },
  actions: {
    gap: 8,
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
});
```

### 7.2b Sheet vyjíždí zespoda (3.0)

Použij `src/components/shared/BottomSheetModal.tsx`. Nestav si `Modal` s
`animationType` sám.

Dřív tu stálo `animationType="fade"` s odůvodněním, že `"slide"` koliduje
s vlastním polohováním karty a vzniká dvojitý pohyb. Je to napůl pravda:
`slide` na `transparent` modalu posune **celý modal včetně backdropu**, takže
tmavý závoj vyjede zespoda místo aby prolnul. To nečte jako karta přijíždějící
přes obrazovku, ale jako jeden velký kus tmavého papíru.

Řešení není vybrat jednu ze dvou vestavěných animací. Sheet jsou **dva pohyby
najednou a nejsou stejné**:

| Vrstva | Pohyb | Proč |
|---|---|---|
| závoj | prolnutí | je to stav obrazovky za ním, ne předmět |
| karta | posun zespoda, spring | je to objekt, který přijíždí, a má hmotu |

Takže `Modal` neanimuje nic (`animationType="none"`) a obojí řídí wrapper. Při
zavírání běží ty samé dva pohyby pozpátku a `Modal` se odmontuje až na konci —
`visible={false}` hned by kartu nechal zmizet místo odejít.

Wrapper taky drží Android back gesture, aby zavřel sheet a ne obrazovku za ním.

> **Migrace.** Ve 3.0 na něm jedou sheety v `src/party/`. Zbytek appky
> (~27 míst) pořád fade a je to **vědomý dluh**, ne opomenutí — projede se to
> najednou, ne po jednom, aby appka nebyla půl na půl.

### 7.2c Zavírací tlačítko

Použij `src/components/shared/CloseButton.tsx`. Nestav si další.

Každý sheet měl svůj: **32pt ploška z plného `stout3`**. Dvě chyby v jedné.
32 pt je **pod minimem 44 pt**, což je jediné rozměrové pravidlo, které není věc
vkusu (§11). A plná ploška na povrchu, který je sám ze skla, čte jako **díra
vyseknutá do materiálu**, ne jako tlačítko na něm.

Takže je to 44 pt na stejném skle jako všechno ostatní plovoucí (§15.1), s plnou
plochou jako fallback (§15.2).

> **Migrace.** Ve 3.0 na něm jede detail hospody. Zbytek (~12 míst) pořád vlastní
> 32pt plošky — vědomý dluh, projede se najednou.

### 7.3 Řádky uvnitř sheetu

Řádky v sheetu jsou stejné ploché řádky jako na obrazovce (§5.1) — hairline `foam 0.10` nahoře,
`first` bez něj:

```ts
row:        { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
              paddingVertical: Spacing.sm,
              borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
rowFirst:   { borderTopWidth: 0 },
rowText:    { flex: 1 },
rowName:    { ...MockType.bodySemibold, color: Colors.foam },          // 16 / 600
rowMeta:    { ...MockType.bodySmall, color: Colors.mutedText, marginTop: 2 },  // 14 / 500
rowPressed: { opacity: 0.65 },
```

Akční („udělej něco nového“) řádek má vlastní plochu a jantarový medailonek pod ikonou:

```ts
actionRow:  { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12,
              paddingHorizontal: Spacing.md, borderRadius: Radius.medium,
              backgroundColor: Colors.stout3 },                        // bez okraje
actionIcon: { width: 34, height: 34, borderRadius: Radius.pill, alignItems: 'center',
              justifyContent: 'center', backgroundColor: withAlpha(Colors.amber, 0.12) },
```

Nadpis sekce v sheetu je `MockType.titleS` v sentence case (§3.1). Verzálkový 11pt jantarový
kicker je jazyk 2.x a je zakázaný.

Řádek se dvěma řádky textu **a** 44pt ovládacím prvkem potřebuje `minHeight: 64`,
jinak druhý řádek koliduje s řádkem pod sebou.

### 7.4 Sheet za sheetem

iOS odmítne otevřít modal, dokud se předchozí zavírá. Když řádek v sheetu otevírá další modal, zavři
sheet a akci odlož:

```ts
const SHEET_DISMISS_MS = 260;

const runAfterSheetClose = useCallback((action: () => void) => {
  setMoreOpen(false);
  setPickOpen(false);
  setReceiptOpen(false);
  if (sheetActionTimer.current) clearTimeout(sheetActionTimer.current);
  sheetActionTimer.current = setTimeout(() => {
    sheetActionTimer.current = null;
    action();
  }, SHEET_DISMISS_MS);
}, []);
```

Timer vždycky uklízej v `useEffect` cleanupu.

> **Známá odchylka:** `CounterMoreSheet.tsx` používá zjednodušenou variantu, kde je backdrop rodičem
> karty. Funguje to, protože jde o krátký neskrolující seznam bez patky. **Pro nové sheety použij
> kanonickou variantu výše.** Kdykoli sheet obsahuje `ScrollView` nebo pevnou patku, je varianta
> s rodičovským backdropem chyba.

### 7.5 Krátký sheet obepíná obsah, dlouhý má strop na `cardWrap`

Tohle je nejzákeřnější chyba v celém receptu, protože **nikde nespadne a nic nenahlásí** — jen
zmizí obsah.

Procentní `maxHeight` se v Yoze počítá vůči **výšce rodiče**. Když ho napíšeš na
`card`, jejím rodičem je `cardWrap`, který má výšku `auto` — tedy neurčitou. Procento se nemá o co
opřít a Yoga ho **potichu zahodí**. Karta pak roste podle obsahu klidně přes celou obrazovku,
`ScrollView` uvnitř nikdy nedostane ohraničený box, takže **nescrolluje** — a všechno pod ohybem je
nedostupné. Testy projdou, typecheck projde, na screenshotu chybí půlka sheetu.

Projeví se to až u dlouhého obsahu. `DrinkPickSheet` to nikdy neodhalil, protože jeho seznam je
krátký; první to shodilo na `DiaryStatsSheet`, kde byly sekce REKORDY, NEJVÍC JSI VYPIL a ROKY
prostě uříznuté a nešlo se k nim doscrollovat.

Správně:

```ts
// backdrop má flex: 1 → má určitou výšku → procento se má o co opřít
cardWrap: { width: '100%', maxHeight: '92%' },
card:     { flexShrink: 1 },
list:     { flexGrow: 0, flexShrink: 1 },
```

`minHeight` se na běžný intent sheet nedává. Dvouřádková nabídka má být vysoká jen jako hlavička a
její dva řádky; formulář jen jako hlavička, pole a tlačítka. Výjimkou je obsah, který potřebuje
vlastní pracovní plochu (graf, mapa, dlouhý editor). I tam se minimální výška přidává vědomě až po
kontrole na malém telefonu, ne jako univerzální default.

**Jak to ověřit, když nemáš prst.** V simulátoru ovládaném přes computer use scroll gesto většinou
neprojde — myší tahy se na RN `ScrollView` nepřenesou, takže „nescrolluje to“ nic nedokazuje.
Nespoléhej na gesto, **změř to**:

```tsx
<ScrollView
  onLayout={(e) => setBox(Math.round(e.nativeEvent.layout.height))}
  onContentSizeChange={(_w, h) => setContent(Math.round(h))}
  …
/>
// a dočasně vypiš `box ${box} / content ${content}` třeba do patky
```

- `box < content` → scroll je ohraničený a funkční, jen na něj nedosáhneš myší. V pořádku.
- `box === content` → **tohle je ta chyba**. `ScrollView` se roztáhl na celý obsah, nikdy nescrolluje
  a všechno pod hranou karty je nedostupné.

Na `DiaryStatsSheet` to vyšlo `box 451 / content 707` — potvrzeno funkční. Diagnostiku pak zase ukliď.

---

## 8. Jeden záměr na sheet

**Sheet, který přidává, nesmí ubírat. Sheet, který ubírá, nesmí přidávat.**

| Sheet | Umí | Neumí |
|---|---|---|
| „Co si dáš?“ (`DrinkPickSheet`) | připsat pivo, přidat nové pivo, přidat nealko | žádné minus, žádné mazání, žádné „dopito“ |
| „Tvůj účet“ (`ReceiptSheet`) | odebrat drink, zavřít večer | žádné plus, žádné přidání |
| „Co ještě?“ (`CounterMoreSheet`) | všechno ostatní jako plochý seznam | nepočítá a neubírá |

Proč: v hospodě, po třech pivech, člověk nečte. Když v jednom panelu vedle sebe žije „+“ i „−“,
odečte si pivo omylem. Rozdělení podle záměru dělá z chybného tapu nemožný tap.

Prakticky: pojmenuj sheet slovesem nebo otázkou, která říká jeho jediný záměr, a když do něj chceš
přidat akci opačného směru, **udělej místo toho druhý sheet**.

---

## 9. Ilustrace a osobnost

**Kreslený prvek si musí zasloužit místo tím, že nese data.** Obrázek TOHO, co se počítá, data
nenese — a přesně na tom umřely dvě ilustrace, které tu dřív byly povinné:

| Zabito | Proč |
|---|---|
| `BeerGlass` (krýgl na počítadle) | Byl to obrázek piva na obrazovce, která chtěla ukázat počet piv. Vedle velkého čísla říkal totéž podruhé a hůř. |
| `CoasterStack` (štos tácků na profilu) | Kódoval kariéru jako nečitelnou výšku hromádky, a level byl vedle toho stejně napsaný slovy v patce. |
| čárky na tácku v kartě počítadla | Zkoušené jako náhrada krýglu. U jednoho piva je jedna čárka vedle velké „1“ jen škrábanec. |

Pravidlo tedy **není** „aspoň jeden kreslený prvek na obrazovku“. Pravidlo je:

1. **Nejdřív skutečná věc, teprve pak kresba.** 3.0 obrazovky nekreslí skoro nic — kreslí
   **reálnou mapu** (`NightRoute`: `react-native-maps`, číslované piny, non-interaktivní, caption
   přes fade, ne přes pruh), **nativní grafy** (`@expo/ui Chart`) a **velkou typografii**.
   Vymyšlená klikatá čára prohrála se skutečnou mapou místa.
2. **Kreslí se jen to, co se jinak přečíst nedá.** Směr (`CompassDial` v kompasové buňce),
   odznaky. Obrázek TOHO, co se počítá, data nenese — krýgl vedle čísla piv říkal totéž podruhé
   a hůř.
3. **Když to jde říct číslem, řekne se to číslem.** Velké číslo v pěně je silnější než jakákoli
   kresba téhož (§14.5 platí i obráceně).
4. **Osobnost nese chrome a slova.** Baloo číslice, hnědý gradient hlavičky, hospodská copy
   („Jedeš z posledního načtení“, „Svět je zatím podezřele čerstvý“). Obrazovka bez kresby není
   „jen typografie na hnědém pozadí“ — je to ten design.

Když už kreslíš: **vektor, ne bitmapa** (`react-native-svg`), **barvy z tokenů**, nikdy hardcoded
hex uvnitř SVG, **reaguje na data, ne na čas**, komponenta je `memo`, pevný `viewBox`, výška
odvozená od šířky konstantním poměrem, prázdný stav je vidět (`foam` na 4–8 %) a dekorativní
kresba je pro čtečku skrytá (`accessibilityElementsHidden`).

---

## 10. Pohyb

**Žádné smyčkové animace.** Ani bublinky, ani pulzující glow, ani dýchající ikony. Autor je
nesnáší a byly kvůli tomu už jednou odstraněny. Dekorativní pohyb na jádrových obrazovkách je
zakázaný. Povolený pohyb má přesně tři kategorie, všechny stavové, ne ambientní: **reakce na tap**
(pop níže), **příchod nového datového záznamu** (nový řádek threadu, §20.3) a **stavové smyčky
vázané na skutečný stav** — prstenec Party ikony při běžícím večeru (§20.6) a loading skeleton
během reálného síťového čekání (§20.11), které skončí, jakmile stav skončí.

Povolený je **jeden pop jako reakce na akci uživatele**:

```tsx
const reducedMotion = useReducedMotion();
const countScale = useSharedValue(1);
const prevCountRef = useRef(count);

useEffect(() => {
  const prev = prevCountRef.current;
  prevCountRef.current = count;
  if (count > prev && !reducedMotion) {
    countScale.value = withSequence(
      withTiming(1.12, { duration: 130 }),
      withTiming(1, { duration: 180 }),
    );
  }
}, [count, reducedMotion, countScale]);
```

Pravidla:

- **Nikdy na mount.** Porovnávej proti `useRef` s předchozí hodnotou.
- **Nikdy při snížení hodnoty.** Ubrání piva se neoslavuje.
- **Vždy `useReducedMotion()`** — když je zapnuté, hodnota se přepne bez animace.
- Trvání drž na `130 / 180 ms`. Nic pomalejšího; nic, co se opakuje.
- Stavové změny (sloty s proměnlivým obsahem) se přepínají **okamžitě, bez animace** a mají
  pevnou výšku — obsah se mění, výška ne, takže nic pod nimi neposkočí.
- Stisk se řeší stylem, ne animací: `pressed && { opacity: 0.65–0.9 }` (§6.2), u jantarové CTA
  navíc `transform: [{ scale: 0.97 }]`.

---

## 11. Přístupnost

- **Dotykový cíl ≥ 44 pt.** `HitArea.min` z `@/theme/layout`. Používej ho jako `minHeight` /
  `width` / `height`, ne jako komentář.
- **Nižší řádky dolaď přes `hitSlop`**, ne zvětšením vizuálu:

```ts
const CHIP_HEIGHT = 38;
const VERTICAL_SLOP = (44 - CHIP_HEIGHT) / 2;   // = 3
<Pressable hitSlop={{ top: VERTICAL_SLOP, bottom: VERTICAL_SLOP }} … />
```

  Jednodušší případy: `hitSlop={8}`, `hitSlop={10}`, `hitSlop={Spacing.xs}`.
- **Každý `Pressable` má `accessibilityRole="button"` a `accessibilityLabel`.** Label se bere
  z `cs.a11y.*`, ne z vizuálního textu — má popisovat *co se stane*
  (`cs.a11y.counterPlaceChip(label)` → „Změnit místo. Teď U Hrocha.“).
- **Neinteraktivní karta** dostane `accessibilityRole="text"` a `disabled`. `CoasterCard` přepíná
  mezi `'button'` a `'text'` podle toho, jestli je co otevřít.
- **Skrytý gesture (long press) potřebuje `accessibilityHint`** — jinak se o něm uživatel čtečky
  nikdy nedozví.
- **Ozdobné vrstvy vypni:** backdrop `accessibilityElementsHidden` + `importantForAccessibility="no"`,
  dekorativní `View` navíc `pointerEvents="none"`.
- **Segmenty:** `accessibilityRole="tab"` + `accessibilityState={{ selected }}`.
- **Každý `<Text>` má `maxFontSizeMultiplier`, nebo — u číslic v pevných buňkách — explicitní
  `allowFontScaling={false}`** (viz §3.3).
- **Dlouhé názvy hospod:** `numberOfLines={1}` na `<Text>` **a** `flexShrink: 1` na něm nebo na jeho
  obalu (+ `minWidth: 0` u sloupce vedle ilustrace). Bez `flexShrink` text netruncuje — vytlačí
  sousedy z obrazovky.
- Ikony jsou vždy z `@/components/shared/IconGlyph` s explicitní `size` a `color`.

---

## 12. Copy

- **Česky, tykáním.** „Zapiš první pivo“, „Kde sedíš?“, „Dopito?“
- **První osoba jednotného čísla.** Aplikace mluví za solo autora: „Potřebuju tvoji polohu“,
  „GPS trasu neukládám“. Nikdy firemní „my“, „naše aplikace“, „nabízíme“.
- **Slovesa mířená na uživatele bez rodu.** „Zapiš“, „Ťukni“, „Vyber“. Nikdy „zapsal jsi“ /
  „byla jsi“.
- **Tón: hospodský, lehce vtipný, krátký.** „Čistej tácek.“ je celá věta a stačí. Žádné sterilní
  SaaS („Pro pokračování prosím zvolte možnost“), žádné moralizování o alkoholu.
- **Label tlačítka říká výsledek tapu**, ne kategorii. „Ještě jedno“ ✓, „Přidat položku“ ✗.
- **Žádné emoji v UI chromu** — ani v labelech, ani v nadpisech, ani v toastech. Osobnost dělá
  ilustrace a text, ne emoji. (App Store „What's New“ emoji navíc rovnou odmítá.)
- **Všechny texty žijí v `src/i18n/cs.ts`.** Řetězec zapsaný natvrdo v komponentě je chyba.
  Skloňování jde přes `src/i18n/plural.ts` (`beerCountLabel`, `beerNoun`, …), formátování přes
  `formatVolume` / `formatPrice`. Plánuje se angličtina — copy natvrdo v JSX je dluh, který ji
  blokuje (mock obrazovky ho zatím mají, viz Část III).
- **Podpisový slovník:** pivo se **čepuje**, nikdy netočí. Chybové stavy říkají „nedotáhlo se“ /
  „nedotekly“ / „dotahuju“ — hospodsky, bez omluv. Prázdný stav smí vtipkovat („Svět je zatím
  podezřele čerstvý“), ale neomlouvá se.
- **Uživatelské texty ukaž autorovi ke schválení dřív, než něco commitneš nebo nasadíš.**

---

## 13. Checklist „nic se nepřekrývá“

Projdi před každým commitem obrazovky. Všech dvanáct.

1. **Svisle useknutý text** — má každé velké číslo `lineHeight: fontSize * 1.24` a
   `includeFontPadding: false`? Nechybí vršek číslic na iOS?
2. **Přetékání karty** — má karta `overflow: 'hidden'` a je obsah dimenzovaný z ní (`onLayout` +
   clamp), ne naopak?
3. **Dva `flex: 1`** — je na každé úrovni maximálně jeden dýchající prvek? Ostatní pevné nebo
   `flexShrink: 1`?
4. **Obsah za tab barem** — má scrollovatelná tab obrazovka `paddingBottom: insets.bottom +
   TAB_CHROME` a obrazovka bez tab baru `Math.max(insets.bottom, Spacing.sm)` (§4)? Je CTA celé
   nad spodní hranou i na telefonu s home indicatorem?
5. **Sheet nesahající na spodní hranu** — má `cardWrap` `marginBottom: -insets.bottom` a karta
   `paddingBottom: insets.bottom + Spacing.lg`? Není mezi kartou a hranou displeje proužek?
6. **Patka překrývající obsah** — je patka sheetu **mimo** `ScrollView` a má `ScrollView`
   `flex: 1` + `contentContainerStyle.paddingBottom`? Doskroluje poslední řádek?
7. **Nadpis vs. notch** — je `paddingTop: insets.top` (detail s vlastním headerem `insets.top +
   52`, `embedded` režim 0, protože inset vlastní rodič)? Neleze nic pod status bar?
8. **Dlouhý název hospody** — otestuj „Restaurace U Zlatého Tygra na Starém Městě“. Truncuje se
   (`numberOfLines` + `flexShrink: 1`), nebo vytlačí chevron z obrazovky?
9. **Dynamic Type 1.3** — pusť s největším systémovým písmem. Má každý `<Text>`
   `maxFontSizeMultiplier`, nebo explicitní `allowFontScaling={false}` (§3.3)? Vejde se pořád
   všechno?
10. **iPhone SE 375 × 667** — nejmenší podporovaná obrazovka. Zmenšila se ilustrace? Nezmizel nudge
    slot? Není CTA odříznuté?
11. **Klávesnice vs. aktivní pole** — po focusu je pole vidět nad klávesnicí, i u posledního pole
    formuláře?
12. **`KeyboardAwareScrollView`** — každé skrolovatelné UI s `TextInput` používá
    `src/components/shared/KeyboardAwareScrollView`. Krátký neskrolující dialog má keyboard lift na
    svém obalu. Samotný `ScrollView` + `KeyboardAvoidingView` bez focus-aware chování je zakázaný.

---

## 14. Antipatterns

Konkrétní věci, které už jednou byly a byly zabity. Nedělej je znovu.

1. **Ovladač před odpovědí.** Obrazovka, která se otevře na filtru, segmentu nebo pickeru místo na
   odpovědi. Pořadí je vždycky **čísla → tvar čísel → ovladač, který obojí mění**
   (`ProfileMockScreen`: totals → chart → periodRow). Na profil se člověk dívá, aby viděl, jak na
   tom je, ne aby si vybral časové okno.
2. **Tři žluté plochy v obsahu.** Jantarový segment + jantarový blok + jantarové tlačítko = tři
   bloky, které soupeří. **Jedna plná jantarová plocha v obsahu obrazovky** (§2.2); trvalé kotvy
   chromu (disk Party, `+1` v live baru) se počítají zvlášť.
3. **Rozmazaný glow na pozadí.** Radiální jantarové halo za obsahem, „ambient light“, plošné
   gradienty přes celou obrazovku. `Colors.glow` je legacy 2.x — nové UI nemá glow vůbec (§6.1).
4. **Tři cesty ke stejné věci.** Přidat pivo šlo z CTA, z pilulky pod ním i z overflow menu — a nikdo
   nevěděl, který tap co udělá. Každá akce má **právě jedno** místo. Když přidáváš vstupní bod,
   nejdřív ukaž, který existující rušíš.
5. **Abstraktní ukazatel místo velkého čísla.** Progress ring, gauge, sparkline, „naplněnost večera
   68 %“. Uživatel chce vidět, kolik piv vypil. Číslo, velké, pěnové, tabulární. Ilustrace ho
   doplňuje, nenahrazuje.
6. **Řada soupeřících akčních pilulek pod hlavním obsahem.** Foto, story, ping partě, zpětný
   zápis, sken — pět outline chipů vedle sebe, každý jinak široký, mezi obsahem a tlačítkem.
   Tohle zůstává zabité. **Filtry jsou něco jiného než akce:** vodorovný scroller filtračních
   chipů nad seznamem (`PubListMockScreen`) je kanonický vzor — filtruje tentýž seznam, nespouští
   pět různých věcí. Akce nad rámec primární patří za „…“ jako prostý pojmenovaný seznam.
7. **Ozdobné smyčkové animace.** Bublinky ve skle, pulzování, „dýchající“ ikona, dekorativní nebo
   falešný skeleton (bez skutečného načítání za sebou). Viz §10.
8. **Skákající layout.** Podmíněně renderovaný pruh nad tlačítkem, který se objevuje a mizí, posouvá
   CTA pod palcem. Řeš pevnou výškou slotu (`NudgeSlot`, 52 pt), ne animací.
9. **Dvě nabídky najednou.** Undo strip + rank chip + check-in nabídka naráz. Vždycky **jeden** nudge,
   vybraný prioritou v jednom `useMemo`.
10. **Rámeček na rámečku.** Outline chip vedle outline kruhového tlačítka vedle jantarového tlačítka.
    Když prvek nepotřebuje být ohraničený, ať je to jen glyf nebo jen text (viz `chipDefault`:
    `borderWidth: 0`, `paddingHorizontal: 0`).
11. **`opacity` na kontejneru místo alfy v barvě.** Zprůhlední i text a rozbije kontrast. Alfa patří
    do barvy přes `withAlpha`.
12. **Nový design pattern kvůli jedné obrazovce.** Žádný nový state manager, navigační pattern,
    komponentová knihovna ani druhý typografický systém. Když ti existující systém nestačí, uprav
    tenhle dokument a pak kód — v tomhle pořadí.

---

## 15. Materiál a hloubka (3.0)

Do 3.0 byla appka plochá: každý povrch byl plný `stout` / `stout2` / `stout3`. Od 3.0 přibývá
**jeden** další materiál — poloprůhledné sklo pod chromem. Referencí je nativní iOS, ne webový
`backdrop-filter` a rozhodně ne dekorativní blur přes obsah.

### 15.1 Kam sklo patří

| Povrch | Materiál |
|---|---|
| Tab bar | sklo |
| Header obrazovky (včetně search pole vpravo nahoře) | sklo |
| Bottom sheet — grabber a patka s akcí | sklo |
| Plovoucí lišta nad obsahem (např. filtry v seznamu hospod) | sklo |
| Karta | **ne** — karta zůstává plný `stout2` (§5) |
| Plocha pod velkým číslem | **ne** (§14.1, §14.5) |
| Primární tlačítko | **ne** — jantar je plný, vždycky (§6.1) |

Pravidlo jednou větou: **sklo je chrome, ne obsah.** Když skrz materiál prosvítá věc, kterou má
uživatel číst, je to špatně. Sklo smí prosvítat jen scrollující obsah, který právě mizí za okrajem.

### 15.2 Fallback je povinný

Liquid glass běží až na iOS 26+, deployment target appky je nižší, takže **každé**
použití skla má větev pro zařízení, která ho neumí:

```tsx
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';

// Sklo tam, kde je; jinak přesně ta plná plocha, kterou má appka dnes.
{isLiquidGlassAvailable() ? (
  <GlassView style={styles.bar} glassEffectStyle="regular" />
) : (
  <View style={[styles.bar, { backgroundColor: Colors.stout2 }]} />
)}
```

`expo-glass-effect` přímo importuje šest produkčních souborů (`TabBar`, `GlassIconButton`, …),
ale v `package.json` zatím chybí — funguje jako tranzitivní závislost Expo 56. Je to dluh: přímý
import chce přímou dependency (Část III).

Android sklo nemá vůbec. Tam platí fallback větev vždycky.

### 15.3 Vztah k §10 (Pohyb)

Sklo je **materiál, ne animace**. Reaguje na to, co pod ním scrolluje, a jinak stojí. Zakázané
zůstává všechno z §10: žádné pulzování průhlednosti, žádný animovaný blur radius, žádné
„dýchající“ pozadí. Když se sklo hýbe samo od sebe, je to smyčková animace se sklem místo bublinek.

---

## 16. Gradienty (3.0)

3.0 bere strukturu z nativních iOS aplikací, ale **barevnost zůstává Na pivo**. Tam, kde by
referenční appka sáhla po sytém akcentu (červená u Packety), sahá Na pivo po **hnědém přechodu**.

### 16.1 Co gradient smí

- Shader hlavičky obrazovky (`GradientBand` + `HEADER_GRADIENT` / `LIVE_GRADIENT`).
- Podklad chromu **pod** sklem, aby nebyl plochý obdélník — povolený pattern; kanonický `TabBar`
  ho zatím nemá, takže ho nezaváděj bez schváleného mocku.
- Uvnitř ilustrací, kde už dnes je (`TallyCoaster`, `PartyTable` — 2.x obrazovky).

### 16.2 Co gradient nesmí

**§14.3 platí dál a tenhle oddíl ho neruší.** Zakázané zůstává:

- radiální halo za obsahem a „ambient light“;
- gradient přes celou obrazovku;
- gradient jako pozadí karty — karta je plný `stout2` (§5);
- jakýkoliv **jantarový** gradient mimo ilustraci. Jantar je plocha, text nebo ikona, ne přechod.

Rozdíl proti zabitému antipatternu je v tom, že gradient 3.0 je **hnědý přechod mezi dvěma
sousedními stouty na chromu**, ne světelný efekt za obsahem. Když je vidět, kde gradient začíná a
končí, je moc silný.

### 16.3 Tokeny

Gradient se nepíše hexy na místě. Pojmenované stopy žijí v `src/mocks/mockTheme.ts`:

```ts
export const HEADER_GRADIENT = ['#5A3418', '#2A1A0C', MockColors.bg] as const;
export const LIVE_GRADIENT   = ['#0F4429', '#122A1B', MockColors.bg] as const; // běžící večer
```

`GradientBand` (`BAND_HEIGHT = 320`, stopy na 0 / 0.45 / 1) je **statický chrome**: absolutně za
obsahem, `pointerEvents="none"`, **nikdy neanimuje**. Když běží večer, hlavička přepne na zelenou
variantu — to je stavová informace, ne dekorace. Pozor: je to **navržený pattern** — definovaný
v kódu, ale zatím ho nekonzumuje žádná etalonní obrazovka; nasazuj ho jen podle schváleného mocku.
Devět dvoustopých gradientů coverů her žije v `gameCatalog.ts` (Část III je má nahradit artwork).

Rozpad 60 / 30 / 10 z §2.2 platí beze změny — gradient je pořád těch 60 % pozadí, jen ne jednolitých.

---

## 17. Navigace (3.0)

### 17.1 Pět tabů

| Tab | Co v něm je |
|---|---|
| **Kocoviny** | Kronika parties. Co zažili ostatní. Route zůstává `friends`. |
| **Hospody** | Objevování. Kompas, mapa, seznam, filtry, detail. Route je group `(pubs)`, URL `/`. |
| **Party** | Střed. Živý večer, nebo jeho založení. Route zůstává `beer`. |
| **Komunita** | Žebříčky, výzvy, akce. Route `community`. |
| **Profil** | Vlastní historie, statistiky, odznaky — a **nastavení**. |

Labely se změnily, **route názvy ne**. `napivo://beer`, `/friends` a `/profile` jsou deep-link cíle
a jsou pojmenované v telemetrii a `appReviewPolicy` — přejmenovat složku znamená rozbít vydané
appky. Když se mění název v UI, mění se jen `TAB_META`.

Nastavení nemá vlastní vstupní bod v chromu. Žije v Profilu (§0.4: okrajové akce do jednoho místa).

### 17.2 Party je střed a jediný důraz

Party je prostřední položka a **jediná** v baru, která nese jantar — a nese ho jako **plný jantarový
disk se stout glyfem**, ne jako obarvená ikona. Rozdíl je záměr: ostatní čtyři taby jsou místa, kam
jdeš, Party je akce, kterou spustíš, a control, co něco spouští, má vypadat jako tlačítko.

Ikona a label mají v `TabBar.tsx` **oddělené barvy**: uvnitř disku je glyf `Colors.stout` (na jantaru
by jantarová ikona zmizela), zatímco label pod ním zůstává jantarový jako u aktivního tabu.

Ostatní čtyři drží původní pravidlo: aktivní je jantarová ikona i label, neaktivní `mutedText`,
a **žádný glow nikde** — glow v novém UI neexistuje vůbec (§6.1) a velká jantarová plocha patří
obsahu obrazovky, ne baru, který je na každé z nich. Bar nemá horní hairline; sklo se od obsahu
odděluje samo (§15.1).

Party tab **nenaviguje** — pushuje `/party-live` jako fullscreen modal, takže se zavírá stejným
gestem obráceně. Na té route se tab bar celý skrývá.

### 17.3 Search

Search je **vpravo nahoře v headeru**, ne šestý tab a ne plovoucí pole nad obsahem. Otevírá se jako
vlastní povrch, ne jako rozbalovací pole v liště — jeden záměr na povrch (§8).

### 17.4 List → detail

Default je pushnutá route s nativním zpět (detail výzvy, akce, cizí profil) — patří do stacku
vedle `/profile/edit` a `/settings`. **Výjimka je detail hospody:** ten žije uvnitř taženého
`PlacesSheet` (`PubDetailBody` v `PubListMockScreen`), protože jeho kontextem je mapa, která má
zůstat vidět. Intent sheet (§7) detail nikdy nenese.

### 17.5 Kompas v seznamu hospod

Kompas nezmizel a nestal se položkou menu. Je **první buňkou seznamu hospod** a nese u sebe
hospodu, ke které právě navádí. Zůstává tím, co uživatel v tabu Hospody uvidí jako první.

Zdroje pravdy o poloze a nejbližší hospodě jsou **dva a mají dané role**: `useCompass` pro
discovery (seznam hospod, kompasová buňka), `useNearbyPub` (`src/counter/useNearbyPub.ts`) pro
autopick hospody při zápisu. Třetí nezakládej.

---

## 18. Nativní komponenty (3.0)

### 18.1 Pravidlo

Když pro ovládací prvek existuje systémová komponenta, **použij ji**. Ne kresbu, která ji připomíná.

Ručně stavěný segmented control měl správný tvar a všechno ostatní špatně: nešlo stisknout a přejet
prstem mezi segmenty, nebyl focus ring, VoiceOver neřekl „tab, 2 ze 3“, a s každým Apple restylem
by se rozešel s okolím. To samé platí pro dropdowny, grafy a kontextová menu.

Cena je, že **nemáme plnou kontrolu nad vzhledem**. To je součást rozhodnutí, ne důvod k návratu:
`UISegmentedControl` má systémově šedý selection indicator, protože ho SwiftUI přes `.tint()`
nevystavuje. Buď je to systémový prvek, nebo je to náš prvek — obojí nejde.

### 18.2 Čím to stavíme

Vším jede `@expo/ui` (SwiftUI host) — **přímá závislost projektu** (`package.json`).

| Prvek | Co použít |
|---|---|
| Segmented control | `Picker` + `pickerStyle('segmented')` |
| Dropdown / filtr chip | `Menu` + vnořený `Picker` s `pickerStyle('inline')` |
| Graf | `Chart` (`type: 'bar' \| 'pie' \| 'line'`) |
| Kontextové menu | `ContextMenu` (long-press) |

**Nezaváděj `react-native-ios-context-menu`.** Zkoušeno, nelinkuje se proti tomuhle Xcode SDK
(`ld: cannot link directly with 'SwiftUICore'`) a oprava znamená stavět React ze zdrojáků
(`RCT_USE_PREBUILT_RNCORE=0`), což je trvalá daň na každém čistém buildu kvůli jedné komponentě.
`@expo/ui` řeší to samé a linkuje se.

### 18.3 Label si skládej ve SwiftUI

`Menu` s `label` jako holým stringem se vykreslí jako text s vedoucí SF ikonou a **žádnou pilulkou**.
Vedle našich chipů to čte jako rozbitý prvek. Label skládej z `HStack` + `Text` + `Image` a styluj
modifiery — `glassEffect({ shape: 'capsule', interactive: true })` dá liquid glass kapsli.

### 18.4 Fallback

`Host` existuje jen na iOS. Každá obrazovka, která nativní prvek používá, musí mít **RN variantu pro
Android** — a ta nemá předstírat systémový prvek, protože tam systémový není. `Chart` typu `pie`
navíc potřebuje iOS 17+; pod tím se přepínač typu **skryje**, místo aby nabízel ovladač, co nic
nevykreslí.

---

## 19. Ikonografie

Používáme Lucide (dnes 80+ glyfů). Vlastní sada by byla samostatné rozhodnutí.

**Ikona musí něco rozlišovat.** Tři výzvy se stejnou jiskřičkou jsou dekorace na
místě myšlenky — každá výzva má glyf podle toho, co je (špendlík / hodiny /
půllitr). A **v detailu ikona většinou nepatří**: na obrazovce, která je o jedné
věci, zdobí titulek, co už všechno řekl.

### 19.1 Co znamená půllitr

Jeden glyf = jeden význam, napříč celou appkou.

| Glyf | Význam |
|---|---|
| **Jeden půllitr** (`BeerIcon`) | Jedno pivo. Počet piv, „+1 pivo“, jednotka v grafu. |
| **Dva ťuknuté půllitry** (`CheersIcon`) | Cheers — sociální reakce na večer. Nikdy počet. |

Než tohle vzniklo, obojí byl ten samý půllitr, takže „12“ pod postem bylo nejednoznačné: ťuklo
dvanáct lidí, nebo se vypilo dvanáct piv? Rozdíl je schválně **v počtu, ne v jiné ilustraci** —
nesouvisející glyf (srdce, party popper) by znamenal ikonu přeučit.

`CheersIcon` je **širší než vyšší**. Dva půllitry vecpané do čtverce o velikosti jednoho jsou
nutně poloviční a v 17 pt z nich je šmouha.

**Nikdy emoji.** Platilo to už pro `CheersPill` a platí to dál.

> `src/friends/CheersPill.tsx` ve vydané appce zatím pořád používá samotný půllitr pro reakci.
> Je to živé UI a je to samostatné rozhodnutí; při dalším zásahu do něj to sjednoť.

---

## 20. Obrazovky 3.0

### 20.1 Jedna šířka skrz celou app

Vodorovný okraj obsahu je **vždycky** `MockLayout.screenPad` (20) — na
obrazovce, v sheetu i v detailu. Žádných 16 „protože je to sheet“.

Hostitel obsahu si k tomu **nesmí přidat vlastní padding**. Detail hospody měl
20 ze `PubDetailBody` a 16 z ScrollView okolo, takže text seděl na 36, zatímco
full-bleed pásy (`SectionBreak`, `UnderlineTabs`) přetékaly jen o 20 a končily
16 před krajem. Tři různé hrany na jednom sheetu.

Komponenty, které přetékají přes okraj, dostávají `inset` rovný té jedné šířce.
Když se okraj mění, mění se `MockLayout.screenPad`, ne lokální číslo.

### 20.2 Živý večer nemá grafy

Běžící večer a jeho recap jsou dvě různé obrazovky s různou prací.

Hub (`/party`) je **co se právě děje**: pár velkých čísel, ovládání a log. Žádné
taby, žádné grafy. Do telefonu se během večera kouká vestoje, na tři vteřiny —
graf vlastního večera je věc, kterou nikdo nestuduje uprostřed hospody.

Statistiky, grafy a rozbor patří do **recapu** (`/party-recap`), po ukončení a
odeslání. Tam je ohlédnutí celý smysl obrazovky.

### 20.3 Log je thread, ne systémový žurnál

Log běžícího večera je společný thread. U každého záznamu musí být vidět **kdo
to tam dal** — u stolu pro čtyři je „Fotka“ bez jména aplikace mluvící sama se
sebou. Obsah do něj přidávají tlačítka dole (pozvat, foto, pivo, hra, přesun) a
každý typ má svůj glyf na lince.

Hra v threadu **není zpráva o hře** — ten řádek hru spouští a po dohrání na místě
vyroste ve výsledkovku. Dva řádky (založení + výsledek) čtou jako dvě hry.

Thread smí nést **jen obsah, který app umí vyrobit**. Namockovaná „poznámka“ a
„runda“ vypadaly dobře a slibovaly dvě funkce, ke kterým nevede žádné tlačítko —
log by inzeroval něco, co neexistuje. Typy obsahu = přesně ta akce dole.

Vodicí linka se kreslí **uvnitř řádku**, takže mezi řádky nesmí být gap; jinak se
z linky stane čárkovaná. Odsazení si nese řádek sám.

Hlavička hubu (hospoda, lidi, čísla) je **sticky**, scrolluje jen thread. Odpověď
na „co se děje“ nesmí odjet nahoru, když se koukáš, co se stalo.

Nově přidaný záznam **přijede animací** (`FadeInDown` + `LinearTransition`, §10),
ale jen ten — řádky, které tam byly při otevření, se nesmí rozdávat jako karty.
Rozhoduje o tom razítko mountu, ne pořadí.

Akce, které něco přidávají, nesou na ikoně malý **plus badge**. Řádek samotných
podstatných jmen („Foto“, „Hry“) čte jako navigace, ne jako přidávání.

### 20.4 Opravy patří do logu

Do hospody se ťuká špatně. Log je jediné místo, kde uživatel vidí, **který**
záznam je špatný, takže oprava patří tam — ne do samostatné obrazovky historie.

Řádek s pivem nese `RowMenu` (`src/mocks/MenuChip.tsx`): nativní kotvené menu
jako v Spendee, čepované pivo jako zaškrtnutý seznam a „Smazat“ jako destructive
položka pod ním. Oprava **přepíše původní řádek**; thread ve stylu „Pilsner / no
vlastně Kozel“ je horší záznam večera než ten, co prostě říká, co jsi pil.

Pozor na hranici: SwiftUI `Menu` si kreslí vlastní label, takže se kotví na
glyf, který mu dáme — **neumí obalit existující RN řádek** a udělat z long-pressu
na něm kontextové menu. To by chtělo `react-native-ios-context-menu`, což je ta
knihovna, která nešla slinkovat (§18.2).

### 20.5 Běžící večer v chrome

Live bar nad tab barem se **vysvětluje sám**: hospoda a pod ní běžící stopky a
počet piv. Zelená tečka je pryč — stavová kontrolka se musí naučit, kdežto
tikající čas říká „běží to“ slovy, která už čteš. Plurály česky (1 pivo, 3 piva,
7 piv); špatný plurál je na takhle malém pruhu první, čeho si všimneš.

Ikona Party v tab baru dostane při běžícím večeru **prstenec** a popisek
„Večer“. Ne jinou ikonu a ne jinou barvu — je to pořád stejné místo, jen jsi
v něm.

### 20.6 Jedna smyčka v celé app

Tab bar je na každé obrazovce, takže cokoliv, co v něm běží ve smyčce, běží
pořád. §10 to zakazuje a ten zákaz platí dál — **s jednou výjimkou**: prstenec
kolem Party ikony při běžícím večeru.

Proč zrovna tenhle: běžící večer je jediná věc v appce, která se **opravdu děje**,
zatímco se díváš na něco jiného. Statický prstenec říká „je zapnutý režim“,
pulzující říká „běží to“. „Kamarád je live“ tuhle výjimku nedostane — to je cizí
novinka a ta počká na pohled.

Podmínky: **2,4 s na cyklus**, tam a zpět (skok zpátky na malý je bliknutí a
blikající tab bar je alarm), hýbe se **jen prstenec, nikdy glyf**, a při reduced
motion se nehýbe nic.

### 20.7 Velká čísla se neklikají

Blok velkých numerálů je nadpis, ne ovládací prvek. Nedávej pod něj `Pressable`
ani „rozklikni pro víc“ — vypadá jako obsah, chová se jako tlačítko, a uživatel
to najde omylem.

Které číslo se ukáže, je **produktové pravidlo s testy**, ne pevný řádek. „U
stolu“ dává smysl jen když u stolu někdo je; sám sobě by uživatel četl vlastní
počet dvakrát. Radši dvě pravdivá čísla než tři s pomlčkou. Viz
`src/party/nightPulse.ts` (`hubStats`).

### 20.8 Cizí profil

Cizí profil je **stejná obrazovka jako tvoje**, jen zvenku. Člověk má vypadat
jako člověk, ať ho potkáš kdekoli; jinak nakreslený profil cizího čte jako jiný
produkt.

Co se mění:

- vztah v hlavičce — „Byli jste spolu 4× na pivu“. To je poctivá verze „12
  společných přátel“ v hospodské appce;
- dvě akce: **Sledovat** a **Na pivo?**. Druhá je vlastně smysl celé appky;
- **žádná série a žádné rekordy**. Na svém profilu tlačí tebe; na cizím je série
  běžící součet cizího pití, který si ten člověk nezveřejnil.

Statistiky jsou **agregáty**. „12 hospod“ je fakt o tom, jak často chodí ven;
seznam kterých dvanáct je rozvrh, a rozvrh jednoho člověka tahle app druhému
nedává.

**Otevřená otázka (Část III):** jak se ta akce jmenuje. Teď „Sledovat“, protože je
jednoznačné. Ve hře je „Parťák“ (hospodštější, ale svádí k tomu, že je to
vzájemné, což follow není).

### 20.9 Textová pole

Pole je díra, do které se píše — musí být **světlejší než to, na čem leží**, a
nést vlásečnicový okraj. Search v Hospodách byl `surface` na sheetu, jehož
podklad je taky `surface`; pilulku šlo najít jen podle placeholderu uvnitř.

Tokeny (`MockColors`): `field`, `fieldBorder`, `fieldHint`. Placeholder je
foam na 55 %, ne hnědý `mutedText` — ten je na tmavém poli sotva čitelný.

Platí to na **všechna** pole: search, sheety, dialogy. Nekresli si vlastní
podklad pole ve screenu.

### 20.10 Avatary a fotky

- Profilová fotka je **reálná, jinak iniciála na barvě** (`Face`). Cizí obličej
  ze stocku je lež, která se pozná ve chvíli, kdy si toho někdo všimne.
- Barvy iniciál: šest odstínů, **deterministicky z id**, takže je člověk stejně
  barevný na všech telefonech. Jantar je vyhrazený tobě samotnému.
- Fotky večera a menu jsou skutečný upload (`BeerPhoto`), avatary `Account.avatar`.
- **`pravatar.cc` a `picsum.photos` placeholdery nesmí opustit mocky.**

### 20.11 Skeletony

Primitiva je `SkeletonBlock`: foam wash, 900 ms ping-pong, při reduce-motion se
**zastaví**, nezpomalí. (Tohle není shimmer z §14.7 — reaguje na čekání na síť,
ne dekorace.)

Skeleton je jen tam, **kde se opravdu čeká na síť** (feed, komunita, detail
hospody). Kde jsou data lokálně (party hub, počítadlo), není **nic** — bliknutí
kostry pod obrazovkou, která má data hned, je horší než nic.

### 20.12 Prázdné stavy

Prázdný stav je **jedna věta a jedna akce**. Ne „0 výsledků“, ne odstavec
vysvětlování, ne ilustrace ke každému — ilustrace jen tam, kde je opravdu na
místě (Kocoviny), a stačí jedna.

| kde | kdy je prázdno | co má říct |
|---|---|---|
| Kocoviny | nikdo z tvých kamarádů nic nepostnul | „zatím ticho“ + cesta k pozvání |
| Party | před prvním pivem | co večer bude sbírat |
| Hospody | filtr nic nenašel | ne „0 výsledků“, ale co zkusit |
| Komunita → Výzvy | žádná výzva neběží | kdy budou |
| Profil → Aktivita | ještě nic | první krok |

---

### 20.13 Kompozice sdílených bloků

Idiomy z etalonu, které platí všude, kde se blok objeví:

- **Jedna entita = jedna komponenta všude.** Statistiky večera kreslí `StatGrid`, žebříček
  `Leaderboard`, tempo `TempoChart` — ať se blok objeví kdekoli (feed, hub party, recap, profil).
  Dvě pořadí by znamenala, že ta samá čísla čtou jinak podle toho, kde je potkáš. Starší obrazovky
  mají ještě vlastní varianty — nekopíruj je, sáhni po sdílené komponentě.
- **Hodnota nad popiskem, nikdy naopak.** Velká těžká hodnota, malý ztlumený label pod ní, žádná
  dělítka mezi sloupci — mezera v gridu JE oddělovač. Poslední buňka v řádku se zarovnává doprava,
  per řádek. Rekord (`PR`) je fakt o čísle a sedí u popisku — číslo zůstává číslem.
- **Graf nemá vlastní callout — přepisuje hlavičku.** Dotek na sloupci přesměruje velká čísla nad
  grafem na ten bucket (scrub přes `PanResponder`, práh 2 px); puštění vrátí celé okno. Bez dotyku
  svítí poslední sloupec — graf bez zvýraznění čte jako mrtvá historie. Graf nemá osy ani mřížku:
  otázka profilového grafu je „stoupá to, nebo klesá“, ne „bylo to přesně sedmnáct“.
- **Podium jen od tří lidí** — se dvěma je to ceremonie pro hod mincí. Výšky bloků `[64, 84, 56]`,
  pořadí `[2, 1, 3]`, koruna = 2px jantarový okraj.
- **Stale-data pruh je text, ne ikona.** Celá věta + jedna akce: „Jedeš z posledního načtení.
  Novější večery se teď nedotáhly.“ / „Zkusit znovu“. `minHeight: 44`, radius 20, podklad
  `foam 0.06` (chyba navíc okraj `amber 0.22`), text 12pt. Podpisové sloveso je „nedotáhlo se“.
- **Podtržítkové taby ≠ segmentovaný přepínač.** Podtržení říká „stránky jedné obrazovky“
  (`UnderlineTabs`: baseline `foam 0.09` přes celou šířku, aktivní kus `amber 0.85`), dráha
  s thumbem říká „jedna otázka, jedna odpověď“. Nesmí splynout. `UnderlineTabs` si vlastní vzduch
  (`marginTop: controlGap`, `marginBottom: Spacing.lg`) — nechat to na volajícím je způsob, jak si
  titulek sáhne na vlastní taby.
- **Live bar říká „běží to“ tikajícím časem, ne zelenou tečkou** (`LivePartyBar`: výška 58,
  pilulka nad tab barem, hodiny `Fonts.numeral` 20 s tabular-nums, vlastní `+1` CTA 44 pt).

## 21. Hry — pravidla stavby

### 21.1 Skořápky, ne obrazovky

Hra je **obsah plus skořápka**, nikdy vlastní obrazovka. Desátá hra má být řádek
v `gameCatalog.ts` a seznam promptů, ne další složka.

Skořápky (`GameShell`, `src/party/shells/`):

| skořápka | co to je | hry |
|---|---|---|
| `quiz` | otázky s odpověďmi, body | Pub kvíz |
| `turns` | tahy po kruhu | Kostky |
| `prompt` | balíček kartiček, jedna po druhé | Kategorie, Nikdy jsem…, Palec, Pravidlo |
| `draw` | tažení karty s napětím | King's Cup |
| `pick` | náhodný výběr člověka | Runda, Flaška |

(`score` v typu existuje, ale žádná hra ho nepoužívá — nezaváděj ho bez rozhodnutí.)

Drží to i backend generický: hry píší do jednoho append-only endpointu se společnou obálkou
(event kindy `start` / `score` / `answer` / `action` / `finish`), takže hraní nepotřebuje
endpoint na hru.

**Napětí je ta hra.** Losování nikdy jen nevypíše výsledek — jména proběhnou a zpomalí, karta se
otočí. Ta půlvteřina je důvod, proč se kvůli tomu tahá telefon. V RN skořápkách (pick, draw,
prompt) se výsledek **vybere první a teprve pak se k němu animuje**, aby reduced motion nebyla
druhá implementace, co se rozejde. Výjimka jsou fyzické WebView hry (§21.4): tam je simulace
sama náhodou a výsledek se čte z dopadu.

Balíček se **zamíchá jednou a rozdává se**, nenáhodně se nelosuje pokaždé.
Náhoda se opakuje, a opakování dvě karty po sobě je moment, kdy stůl usoudí, že
je appka rozbitá.

**Hra na pití nevede žádnou tabulku.** Jediná, kterou by vést mohla, je kdo
nejvíc pil.

**Dohraná hra nese výsledek na svém coveru** — pod obrázkem to byl popisek, na
něm je cover samotný ten výsledek.

### 21.2 Hra má sestavu, kolo a konec

**Sestava napřed.** Stůl není parta: někdo je u baru, někdo nehraje, někdo si
právě sedl. Před každou hrou je lobby se jmény z večera — předzaškrtnutými,
protože běžný případ je, že hrají všichni — a s možností někoho přizvat rovnou
odtud. Bez toho se první kolo změní v hádku, kdo je na řadě.

**Obrazovka během hry říká jednu věc: kdo je na tahu.** Jméno 34pt, kostky ve
velikosti skutečných. Žebříček je pod tím a potichu — je to kontext, ne otázka.

**Hra musí skončit sama.** Tabulka, která jen roste, nemá konec a někdo u stolu
musí říct „tak dost“. Kostky proto vítěze **odebírají**: třikrát vyhrané kolo a
jsi z obliga, hra se zrychluje a kdo zbude poslední, platí rundu. Napětí jde
nahoru, ne dolů.

Kdo platí, přebíjí kdo vyhrál — je to ta věta, o které stůl bude ještě mluvit.

**Pravidla žijí mimo komponentu.** `src/games/web/dice/rules.ts` je čistá data a funkce
s testy; skořápka je jen kreslí. Hra se špatným koncem je horší než žádná hra a
tohle se neověřuje klikáním v simulátoru.

**Konec je nahoře**, co nejdál od všeho, na co se během hry ťuká, a je to text —
ne druhý jantarový pruh soupeřící s tlačítkem, které se opravdu mačká. Počítadlo
piv naopak plave dole u palce.

### 21.3 Rekvizity vypadají jako rekvizity

Kostka je **kostka**, ne číslo na čtverci. Celé kouzlo házení je v tom, že
stěnu poznáš dřív, než ji spočítáš — a „4“ jako kostku nepoznal nikdo. Puntíky
v uspořádání, které všichni znají, na slonovinové stěně.

Prostorovost je **falešná a levná záměrně**: skutečná 3D kostka znamená
renderer, mesh a fyziku kvůli dvěma kostkám, co dopadnou za vteřinu. Stačí
zaoblený čtverec se světlem vlevo nahoře, tmavší hrana pod ním místo vytažení a
stín. Ve velikosti, v jaké to telefon na stole ukazuje, to čte jako předmět —
a víc dělat nemusí. Kreslené `react-native-svg`, žádný nový balík.

**Rekvizita je hlavní, tlačítko vedlejší.** Jantarový pruh přes celou šířku pod
kostkami dělal z tlačítka nejhlasitější věc na obrazovce, jejíž celý smysl je,
co právě dopadlo.

### 21.4 Fyzické hry žijí ve WebView

Devět her je obsah plus skořápka v React Native. **Výjimka je jedna: hra, jejíž
podstata je fyzika.** Kostky, které se odrazí od mantinelu a dokutálí se nakřivo,
se v RN nedají udělat bez `expo-gl` + three + fyzikálního enginu, tedy tří
nativních závislostí a megabajtů v binárce.

Ve WebView stojí three.js i cannon-es **nulu navíc**, protože jsou to jen skripty
na stránce. `react-native-webview` obaluje systémový WKWebView, takže do velikosti
appky nepřidává engine — a od té chvíle je každá další fyzická hra jen HTML
soubor, co jde ven přes `eas update`.

Podmínky, jinak se z toho stane druhá aplikace uvnitř aplikace:

1. **Do WebView jde jen plátno.** Texty, seznamy, počítadla a jména zůstávají
   v RN — to je UI aplikace, ne hra.
2. **Most je úzký.** Sem „hoď“ a „obarvi se“, ven „padlo tohle“. Barva je
   jediná věc, kterou plátno o hráčích ví — **žádná jména do herní logiky**. U telefonu,
   co koluje kolem stolu, se „tyhle jsou Honzovy“ přečte z barvy dřív, než by
   kdo četl popisek. Výjimka z bodu 1: jméno namalované na rekvizitě (výseč
   kola Rundy), které je součástí té rekvizity.
3. **Text zůstává v RN, i když leží přes plátno.** Zvolání po dosednutí je
   vrstva nad WebView, ne text ve stránce — tím zůstane skutečným textem
   s Dynamic Type, VoiceOver a písmem aplikace, a přitom vypadá, že dopadlo na
   sukno.
4. **Simulace JE náhoda.** Čísla jdou ven, ne dovnitř. Nic si předem nevybere
   výsledek a neanimuje se k němu — hod je opravdu spravedlivý, což předstíraný
   hod nikdy není.
5. **Žádná síť.** Hra se sestaví do jednoho HTML s vloženými knihovnami
   (`npm run build:games`) a přibalí se jako asset. V hospodě signál není.
6. **Téma cestuje dovnitř** v `init` zprávě po `ready` handshaku (`GameHost`), jinak plátno
   vypadá jako cizí web. Query string používá jen browser harness (`npm run games:dev`).

**Hra se ladí v prohlížeči, ne v simulátoru.** `npm run games:dev` ji sestaví a
otevře jako obyčejnou stránku; když si všimne, že na druhé straně není most,
přidá si vlastní tlačítko a výpis výsledku. Doladit pocit z hodu tak stojí
reload, ne nativní build, simulátor a čtyři obrazovky proklikávání. To je rozdíl
mezi hrou, která se doladí, a hrou, co vyjde tak, jak poprvé spadla.

Past, na kterou se přijde těžko: hra se načítá jako asset (`.html` v
`assetExts`). Když Metro drží cache z doby před tou změnou konfigurace, import
routy selže a expo-router to nahlásí jako **„Cannot read property 'ErrorBoundary'
of undefined“** — hláška, která nemíří ani zdaleka k příčině. Řeší to
`npx expo start --clear`.

### 21.5 Herní vrstva

Mezi appkou a hrou je **definovaná vrstva**, ne most šitý na míru jedné hře.
Tři soubory, a desátá hra nepřidá čtvrtý:

| soubor | čí je | co dělá |
|---|---|---|
| `src/games/protocol.ts` | **obou stran** | tvary zpráv a verze |
| `src/games/web/sdk.ts` | hra | obálka, verze, dev harness |
| `src/games/GameHost.tsx` | appka | jeden WebView hostitel pro všechny hry |

Protokol importují **obě strany** — RN i stránka přes esbuild alias — takže když
se tvar zprávy změní, nepřeloží se ani jedna. To je ten smysl.

**Zprávy do hry:** `init` (hráči, téma, options), `turn`, `command` (sloveso,
které si hra deklaruje — „roll“, „spin“, „draw“).
**Ven:** `ready`, `state` (celý stav po každé změně), `event` (jednorázová
novinka), `result` (skóre, vítěz, kdo platí), `error`.

**Pravidla vlastní sdílený modul pravidel, ne platforma.** Lokální hra si stav postupuje sama
a po každé změně pošle **snímek celého stavu**. Ve sdílené hře je kanonický stav fold
append-only událostí (`sharedGameActions`) a plátno ho dostává přes `sync` — skládá se, nehádá.
Appka ze snímku kreslí všechen text — „Honza hází“, žebříček, výsledky kola — takže texty
zůstávají skutečnými texty s Dynamic Type a VoiceOverem.

Snímek, ne rozdíl: obrazovka, která se kreslí z celého stavu, se nemůže rozejít
s hrou, když jí unikne jeden rámec.

Pravidla jsou obyčejný TypeScript v repu (`src/games/web/dice/rules.ts`), takže
je jest testuje jako cokoliv jiného — sedm testů hlídá konec hry. Appka si ten
samý modul importuje **jen pro případ, kdy plátno není vůbec** (reduced motion,
build bez WebView). Jedna pravidla, dva hostitelé, nikdy dvě implementace.

Tři pravidla, která ty tvary vynucují:

1. **Plátno smí zdobit, ne vyprávět.** Hráč je `id`, `barva` a — jen tam, kde je
   popsaný sám předmět, třeba jméno na výseči kola — krátký `label`. Popisek
   **namalovaný na** točícím se předmětu je jeho součást, jako číslo v ruletové
   kapse. Věta, která říká, kdo byl vybrán, se pořád kreslí v RN, kde má typografii
   aplikace, Dynamic Type a hlas.
2. **Hra je zdroj náhody.** Výsledky jdou ven, ne dovnitř.
3. **Hra končí tím, že to řekne.** `result` má stejný tvar pro všechny hry —
   je to to, co konzumuje recap, feed i sdílený backend.

Appka pošle `init` **až po `ready`**. Dřív by dorazil, než se SDK stihne
přihlásit, a tiše by se ztratil.

### 21.6 Konec hry patří platformě

Hra ohlásí `result` a skončí; obrazovku kreslí **`GameResult`**, jedna pro
všechny hry. Výsledek nese jména a tváře, musí vypadat stejně napříč hrami a ta
samá data pak čte thread, recap i feed.

**Tvar se odvozuje z dat, ne z příznaku, který hra pošle.** Jedno jméno nahoře
vzniká z `payingId` nebo `winnerId`; tabulka pod ním se objeví, když hra vrátila
**víc než jedno skóre**, a nezobrazí se, když ne. Hra, která vybírá jednoho
člověka, pošle prázdné skóre a dostane jednu tvář; kvíz pošle pět a dostane
žebříček s vítězem vypsaným nad ním. Ani jedna neříká, co chce.

`variant` prop je věc, kterou může hra splést. „Je tu `payingId`, takže někdo
platí“ splést nejde.

Hra na pití dojde k „Dohráno“ nebo „Platí X“, **nikdy k vítězi** — jediná
tabulka, kterou by mohla vyrobit, je kdo nejvíc pil.

Plátno si přesto smí konec **oslavit** — konfety, rozsvícená vítězná výseč. To je
zdobení, ne vyprávění.

### 21.7 Hra na víc telefonů má tři stavy, ne dva

Pub kvíz je první hra, kde **každý hraje na svém**. To mění, co obrazovka je:
nekreslí stůl, kreslí pohled jednoho hráče na společnou otázku a nikdy nepředstírá,
že ví víc, než ten telefon může vidět.

| stav | co je vidět |
|---|---|
| ptá se | otázka a čtyři možnosti |
| **zamknuto** | tvoje odpověď je daná, chybějící jména jsou vypsaná |
| odhaleno | správná odpověď — až když odpověděli všichni |

**Zamknuto je vlastní stav, ne mezikrok.** Odhalit ve chvíli, kdy odpovíš *ty*,
znamená, že nejrychlejší u stolu odpověď přečte nahlas — a hospoda je přesně
místo, kde tohle nezůstane teoretické. Odpověď se taky nedá měnit; kvíz, ve kterém
si můžeš odpověď rozmyslet, když vidíš ostatní, není kvíz.

Čekání musí jít **přerušit** („Nečekat“). Někdo je na baru a hra, kterou odemkne
jenom člověk, co odešel, končí právě tam.

Skóruje se **po týmech**, a člověk hrající sám je tým o jednom. Party a komunitní
event jsou tím pádem jedna hra, ne dvě — kdyby se to psalo po lidech a týmy se
přidaly potom, každé pravidlo by existovalo dvakrát a ty dvě verze by se rozešly.

Stav je fold nad **append-only seznamem odpovědí**, nikdy uložený součet. Dva
telefony můžou odpovědět ve stejnou chvíli, pořadí nehraje roli, retry nemůže
započítat dvakrát a telefon, co byl offline, pošle svoje pozdě a nic se neslučuje.
Je to zároveň přesně tvar, který drží backend (`PartyGameEvent`, kind `answer`).

### 21.8 Hry, které máme (WebView)

| hra | plátno | co vrací |
|---|---|---|
| Kostky | 3D, fyzika (three + cannon) | `state` po každém hodu, `result` na konci |
| Flaška | 3D, roztočená láhev | `picked` po každém zastavení, nikdy nekončí |
| Kdo platí rundu | 3D kolo štěstí se jmény | `picked` a rovnou `result` — runda má jednoho plátce |

Kostky a Flaška se točí dál, dokud stůl nemá dost. Kolo **končí prvním
zastavením**, protože runda má právě jednoho plátce — a přesně kvůli tomuhle
rozdílu je v protokolu `result` a nestačí `event`.

Každá hra je jeden HTML soubor (~520–600 kB s vloženými knihovnami). Three.js je
v každém zvlášť; při osmi hrách to bude stát za sdílený chunk, do té doby je
samostatnost souboru cennější než ušetřené megabajty.

---

# ČÁST III — Otevřená práce a rozhodnutí

## Cover artwork her — největší kus

Dnes má každá hra dvoubarevný gradient a Lucide glyf. Funguje to a šlo to ven,
ale devět gradientů vedle sebe vypadá jako devět tlačítek. Potřeba: **devět
coverů, jeden styl.**

| | |
|---|---|
| formát | PNG, průhledné pozadí **ne** — cover je plná plocha |
| poměr | 3:2 (kreslí se na šířku karty, výška 112–150 pt) |
| export | `assets/games/covers/<key>@3x.png` + `@2x` |
| velikost | @3x ≈ 1200×800 px; generuj větší a zmenši |
| klíče | `quiz`, `dice`, `categories`, `never`, `kings`, `round`, `bottle`, `thumb`, `rules` |

**Na co si dát pozor.** Devět samostatných pokusů = devět stylů. Postup, který
fungoval u odznaků (`docs/badge-art-brief.md`): udělej **jeden** cover, dolaď ho
do finále, a pak ho přikládej ke každému dalšímu jako referenci stylu.

Cover se překrývá názvem hry a play buttonem, takže **dolní třetina musí být
klidná** — tam jde text. Žádný text v obrázku; názvy jsou v appce a musí jít
změnit bez překreslení.

## Onboarding

Ilustrace jsou pryč, místo nich jsou tři skutečné kusy appky: kompasová buňka,
čísla večera s vláknem, žebříček. Reálné komponenty s natvrdo danými propsy, ne
obrázky — takže když se změní design buňky, změní se i promo.

Tři staré PNG v `assets/images/onboarding/` čekají na smazání, až autor
potvrdí, že náhrada sedí.

## Akce v komunitě

Dnes: gradient s datem v rohu. Události mají místo, čas a lidi — poster tam dává
smysl líp než u výzev. Otevřená otázka: **kdo poster dodá?** Pořadatel při
zakládání akce, nebo se generuje z názvu a data?

## Paleta iniciálových avatarů

Šest odstínů pro iniciálová pozadí (§20.10) čeká na potvrzení nebo přepsání:
`#7DD66B`, `#F0BE5C`, `#A8896A`, `#FBF3E0`, `#6FB3D9`, `#D98C6F`.

## Mocky jsou kánon (rozhodnuto 11. 8. 2026)

Mockový jazyk 3.0 (`src/mocks/`, `src/feed/`, `src/party/`, `src/pubs/`, `src/community/`,
`src/profile/`, `src/search/`) je **finální vizuální kánon** a Část II je přepsaná podle něj:
ploché seznamy a `SectionBreak` (§5), škála `MockType` bez verzálkových kickerů (§3.1), radiusy
20–34 (§5.3), tlačítka bez glow s tichou `stout3` sekundární pilulkou (§6), dva druhy sheetů (§7).
Dřívější rozhodnutí (1. 8. 2026): tmavší zem a systémové písmo.

Zbývající dev-dluh mocků a kódu vůči dokumentu (opravuje se v kódu, ne v dokumentu):

- **Copy inline v komponentách** — §12 platí, texty patří do `src/i18n/cs.ts`; 7 z 9 mock
  obrazovek je má natvrdo. Přesouvá se při oživování obrazovek (plánuje se angličtina).
- **Starší obrazovky (2.x)** pořád používají `CardSurface`, glow, outline sekundárky, vlastní
  statistické bloky a 32pt close plošky. Migrují se po celku, ne po jednom; nový kód je nekopíruje.
- **`includeFontPadding: false` a `lineHeight` chybí** na některých `Fonts.numeral` textech
  (`StatGrid.value`, wordmark, výsledek hry).
- **`expo-glass-effect`** je přímo importovaný, ale chybí v `package.json` (§15.2).
- **Feed pás** přetéká o −14 místo −20 na screen padding (§5.1).
- `HEADER_GRADIENT` / `LIVE_GRADIENT` / `GradientBand` jsou definované, ale žádná etalonní
  obrazovka je zatím nepoužívá (§16.3).
- Komentář „Eight games, three shells“ v `gameCatalog.ts` je zastaralý (šest typů, pět použitých).

## Otevřená produktová rozhodnutí

- **Auto-friendship.** Doporučení: auto-**návrh**, ne automatická vazba. Sedět
  s někým v hospodě není souhlas s trvalou sociální vazbou.
- **Verze bez přihlášení** — co se stane s lokálními záznamy, když se člověk
  přihlásí do účtu, který už data má (`docs/no-account-mode.md`).
- **Názvosloví** pro sledování: „Sledovat“ vs „Parťák“ (§20.8).
- **Monetizace.** Free/pro hranice není daná. Sdílený večer a hry jsou levné;
  drahé jsou datové a proxy části.

## Co nedělat

- **Světlý režim.** Odložený vědomě — zdvojil by práci na každé obrazovce.
- **Grafy v běžícím večeru.** Patří do recapu (§20.2).
- **Cokoliv, co počítá promile, útratu nebo čas do řízení.** Rozhodnuto
  a nediskutovatelné (`docs/decisions/no-bac-or-driving-estimates.md`).
- **Žebříček, který korunuje toho, kdo nejvíc vypil.** Hra na pití nemá vítěze.

## Jak předávat assety

Cokoliv rastrového do `assets/`, `@2x` a `@3x`, nic většího než 3x. Rozhodnutí
(barvy, pravidla, kde co je) rovnou do tohohle dokumentu — je závazný a rozpor
se řeší jeho změnou.
