/**
 * ProfileCard — the hero of the "Profil" screen: your beer calling card.
 *
 * Direct sibling of `NightCard` and `PartyCard`, and through them of the etalon
 * `CoasterCard`: same card recipe (stout2 surface, 28 radius, 7% foam hairline
 * border, 24/24/8 padding), same four-step type scale (display numeral / 20
 * title / 15 body / 13 caption), same hairline footer with one loud fact, one
 * quiet one and one amber door.
 *
 * The rule this file enforces: the lifetime count is the only lit thing here.
 * No amber frame, no glow, and deliberately no XP progress bar — an abstract
 * gauge would compete with the numeral for the same job, and the screen's one
 * glow belongs to its one button. The level is a sentence in the footer, not a
 * meter. The numeral keeps a 1.24x line box because Baloo 2 ExtraBold overshoots
 * and iOS otherwise shaves the tops off the digits; the uppercase caption is
 * pulled back up into that headroom so the pair reads as one object.
 *
 * The card owns the stack's SIZE but not its contents: `CoasterStack` is
 * dimensioned from the measured card, never the other way round — on an iPhone
 * SE it shrinks instead of spilling over the rounded corner.
 *
 * The card itself is not pressable. Exactly one door leads into the trophy
 * cabinet, and that is the footer link — a card that is also a button would be
 * a second path to the same place.
 *
 * Purely presentational: props in, callbacks out. The parent has already
 * formatted the number, uppercased the caption and written both footer lines.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { CoasterStack } from '@/profile/CoasterStack';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';

/**
 * The numeral shrinks with the formatted label, not with the raw number: the
 * parent spaces thousands ("1 240"), so the character count is what actually
 * decides whether the digits still fit beside the stack.
 */
function numeralFontSize(label: string): number {
  if (label.length <= 2) return 88;
  if (label.length <= 3) return 72;
  return 56;
}

export interface ProfileCardProps {
  /** Lifetime beers — drives how deep the coaster stack goes. */
  beers: number;
  /** The same number, pre-formatted with thousands spacing ("1 240"). */
  beersLabel: string;
  /** Uppercased by the parent ("PIV ZA ŽIVOT" / "ČISTEJ ŠTOS"). */
  caption: string;
  /** The loud fact in the footer ("Úroveň 7 · Štamgast"), or null. */
  levelLine: string | null;
  /** The quiet fact under it ("ještě 40 XP do dalšího levelu"), or null. */
  levelHint: string | null;
  /** The amber door on the right of the footer ("Odznaky"); null draws no link. */
  linkLabel: string | null;
  /** Opens the badge cabinet. Null leaves the link undrawn. */
  onPressLink: (() => void) | null;
  accessibilityLabel: string;
}

export function ProfileCard({
  beers,
  beersLabel,
  caption,
  levelLine,
  levelHint,
  linkLabel,
  onPressLink,
  accessibilityLabel,
}: ProfileCardProps) {
  // The stack is sized from the card, not the other way round: on a short phone
  // it shrinks instead of spilling over the card's edge.
  const [bodyHeight, setBodyHeight] = useState(0);
  const stackWidth = bodyHeight > 0 ? Math.max(64, Math.min(112, (bodyHeight - 16) * 0.66)) : 88;

  const hasFooter = levelLine !== null || levelHint !== null || linkLabel !== null;
  const hasLink = linkLabel !== null && onPressLink !== null;
  const numeralSize = numeralFontSize(beersLabel);

  return (
    <View style={styles.card} accessibilityRole="text" accessibilityLabel={accessibilityLabel}>
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
        <CoasterStack beers={beers} width={stackWidth} />
      </View>

      {/* Etalon footer: one loud fact, one quiet one, one door. */}
      {hasFooter ? (
        <View style={styles.footer}>
          <View style={styles.facts}>
            {levelLine !== null ? (
              <Text
                style={styles.levelLine}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {levelLine}
              </Text>
            ) : null}
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
  // middle. It clips itself: the stack is sized from the card, never the other
  // way round.
  card: {
    flex: 1,
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 8,
  },
  pressed: {
    opacity: 0.85,
  },
  // `flex: 1` lets the body absorb whatever height the card is given, so the
  // footer stays pinned to the bottom edge instead of floating mid-card; the
  // minimum is the safety net for when the card is only as tall as its content.
  // 132 is the 88pt numeral's line box plus room for the stack.
  body: {
    flex: 1,
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  // Without flexShrink/minWidth a long caption pushes the stack off the card
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
  footer: {
    marginTop: 20,
    paddingTop: 12,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  facts: {
    flexShrink: 1,
    minWidth: 0,
  },
  levelLine: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
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
