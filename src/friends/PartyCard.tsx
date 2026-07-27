/**
 * PartyCard — the hero of the "Parta" screen: tonight's table, in one card.
 *
 * It is the direct sibling of `NightCard` and `CoasterCard`: same card recipe
 * (stout2 surface, 28 radius, 7% foam hairline border, 24/24/8 padding), same
 * four-step type scale (display numeral / 20 title / 15 body / 13 caption),
 * same hairline footer with one loud fact, one quiet one and one amber door.
 *
 * The rule this file enforces: the head count is the only lit thing here. No
 * amber frame, no glow — the screen's one glow belongs to its one button. The
 * numeral keeps a 1.24x line box because Baloo 2 ExtraBold overshoots and iOS
 * otherwise shaves the tops off the digits; the uppercase caption is pulled
 * back up into that headroom so the pair reads as one object.
 *
 * The card owns the table's SIZE but not its contents: `PartyTable` is
 * dimensioned from the measured card, never the other way round — on an iPhone
 * SE it shrinks instead of spilling over the rounded corner.
 *
 * Purely presentational: props in, callbacks out. The parent has already
 * declined every noun, picked the headline and decided what the footer says.
 */

import React, { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { ChevronRightIcon } from '@/components/shared/IconGlyph';
import { PartyTable } from '@/friends/PartyTable';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';

/** The numeral shrinks as the party grows so "12" never crowds the card. */
function countFontSize(count: number): number {
  if (count < 10) return 88;
  if (count < 100) return 72;
  return 56;
}

export interface PartyCardProps {
  /** How many of the party are sitting or already nodded for tonight. */
  count: number;
  /** Uppercased by the parent ("DNESKA NA PIVU" / "KLID V LOKÁLE"). */
  countLabel: string;
  /** One sentence about the freshest thing, or null when there is nothing to say. */
  headline: string | null;
  /** The loud fact in the footer ("3 týdny v sérii"), or null. */
  factStrong: string | null;
  /** The quiet fact under it ("2. pivař v zemi"), or null. */
  factMuted: string | null;
  /**
   * The amber door on the right of the footer. On Parta this is the screen's
   * primary action ("Cinknout partě") rather than a second way into the roster:
   * a feed does not get a pinned button above its tab bar, so the one action it
   * has lives in the card that the action is about.
   */
  linkLabel: string | null;
  /** What the footer door does. Falls back to `onPress` (opens the party). */
  onLinkPress?: (() => void) | null;
  /** Friends who said Jdu — drives the seats taken at the table. */
  going: number;
  /** Friends who said Možná — drives the half-lit seats. */
  maybe: number;
  /** Whether I am at the table myself. */
  mine: boolean;
  /** Both the whole card and the footer link open the party. Null = not pressable. */
  onPress: (() => void) | null;
  accessibilityLabel: string;
  /**
   * A `DoorRail` under the footer, in the counter card's idiom. Its own
   * pressables take the touch, so tapping a door does not also open the party
   * behind it.
   */
  rail?: ReactNode;
  /**
   * The screen's own chrome — party chip left, overflow door right — rendered
   * INSIDE the card's top padding instead of in a band above it.
   *
   * Parta is a feed under a status bar that already eats ~60pt: a separate
   * header row there is a third strip of chrome holding two small controls, and
   * it reads as an empty brown forehead. In the card the same two controls cost
   * nothing extra — the card's 24pt top padding was already there. Its own
   * pressables take the touch, like `rail`.
   */
  topRow?: ReactNode;
}

export function PartyCard({
  count,
  countLabel,
  headline,
  factStrong,
  factMuted,
  linkLabel,
  onLinkPress,
  going,
  maybe,
  mine,
  onPress,
  accessibilityLabel,
  rail,
  topRow,
}: PartyCardProps) {
  // The table is sized from the card, not the other way round: on a short phone
  // it shrinks instead of spilling over the card's edge.
  const [bodyHeight, setBodyHeight] = useState(0);
  const tableWidth = bodyHeight > 0 ? Math.max(72, Math.min(140, (bodyHeight - 16) * 0.72)) : 96;

  const hasFooter = factStrong !== null || factMuted !== null || linkLabel !== null;
  const numeralSize = countFontSize(count);

  const content = (
    <>
      {topRow !== undefined ? <View style={styles.topRow}>{topRow}</View> : null}

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
            maxFontSizeMultiplier={FontScaleCap.display}
          >
            {count}
          </Text>
          <Text style={styles.countLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {countLabel}
          </Text>
        </View>
        <PartyTable going={going} maybe={maybe} mine={mine} width={tableWidth} />
      </View>

      {headline !== null ? (
        <Text style={styles.headline} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {headline}
        </Text>
      ) : null}

      {/* Etalon footer: one loud fact, one quiet one, one door. */}
      {hasFooter ? (
        <View style={styles.footer}>
          <View style={styles.facts}>
            {factStrong !== null ? (
              <Text style={styles.factStrong} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {factStrong}
              </Text>
            ) : null}
            {factMuted !== null ? (
              <Text style={styles.factMuted} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {factMuted}
              </Text>
            ) : null}
          </View>

          {linkLabel !== null ? (
            <Pressable
              onPress={(onLinkPress ?? onPress) ?? undefined}
              disabled={(onLinkPress ?? onPress) === null}
              hitSlop={10}
              accessibilityRole={(onLinkPress ?? onPress) !== null ? 'button' : 'text'}
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

      {rail ?? null}
    </>
  );

  // An empty party has nowhere to go, so the card stops being a button rather
  // than staying a button that does nothing.
  if (onPress === null) {
    return (
      <View style={styles.card} accessibilityRole="text" accessibilityLabel={accessibilityLabel}>
        <CardSheen />
        {content}
      </View>
    );
  }

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <CardSheen />
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // `flex: 1` fills whatever box the screen hands over. When the stream below
  // is empty the host wraps this card in a growing container, and without the
  // flex the card would sit short with a hole of stout under it (§14.1). Inside
  // a plain scroll the flex simply has nothing to divide and `body`'s minHeight
  // takes over, which is exactly the NightCard behaviour.
  card: {
    ...CardSurface.card,
    flex: 1,
  },
  pressed: {
    opacity: 0.85,
  },
  // Sits in the card's own top padding, so it costs the composition nothing:
  // 12 under it is "same group" spacing — chip and numeral are one object.
  topRow: {
    marginBottom: 12,
  },
  // `flex: 1` lets the body absorb whatever height the card is given, so the
  // footer stays pinned to the bottom edge instead of floating mid-card; the
  // minimum is the safety net for when the card is only as tall as its content.
  // 132 is the 88pt numeral's line box plus room for the table.
  body: {
    flex: 1,
    minHeight: 132,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  // Without flexShrink/minWidth a long caption pushes the table off the card
  // instead of truncating.
  countColumn: {
    flexShrink: 1,
    minWidth: 0,
  },
  count: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.amber,
    includeFontPadding: false,
    // Tabular figures so the digit never shifts sideways as people nod.
    fontVariant: ['tabular-nums'],
  },
  // Small, wide, unlit: a caption for the numeral, not a headline of its own.
  // Pulled up into the numeral's line-box headroom so the pair reads as one
  // object instead of two stacked labels.
  countLabel: {
    marginTop: -8,
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    letterSpacing: 3,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  headline: {
    marginTop: 12,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
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
  factStrong: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  factMuted: {
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
  // A shade louder than a plain card door: on Parta this text IS the screen's
  // primary action, and it has no glow behind it to help it get noticed.
  linkLabel: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.amber,
    includeFontPadding: false,
  },
});
