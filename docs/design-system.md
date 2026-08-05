# Na pivo — design system

> **Etalon:** obrazovka Štamgast → Počítat.
> Soubory: `src/counter/CounterScreen.tsx`, `CoasterCard.tsx`, `CounterCta.tsx`,
> `CounterQuickActions.tsx`, `NudgeSlot.tsx`, `PlaceChip.tsx`, `DrinkPickSheet.tsx`,
> `ReceiptSheet.tsx`, `CounterMoreSheet.tsx`, `src/components/shared/CardSurface.tsx`,
> `src/components/shared/DoorRail.tsx`, `src/beer/BeerScreen.tsx`.
>
> Tenhle dokument je **závazný**. Když stavíš nebo přestavuješ obrazovku, hodnoty se neopisují
> „přibližně“ — kopírují se. Když ti nějaké pravidlo brání, řekni to nahlas a navrhni změnu
> dokumentu; netiš to lokální výjimkou v jednom souboru.
>
> Kód, tokeny a identifikátory anglicky. UI copy česky, tykáním. Viz `src/i18n/cs.ts`.

---

## 0. Zákon zjednodušení (nadřazený všemu ostatnímu)

**Hlavní cíl přestavby není přemalovat appku, ale zjednodušit ji.** Když je spor mezi „vypadá to
podle etalonu“ a „je toho na obrazovce míň“, vyhrává „je toho míň“.

Zjednodušení znamená **prázdnější plochu, ne chudší produkt**. Tácek je důkaz: nepřišel o jedinou
funkci, jen přestal ukazovat všechno naráz. Postup je vždycky stejný:

1. **Jedna primární akce.** Na obrazovce právě jedna věc, která svítí. Zbytek ztiší nebo přesuň.
2. **Tři bloky nad ohybem, víc ne.** Co se nevejde, patří níž, do sheetu nebo o obrazovku dál.
3. **Jedna cesta k jedné věci.** Tři způsoby, jak udělat totéž, byly hlavní problém starého
   počítadla. Když najdeš duplicitní cestu, **zruš ji** — nezachovávej ji „pro jistotu“.
4. **Okrajové akce do jednoho `…` sheetu.** Ne do headeru, ne do karty, ne do plovoucí pilulky.
   **Rovnocenný povrch ale okrajová akce není.** Mapa je dvojče kompasu, ne položka menu — proto
   sedí v headeru jako polovina titulku (`ExploreSwitch`, `variant="flat"`) a v `…` sheetu už
   není. Když povrch pustíš do headeru, **musíš** jeho řádek ze sheetu smazat (§14.4).
5. **Zruš dekoraci, která nic neříká.** Rozmazané záře na pozadí, jantarové kickery nad každou
   sekcí, rámečky kolem rámečků, emoji v chromu, ikona u každého řádku.
6. **Slučuj sekce.** Dvě sekce, které uživatel čte jako jednu věc, mají být jedna karta.

### Co „nesmí zmizet ani jedna funkce“ znamená

Funkce se **nesmí ztratit**, ale skoro jistě se **má přestěhovat**. Povolené přesuny:

| Z | Do |
|---|---|
| trvale viditelná sekundární akce | `…` sheet |
| tři chipy vedle sebe | jeden sheet s jedním záměrem |
| dvě sekce se stejným kickerem | jedna karta |
| pole formuláře uprostřed scrollu | sheet, který ho vlastní |
| údaj, který nikdo nečte | pryč z povrchu, zůstává v detailu |

Zakázané je jen jedno: **funkci potichu smazat**. Každý přesun musí být v závěrečném reportu
vypsaný jako „odkud → kam“.

---

## 1. Filosofie

Vizuální jazyk Na pivo je **tácek pod pivem v tmavé hospodě**. Pozadí je stout — skoro černá s teplým
hnědým podtónem — a všechno, co na něm leží, je papírově světlé nebo jantarové. Na obrazovce je vždycky
**jedno velké číslo nebo jedna velká věc, jedna jantarová akce a nic dalšího, co svítí**. Karta drží
obsah, aby uprostřed obrazovky nikdy nezůstala prázdná plocha, která by ji shodila na drátěný model.
Osobnost dodává jeden kreslený vektorový prvek, ne dekorace, ne animace a rozhodně ne emoji v chromu.

---

## 2. Barvy

### 2.1 Tokeny (`src/theme/colors.ts`)

| Token | Hex | K čemu to je |
|---|---|---|
| `Colors.stout` | `#15120F` | Pozadí obrazovky (root). Nic jiného. |
| `Colors.stout2` | `#1C1815` | Plocha karty a bottom sheetu. O stupeň světlejší než root. |
| `Colors.stout3` | `#262019` | Vnořený prvek uvnitř karty/sheetu: řádek, strip, chip, close button. |
| `Colors.border` | `#3A322A` | Plný okraj sheetu, grabber, dělítka uvnitř sheetu. Často s alfou. |

> **Změna 3.0.** Tyhle čtyři byly teplejší hnědé (`#1F1308` / `#2B1A0E` / `#3A2515` /
> `#5A3A20`). Proti referencím — Strava i Packeta sedí na skoro černé — ta hnědá
> nečetla jako hloubka, ale jako tint přes celou appku, a je z velké části důvod,
> proč rané návrhy působily levněji, než byly. **Hnědá z produktu nezmizela**,
> jen se přestěhovala z pozadí do světla: žije v gradientech (§16).
>
> Nikdy ne čistě černá. Na appce s teplým akcentem čte jako díra a OLED smear
> při scrollu stojí víc, než kolik ten tint ušetří.
| `Colors.amber` | `#E8A317` | Akcent. Primární tlačítko, hlavní číslo, ikony, aktivní stav. |
| `Colors.amberLight` | `#F5B642` | Jen uvnitř ilustrací (horní stop gradientu piva). |
| `Colors.glow` | `#FF7A1A` | **Jen** `shadowColor` v `amberGlow*`. Nikdy jako fill nebo text. |
| `Colors.neon` | `#FFD27A` | Rezerva pro zvýrazněné stavy. Na etalonu se nepoužívá. |
| `Colors.foam` | `#FBF3E0` | Primární text a světlé hairliny (s alfou). |
| `Colors.foamMuted` | `#E8DCC0` | Sekundární text, popisek pod číslem, ikona zavírání. |
| `Colors.mutedText` | `#A8896A` | Terciární text, meta řádky, neaktivní stav, „…“ ikona. |
| `Colors.success` | `#7DD66B` | Potvrzení. Používej střídmě; jantar většinou stačí. |
| `Colors.open` | `#F0BE5C` | Otevřeno (otevírací doba) — text i stavová tečka. |
| `Colors.closed` | `#A8896A` | Zavřeno. Nikdy červená — nemáme na uživatele křičet. |
| `Colors.black` | `#000000` | Jen backdrop (`withAlpha(Colors.black, 0.6)`) a `softDrop()`. |
| `Colors.white` | `#FFFFFF` | Nepoužívat na text. Text je `foam`. |

`withAlpha(hex, alpha)` z `@/theme/colors` přidá alfa kanál k šestimístnému hexu. Alfu píšeme vždycky
přes něj, nikdy ručně `'#FBF3E01A'` a nikdy `opacity` na kontejneru s textem.

### 2.2 Pravidla užití

**Plná jantarová plocha smí být na obrazovce právě jednou.** Patří primárnímu tlačítku
(`backgroundColor: Colors.amber`). Druhá plná jantarová plocha je bug. Výjimka existuje jen pro
malý potvrzovací pill uvnitř nudge stripu (`filledPill` v `NudgeSlot`), a i ten je vidět max
5 vteřin a nikdy zároveň s ničím jiným jantarovým.

**Jantar jako text/ikona** patří hlavnímu číslu (`CoasterCard.count`), ikonám v jantarových
„medailoncích“, akcentovaným captionům a odkazu typu „Účet →“. To je tenká, ne plošná barva.

**Sekundární akce = jantar na 6 %:**

```ts
backgroundColor: withAlpha(Colors.amber, 0.06),
borderWidth: 1,
borderColor: withAlpha(Colors.amber, 0.18),
```

