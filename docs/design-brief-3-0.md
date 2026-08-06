# Na pivo 3.0 — zadání pro design

Pro Tomáše. Stav k 6. 8. 2026, větev `feat/napivo-3-0`.

**Tenhle dokument říká, co chybí a v jakém formátu to potřebuju.** Neopakuje
pravidla — ta jsou v `docs/design-system.md` a platí. Co produkt dělá, je
v `docs/product-spec-3-0.md`.

---

## 0. Než začneš

Tři věci z design systému, které rozhodují o všem ostatním:

- **Zákon zjednodušení** (§0) je nadřazený zbytku. Když je něco v rozporu, mění
  se dokument, ne se dělá lokální výjimka.
- **Jedna svítící věc na obrazovce** (§6.1). Jantar je akcent, ne barva pozadí.
- **Pohyb kopíruje prst, ne sám sebe** (§10). Nekonečné smyčky, dýchající prvky
  a ambientní animace jsou zakázané.

Podklad je stout (tmavě hnědá), akcent jantar. Světlý režim je **vědomě
odložený** — zdvojil by práci na každé obrazovce.

---

## 1. Cover artwork her — největší kus

**Dnešní stav:** každá hra má dvoubarevný gradient a Lucide glyf. Funguje to a
šlo to ven, ale devět gradientů vedle sebe vypadá jako devět tlačítek.

**Co potřebuju:** devět coverů, jeden styl.

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

## 2. Prázdné stavy

Momentálně jich většina nemá nic — buď je tam mock, nebo prázdno.

| kde | kdy je prázdno | co má říct |
|---|---|---|
| Kocoviny | nikdo z tvých kamarádů nic nepostnul | „zatím ticho" + cesta k pozvání |
| Party | před prvním pivem | co večer bude sbírat (dnes: nulové statistiky) |
| Hospody | filtr nic nenašel | ne „0 výsledků", ale co zkusit |
| Komunita → Výzvy | žádná výzva neběží | kdy budou |
| Profil → Aktivita | ještě nic | první krok |

**Nechci ilustrace ke každému.** Prázdný stav má být jedna věta a jedna akce.
Kde je ilustrace opravdu na místě (Kocoviny), stačí jedna.

## 3. Skeleton loadingy

Primitiva existuje (`SkeletonBlock`: foam wash, 900 ms ping-pong, při
reduce-motion se **zastaví**, nezpomalí). Chybí kompozice pro 3.0 obrazovky.

Potřebuju od tebe **rozhodnutí, kde skeleton je a kde ne**, ne kresbu:

- kde se opravdu čeká na síť (feed, komunita, detail hospody) → skeleton;
- kde jsou data lokálně (party hub, počítadlo) → **nic**, bliknutí kostry pod
  obrazovkou, která má data hned, je horší než nic.

## 4. Avatary a fotky — blokuje release

V devíti souborech jsou `pravatar.cc` a `picsum.photos`. **Nesmí ven.**

- Profilová fotka: reálná, jinak **iniciála na barvě** (`Face`) — cizí obličej ze
  stocku je lež, která se pozná ve chvíli, kdy si toho někdo všimne. Profil už
  opravený, zbytek ne.
- Barvy iniciál: šest odstínů, deterministicky z id, takže je člověk stejně
  barevný na všech telefonech. Jantar je vyhrazený tobě samotnému.
- Fotky večera a menu čekají na skutečný upload (`BeerPhoto`).

**Co od tebe potřebuju:** paletu iniciálových pozadí potvrdit nebo přepsat
(dnes: `#7DD66B`, `#F0BE5C`, `#A8896A`, `#FBF3E0`, `#6FB3D9`, `#D98C6F`).

## 5. Ikonografie

Pravidla jsou v §19 (co znamená půllitr). Dvě věci, které vypluly teď:

- **Ikona musí něco rozlišovat.** Tři výzvy měly stejnou jiskřičku — to je
  dekorace na místě myšlenky. Teď má každá výzva glyf podle toho, co je (špendlík
  / hodiny / půllitr).
- **V detailu ikona většinou nepatří.** Na obrazovce, která je o jedné věci,
  zdobí titulek, co už všechno řekl.

Používáme Lucide. Kdybys chtěl vlastní sadu, je to samostatné rozhodnutí — dnes
je to 80+ glyfů.

## 6. Onboarding

**Ilustrace jsou pryč**, místo nich jsou tři skutečné kusy appky: kompasová
buňka, čísla večera s vláknem, žebříček. Reálné komponenty s natvrdo danými
propsy, ne obrázky — takže když se změní design buňky, změní se i promo.

Tři staré PNG v `assets/images/onboarding/` čekají na smazání. **Řekni, jestli
ti ta náhrada sedí**, ať je můžu vyhodit.

## 7. Akce v komunitě

Dnes: gradient s datem v rohu. Události mají místo, čas a lidi — poster tam dává
smysl líp než u výzev. Otázka pro tebe: **kdo poster dodá?** Pořadatel při
zakládání akce, nebo generujeme z názvu a data?

## 8. Co nedělat

- **Světlý režim.** Odložený vědomě.
- **Grafy v běžícím večeru.** Během večera se koukáš, co se právě stalo; grafy
  jsou v recapu, kde je ohlédnutí smysl obrazovky.
- **Cokoliv, co počítá promile, útratu nebo čas do řízení.** Rozhodnuto
  a nediskutovatelné (`docs/decisions/no-bac-or-driving-estimates.md`).
- **Žebříček, který korunuje toho, kdo nejvíc vypil.** Hra na pití nemá vítěze.

## 9. Jak předat

Cokoliv rastrového do `assets/`, `@2x` a `@3x`, nic většího než 3x. Rozhodnutí
(barvy, pravidla, kde co je) rovnou do `docs/design-system.md` — ten dokument je
závazný a rozpor se řeší jeho změnou.
