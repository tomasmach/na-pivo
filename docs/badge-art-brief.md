# Zadání na odznaky — Na pivo

Podklad pro vygenerování artworku dvaceti odznaků. Kopíruj odsud přímo do GPT.

---

## 1. Čím to dělat

**Doporučení: rastr z modelu, ne pokus o SVG.**

Obrazové modely neumí čistý SVG — vypadnou z nich stovky zbytečných cest, které
se stejně musí ručně přetrasovat. Rychlejší cesta je nechat si vygenerovat PNG
a přijmout, že to je bitmapa.

| Cesta | Kdy |
|---|---|
| **PNG 1024×1024, průhledné pozadí** ← doporučuju | Dvacet odznaků, jeden styl, hotovo za odpoledne. |
| SVG na míru od designéra | Až bude jasné, že odznaky zůstávají a bude jich 50+. Tintovatelné, pár kB. |
| Lucide ikony na kotouči (dnešní stav) | Funguje, ale je to ikona, ne odměna. |

**Export do appky:** `assets/badges/<key>@3x.png` (a `@2x`, `@1x`). V UI se kreslí
na ~52–64 pt, takže **@3x = 192 px** stačí; generuj na 1024 a zmenši.
Dvacet odznaků ve třech hustotách vyjde zhruba na 1,5–3 MB — únosné, ale ne
zadarmo, takže **nedávej tam nic většího než 3x**.

### Dvě věci, na kterých to nejčastěji spadne