To je přesně `CounterSecondary`. Dost na to, aby to patřilo do rodiny, ani zdaleka ne dost na to,
aby to soupeřilo s plným tlačítkem.

**Neutrální chrome (segmenty, rámečky, hairliny) = pěna na 4–14 %:**

| Použití | Hodnota |
|---|---|
| Pozadí segmentovaného přepínače | `withAlpha(Colors.foam, 0.04)` |
| Okraj karty | `withAlpha(Colors.foam, 0.07)` |
| Okraj segmentovaného přepínače | `withAlpha(Colors.foam, 0.08)` |
| Hairline dělítko uvnitř karty / patka sheetu | `withAlpha(Colors.foam, 0.10)` |
| Aktivní segment (fill) | `withAlpha(Colors.foam, 0.10)` |
| Světelný hairline na horní hraně CTA | `withAlpha(Colors.foam, 0.55)` |
| Jantarový medailonek pod ikonou v řádku | `withAlpha(Colors.amber, 0.12)` |
| Okraj jantarového chipu (stav „vyžaduje akci“) | `withAlpha(Colors.amber, 0.32)` |
| Okraj rapid-confirm stripu | `withAlpha(Colors.amber, 0.42)` |
| Neutrální okraj stripu | `withAlpha(Colors.border, 0.6)` |
| Dělítko mezi řádky v sheetu | `withAlpha(Colors.border, 0.4)` |

**Segmentovaný přepínač mimo kartu je plný `stout3`.** Pěna na 4 % funguje jen na světlejší ploše
karty (`LayerSwitch` v kartě mapy). Přímo na `stout` je ten rozdíl skoro neviditelný, dráha zmizí a
přepínač se rozpadne na tři volná slova. Přepínač, který leží na holé obrazovce (`BoardSegmented` na
Žebříčcích), má proto `backgroundColor: Colors.stout3`, okraj `withAlpha(Colors.border, 0.6)` a jeden
posuvný thumb `withAlpha(Colors.foam, 0.10)` se stejným okrajem.

**Rozpad 60 / 30 / 10.** 60 % plochy je `stout` + `stout2` (pozadí a karta), 30 % je text v odstínech
`foam` / `foamMuted` / `mutedText`, 10 % je jantar. Když se při návrhu dostaneš přes ~10 % jantaru,
něco jsi udělal plochou místo textem.

---

## 3. Typografie

Typografie je **systémové písmo** (San Francisco), všude. `src/theme/fonts.ts`
neexportuje žádné rodiny — jen `FontScaleCap`.

Váha se píše jako `fontWeight`, nikdy jako název rodiny. Dřív ji nesl název
(`Baloo2-ExtraBold`), takže `fontFamily` a `fontWeight` si na jednom stylu
odporovaly.

**Proč:** 3.0 stojí na skutečných systémových prvcích — segmented picker,
kotvená menu, SwiftUI grafy, nativní velké titulky (§18). Vlastní rodina vedle
nich staví na jednu obrazovku dvě abecedy. SF navíc nese optical sizing a
škáluje s Dynamic Type, což přibalená TTF neumí.

**Jedna výjimka: `Fonts.numeral` — Baloo 2 ExtraBold, jen na display číslice.**

SF je záměrně neutrální. To je správně pro řádek v nastavení a špatně pro číslo,
které říká, jak dopadl večer — v SF čtou jako tabulka, v Baloo jako tahle appka.
Ta čísla jsou nejblíž tomu, co má produkt místo tváře.

Platí to **jen pro číslice** (`StatGrid`, hero čísla, série, postup výzvy). Body
text, popisky, nadpisy a tlačítka zůstávají systémové — dvě abecedy v odstavci
je přesně to, co jsme odstranili.

Baloo 2 ExtraBold **přetéká svůj řádkový box**, takže každý styl, který ho
používá, potřebuje `lineHeight` kolem 1,24× velikosti (§3.2). Bez toho se číslo
ořízne shora.

Zbylé TTF zůstávají v `assets/fonts/` nenačtené.

Jednoduché rozhodovací pravidlo: **když to má znít, je to Baloo. Když se to má číst, je to Inter.**

### 3.1 Čtyřstupňová škála (přesně z etalonu)

| Stupeň | Velikost | Rodina | Barva | Kde |
|---|---|---|---|---|
| **display numeral** | 88 / 72 / 56 | `Fonts.display.extrabold` | `Colors.amber` | Hlavní číslo v kartě |
| **nadpis** | 20 | `Fonts.display.extrabold` | `Colors.stout` (na jantaru) | Label primárního tlačítka |
| **body** | 15 | `Fonts.ui.semibold` | `Colors.foam` | Řádky seznamů, fakta, sekundární label |
| **caption** | 13 | `Fonts.ui.medium` | `Colors.mutedText` | Meta pod řádkem, „před 12 min“, subLabel |

Doplňkové, odvozené stupně (používej je, ale nezaváděj páté a šesté):
`22` Baloo extrabold = titulek bottom sheetu · `18` Baloo extrabold = `PlaceChip` (název místa) ·
`17` Baloo extrabold = řádek „Celkem“ · `14` Baloo bold = label pilulky / segmentu ·
`13` Baloo bold `letterSpacing: 3` = popisek pod číslem (verzálky) ·
`11` Inter bold `letterSpacing: 1.5` = jantarový caption sekce v sheetu.

Velké číslo se **zmenšuje podle počtu číslic**, aby nikdy nerozbilo kartu:

```ts
function countFontSize(count: number): number {
  if (count < 10) return 88;
  if (count < 100) return 72;
  return 56;
}
```

**Když je číslo jediný obsah karty, je 88 podlaha, ne strop.** Karta počítadla nemá ilustraci, takže
se číslo měří z karty (`countNumeralSize` v `CoasterCard.tsx`): výška těla mínus místo na popisek,
lomeno 1.24, zastropováno na 132 a navíc omezeno šířkou (`digits × 0.62 × fontSize ≤ šířka`), aby
tříciferný večer nepřetekl na iPhonu SE. `adjustsFontSizeToFit` je pojistka, ne návrh — číslo, které
si velikost tiše určí samo, je číslo, jehož velikost nikdo neřídí.

### 3.2 Povinná pravidla pro velká čísla

```tsx
<Text
  style={[
    styles.count,
    { fontSize: countFontSize(count), lineHeight: countFontSize(count) * 1.24 },
  ]}
  numberOfLines={1}
  maxFontSizeMultiplier={FontScaleCap.display}
>
  {count}
</Text>
```

```ts
count: {
  fontFamily: Fonts.display.extrabold,
  color: Colors.amber,
  includeFontPadding: false,
  fontVariant: ['tabular-nums'],
},
```

- **`lineHeight = fontSize * 1.24` je povinné.** Baloo 2 ExtraBold má výrazný overshoot horních
  partií číslic. Když `lineHeight` chybí (RN dopočítá zhruba `fontSize`), **iOS svisle ořízne vršek
  cifer** — u „8“ zmizí horní oblouk. 1.24 nechá reálnou hlavičku. Prázdné místo, které tím vznikne
  dole, se zavírá zápornou horní marží popisku (`marginTop: -8` na `noun`), aby číslo + popisek
  četly jako jeden objekt, ne jako dva labely nad sebou.
- **`fontVariant: ['tabular-nums']` je povinné** u čehokoliv, co se v čase mění (počty, ceny, časy).
  Bez toho číslo při každé změně poskočí do stran.
- **`includeFontPadding: false`** dávej **na každý `<Text>`** s vlastním `fontFamily`. Android jinak
  přidává neviditelné odsazení a rozbíjí svislé zarovnání proti ikonám.

### 3.3 Dynamic Type

**Každý `<Text>` musí mít `maxFontSizeMultiplier`.** Bez stropu Samsung škáluje až ~2.0× a rozbije
kompozici. Používej `FontScaleCap` z `@/theme/fonts`:

| Cap | Hodnota | Pro co |
|---|---|---|
| `FontScaleCap.display` | `1.1` | Velká čísla, label primárního tlačítka, badge s počtem |
| `FontScaleCap.heading` | `1.2` | Titulky sheetů, název místa, labely pilulek |
| `FontScaleCap.body` | `1.3` | Běžný text, meta řádky, popisky |

