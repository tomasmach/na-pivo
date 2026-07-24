# Na pivo — design system

> **Etalon:** obrazovka Štamgast → Počítat (commit `84ee101`).
> Soubory: `src/counter/CounterScreen.tsx`, `CoasterCard.tsx`, `BeerGlass.tsx`, `CounterCta.tsx`,
> `NudgeSlot.tsx`, `PlaceChip.tsx`, `DrinkPickSheet.tsx`, `ReceiptSheet.tsx`, `CounterMoreSheet.tsx`,
> `src/beer/BeerScreen.tsx`.
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
| `Colors.stout` | `#1F1308` | Pozadí obrazovky (root). Nic jiného. |
| `Colors.stout2` | `#2B1A0E` | Plocha karty a bottom sheetu. O stupeň světlejší než root. |
| `Colors.stout3` | `#3A2515` | Vnořený prvek uvnitř karty/sheetu: řádek, strip, chip, close button. |
| `Colors.border` | `#5A3A20` | Plný okraj sheetu, grabber, dělítka uvnitř sheetu. Často s alfou. |
| `Colors.amber` | `#E8A317` | Akcent. Primární tlačítko, hlavní číslo, ikony, aktivní stav. |
| `Colors.amberLight` | `#F5B642` | Jen uvnitř ilustrací (horní stop gradientu piva). |
| `Colors.glow` | `#FF7A1A` | **Jen** `shadowColor` v `amberGlow*`. Nikdy jako fill nebo text. |
| `Colors.neon` | `#FFD27A` | Rezerva pro zvýrazněné stavy. Na etalonu se nepoužívá. |
| `Colors.foam` | `#FBF3E0` | Primární text a světlé hairliny (s alfou). |
| `Colors.foamMuted` | `#E8DCC0` | Sekundární text, popisek pod číslem, ikona zavírání. |
| `Colors.mutedText` | `#A8896A` | Terciární text, meta řádky, neaktivní stav, „…“ ikona. |
| `Colors.success` | `#7DD66B` | Potvrzení. Používej střídmě; jantar většinou stačí. |
| `Colors.open` | `#F0BE5C` | Otevřeno (otevírací doba). |
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

**Rozpad 60 / 30 / 10.** 60 % plochy je `stout` + `stout2` (pozadí a karta), 30 % je text v odstínech
`foam` / `foamMuted` / `mutedText`, 10 % je jantar. Když se při návrhu dostaneš přes ~10 % jantaru,
něco jsi udělal plochou místo textem.

---

## 3. Typografie

Dvě rodiny, obě lokální (`src/theme/fonts.ts`):

- **`Fonts.display.*` = Baloo 2** — kulaté, hospodské, hravé. Čísla, nadpisy, labely tlačítek,
  názvy míst, malé „hlasité“ pilulky. Nejtěžší dostupná váha je `extrabold` (`black` je jen alias).
- **`Fonts.ui.*` = Inter** — věcné. Body text, meta řádky, popisky, ceny, řádky v seznamech.

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
  minHeight: 44,           // header sám je dotykový cíl
  marginBottom: 8,         // + gap 12 = 20 pod headerem
},
```

- **Vnitřní padding karty: 24** vodorovně, 24 nahoře (dole 8, protože patka má vlastní `paddingTop`).
- **Mezera mezi bloky: 12.** Jedna `gap` na kontejneru, ne marginy na dětech.
- **Kolem headeru: 24 po stranách, 20 pod ním** (8 marginBottom + 12 gap). Header je vizuálně
  oddělený, ale pořád patří k obsahu.
- **Uvnitř sheetu:** `paddingHorizontal: Spacing.lg` (20), `paddingTop: Spacing.sm` (8).
- **Spodní okap obrazovky:** `paddingBottom: Math.max(insets.bottom, Spacing.sm)`.

**Relationship-based spacing.** Vzdálenost = vztah. Věci, které patří k sobě, mají 4–8 (číslo a jeho
popisek: `-8`, protože je to doslova jeden objekt; ikona a text: 6–8). Věci ve stejné skupině 12.
Různé bloky 20–24. Nikdy nedávej stejnou mezeru mezi „ikona ↔ její label“ a „blok ↔ blok“ — kompozice
se pak čte jako seznam náhodných prvků.

---

## 5. Karty

### 5.1 Recept

```ts
card: {
  flex: 1,                 // karta žere prostor mezi headerem a tlačítkem
  overflow: 'hidden',      // obsah nikdy nepřeteče přes zaoblený roh
  backgroundColor: Colors.stout2,
  borderRadius: 28,        // === Radius.cardLarge
  borderWidth: 1,
  borderColor: withAlpha(Colors.foam, 0.07),
  paddingHorizontal: 24,
  paddingTop: 24,
  paddingBottom: 8,
},
```

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
`minHeight: 44`. Přesně jeden dýchá.

### 5.3 Obsah se dimenzuje Z karty, ne naopak

Nikdy nedávej ilustraci ani velký prvek pevnou velikost a nedoufej, že se karta přizpůsobí.
Změř kartu a odvoď od ní velikost obsahu:

```tsx
const [bodyHeight, setBodyHeight] = useState(0);
// clamp: nikdy menší než 64, nikdy větší než 112
const glassWidth = bodyHeight > 0
  ? Math.max(64, Math.min(112, (bodyHeight - 16) * 0.66))
  : 88;

