# UX/UI audit — konzistence a znovupoužití

Měřeno na kódu, ne od oka. Čísla jsou z `src/` a `app/` (85 obrazovek).

## Shrnutí

App není nekonzistentní proto, že by chyběly komponenty. **Komponenty existují a
skoro se nepoužívají.** Skoro každá obrazovka si kreslí vlastní sheet, vlastní
křížek, vlastní jantarové tlačítko a vlastní typografickou stupnici.

Tohle je hlavní dluh. Není to kosmetika: každá nová obrazovka dnes stojí víc,
než by měla, a každá vizuální oprava se musí udělat padesátkrát.

## Top nálezy, podle dopadu

| # | Nález | Číslo | Proč to bolí |
|---|---|---|---|
| 1 | Bottom sheety kreslené ručně | **38** souborů vs **7** používá `BottomSheetModal` | 18 z nich si píše i vlastní animaci. Každý sheet má jinou pružinu, jiný radius, jiný grabber. |
| 2 | Křížky mimo `CloseButton` | **51** souborů | Oprava „křížek je malý a není liquid glass" žije v jednom místě z padesáti dvou. |
| 3 | Jantarové CTA ručně | **114** výskytů vs **37** souborů s `GlowButton` | Tři čtvrtiny primárních tlačítek jsou kreslené ručně. |
| 4 | Typografie bez stupnice | 10+ velikostí: 13 (232×), 15 (163×), 14 (133×), 12 (132×), 16, 11, 22, 18, 24, 10 | `MockType` existuje, používá ho 24 souborů. Zbytek si stupnici vymýšlí. |
| 5 | Radiusy | **445** literálů vs 507 tokenů | Mimo jiné 2, 3, 4, 5, 6, 13, 16, 18, 19, 20, 24. Proto je §20 „radiusy" pořád otevřená. |
| 6 | Avatar třikrát | `Face`, `profile/Avatar`, `Leaderboard/Avatar` | Jeden objekt, tři implementace, tři velikostní logiky. |
| 7 | Segmented čtyřikrát | 4 implementace | iOS má nativní segmented control; `MenuChip` už ukazuje, že nativní cesta v tomhle projektu funguje. |
| 8 | Odsazení mimo tokeny | **329** literálů vs 500 tokenů (40 %) | Přesně to, co pak čte jako „nahečmané". |
| 9 | Seznamy | **82** souborů `ScrollView` + `.map`, **8** `FlatList`, 0 `SectionList` | Feed a seznam hospod rostou; bez virtualizace to na starším Androidu spadne dřív než na iOS. |
| 10 | Skeletony existují třikrát | `SkeletonBlock`, `FriendsSkeleton`, `BoardSkeleton` | Než přidávat čtvrtý, povýšit `SkeletonBlock` na sdílený. |

## Nativní komponenty — co využíváme a co ne

| Komponenta | Soubory | Poznámka |
|---|---|---|
| `expo-glass-effect` | 6 | Dobře. Fallback řešený. |
| `@expo/ui` (SwiftUI Menu, Picker, Chart) | 5 | Precedens existuje a funguje. |
| `expo-symbols` (SF Symbols) | **2** | Největší nevyužitá příležitost — viz níže. |
| `RefreshControl` | 6 | OK. |
| `ActionSheetIOS` | 1 | Jen fallback v `MenuChip`. |
| Nativní `Switch` | 12 souborů, k tomu 3× ruční `Toggle` | Míchá se. |
| Kontextové menu na long-press | 0 | Nejde bez knihovny, co nelinkovala. Neřešit. |

**SF Symbols jsou ta velká věc.** Máme ~80 ručně obalených lucide glyfů. Systémové
symboly by daly zdarma: správnou optickou váhu k textu, hierarchické varianty,
Dynamic Type, a hlavně ikonografii, kterou uživatel zná odjinud. Nešlo by to
paušálně — pivní glyfy vlastní zůstat musí — ale chrome (share, hledání, zpět,
zavřít, mapa, poloha) by mělo být systémové. `share` už takhle udělaný je.

## Co bych udělal, v tomhle pořadí

1. **Sheety.** Zmigrovat 38 ručních na `BottomSheetModal`. Jedna změna pružiny
   pak platí všude. Největší poměr dopadu k riziku.
2. **`CloseButton` do všech.** Mechanické, 51 souborů, nulové riziko.
3. **Typografická stupnice.** Povýšit `MockType` na `Type` v `src/theme/`, dát
   mu jména z produktu (`title`, `row`, `rowSub`, `label`, `numeral`) a projet
   obrazovky. Tohle je ta věc, po které app „vypadá jako jedna app".
4. **Jedno `Button`.** `GlowButton` umí primár; chybí secondary a ghost. Doplnit
   varianty a zrušit 114 ručních jantarů.
5. **Jeden `Avatar`.** Sloučit tři implementace.
6. **`Skeleton` sdílený** + nasadit tam, kde se dnes čeká na `ActivityIndicator`.
7. **Virtualizace** feedu a seznamu hospod.
8. **SF Symbols pro chrome.**

## Co v tomhle auditu vědomě není

- Barvy. Paleta je jednotná a drží (`Colors` + `MockColors`), problém není tam.
- Copy. Tón je konzistentní.
- Přístupnost. `accessibilityLabel` je skoro všude; `maxFontSizeMultiplier`
  taky. To je nadprůměr, ne dluh.
