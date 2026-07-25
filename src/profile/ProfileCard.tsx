/**
 * ProfileCard — the hero of the "Profil" screen: your beer calling card.
 *
 * Direct sibling of `NightCard` and `PartyCard`, and through them of the etalon
 * `CoasterCard`: same card surface (`CardSurface.card`), same four-step type
 * scale (display numeral / 20 title / 15 body / 13 caption), same hairline
 * footer with one quiet fact and one amber door.
 *
 * The rule this file enforces: the lifetime count is the one LOUD thing here.
 * The level sits beside it as a ring — the level number and how far into the
 * rung you are — because that is the part a sentence in the footer could never
 * show. The ring's arc is a thin amber stroke, not a plane, so the screen still
 * has exactly one filled amber surface (its button) and one big amber numeral
 * (this one). The numeral keeps a 1.24x line box because Baloo 2 ExtraBold
 * overshoots and iOS otherwise shaves the tops off the digits; the uppercase
 * caption is pulled back up into that headroom so the pair reads as one object.
 *
 * The card owns the ring's SIZE but not its contents: `LevelRing` is dimensioned
 * from the measured card, never the other way round — on an iPhone SE it shrinks
 * instead of spilling over the rounded corner.
 *
 * The card itself is not pressable. Exactly one door leads into the trophy
 * cabinet, and that is the footer link — a card that is also a button would be
 * a second path to the same place.
 *
 * Purely presentational: props in, callbacks out. The parent has already
 * formatted the number, uppercased the caption and written the footer line.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { LevelRing } from '@/profile/LevelRing';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';

/**
 * The numeral shrinks with the formatted label, not with the raw number: the
 * parent spaces thousands ("1 240"), so the character count is what actually
 * decides whether the digits still fit beside the ring.
 */
function numeralFontSize(label: string): number {
  if (label.length <= 2) return 88;
  if (label.length <= 3) return 72;
  return 56;
}

export interface ProfileCardProps {
  /** The lifetime total, pre-formatted with thousands spacing ("1 240"). */
  beersLabel: string;
  /** Uppercased by the parent ("PIV ZA ŽIVOT" / "ČISTEJ ŠTOS"). */
  caption: string;
  /** Rung number, or null with no account (the ring then shows a dash). */
  level: number | null;
  /** The rung's name ("Výčepní"), or null. */
  levelTitle: string | null;
  /** 0..1 through the current rung; null = maxed (or unknown) → full ring. */
  levelProgress: number | null;
  /** The one footer fact ("ještě 40 XP do dalšího levelu"), or null. */
  levelHint: string | null;
  /**
   * The lifetime trio under the numeral: pubs, evenings, money. Pre-formatted and
   * pre-uppercased by the parent. An empty list draws no row.
   */
  stats: { key: string; value: string; label: string }[];
  /** The amber door on the right of the footer ("Odznaky"); null draws no link. */
  linkLabel: string | null;
  /** Opens the badge cabinet. Null leaves the link undrawn. */
  onPressLink: (() => void) | null;
  accessibilityLabel: string;
}

export function ProfileCard({
  beersLabel,
  caption,
  level,
  levelTitle,
  levelProgress,
  levelHint,
  stats,
  linkLabel,
  onPressLink,
  accessibilityLabel,
}: ProfileCardProps) {
  // The ring is sized from the card, not the other way round: on a short phone
  // it shrinks instead of spilling over the card's edge.
  const [bodyHeight, setBodyHeight] = useState(0);
  const ringSize = bodyHeight > 0 ? Math.max(72, Math.min(108, Math.round(bodyHeight * 0.52))) : 92;

  const hasFooter = levelHint !== null || linkLabel !== null;
  const hasLink = linkLabel !== null && onPressLink !== null;
  const numeralSize = numeralFontSize(beersLabel);

  return (
    <View style={styles.card} accessibilityRole="text" accessibilityLabel={accessibilityLabel}>
      <CardSheen />

      <View style={styles.body} onLayout={(event) => setBodyHeight(event.nativeEvent.layout.height)}>
        <View style={styles.countColumn}>
          <Text
            style={[
              styles.count,
              // The line box must clear the extrabold glyph's overshoot, or iOS
              // shaves the top off the digits. 1.24 leaves real headroom; the
              // caption's negative margin closes the gap it creates below.
              { fontSize: numeralSize, lineHeight: numeralSize * 1.24 },
            ]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            maxFontSizeMultiplier={FontScaleCap.display}
          >
            {beersLabel}
          </Text>
          <Text style={styles.caption} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {caption}
          </Text>
        </View>
        <LevelRing
          level={level}
          title={levelTitle}
          progress={levelProgress}
          size={ringSize}
        />
      </View>

      {/* The lifetime trio. Separated by light, not by boxes: three framed tiles
          inside a framed card would be frame-on-frame. */}
      {stats.length > 0 ? (
        <View style={styles.stats}>
          {stats.map((stat, index) => (
            <React.Fragment key={stat.key}>
              {index > 0 ? <View style={styles.statDivider} /> : null}
              <View style={styles.stat}>
                <Text
                  style={styles.statValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {stat.value}
                </Text>
                <Text
                  style={styles.statLabel}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {stat.label}
                </Text>
              </View>
            </React.Fragment>
          ))}
        </View>
      ) : null}

      {/* Etalon footer: one quiet fact and one door. */}
      {hasFooter ? (
        <View style={styles.footer}>
          <View style={styles.facts}>
            {levelHint !== null ? (
              <Text
                style={styles.levelHint}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {levelHint}
              </Text>
            ) : null}
          </View>

          {hasLink ? (
            <Pressable
              onPress={onPressLink}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={linkLabel}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Text style={styles.linkLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                {linkLabel}
              </Text>
              <ChevronRightIcon size={15} color={Colors.amber} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Like NightCard and PartyCard this one sits at the top of a scroll, not in a
  // fixed composition — but it still takes `flex: 1` so a screen that hands it
  // the leftover space gets a card that fills it instead of a hole in the
  // middle. It clips itself: the ring is sized from the card, never the other
  // way round.
  card: {
    ...CardSurface.card,
    flex: 1,
  },
  pressed: {
    opacity: 0.85,
  },
  // `flex: 1` lets the body absorb whatever height the card is given, so the
  // footer stays pinned to the bottom edge instead of floating mid-card; the
  // minimum is the safety net for when the card is only as tall as its content.
  // 132 is the 88pt numeral's line box plus room for the ring's caption.
  body: {
    flex: 1,
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  // Without flexShrink/minWidth a long caption pushes the ring off the card
  // instead of truncating.
  countColumn: {
    flexShrink: 1,
    minWidth: 0,
  },
  count: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.amber,
    includeFontPadding: false,
    // Tabular figures so the digits never shift sideways as the total grows.
    fontVariant: ['tabular-nums'],
  },
  // Small, wide, unlit: a caption for the numeral, not a headline of its own.
  // Pulled up into the numeral's line-box headroom so the pair reads as one
  // object instead of two stacked labels.
  caption: {
    marginTop: -8,
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    letterSpacing: 3,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  stats: {
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  stat: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'center',
    height: 26,
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  statValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 17,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontFamily: Fonts.ui.medium,
    fontSize: 11,
    letterSpacing: 1.2,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  footer: CardSurface.footer,
  facts: {
    flexShrink: 1,
    minWidth: 0,
  },
  levelHint: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: HitArea.min,
    paddingLeft: 8,
  },
  linkLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },
});
