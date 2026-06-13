# Design směr: „Mosazný výčep" (Brass Taproom)

Premium redesign hlavní (kompasové) obrazovky appky **na pivo**. Schválený směr — viz koncept `design/napivo-brass-taproom-concept.png`.

**Metafora:** přesný mosazno-smaltový přístroj nasvícený jedním teplým světlem výčepu. Prémiovost staví na **materiálu a řemesle** (broušená mosaz, smalt, sklenutá pěna), ne na všudypřítomné záři. Jeden záměrný zdroj světla shora; mosaz a pěna ho odrážejí.

**Prémiový jazyk:** materialita, hairline odlesky, debossed stíny, racionovaný amber.

---

## Tokeny (beze změny)
stout `#1F1308`, stout2 `#2B1A0E`, stout3 `#3A2515`, border `#5A3A20`, amber `#E8A317`, amberLight `#F5B642`, glow `#FF7A1A`, neon `#FFD27A`, foam `#FBF3E0`, foamMuted `#E8DCC0`, mutedText `#A8896A`, open `#F0BE5C`, closed `#A8896A`, success `#7DD66B`. Radius.card 22, Radius.pill 999. Spacing 4/8/14/20/28/40.

## Nové odvozené hexy (dopočítané z palety, ne tokeny)
`#160D04` deep roast (bg edge), `#241608` smalt (enamel face), `#332011` nasvícený top zamčené karty, `#8A5A1E` mosaz stín (amber ×0.62), `#C98A2E` gravírovaná linka, `#7A5A38` zapuštěný minor tick, `#FCE7B8` specular glint, `#1B1006` kanál přepínače.

## Gradienty
- **#brassRim** LinearGradient (TL→BR): 0% `#F5B642` / 30% `#E8A317` / 55% `#8A5A1E` / 80% `#E8A317` / 100% `#5A3A20`
- **#foamDisk** RadialGradient cx50 cy42: 0% `#FFFFFF` / 45% `#FBF3E0` / 100% `#E8DCC0`
- **key-light** RadialGradient cx50 cy34 r85: 0% `#3A2515`@0.9 / 38% `#2B1A0E`@0.85 / 72% `#1F1308`@1 / 100% `#160D04`@1
- **vignette** RadialGradient cx50 cy50 r75: transparent → 100% `#000000`@0.28

---

## Spec po prvcích

**Pozadí** — zrušit plochý `Colors.stout` root fill; full-bleed SVG za obsahem (`absoluteFill`, `pointerEvents none`), base View na `stout` proti probliknutí. Nad ním key-light radial + vignette radial (viz výše). Žádné zrno v v1.

**Kompas (CompassDial)** — zachovat viewBox `0 0 320 320`, 320pt konstanty a `memo`.
1. Mosazný bezel: outer Circle r150 fill `url(#brassRim)`, inner Circle r134 fill `#241608` (smalt). Jeden specular oblouk vlevo nahoře: Path stroke `#FCE7B8` w2.5 op0.7.
2. JEDEN gravírovaný kroužek: SMAZAT R_INNER_RING (132); ponechat jen R_INNER2 (104) jako hairline `#C98A2E`@0.4.
3. Foam disk r120 fill `url(#foamDisk)`.
4. Bubliny: 12–14 (místo 6 TEXTURE_DOTS), r1–4, `#FFFFFF`@0.12–0.45, shluk vlevo nahoře; 3 ring-only (stroke `#FFFFFF` w0.5 op0.22). Cap ~14 nodů.
5. Ticky: 24 ring; cardinaly = zaoblené Rect 2×8 fill `url(#brassRim)`; minor = Circle r1.6 `#7A5A38`@0.55.
6. Cardinaly S/V/J/Z: Baloo2 ExtraBold 20, fill `#3A2515` + jeden debossed foam twin (`#FBF3E0`@0.22, y+0.5). Sever „S" dostane mosazný tick.
7. Hub (CompassContainer): mosazná čepička — outer r16 `url(#brassRim)` stroke `#5A3A20`, mid r9 `#241608`, center r4.5 `#F5B642` + highlight r1.5 `#FCE7B8`.

**Vzdálenost** — number Baloo2 ExtraBold foam, letterSpacing -1.5, responsivní velikost zachovat. Jednotka DEMOTE z amber na `mutedText` + letterSpacing 0.5. Mosazná hairline pod řádkem: w~64, `#5A3A20`@0.5 + 1px `#E8A317`@0.3 top. Caption: Inter Medium 12 `mutedText` letterSpacing 1.6 UPPERCASE marginTop 8 (kapitálkový kicker, ne kurzíva).

**Skrytá hospoda (HiddenPubPill)** — SMAZAT `SKELETON_BAR_WIDTHS`/`skeletonGroup`/`skeletonBar`. Zapečetěný pivní tácek: sdílený `pubPill` styl + `PUB_PILL_MIN_HEIGHT 166` (musí se rovnat revealed kartě — jinak controls spadnou do Android nav baru). bg vertical LinearGradient `#332011`→`#241608`, border 1px `#5A3A20` (NE amber), 1px top highlight `#FBF3E0`@0.06. Střed: 64pt mosazná medaile (`url(#brassRim)`) s `LockKeyholeIcon` 26 `#241608` (embossed) + top-arc glint `#FCE7B8`@0.3. Titul „Tvoje pivo čeká" Baloo2 Bold 17 foam; sub „Klepni a odkryj nejbližší výčep" Inter Medium 12 mutedText. Dole pilulka: stout3 + 1px border, `EyeIcon` 14 amber + „Odkrýt" Inter SemiBold 13 amber. Press scale 0.985. Zachovat a11y label/role.