Když se label i tak nevejde, přidej `adjustsFontSizeToFit` + `minimumFontScale={0.8}` (viz label CTA).
Nikdy ne `numberOfLines` bez `flexShrink: 1` na rodiči — jinak text netruncuje, ale vytlačí sourozence.

---

## 4. Mezery a grid

Osmibodový grid. Povolené hodnoty: **4 / 8 / 12 / 16 / 20 / 24 / 28 / 32 / 40 / 48**.
Tokeny (`src/theme/layout.ts`): `Spacing.xs 4`, `sm 8`, `md 14`, `lg 20`, `xl 28`, `xxl 40`.
Literál (`12`, `16`, `24`) je v pořádku tam, kde token neexistuje — etalon to tak dělá — ale nikdy
nevymýšlej `13`, `18`, `22`.

Konkrétní hodnoty z etalonu:

```ts
surface: {
  paddingHorizontal: 24,   // boční okap celé obrazovky
  gap: 12,                 // mezera mezi hlavními bloky
},
header: {
  minHeight: 40,           // řádek headeru; dotykový cíl dělá hitSlop dětí
  marginBottom: 4,         // + gap 12 = 16 pod headerem
},
// horní okap obrazovky: paddingTop: insets.top — bez přídavku
```

- **Vnitřní padding karty: 24** vodorovně, 24 nahoře (dole 8, protože patka má vlastní `paddingTop`).
- **Mezera mezi bloky: 12.** Jedna `gap` na kontejneru, ne marginy na dětech.
- **Kolem headeru: 24 po stranách, 16 pod ním** (4 marginBottom + 12 gap). Header je vizuálně
  oddělený, ale pořád patří k obsahu.
- **Nad headerem nic navíc: `paddingTop: insets.top`.** Status bar je na telefonu s ostrovem sám o
  sobě ~60 pt hnědého čela; každý přidaný bod se pak čte jako prázdné čelo, ne jako vzduch. Řádek
  headeru je proto 40 a jeho tlačítka si 44pt dotykový cíl dodělávají `hitSlop`em, ne výškou řádku.
- **Uvnitř sheetu:** `paddingHorizontal: Spacing.lg` (20), `paddingTop: Spacing.sm` (8).
- **Spodní okap obrazovky:** `paddingBottom: Math.max(insets.bottom, Spacing.sm)`.

**Relationship-based spacing.** Vzdálenost = vztah. Věci, které patří k sobě, mají 4–8 (číslo a jeho
popisek: `-8`, protože je to doslova jeden objekt; ikona a text: 6–8). Věci ve stejné skupině 12.
Různé bloky 20–24. Nikdy nedávej stejnou mezeru mezi „ikona ↔ její label“ a „blok ↔ blok“ — kompozice
se pak čte jako seznam náhodných prvků.

---

### 4.4 Hustota: co dělá „lacině" (3.0)

Tři věci, které se opakovaně vracely a pokaždé to vypadalo levněji, než produkt
je. Všechny jsou rozměrové, takže nejsou věc vkusu.

| Prvek | Minimum | Proč |
|---|---|---|
| Řádek seznamu | **60 pt**, u dvouřádkového **68** | 44 je minimum pro *dotyk*, ne pro čtení. Seznam natěsnaný na dotykové minimum čte jako tabulka. |
| Vnitřní okraj sheetu | `MockLayout.screenPad` (20) | Sheet je obrazovka, ne popup. Menší okraj tlačí obsah na sklo. |
| Nadpis → jeho obsah | `MockLayout.controlGap` (24) | Nadpis nalepený na první řádek se čte jako jeho součást. |
| Sekce → sekce | `SectionBreak` (§ 4.5) | Mezera sama nestačí, viz níž. |

**Pravidlo:** když se ptáš, jestli je něčeho moc, je ho málo. Tenhle produkt se
používá v hospodě, jednou rukou, v šeru — vzduch není luxus, je to čitelnost.

A dvě věci, které se pojí s tím samým dojmem:

- **Zavírací křížek** je `CloseButton`, 44 pt, na skle (§7.2c). 32pt ploška je
  pod dotykovým minimem a na skleněném povrchu čte jako díra.
- **Ovládací prvky mají být systémové**, kde existují (§18). Ruční nápodoba
  nativního prvku je nejlevněji vypadající věc, kterou lze na iOS udělat.

## 5. Karty

### 5.1 Recept

**Recept není v žádné obrazovce. Je v `src/components/shared/CardSurface.tsx`** a všechny hero
karty (počítadlo, kompas, profil, deník, parta, příchod) ho jen rozbalí:

```ts
card: {
  ...CardSurface.card,     // stout2, radius 28, okraj foam 7 %, padding 24/24/8, softDrop
  flex: 1,                 // karta žere prostor mezi headerem a tlačítkem
},
```

A jako **první dítě** karty jde `<CardSheen />`: jeden světelný hairline po horní hraně
(`foam 22 %`, vsazený 14 % z každé strany) a jemný přeliv shora dolů (`foam 5 % → 0` na horních
42 % karty). Bez toho je karta plochý hnědý obdélník; s tím čte jako nasvícený fyzický povrch.

**Tohle není zakázaná záře.** `Colors.glow` v tom nevystupuje, nic se nerozmazává, nic nesvítí
za obsahem a nic se nehýbe — je to pěna na 5–22 % na hraně panelu. Radiální halo za obsahem
zůstává zakázané (§14.3).

Karta si vlastní i patku: `CardSurface.footer` je ten hairline + `space-between` řádek.

Vnořené prvky uvnitř karty jsou `Colors.stout3` s `Radius.medium` (16) nebo `Radius.pill`.
Patka karty je hairline, ne plná linka:

```ts
footer: {
  marginTop: 20,
  paddingTop: 12,
  borderTopWidth: StyleSheet.hairlineWidth,
  borderTopColor: withAlpha(Colors.foam, 0.1),
},
```

Radiusy (`Radius`): `small 8`, `medium 16` (řádky, stripy), `card 22`, `cardLarge 28` (karty a horní
rohy sheetů), `pill 999` (tlačítka, chipy, ikonové cíle).

### 5.2 Nikdy dva `flex: 1` sourozenci

Na jedné úrovni smí být **maximálně jeden** prvek s `flex: 1`. Ten je „ten, co dýchá“. Ostatní mají
pevnou výšku nebo `flexShrink: 1`. Dva `flex: 1` sourozenci znamenají, že se prostor dělí půl na půl
bez ohledu na obsah, a na malém telefonu se oba useknou uprostřed.

Etalon: `CoasterCard` má `flex: 1`, `NudgeSlot` má pevných 52, `CounterCta` pevných 84, header
`minHeight: 40`. Přesně jeden dýchá.

### 5.3 Obsah se dimenzuje Z karty, ne naopak

Nikdy nedávej ilustraci ani velký prvek pevnou velikost a nedoufej, že se karta přizpůsobí.
Změř kartu a odvoď od ní velikost obsahu:

```tsx
const [bodyHeight, setBodyHeight] = useState(0);
// clamp: nikdy menší než 72, nikdy větší než 108
const ringSize = bodyHeight > 0
  ? Math.max(72, Math.min(108, Math.round(bodyHeight * 0.52)))
  : 92;

<View style={styles.body} onLayout={(e) => setBodyHeight(e.nativeEvent.layout.height)}>
  …
  <LevelRing level={level} title={title} progress={progress} size={ringSize} />
</View>
```

Na iPhonu SE se prstenec zmenší; na iPhonu 16 Pro Max naroste na strop. Nikdy nepřeteče kartu.
Vždycky měř s fallbackem (`bodyHeight > 0 ? … : 92`), aby první frame nebyl nulový. Stejně se měří
i velké číslo v kartě počítadla (§3.1) a ciferník kompasu.

### 5.4 Otevírací doba má vlastní řádek

