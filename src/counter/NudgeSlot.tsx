/**
 * NudgeSlot — block 3 of the Tácek counter layout: a fixed-height slot that
 * shows at most ONE nudge (undo strip, rapid confirm, dopito chip, check-in
 * offer, or weekly rank chip). The design rule it enforces: the slot is always
 * 52pt tall — occupied or empty — so the big CTA below it never jumps. The one
 * exception is `collapseWhenEmpty`, for screens that scroll (see below).
 * Presentational only: props in, callbacks out; appearance is instant, no
 * animation.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { BeerIcon, CheckIcon, XIcon } from '@/components/shared/IconGlyph';

export type Nudge =
  | { kind: 'rapid'; text: string; confirmLabel: string; onConfirm: () => void }
  | {
      kind: 'counted';
      text: string;
      undoLabel: string;
      onUndo: () => void;
      actionAccessibilityLabel?: string;
    }
  | { kind: 'dopito'; label: string; onPress: () => void }
  | { kind: 'checkin'; text: string; ctaLabel: string; onPress: () => void; onDismiss: () => void }
  | { kind: 'rank'; node: React.ReactNode };

const SLOT_HEIGHT = 52;
const ICON_SIZE = 14;

function StripText({ text }: { text: string }) {
  return (
    <Text
      style={styles.stripText}
      numberOfLines={1}
      maxFontSizeMultiplier={FontScaleCap.body}
    >
      {text}
    </Text>
  );
}

function CountedStrip({ nudge }: { nudge: Extract<Nudge, { kind: 'counted' }> }) {
  return (
    <View style={[styles.strip, styles.stripNeutralBorder]}>
      <CheckIcon size={ICON_SIZE} color={Colors.amber} />
      <StripText text={nudge.text} />
      <Pressable
        onPress={nudge.onUndo}
        style={({ pressed }) => [styles.ghostPill, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={nudge.actionAccessibilityLabel ?? cs.a11y.counterUndoStrip}
        hitSlop={Spacing.xs}
      >
        <Text
          style={styles.ghostPillLabel}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {nudge.undoLabel}
        </Text>
      </Pressable>
    </View>
  );
}

function RapidStrip({ nudge }: { nudge: Extract<Nudge, { kind: 'rapid' }> }) {
  return (
    <View style={[styles.strip, styles.stripRapidBorder]}>
      <CheckIcon size={ICON_SIZE} color={Colors.amber} />
      <StripText text={nudge.text} />
      <Pressable
        onPress={nudge.onConfirm}
        style={({ pressed }) => [styles.filledPill, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={cs.a11y.counterRapidConfirm}
        hitSlop={Spacing.xs}
      >
        <Text
          style={styles.filledPillLabel}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {nudge.confirmLabel}
        </Text>
      </Pressable>
    </View>
  );
}

function DopitoChip({ nudge }: { nudge: Extract<Nudge, { kind: 'dopito' }> }) {
  return (
    <View style={styles.centered}>
      <Pressable
        onPress={nudge.onPress}
        style={({ pressed }) => [styles.dopitoChip, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={nudge.label}
      >
        <Text
          style={styles.dopitoLabel}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {nudge.label}
        </Text>
      </Pressable>
    </View>
  );
}

function CheckinStrip({ nudge }: { nudge: Extract<Nudge, { kind: 'checkin' }> }) {
  return (
    <View style={[styles.strip, styles.stripNeutralBorder]}>
      <BeerIcon size={ICON_SIZE} color={Colors.amber} />
      <StripText text={nudge.text} />
      <Pressable
        onPress={nudge.onPress}
        style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={nudge.ctaLabel}
        hitSlop={Spacing.xs}
      >
        <Text
          style={styles.textButtonLabel}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {nudge.ctaLabel}
        </Text>
      </Pressable>
      <Pressable
        onPress={nudge.onDismiss}
        style={({ pressed }) => [styles.dismissButton, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={cs.a11y.counterCheckinDismiss}
      >
        <XIcon size={ICON_SIZE} color={Colors.mutedText} />
      </Pressable>
    </View>
  );
}

export function NudgeSlot({
  nudge,
  collapseWhenEmpty = false,
}: {
  nudge: Nudge | null;
  /**
   * Render nothing at all when there is no nudge.
   *
   * Only for screens whose breathing element is a `ScrollView`: there the slot's
   * appearance shortens the scroll instead of moving the button, so the fixed
   * height buys nothing and an empty 52pt band reads as a brown hole that cuts
   * the last row in half. On a screen whose breathing element is the hero card
   * (counter, compass, profile) the height MUST stay fixed — otherwise the card,
   * and with it the numeral or the dial, resizes every time a nudge shows up.
   */
  collapseWhenEmpty?: boolean;
}) {
  if (!nudge && collapseWhenEmpty) return null;

  return (
    <View style={styles.slot}>
      {nudge?.kind === 'counted' && <CountedStrip nudge={nudge} />}
      {nudge?.kind === 'rapid' && <RapidStrip nudge={nudge} />}
      {nudge?.kind === 'dopito' && <DopitoChip nudge={nudge} />}
      {nudge?.kind === 'checkin' && <CheckinStrip nudge={nudge} />}
      {nudge?.kind === 'rank' && <View style={styles.centered}>{nudge.node}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: {
    height: SLOT_HEIGHT,
    justifyContent: 'center',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.stout3,
    borderRadius: Radius.medium,
    borderWidth: 1,
  },
  stripNeutralBorder: {
    borderColor: withAlpha(Colors.border, 0.6),
  },
  stripRapidBorder: {
    borderColor: withAlpha(Colors.amber, 0.42),
  },
  stripText: {
    flex: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.foam,
    includeFontPadding: false,
  },
  ghostPill: {
    minHeight: HitArea.min,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.32),
  },
  ghostPillLabel: {
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.amber,
    includeFontPadding: false,
  },
  filledPill: {
    minHeight: HitArea.min,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  filledPillLabel: {
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.stout,
    includeFontPadding: false,
  },
  dopitoChip: {
    minHeight: HitArea.min,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.stout3,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
  },
  dopitoLabel: {
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.foam,
    includeFontPadding: false,
  },
  textButton: {
    minHeight: HitArea.min,
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  textButtonLabel: {
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.amber,
    includeFontPadding: false,
  },
  dismissButton: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
});