**Odhalená hospoda (RevealedPubPill)** — sdílený `pubPill`; bg vertical LinearGradient `#3A2515`→`#2B1A0E`, border 1.5px `amber`. Místo `amberGlow(14)` contained iOS under-glow: shadowColor `glow`, opacity 0.28, radius 22, offset {0,6}; Android elevation 6. 1px top highlight `#F5B642`@0.5. Name row: BeerIcon v 30pt čipu (stout fill, 1px amber ring), název Baloo2 ExtraBold 23 letterSpacing -0.3 (numberOfLines 1). Open status: ponechat OpenStatusChip barvy; OPEN stav v kapsli `withAlpha(open,0.1)` radius pill + 6px tepající `#F0BE5C` tečka. Beer line: lead Inter SemiBold 13 foamMuted, CENA Baloo2 Bold 13 amber, „· a další" mutedText. Maps CTA: full-width amber lišta bg `withAlpha(amber,0.12)`, 1px top `withAlpha(amber,0.25)`, radius 12, height 44, MapPinIcon 16 + „Otevřít v mapách" Inter Bold 14 amber + ExternalLinkIcon 12, press scale 0.98. Footer: 1px border top, ztišit — contribute amber@0.85, report mutedText, Inter Medium 12. **Zachovat složený accessibilityLabel** (VoiceOver skládá chip do Pressable labelu).

**Přepínač (ModeToggle)** — track bg `#1B1006`, 1px top `#160D04` + 1px bottom `#5A3A20`@0.6 (fake inset), radius pill, padding 5. ODSTRANIT `amberGlow(8)`. Jeden absolutně pozicovaný Animated.View „slug" co translateX-springuje (damping 22, stiffness 220) mezi segmenty měřenými přes onLayout (NE dva cross-fade backgroundy). Slug = brass LinearGradient `#F5B642`→`#E8A317`→`#C98A2E`, 1px top highlight `#FCE7B8`@0.6, iOS shadow op0.35 r4 offsetY2 / Android elevation 3. Active label stout Inter Bold 14; inactive foamMuted@0.6. Zachovat adjustsFontSizeToFit/minimumFontScale 0.82/paddingHorizontal 10. Lehký expo-haptics selection tick (už nainstalováno). Reroll: knurled knob — stout3, 1px `#5A3A20`, top-arc glint `#FCE7B8`@0.25, RefreshCwIcon 18 foamMuted, press scale 0.94 + spring spin 180°.

**Hlavička (TitleBar)** — engraved nameplate, zachovat align='left' + onSettingsLongPress dev hook. Wordmark „na" foamMuted / „pivo" amber, letterSpacing -0.5. Vlevo 18pt mosazná medaile místo BeerIcon. Gear 20pt mutedText na `withAlpha(foam,0.04)` disku s 1px `withAlpha(border,0.5)` ringem. 1px hairline pod hlavičkou: `#5A3A20`@0.4 + 1px `withAlpha(foam,0.05)` highlight nad.

**Glow filozofie** — JEDEN zdroj světla (key-light na ciferníku). ODSTRANIT: velké compassGlow halo (CompassContainer), amberGlow(8) na toggle, amberGlow(14) na revealed kartě. ZMENŠIT needle FeGaussianBlur: opacity 0.45→0.22, stdDeviation 10→5. Glow povolen jen 2× contained: (a) teplý under-glow revealed karty, (b) světlo skrz foam disk.

**Motion** — NEsahat na hot heading→needle path (useAnimatedReaction + ARROW_SPRING_CONFIG). Dekorativní loopy = separátní shared values, gate na useReducedMotion, pauza na blur, cap ≤4 animované SVG nody. (1) Dýchající key-light: Stop opacity 0.82↔0.92 6s. (2) Foam settle: až 3 bubliny drift -3 + fade 4–7s. Interakce: reveal = cross-fade + spring scale 0.96→1; mode switch = slug slide + haptik; reroll = knob scale 0.94 + spin 180°; všechny Pressable scale 0.98.

---

## Asset (volitelný, NE ve v1)
Obrazovka je plně kódová — asset nepotřebuje. Volitelně později jemné zrno sladu přes pozadí na ~6–8 %. ChatGPT prompt: viz konverzace (2048×2048, tileable, transparentní PNG, range `#160D04`–`#2B1A0E`, žádný jas/amber/text).

## Invarianty k zachování při implementaci
1. CompassDial viewBox + 320pt konstanty + memo (jinak crop na iPad compatibility window).
2. Stejná výška skryté/odhalené karty přes sdílený pubPill + PUB_PILL_MIN_HEIGHT 166 (Android nav overlap).
3. NEsahat na hot heading→needle reanimated path (Android-only spring).
4. Zachovat všechny maxFontSizeMultiplier/FontScaleCap capy a a11y labely.
5. Žádné nové závislosti (expo-blur/expo-linear-gradient netřeba — vše SVG; expo-haptics už je).

## Dotčené soubory
`app/(tabs)/index.tsx`, `src/components/compass/CompassDial.tsx`, `src/components/compass/CompassContainer.tsx`, `src/components/compass/CompassArrow.tsx`, `src/components/shared/TitleBar.tsx`. (Kompas + TitleBar jsou sdílené → změna se projeví i na loading/dalších obrazovkách.)