V patce karty kompasu jde **nejdřív název hospody, pak otevírací doba na vlastním řádku se stavovou
tečkou, a teprve pak pivo s cenou**. Dřív to byla jedna 13pt věta („Otevřeno do 23:00 · Pilsner
Urquell 95 Kč"), takže údaj, kvůli kterému člověk kouká do telefonu na ulici, se ořezával první.

- Tečka 6 × 6 pt, `Radius.pill`, barva `Colors.open` / `Colors.closed` / `Colors.mutedText`. Je to
  jediná tečka v appce, která smí být ozdobného tvaru, protože nese skutečný stav.
- Oba řádky sedí v jednom slotu s **pevnou výškou 38** — hodiny dojdou ze sítě chvíli po názvu a
  ciferník se kvůli nim nesmí přeměřovat.
- Když hledání dojede naprázdno, řekne se to („Otevírací doba neznámá") — a tečka zůstává, protože
  ten řádek je pořád o otevírací době. Vedle toho stojí dveře „Zmapuj", takže z neznalosti rovnou
  plyne úkol. Ticho drží jen po dobu, kdy dotaz běží — nikdo nečte „Načítám".
- **Stejná anatomie platí pro kartu na mapě** (`PlaceCard`): název na vlastním řádku přes celou
  šířku, pod tím hlasitá otevírací doba s tečkou, pod tím tichý řádek (hodnocení, město, „byl jsi
  tu"). Slot má pevných 38, aby se karta nepřeměřovala, když dojdou hodiny nebo když vybereš pin.
- **Dveře stojí na tichém řádku, ne vedle názvu.** Vedle názvu braly „Restauraci U Parlamentu"
  půlku šířky a lámaly ji na dva řádky; vycentrované proti celému bloku zase nesedí na žádný
  řádek. Tichý řádek je nejkratší, takže na dveře má místo a obě půlky sdílí jednu osu.

### 5.5 Řádky v kartě: rychlé akce a lišta dveří

Karta drží pod velkým číslem nanejvýš dva řádky, a jsou to jediné povolené:

| Řádek | Co v něm je | Jak vypadá |
|---|---|---|
| `CounterQuickActions` | „Jiné pivo", „Zmapuj" | outline chipy, `height: 44`, jantar na 6 % / okraj 18 %, `flex: 1` každý |
| `DoorRail` | Výčep, Žebříčky, FotoPivař (v kartě Party) | tři stejné sloupce, jantarový medailonek 34 pt, label 13 Baloo bold, svislý hairline mezi nimi |
| `LayerSwitch` (karta na mapě) | V okolí, Moje stopy, Parta teď | segmentovaná dráha `foam 4 %` / okraj 8 %, aktivní `foam 10 %`, výška 38 |

Pravidla, aby z toho nebyla mřížka tlačítek:

- **Oddělují se světlem, ne rámečkem.** Hairline nad řádkem (`foam 10 %`) a mezi sloupci
  (`foam 10 %`, výška 26–28). Tři ohraničené dlaždice v ohraničené kartě je rámeček na rámečku (§14.10).
- **Chip se zobrazí jen když jeho akce něco dělá jinak než CTA.** „Jiné pivo" existuje pouze ve
  chvíli, kdy tlačítko opakuje poslední pivo; jinak by to byly dvě dveře do jednoho sheetu (§14.4).
  „Zmapuj" existuje jen v hospodě.
- **Lišta je navigace, ne akce.** Vede na povrch (Výčep, žebříček, soutěž), nic nepočítá a nic
  nemaže. Proto neporušuje pravidlo jedné akce (§6.3) — to mluví o akcích, ne o dveřích.
- **Jeden živý údaj, a jen když je zdarma.** Badge čte číslo z už uloženého snapshotu. Vymyšlené
  číslo je horší než žádné číslo.
- **Jedna obrazovka jedny dveře.** Lišta žila i v kartě počítadla (Parta / Pivaři / FotoPivař) a
  vedla tam, kam vede tab bar a lišta na Partě. Tři dveře na totéž jsou šum: komunitní povrchy
  vlastní tab Parta, Štamgast zůstal u vlastního pití (§0.4).
- **Režim povrchu je ovládací prvek, ne popisek.** Vrstvy mapy byly tři řádky v `…` sheetu a karta
  jen tiskla jméno té aktivní. Teď jsou to segmenty v patce karty a ze sheetu zmizely — jedny dveře
  na jedno místo (§0.4).

---

## 6. Tlačítka

### 6.1 Primární — jedno na obrazovku

```ts
const CTA_HEIGHT = 84;
const PRESS_SWALLOW_MS = 700;

button: {
  height: CTA_HEIGHT,
  borderRadius: Radius.pill,
  backgroundColor: Colors.amber,
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: 28,
  overflow: 'hidden',
},
// aplikuje se ve style array: [styles.button, amberGlowStrong(22), pressed && styles.pressed]
topLight: {
  position: 'absolute',
  top: 0, left: '12%', right: '12%',
  height: 1,
  backgroundColor: withAlpha(Colors.foam, 0.55),
},
pressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
label: {
  fontFamily: Fonts.display.extrabold,
  fontSize: 20,
  color: Colors.stout,
  textAlign: 'center',
  includeFontPadding: false,
},
subLabel: {
  fontFamily: Fonts.ui.semibold,
  fontSize: 13,
  color: withAlpha(Colors.stout, 0.72),
  marginTop: 2,
  includeFontPadding: false,
},
```

- **Glow:** `amberGlowStrong(22)` z `@/theme/shadows`. Na obrazovce svítí **právě jeden** prvek.
  `Colors.glow` je výhradně `shadowColor`, nikdy fill.
- **`topLight`** — jeden pixel světla po horní hraně, aby tlačítko četlo jako nasvícený fyzický
  povrch, ne jako plochý vzorník barvy. Musí mít `pointerEvents="none"`.
- **Label vždycky říká, co jeden tap udělá** („Ještě jedno“, „Co si dáš?“, „Zapiš první pivo“).
  Nikdy generické „Pokračovat“ nebo „OK“.
- **Debounce 700 ms** uvnitř komponenty, přes `useRef` (žádný state — spolknutý tap nesmí nic
  překreslit). Když se změní `label`, debounce se resetuje, protože nový label = nová akce:

```tsx
const lastPressAtRef = useRef(0);
useEffect(() => { lastPressAtRef.current = 0; }, [label]);
const handlePress = useCallback(() => {
  const now = Date.now();
  if (now - lastPressAtRef.current < PRESS_SWALLOW_MS) return;
  lastPressAtRef.current = now;
  onPress();
}, [onPress]);
```

Alternativa pro ne-hero obrazovky: `GlowButton` z `@/components/shared/GlowButton`
(`variant="primary"`, `glow="soft"` = `amberGlow(18)`, default `height: 62`).

### 6.2 Sekundární — outline, nikdy fill

```ts
secondary: {
  height: 48,
  borderRadius: Radius.pill,
  borderWidth: 1,
  borderColor: withAlpha(Colors.amber, 0.18),
  backgroundColor: withAlpha(Colors.amber, 0.06),
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: 24,
},
secondaryLabel: {
  fontFamily: Fonts.ui.semibold,
  fontSize: 15,
  color: Colors.foamMuted,
  includeFontPadding: false,
},
secondaryPressed: { opacity: 0.7 },
```

V sheetech se sekundární tlačítko dělá jako `<GlowButton variant="secondary" glow="none" />`.

### 6.3 Pravidlo jedné akce

Na obrazovce je **jedna primární akce a jeden glow**. Sekundární tlačítko je nanejvýš jedno a je vždy
outline. Cokoli dalšího jde o tap hlouběji do pojmenovaného sheetu. Když se ti na obrazovku tlačí
třetí rovnocenná akce, je to signál, že tam patří overflow („…“ → sheet), ne třetí pilulka.

---

## 7. Bottom sheet — kanonický recept

Přepsáno z `DrinkPickSheet.tsx`. Tohle je **jediný** správný způsob, jak v téhle aplikaci udělat
spodní panel. Modal, ne knihovna.

### 7.1 Proč právě takhle

| Rozhodnutí | Důvod |
|---|---|
| `transparent` + `statusBarTranslucent` + `presentationStyle="overFullScreen"` | Sheet musí kreslit přes status bar i přes tab bar. Bez `statusBarTranslucent` zůstane na Androidu nad backdropem pruh. |
| `animationType="none"` + `BottomSheetModal` | Viz níž. Ani `fade`, ani `slide`. |
| Backdrop je **absolutní sourozenec** karty (`StyleSheet.absoluteFill`), ne její rodič | Kdyby backdrop kartu obaloval, karta by nesedla nadoraz na spodní hranu a backdrop by polykal její gesta. |
| `cardWrap` má `marginBottom: -insets.bottom` | Vytáhne kartu pod home indicator, takže mezi kartou a spodní hranou displeje nezůstane proužek pozadí. |
| Karta má `paddingBottom: insets.bottom + Spacing.lg` | Obsah se přitom nedostane pod home indicator. Ty dvě věci jdou vždycky spolu. |
| Sloupec **pevná hlavička → `ScrollView` s `flex: 1` → pevná patka MIMO scroll** | Patka (akce, součet, zavírací tlačítko) nesmí odscrollovat ani se nechat ustřihnout `maxHeight`. |
| `minHeight: '56%'`, `maxHeight: '92%'` | Sheet nikdy nevypadá jako proužek a nikdy nezakryje celou obrazovku. Receipt používá `minHeight: '44%'`. |
| `grabber` (40 × 4) | Vizuální afordance „tohle je sheet“. |
| Backdrop má `accessibilityElementsHidden` + `importantForAccessibility="no"` | Jinak VoiceOver ohlásí „Zavřít“ dvakrát — jednou backdrop, jednou skutečné tlačítko. |
| Karta je `Pressable` s prázdným `onPress` | Spolkne tap, aby stisk řádku nepropadl na backdrop a sheet se nezavřel. |

### 7.2 Kostra k překopírování

```tsx
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import { XIcon } from '@/components/shared/IconGlyph';

export function ExampleSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        {/* Dismiss target BEHIND the card, never its parent. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          {/* Swallows presses so a row tap never falls through to the backdrop. */}
          <Pressable
            style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}
            onPress={() => undefined}
          >
            <View style={styles.grabber} />

            {/* 1 — fixed header */}
            <View style={styles.header}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {/* cs.<screen>.sheetTitle */}
              </Text>
              <Pressable
                onPress={onClose}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.counterCloseModal}
              >
                <XIcon size={20} color={Colors.foamMuted} />
              </Pressable>
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
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  // Výškové meze patří SEM, ne na kartu — viz §7.5.
  cardWrap: {
    width: '100%',
    minHeight: '56%',
    maxHeight: '92%',
  },
  card: {
    flex: 1,
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    ...softDrop(),
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
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
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  closeButton: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Bounded so a long list scrolls instead of pushing the pinned footer out.
  list: { flex: 1, marginTop: Spacing.sm },
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

```ts
row:        { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.sm },
rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.border, 0.4) },
rowText:    { flex: 1 },
rowName:    { fontFamily: Fonts.ui.semibold, fontSize: 15, color: Colors.foam },
rowMeta:    { fontFamily: Fonts.ui.medium, fontSize: 13, color: Colors.mutedText, marginTop: 2 },
rowPressed: { opacity: 0.6 },
```

Akční („udělej něco nového“) řádek má vlastní plochu a jantarový medailonek pod ikonou:

```ts
actionRow:  { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14,
              borderRadius: Radius.medium, backgroundColor: Colors.stout3, borderWidth: 1, borderColor: Colors.border },
actionIcon: { width: 34, height: 34, borderRadius: Radius.pill, alignItems: 'center', justifyContent: 'center',
              backgroundColor: withAlpha(Colors.amber, 0.12) },
```

Caption sekce v sheetu: `Fonts.ui.bold`, `fontSize: 11`, `letterSpacing: 1.5`, `color: Colors.amber`,
`marginTop: Spacing.md`, `marginBottom: Spacing.xs`.

Řádek se dvěma řádky textu **a** 44pt ovládacím prvkem potřebuje `minHeight: 64` (viz `ReceiptSheet`),
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

### 7.5 Výškové meze patří na `cardWrap`, ne na kartu

Tohle je nejzákeřnější chyba v celém receptu, protože **nikde nespadne a nic nenahlásí** — jen
zmizí obsah.

Procentní `minHeight` / `maxHeight` se v Yoze počítají vůči **výšce rodiče**. Když je napíšeš na
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
cardWrap: { width: '100%', minHeight: '56%', maxHeight: '92%' },
card:     { flex: 1, /* vyplní, na co byl cardWrap oříznutý — a tím ohraničí scroll */ },
```

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
| čárky na tácku v kartě počítadla | Zkoušené jako náhrada krýglu. U jednoho piva je jedna čárka vedle velké „1" jen škrábanec. |

Pravidlo tedy **není** „aspoň jeden kreslený prvek na obrazovku". Pravidlo je:

1. **Kreslí se to, co se jinak přečíst nedá.** Směr (`CompassDial`), rozjezd levelu v rámci
   stupně (`LevelRing`), noc na tácku ve sdíleném obrázku (`TallyCoaster`, `TallyMarks`),
   stůl party (`PartyTable`), pódium (`PodiumMats`).
2. **Když to jde říct číslem, řekne se to číslem.** Velké jantarové číslo je silnější než jakákoli
   kresba téhož (§14.5 platí i obráceně).
3. **Osobnost nese i chrome.** Baloo, tácková karta se světelnou hranou, jantar na 10 %, hospodský
   copy. Obrazovka bez kresby proto není „jen typografie na hnědém pozadí".
4. **Uvolněné místo patří funkci, ne dekoraci.** Když ilustrace zmizí, na její místo jde něco, co
   něco dělá — v kartě počítadla je to `CounterQuickActions`, v kartě Party `DoorRail` (§5.5).

Když už kreslíš: **vektor, ne bitmapa** (`react-native-svg`), **barvy z tokenů**, nikdy hardcoded
hex uvnitř SVG, **reaguje na data, ne na čas**, komponenta je `memo`, pevný `viewBox`, výška
odvozená od šířky konstantním poměrem, prázdný stav je vidět (`foam` na 4–8 %) a dekorativní
kresba je pro čtečku skrytá (`accessibilityElementsHidden`).

## 10. Pohyb

**Žádné smyčkové animace.** Ani bublinky, ani pulzující glow, ani dýchající ikony, ani shimmer.
Autor je nesnáší a byly kvůli tomu už jednou odstraněny. Dekorativní pohyb na jádrových obrazovkách
je zakázaný.

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
- Stavové změny (nudge slot, obsah karty) se přepínají **okamžitě, bez animace**. Proto má
  `NudgeSlot` pevných 52 pt — obsah se mění, výška ne, takže tlačítko pod ním nikdy neposkočí.
- Stisk se řeší stylem, ne animací: `pressed && { opacity: 0.6–0.9 }`, u primárního tlačítka navíc
  `transform: [{ scale: 0.985 }]`.

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
- **Každý `<Text>` má `maxFontSizeMultiplier`** (viz §3.3).
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
  `formatVolume` / `formatPrice`.
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
4. **Tlačítko za tab barem** — má root `paddingBottom: Math.max(insets.bottom, Spacing.sm)` a je
   CTA celé nad spodní hranou i na telefonu s home indicatorem?
5. **Sheet nesahající na spodní hranu** — má `cardWrap` `marginBottom: -insets.bottom` a karta
   `paddingBottom: insets.bottom + Spacing.lg`? Není mezi kartou a hranou displeje proužek?
6. **Patka překrývající obsah** — je patka sheetu **mimo** `ScrollView` a má `ScrollView`
   `flex: 1` + `contentContainerStyle.paddingBottom`? Doskroluje poslední řádek?
7. **Nadpis vs. notch** — je `paddingTop: insets.top + 8` (nebo 0 v `embedded` režimu, kdy inset
   vlastní rodič)? Neleze nic pod status bar?
8. **Dlouhý název hospody** — otestuj „Restaurace U Zlatého Tygra na Starém Městě“. Truncuje se
   (`numberOfLines` + `flexShrink: 1`), nebo vytlačí chevron z obrazovky?
9. **Dynamic Type 1.3** — pusť s největším systémovým písmem. Má každý `<Text>`
   `maxFontSizeMultiplier`? Vejde se pořád všechno?
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

1. **Prázdná plocha uprostřed = drátový model.** Velké číslo samo na holém pozadí vypadalo jako
   nedodělaný wireframe. Číslo musí ležet **v kartě**, ideálně vedle ilustrace, s patkou pod sebou.
   Když ti v půlce obrazovky zbývá dýra, není to „vzdušný design“, je to nedokončený layout.
2. **Tři žluté plochy.** Jantarový segment nahoře + jantarová karta + jantarové tlačítko = tři bloky,
   které soupeří. Segment je proto `withAlpha(Colors.foam, 0.04)` a aktivní stav
   `withAlpha(Colors.foam, 0.10)`. **Jedna plná jantarová plocha na obrazovku.**
3. **Rozmazaný glow na pozadí.** Radiální jantarové halo za obsahem, „ambient light“, plošné
   gradienty přes celou obrazovku. `Colors.glow` je výhradně `shadowColor` jednoho tlačítka.
4. **Tři cesty ke stejné věci.** Přidat pivo šlo z CTA, z pilulky pod ním i z overflow menu — a nikdo
   nevěděl, který tap co udělá. Každá akce má **právě jedno** místo. Když přidáváš vstupní bod,
   nejdřív ukaž, který existující rušíš.
5. **Abstraktní ukazatel místo velkého čísla.** Progress ring, gauge, sparkline, „naplněnost večera
   68 %“. Uživatel chce vidět, kolik piv vypil. Číslo, velké, jantarové, tabulární. Ilustrace ho
   doplňuje, nenahrazuje.
6. **Řada soupeřících pilulek pod hlavním obsahem.** Foto, story, ping partě, zpětný zápis, sken —
   pět outline chipů vedle sebe **volně na obrazovce**, každý jinak široký, mezi kartou a tlačítkem.
   Tohle zůstává zabité. Povolený je jen strukturovaný řádek **uvnitř karty** podle §5.5: maximálně
   dva chipy stejné šířky, nebo tři stejné sloupce oddělené hairlinem. Cokoliv dalšího patří za „…“
   jako prostý pojmenovaný seznam.
7. **Ozdobné smyčkové animace.** Bublinky ve skle, pulzování, shimmer skeleton, „dýchající“ ikona.
   Viz §10.
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

Liquid glass běží až na iOS 26+. Deployment target je 16.4 (`ios/Podfile:25`), takže **každé**
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

`expo-glass-effect` je už v `node_modules` jako tranzitivní závislost Expo 56 — není to nová
dependency a nepřidávej ji do `package.json` bez důvodu.

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

- Podklad tab baru a headeru **pod** sklem, aby chrome nebyl plochý obdélník.
- Vršek detailu hospody — přechod ze `stout` do `stout2` pod titulkem.
- Uvnitř ilustrací, kde už dnes je (`TallyCoaster`, `PartyTable`).

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

Gradient se nepíše hexy na místě. Patří do `src/theme/colors.ts` vedle stávajících tokenů jako
pojmenované dvojice stopů, ať jde změnit na jednom místě:

```ts
export const Gradients = {
  /** Chrome pod sklem: tab bar, header. */
  chrome: [Colors.stout2, Colors.stout] as const,
  /** Hlava detailu hospody. */
  header: [Colors.stout3, Colors.stout2] as const,
};
```

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
a **žádný glow nikde** — glow na obrazovce patří jednomu tlačítku (§6.1), a tab bar je na každé
obrazovce. Bar nemá horní hairline; sklo se od obsahu odděluje samo (§15.1).

Party tab **nenaviguje** — pushuje `/party-live` jako fullscreen modal, takže se zavírá stejným
gestem obráceně. Na té route se tab bar celý skrývá.

### 17.3 Search

Search je **vpravo nahoře v headeru**, ne šestý tab a ne plovoucí pole nad obsahem. Otevírá se jako
vlastní povrch, ne jako rozbalovací pole v liště — jeden záměr na povrch (§8).

### 17.4 List → detail

Detail je pushnutá route s nativním zpět, ne sheet. Sheet vlastní **jeden záměr** (§7, §8); detail
hospody je místo, kam se dá vracet a odkud vedou další cesty, takže patří do stacku vedle
`/profile/edit` a `/settings`.

### 17.5 Kompas v seznamu hospod

Kompas nezmizel a nestal se položkou menu. Je **první buňkou seznamu hospod** a nese u sebe
hospodu, ke které právě navádí. Zůstává tím, co uživatel v tabu Hospody uvidí jako první.

Zdroj pravdy o nejbližší hospodě je **jeden** — `useNearbyPub` (`src/counter/useNearbyPub.ts`).
Nezakládej druhý.

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

Vším jede `@expo/ui` (SwiftUI host). Je to **tranzitivní závislost Expo 56**, už v `Podfile.lock`,
takže žádná nová dependency.

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

## 19. Ikonografie: co znamená půllitr

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

### 18.4 Živý večer nemá grafy

Běžící večer a jeho recap jsou dvě různé obrazovky s různou prací.

Hub (`/party`) je **co se právě děje**: pár velkých čísel, ovládání a log. Žádné
taby, žádné grafy. Do telefonu se během večera kouká vestoje, na tři vteřiny —
graf vlastního večera je věc, kterou nikdo nestuduje uprostřed hospody.

Statistiky, grafy a rozbor patří do **recapu** (`/party-recap`), po ukončení a
odeslání. Tam je ohlédnutí celý smysl obrazovky.

### 18.3b Jedna šířka skrz celou app

Vodorovný okraj obsahu je **vždycky** `MockLayout.screenPad` (20) — na
obrazovce, v sheetu i v detailu. Žádných 16 „protože je to sheet".

Hostitel obsahu si k tomu **nesmí přidat vlastní padding**. Detail hospody měl
20 ze `PubDetailBody` a 16 z ScrollView okolo, takže text seděl na 36, zatímco
full-bleed pásy (`SectionBreak`, `UnderlineTabs`) přetékaly jen o 20 a končily
16 před krajem. Tři různé hrany na jednom sheetu.

Komponenty, které přetékají přes okraj, dostávají `inset` rovný té jedné šířce.
Když se okraj mění, mění se `MockLayout.screenPad`, ne lokální číslo.

### 18.5 Log je thread, ne systémový žurnál

Log běžícího večera je společný thread. U každého záznamu musí být vidět **kdo
to tam dal** — u stolu pro čtyři je „Fotka" bez jména aplikace mluvící sama se
sebou. Obsah do něj přidávají tlačítka dole (pozvat, foto, pivo, hra, přesun) a
každý typ má svůj glyf na lince.

Hra v threadu **není zpráva o hře** — ten řádek hru spouští a po dohrání na místě
vyroste ve výsledkovku. Dva řádky (založení + výsledek) čtou jako dvě hry.

Thread smí nést **jen obsah, který app umí vyrobit**. Namockovaná „poznámka" a
„runda" vypadaly dobře a slibovaly dvě funkce, ke kterým nevede žádné tlačítko —
log by inzeroval něco, co neexistuje. Typy obsahu = přesně ta akce dole.

Vodicí linka se kreslí **uvnitř řádku**, takže mezi řádky nesmí být gap; jinak se
z linky stane čárkovaná. Odsazení si nese řádek sám.

Hlavička hubu (hospoda, lidi, čísla) je **sticky**, scrolluje jen thread. Odpověď
na „co se děje" nesmí odjet nahoru, když se koukáš, co se stalo.

Nově přidaný záznam **přijede animací** (`FadeInDown` + `LinearTransition`, §10),
ale jen ten — řádky, které tam byly při otevření, se nesmí rozdávat jako karty.
Rozhoduje o tom razítko mountu, ne pořadí.

Akce, které něco přidávají, nesou na ikoně malý **plus badge**. Řádek samotných
podstatných jmen („Foto", „Hry") čte jako navigace, ne jako přidávání.

### 18.5b Opravy patří do logu

Do hospody se ťuká špatně. Log je jediné místo, kde uživatel vidí, **který**
záznam je špatný, takže oprava patří tam — ne do samostatné obrazovky historie.

Řádek s pivem nese `RowMenu` (`src/mocks/MenuChip.tsx`): nativní kotvené menu
jako v Spendee, čepované pivo jako zaškrtnutý seznam a „Smazat" jako destructive
položka pod ním. Oprava **přepíše původní řádek**; thread ve stylu „Pilsner / no
vlastně Kozel" je horší záznam večera než ten, co prostě říká, co jsi pil.

Pozor na hranici: SwiftUI `Menu` si kreslí vlastní label, takže se kotví na
glyf, který mu dáme — **neumí obalit existující RN řádek** a udělat z long-pressu
na něm kontextové menu. To by chtělo `react-native-ios-context-menu`, což je ta
knihovna, která nešla slinkovat.

### 18.5c Běžící večer v chrome

Live bar nad tab barem se **vysvětluje sám**: hospoda a pod ní běžící stopky a
počet piv. Zelená tečka je pryč — stavová kontrolka se musí naučit, kdežto
tikající čas říká „běží to" slovy, která už čteš. Plurály česky (1 pivo, 3 piva,
7 piv); špatný plurál je na takhle malém pruhu první, čeho si všimneš.