<View style={styles.body} onLayout={(e) => setBodyHeight(e.nativeEvent.layout.height)}>
  …
  <BeerGlass count={count} width={glassWidth} />
</View>
```

Na iPhonu SE se sklenice zmenší; na iPhonu 16 Pro Max naroste na strop. Nikdy nepřeteče kartu.
Vždycky měř s fallbackem (`bodyHeight > 0 ? … : 88`), aby první frame nebyl nulový.

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
| `animationType="fade"` | `"slide"` na iOS koliduje s tím, že si kartu polohujeme sami (`justifyContent: 'flex-end'`), a vzniká dvojitý pohyb. |
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

- **Vektor, ne bitmapa.** `react-native-svg`, žádné PNG. Zůstane ostré v každé velikosti a přebarví
  se s tokeny, místo aby se do bundlu přibalil asset.
- **Barvy z tokenů**, nikdy hardcoded hex uvnitř SVG. `Colors.amber`, `Colors.amberLight`,
  `withAlpha(Colors.foam, 0.05)`.
- **Aspoň jeden kreslený prvek na hlavní obrazovku.** Bez něj je obrazovka jen typografie na hnědém
  pozadí a produkt přestane být hospodský.
- **Ilustrace reaguje na data, ne na čas.** Mění se, když se mění hodnota. Nemá vlastní život.

Princip z `BeerGlass.tsx` — obrys je `ClipPath`, obsah je obdélník, jehož poloha se počítá z dat:

```tsx
const GLASS_PATH = 'M12 6 H76 L70 112 Q68.5 126 55 126 H33 Q19.5 126 18 112 Z';
const FULL_AT = 10;

const height = Math.round((width / 88) * 132);
const ratio = Math.max(0, Math.min(1, count / FULL_AT));
const top = 127 - ratio * 115;   // hladina

<Svg width={width} height={height} viewBox="0 0 88 132">
  <Defs>
    <ClipPath id="glassClip"><Path d={GLASS_PATH} /></ClipPath>
    <LinearGradient id="beerFill" x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0" stopColor={Colors.amberLight} stopOpacity={0.95} />
      <Stop offset="1" stopColor={Colors.amber} stopOpacity={0.8} />
    </LinearGradient>
  </Defs>

  {/* prázdná sklenice — čitelná i při nule */}
  <Path d={GLASS_PATH} fill={withAlpha(Colors.foam, 0.05)} />

  {ratio > 0 ? (
    <G clipPath="url(#glassClip)">
      <Rect x="0" y={top} width="88" height={132 - top} fill="url(#beerFill)" />
      <Rect x="0" y={top - 8} width="88" height="10" rx="4" fill={Colors.foam} opacity={0.92} />
    </G>
  ) : null}

  {/* jeden odlesk, aby tvar nečetl jako plochý sloupec */}
  <G clipPath="url(#glassClip)">
    <Rect x="25" y="16" width="6" height="94" rx="3" fill={Colors.foam} opacity={0.16} />
  </G>

  <Path d={GLASS_PATH} fill="none" strokeWidth={2.5} strokeLinejoin="round"
        stroke={withAlpha(Colors.amber, ratio > 0 ? 0.55 : 0.32)} />
</Svg>
```

Přenositelná pravidla: pevný `viewBox`, výška odvozená od šířky konstantním poměrem, `clipPath` drží
obsah v obrysu, prázdný stav je vidět (`foam` na 5 %), obrys mírně zesílí, když je prvek „aktivní“,
a komponenta je `memo`.

---

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
   pět outline chipů vedle sebe. Všechno tohle patří za „…“ do overflow sheetu jako prostý
   pojmenovaný seznam.
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