1. **Konzistence.** Dvacet samostatných promptů = dvacet různých stylů. Postup:
   vygeneruj **jeden** odznak, dolaď ho do finální podoby, a pak ho přikládej ke
   každému dalšímu promptu jako **referenci stylu** („match this style exactly").
   Doporučuju začít se **Stovkou** — je nejsložitější, takže nastaví laťku.
2. **Zamčený stav.** Negeneruj druhou sadu. V appce se zamčené ztlumí kódem
   (opacity + odbarvení), takže artwork musí fungovat i vyšeděný — což znamená
   **nespoléhat na barvu jako na jediný rozdíl mezi tvary**.

---

## 2. Style lock — tohle vlož do KAŽDÉHO promptu

```
Style: a single achievement badge for a Czech beer-diary mobile app.

FORM
- Circular medallion, thick rim, subtle bevel. Reads as a pressed metal token
  or an enamel pin, not a flat UI icon and not a sticker.
- One clear subject centred in the medallion. No text, no letters, no numbers.
- Silhouette must be readable at 48 px: chunky shapes, no thin lines, no fine
  detail, no gradients smaller than a few pixels.

COLOUR
- Warm amber and brass as the base: #E8A317 highlight, #C4841A mid,
  #7A4E18 shadow.
- Cream #FBF3E0 for the lightest accents, deep brown #2A1A0C for the darkest.
- No other hues unless the subject demands it (foliage, night sky), and then
  desaturated so the badge still reads as part of the set.
- Must sit on a near-black background (#15120F) — so no dark outer edge that
  disappears into it, and no white halo.

FINISH
- Soft top-left light, warm shadow bottom-right. Slight material texture.
- Rendered, with depth — but a token, not a 3D render with perspective.

OUTPUT
- 1024×1024, transparent background (PNG), subject fills ~88% of the canvas.
- No drop shadow baked in, no background plate, no frame around the medallion.

TONE
- Czech pub culture: warm, playful, a bit cheeky. Never corporate, never
  wellness-app, never a beer-marketing sticker.
```

---

## 3. Dvacet odznaků

Název a podmínka jsou z appky (`badgeCatalog.tsx`), tak je neměň — motiv se
navrhuje k nim, ne naopak. Poslední sloupec je návrh subjektu; ber ho jako
výchozí bod.

| Klíč | Název | Za co | Motiv do promptu |
|---|---|---|---|
| `firstBeer` | První pivo | Zapiš svoje první pivo | Jeden půllitr s čerstvou pěnou, kapka stéká po skle |
| `firstTen` | Prvních 10 piv | Napočítej 10 piv | Deset tácků naskládaných do komínku, mírně nakřivo |
| `century` | Stovka | Napočítej 100 piv | Vavřínový věnec kolem půllitru, ražba jako na minci |
| `regular` | Stálý host | Navštiv jednu hospodu 5× | Hospodská cedule nad vchodem, pod ní vyšlapaný práh |
| `stamgast` | Štamgast | Navštiv jednu hospodu 10× | Rezervovaná židle u stolu s cedulkou, na stole tácek |
| `pilgrim` | Poutník | Navštiv 25 různých hospod | Poutnická hůl a mapa, na ní 25 špendlíků |
| `reviewer` | Recenzent | Ohodnoť 10 hospod | Ruka s tužkou škrtající hvězdičky do tácku |
| `taster` | Ochutnávač | Ochutnej 10 různých piv | Vějíř pěti sklenic, každá jiný odstín od světlé po tmavou |
| `nightOwl` | Noční sova | Zapiš pivo po půlnoci | Sova sedící na ouškách půllitru, za ní srpek měsíce |
| `partyAnimal` | Duše party | Měj v partě 5 parťáků | Pět půllitrů ťukajících se ve středu, pěna stříká |
| `chatar` | Chatař | Zapiš první pivo mimo hospodu | Chata s verandou, na zábradlí lahev a otvírák |
| `podSirakem` | Pod širákem | Zapiš pivo venku pod širým nebem | Lahev opřená o kámen, nad ní hvězdy a silueta stromů |
| `lahvacovyFilozof` | Lahváčový filozof | Zapiš 25 lahváčů | Lahev s antickou bustou místo etikety |
| `plechovkac` | Plechovkáč | Zapiš 25 plechovek | Plechovka s odtrženým víčkem, kapky kolem otvoru |
| `firstMap` | Prvomapér | Buď první, kdo hospodu zmapuje | Zapíchnutá vlaječka do prázdné mapy, kolem klíčí lístek |
| `explorer` | Objevitel | Zmapuj 10 hospod | Kompas s růžicí, jehla míří na půllitr |
| `cartographer` | Kartograf | Zmapuj 25 hospod | Svinutá mapa s pravítkem a kružítkem, na mapě značky hospod |
| `completionist` | Pořádkumil | Zmapuj jednu hospodu naplno | Odškrtnutý seznam přes celou desku, poslední fajfka zářící |
| `factMachine` | Pivní detektiv | Zaznamenej 100 faktů | Lupa nad tácem, pod sklem detail pivní etikety |
| `fotoPivar` | FotoPivař | Vyhraj kolo fotosoutěže | Starý fotoaparát s bleskem, v hledáčku půllitr |

---

## 4. Šablona jednoho promptu

```
<sem vlož celý Style lock ze sekce 2>

SUBJECT: <motiv z tabulky>
BADGE NAME (do not render as text): <název>

Match the attached reference badge exactly in style, rim, palette, lighting and
level of detail. Only the subject changes.
```

U prvního (Stovka) referenci vynech a přilož ji od druhého dál.

---

## 5. Než to nasadíme

- [ ] Všech dvacet vedle sebe na `#15120F` — vypadá to jako **jedna sada**?
- [ ] Zmenši na **48 px** a koukni z délky paže. Co splyne, je moc detailní.
- [ ] Odbarvi na stupně šedi a ztlum na 45 % — pořád poznáš, co to je?
      (Takhle se kreslí zamčený stav.)
- [ ] Žádné písmo, číslice ani znaky uvnitř medaile. Název je pod ní v UI a
      vysázený text v obrázku by se nepřeložil a nešel škálovat.
- [ ] Průhledné pozadí, žádný bílý lem po ořezu.
- [ ] Odznaky za **objevování a rytmus** ať vypadají hodnotněji než ty za objem.
      Produkt nemá odměňovat, kolik toho vypiješ — `firstTen`, `century`,
      `lahvacovyFilozof` a `plechovkac` proto drž spíš věcné a nech lesk těm za
      mapování, poutnictví a partu.

---

## 6. Co pak udělám já

1. Soubory do `assets/badges/`.
2. `badgeCatalog.tsx` dostane `art` vedle `Icon` — lucide glyf zůstane jako
   fallback, kdyby obrázek chyběl.
3. `AchievementGrid` bude kreslit obrázek místo kotouče s ikonou; zamčené
   ztlumí `opacity` + `grayscale`.

Tohle jsou pak asi dvě hodiny práce a nic v UI se nepřeskládá.