Ikona Party v tab baru dostane při běžícím večeru **prstenec** a popisek
„Večer". Ne jinou ikonu a ne jinou barvu — je to pořád stejné místo, jen jsi
v něm.

### 18.12 Jedna smyčka v celé app

Tab bar je na každé obrazovce, takže cokoliv, co v něm běží ve smyčce, běží
pořád. §10 to zakazuje a ten zákaz platí dál — **s jednou výjimkou**: prstenec
kolem Party ikony při běžícím večeru.

Proč zrovna tenhle: běžící večer je jediná věc v appce, která se **opravdu děje**,
zatímco se díváš na něco jiného. Statický prstenec říká „je zapnutý režim",
pulzující říká „běží to". „Kamarád je live" tuhle výjimku nedostane — to je cizí
novinka a ta počká na pohled.

Podmínky: **2,4 s na cyklus**, tam a zpět (skok zpátky na malý je bliknutí a
blikající tab bar je alarm), hýbe se **jen prstenec, nikdy glyf**, a při reduced
motion se nehýbe nic.

### 18.11a Herní vrstva

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
které si hra deklaruje — „roll", „spin", „draw").
**Ven:** `ready`, `state` (celý stav po každé změně), `event` (jednorázová
novinka), `result` (skóre, vítěz, kdo platí), `error`.

