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
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { BeerIcon, CheckIcon, XIcon, type IconProps } from '@/components/shared/IconGlyph';

export type Nudge =
  | {
      kind: 'rapid';
      text: string;
      confirmLabel: string;
      onConfirm: () => void;
      /**
       * Leading glyph. Defaults to the check, which is right when the strip
       * confirms something ("Ještě jedno?" → "Jo"). When the strip reports a
       * fact instead ("někdo sedí v hospodě"), a checkmark is a small lie about
       * what already happened — pass the glyph that matches.
       */
      icon?: React.ComponentType<IconProps>;
    }
  | {
      kind: 'counted';
      text: string;
      undoLabel: string;
      onUndo: () => void;
      actionAccessibilityLabel?: string;
      /** Same escape hatch as `rapid`: a check beside "nenačetlo se" is a lie
       *  about what happened. Defaults to the check, which is right for
       *  "spočítáno · Vrátit". */
      icon?: React.ComponentType<IconProps>;
    }
  | { kind: 'dopito'; label: string; onPress: () => void }
  | { kind: 'checkin'; text: string; ctaLabel: string; onPress: () => void; onDismiss: () => void }
  | { kind: 'rank'; node: React.ReactNode };

const SLOT_HEIGHT = 52;
const ICON_SIZE = 14;
/**
 * The pill inside the strip is 36 tall, not 44.
 *
 * At 44 inside a 48pt strip a three-letter label like "Jdu" came out 58 × 44 —
 * near enough to a circle that it read as an amber coin stuck to the end of the
 * row, and it ate so much width that the sentence beside it truncated mid-pub.
 * 36 × ~64 is a pill again, and the 4pt it gives back to each side plus the
 * slimmer footprint is the difference between "…U Zlatého t…" and the whole
 * name. The touch target stays 44+ via hitSlop.
 */
const PILL_HEIGHT = 36;
const PILL_HIT_SLOP = { top: 8, bottom: 8, left: 6, right: 6 } as const;

function StripText({ text }: { text: string }) {
  return (
    // The slot is a fixed 52pt row so the button under it never jumps, which
    // means the sentence cannot have more room at large Dynamic Type sizes —
    // it has to get smaller instead of ending in "nenač…" (§3.3).
    <Text
      style={styles.stripText}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
      maxFontSizeMultiplier={FontScaleCap.body}
    >
      {text}
    </Text>
  );
}

function CountedStrip({ nudge }: { nudge: Extract<Nudge, { kind: 'counted' }> }) {
  const Icon = nudge.icon ?? CheckIcon;
  return (
    <View style={[styles.strip, styles.stripNeutralBorder]}>
      <Icon size={ICON_SIZE} color={Colors.amber} />
      <StripText text={nudge.text} />
      <Pressable
        onPress={nudge.onUndo}
        style={({ pressed }) => [styles.ghostPill, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={nudge.actionAccessibilityLabel ?? cs.a11y.counterUndoStrip}
        hitSlop={PILL_HIT_SLOP}
      >
        <Text
          style={styles.ghostPillLabel}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {nudge.undoLabel}
        </Text>
      </Pressable>
    </View>
  );
}

function RapidStrip({ nudge }: { nudge: Extract<Nudge, { kind: 'rapid' }> }) {
  const Icon = nudge.icon ?? CheckIcon;
  return (
    <View style={[styles.strip, styles.stripRapidBorder]}>
      <Icon size={ICON_SIZE} color={Colors.amber} />
      <StripText text={nudge.text} />
      <Pressable
        onPress={nudge.onConfirm}
        style={({ pressed }) => [styles.filledPill, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={cs.a11y.counterRapidConfirm}
        hitSlop={PILL_HIT_SLOP}
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
   * Meant for screens whose breathing element is a `ScrollView`: there the slot's
   * appearance shortens the scroll instead of moving the button, so the fixed
   * height buys nothing and an empty 52pt band reads as a brown hole that cuts
   * the last row in half.
   *
   * On a screen whose breathing element is the hero card the default (fixed) is
   * usually right: the card, and with it the numeral, resizes every time a nudge
   * shows up. The compass opts out anyway — its nudge is rare and its dial is the
   * icon of the product, so 52pt of permanent empty stripe costs more than the
   * occasional resize. Weigh it that way rather than assuming either answer.
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
    fontWeight: '600',
    fontSize: 13,
    color: Colors.foam,
    includeFontPadding: false,
  },
  ghostPill: {
    minHeight: PILL_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.32),
  },
  ghostPillLabel: {
    fontWeight: '700',
    fontSize: 14,
    color: Colors.amber,
    includeFontPadding: false,
  },
  filledPill: {
    minHeight: PILL_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  filledPillLabel: {
    fontWeight: '700',
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
    fontWeight: '700',
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
    fontWeight: '700',
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