**Pravidla vlastní hra, ne platforma.** Hra si počítá kola, pořadí i konec a po
každé změně pošle **snímek celého stavu**. Appka z něj kreslí všechen text —
„Honza hází", žebříček, výsledky kola. Logika je tak na jednom místě vedle věci,
kterou řídí, a texty zůstávají skutečnými texty s Dynamic Type a VoiceOverem.

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

### 18.11d Konec hry patří platformě

Hra ohlásí `result` a skončí; obrazovku kreslí **`GameResult`**, jedna pro
všechny hry. Výsledek nese jména a tváře, musí vypadat stejně napříč hrami a ta
samá data pak čte thread, recap i feed.

**Tvar se odvozuje z dat, ne z příznaku, který hra pošle.** Jedno jméno nahoře
vzniká z `payingId` nebo `winnerId`; tabulka pod ním se objeví, když hra vrátila
**víc než jedno skóre**, a nezobrazí se, když ne. Hra, která vybírá jednoho
člověka, pošle prázdné skóre a dostane jednu tvář; kvíz pošle pět a dostane
žebříček s vítězem vypsaným nad ním. Ani jedna neříká, co chce.

`variant` prop je věc, kterou může hra splést. „Je tu `payingId`, takže někdo
platí" splést nejde.

Hra na pití dojde k „Dohráno" nebo „Platí X", **nikdy k vítězi** — jediná
tabulka, kterou by mohla vyrobit, je kdo nejvíc pil.

Plátno si přesto smí konec **oslavit** — konfety, rozsvícená vítězná výseč. To je
zdobení, ne vyprávění.

### 18.11e Hra na víc telefonů má tři stavy, ne dva

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

Čekání musí jít **přerušit** („Nečekat"). Někdo je na baru a hra, kterou odemkne
jenom člověk, co odešel, končí právě tam.

Skóruje se **po týmech**, a člověk hrající sám je tým o jednom. Party a komunitní
event jsou tím pádem jedna hra, ne dvě — kdyby se to psalo po lidech a týmy se
přidaly potom, každé pravidlo by existovalo dvakrát a ty dvě verze by se rozešly.

Stav je fold nad **append-only seznamem odpovědí**, nikdy uložený součet. Dva
telefony můžou odpovědět ve stejnou chvíli, pořadí nehraje roli, retry nemůže
započítat dvakrát a telefon, co byl offline, pošle svoje pozdě a nic se neslučuje.
Je to zároveň přesně tvar, který drží backend (`PartyGameEvent`, kind `answer`).

### 18.11c Hry, které máme

| hra | plátno | co vrací |
|---|---|---|
| Kostky | 3D, fyzika (three + cannon) | `state` po každém hodu, `result` na konci |
| Flaška | 3D, roztočená láhev | `picked` po každém zastavení, nikdy nekončí |
| Kdo platí rundu | 3D kolo štěstí se jmény | `picked` a rovnou `result` — runda má jednoho plátce |

Kostky a Flaška se točí dál, dokud stůl nemá dost. Kolo **končí prvním
zastavením**, protože runda má právě jednoho plátce — a přesně kvůli tomuhle
rozdílu je v protokolu `result` a nestačí `event`.

Každá hra je jeden HTML soubor (~520–600 kB s vloženými knihovnami). Tři.js je
v každém zvlášť; při osmi hrách to bude stát za sdílený chunk, do té doby je
samostatnost souboru cennější než ušetřené megabajty.

### 18.11b Fyzické hry žijí ve WebView

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
2. **Most je úzký.** Sem „hoď" a „obarvi se", ven „padlo tohle". Barva je
   jediná věc, kterou plátno o hráčích ví — **žádná jména dovnitř**. U telefonu,
   co koluje kolem stolu, se „tyhle jsou Honzovy" přečte z barvy dřív, než by
   kdo četl popisek.
3. **Text zůstává v RN, i když leží přes plátno.** Zvolání po dosednutí je
   vrstva nad WebView, ne text ve stránce — tím zůstane skutečným textem
   s Dynamic Type, VoiceOver a písmem aplikace, a přitom vypadá, že dopadlo na
   sukno.
4. **Simulace JE náhoda.** Čísla jdou ven, ne dovnitř. Nic si předem nevybere
   výsledek a neanimuje se k němu — hod je opravdu spravedlivý, což předstíraný
   hod nikdy není.
5. **Žádná síť.** Hra se sestaví do jednoho HTML s vloženými knihovnami
   (`npm run build:games`) a přibalí se jako asset. V hospodě signál není.
6. **Téma cestuje dovnitř** v query stringu, jinak plátno vypadá jako cizí web.

**Hra se ladí v prohlížeči, ne v simulátoru.** `npm run games:dev` ji sestaví a
otevře jako obyčejnou stránku; když si všimne, že na druhé straně není most,
přidá si vlastní tlačítko a výpis výsledku. Doladit pocit z hodu tak stojí
reload, ne nativní build, simulátor a čtyři obrazovky proklikávání. To je rozdíl
mezi hrou, která se doladí, a hrou, co vyjde tak, jak poprvé spadla.

Past, na kterou se přijde těžko: hra se načítá jako asset (`.html` v
`assetExts`). Když Metro drží cache z doby před tou změnou konfigurace, import
routy selže a expo-router to nahlásí jako **„Cannot read property 'ErrorBoundary'
of undefined"** — hláška, která nemíří ani zdaleka k příčině. Řeší to
`npx expo start --clear`.

### 18.11 Rekvizity vypadají jako rekvizity

Kostka je **kostka**, ne číslo na čtverci. Celé kouzlo házení je v tom, že
stěnu poznáš dřív, než ji spočítáš — a „4" jako kostku nepoznal nikdo. Puntíky
v uspořádání, které všichni znají, na slonovinové stěně.

Prostorovost je **falešná a levná záměrně**: skutečná 3D kostka znamená
renderer, mesh a fyziku kvůli dvěma kostkám, co dopadnou za vteřinu. Stačí
zaoblený čtverec se světlem vlevo nahoře, tmavší hrana pod ním místo vytažení a
stín. Ve velikosti, v jaké to telefon na stole ukazuje, to čte jako předmět —
a víc dělat nemusí. Kreslené `react-native-svg`, žádný nový balík.

**Rekvizita je hlavní, tlačítko vedlejší.** Jantarový pruh přes celou šířku pod
kostkami dělal z tlačítka nejhlasitější věc na obrazovce, jejíž celý smysl je,
co právě dopadlo.

### 18.10 Hra má sestavu, kolo a konec

**Sestava napřed.** Stůl není parta: někdo je u baru, někdo nehraje, někdo si
právě sedl. Před každou hrou je lobby se jmény z večera — předzaškrtnutými,
protože běžný případ je, že hrají všichni — a s možností někoho přizvat rovnou
odtud. Bez toho se první kolo změní v hádku, kdo je na řadě.

**Obrazovka během hry říká jednu věc: kdo je na tahu.** Jméno 34pt, kostky ve
velikosti skutečných. Žebříček je pod tím a potichu — je to kontext, ne otázka.

**Hra musí skončit sama.** Tabulka, která jen roste, nemá konec a někdo u stolu
musí říct „tak dost". Kostky proto vítěze **odebírají**: třikrát vyhrané kolo a
jsi z obliga, hra se zrychluje a kdo zbude poslední, platí rundu. Napětí jde
nahoru, ne dolů.

Kdo platí, přebíjí kdo vyhrál — je to ta věta, o které stůl bude ještě mluvit.

**Pravidla žijí mimo komponentu.** `diceDuel.ts` je čistá data a funkce
s testy; skořápka je jen kreslí. Hra se špatným koncem je horší než žádná hra a
tohle se neověřuje klikáním v simulátoru.

**Konec je nahoře**, co nejdál od všeho, na co se během hry ťuká, a je to text —
ne druhý jantarový pruh soupeřící s tlačítkem, které se opravdu mačká. Počítadlo
piv naopak plave dole u palce.

### 18.9 Hry: tři skořápky, ne devět obrazovek

Hra je **obsah plus skořápka**, nikdy vlastní obrazovka. Desátá hra má být řádek
v `gameCatalog.ts` a seznam promptů, ne další složka.

| skořápka | co to je | hry |
|---|---|---|
| `score` | ťukni na jméno, dostane bod | Pub kvíz |
| `prompt` | balíček kartiček, jedna po druhé | Nikdy jsem…, Kategorie, Pravidlo, Palec |
| `draw` | náhoda i s napětím | Kostky, Flaška, Runda, King's Cup |

Drží to i backend generický: každá skořápka píše ty samé dvě události, takže
hraní nepotřebuje endpoint na hru.

**Napětí je ta hra.** Losování nikdy jen nevypíše výsledek — kostky se kutálí,
jména proběhnou a zpomalí, karta se otočí. Ta půlvteřina je důvod, proč se kvůli
tomu tahá telefon. Výsledek se ale **vybere první a teprve pak se k němu
animuje**, aby reduced motion nebyla druhá implementace, co se rozejde.

Balíček se **zamíchá jednou a rozdává se**, nenáhodně se nelosuje pokaždé.
Náhoda se opakuje, a opakování dvě karty po sobě je moment, kdy stůl usoudí, že
je appka rozbitá.

**Hra na pití nevede žádnou tabulku.** Jediná, kterou by vést mohla, je kdo
nejvíc pil.

**Dohraná hra nese výsledek na svém coveru** — pod obrázkem to byl popisek, na
něm je cover samotný ten výsledek.

### 18.7 Cizí profil

Cizí profil je **stejná obrazovka jako tvoje**, jen zvenku. Člověk má vypadat
jako člověk, ať ho potkáš kdekoli; jinak nakreslený profil cizího čte jako jiný
produkt.

Co se mění:

- vztah v hlavičce — „Byli jste spolu 4× na pivu". To je poctivá verze „12
  společných přátel" v hospodské appce;
- dvě akce: **Sledovat** a **Na pivo?**. Druhá je vlastně smysl celé appky;
- **žádná série a žádné rekordy**. Na svém profilu tlačí tebe; na cizím je série
  běžící součet cizího pití, který si ten člověk nezveřejnil.

Statistiky jsou **agregáty**. „12 hospod" je fakt o tom, jak často chodí ven;
seznam kterých dvanáct je rozvrh, a rozvrh jednoho člověka tahle app druhému
nedává.

**Otevřená otázka (§20):** jak se ta akce jmenuje. Teď „Sledovat", protože je
jednoznačné. Ve hře je „Parťák" (hospodštější, ale svádí k tomu, že je to
vzájemné, což follow není).

### 18.8 Textová pole

Pole je díra, do které se píše — musí být **světlejší než to, na čem leží**, a
nést vlásečnicový okraj. Search v Hospodách byl `surface` na sheetu, jehož
podklad je taky `surface`; pilulku šlo najít jen podle placeholderu uvnitř.

Tokeny (`MockColors`): `field`, `fieldBorder`, `fieldHint`. Placeholder je
foam na 55 %, ne hnědý `mutedText` — ten je na tmavém poli sotva čitelný.

Platí to na **všechna** pole: search, sheety, dialogy. Nekresli si vlastní
podklad pole ve screenu.

### 18.6 Velká čísla se neklikají

Blok velkých numerálů je nadpis, ne ovládací prvek. Nedávej pod něj `Pressable`
ani "rozklikni pro víc" — vypadá jako obsah, chová se jako tlačítko, a uživatel
to najde omylem.

Které číslo se ukáže, je **produktové pravidlo s testy**, ne pevný řádek. „U
stolu" dává smysl jen když u stolu někdo je; sám sobě by uživatel četl vlastní
počet dvakrát. Radši dvě pravdivá čísla než tři s pomlčkou. Viz
`src/party/nightPulse.ts` (`hubStats`).

## 20. Otevřená rozhodnutí 3.0

Mocky v `src/mocks/`, `src/feed/`, `src/party/`, `src/pubs/`, `src/community/`, `src/profile/`
a `src/search/` se v pěti věcech **vědomě rozcházejí s tímhle dokumentem**. Rozcházejí se, protože
jsou to návrhy k posouzení, ne přijatá pravidla. Dokud rozhodnutí nepadne, neaplikuj je na
produkční obrazovky — a až padne, změň **dokument**, ne kód lokální výjimkou (§0).

| Věc | Dokument říká | Mocky dělají |
|---|---|---|
| ~~Ground~~ | **Rozhodnuto 1. 8. 2026** — tmavší zem přijata, §2.1 přepsán. `MockColors` je teď jen alias. |
| ~~Písmo~~ | **Rozhodnuto 1. 8. 2026** — systémové, §3.1 přepsán. `fontFamily` z appky pryč. |
| Radiusy | 12–24 | 20–34 |
| Karty | Obsah žije v kartách (§5) | Posty na ploše, oddělené tmavým pásem |
| Sekce | Oddělené mezerou | `SectionBreak` — 10 pt tmavý pás, nadpis **pod** ním |

**Dluh po přechodu na systémové písmo.** Deset a víc míst kompenzuje metriku
Baloo 2 — `lineHeight: size * 1.24`, protože ExtraBold přetéká, a odhad šířky
číslice `0.62 × fontSize` v `CoasterCard`. SF má jinou metriku: řádkové boxy jsou
teď volnější a odhad šířky konzervativnější, než je potřeba. Nic rozbitého, ale
při dalším zásahu do těch souborů to přepočítej.

Šestá věc, která rozhodnutí nepotřebuje, ale nesmí se zapomenout: **`pravatar.cc` a `picsum.photos`
placeholdery nesmí opustit mocky.** Reálné avatary jsou `Account.avatar`, fotky `BeerPhoto`.
