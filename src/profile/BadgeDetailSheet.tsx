/**
 * One medal up close: what it counts, how far the next level is and who can see
 * it. A medal that went up since it was last opened mints itself once here
 * (DESIGN.md §10, "ražba"): it presses in, the new minting lands with a heavy
 * tap and it settles. Reduced motion swaps the art at once; the haptics stay.
 */

import React, { useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon, EyeIcon, EyeOffIcon, XIcon } from '@/components/shared/IconGlyph';
import { intlLocale, t } from '@/i18n';
import { BadgeMedal, medalLook } from '@/profile/BadgeMedal';
import { daysUntilHoliday, PUBLIC_BADGE_KEYS, type BadgeState } from '@/profile/badgeModel';
import { ProgressBar } from '@/profile/BadgeRows';
import { badgeAmount, badgeName, roman, stillLine } from '@/profile/badgeText';
import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { fireHeavyImpactHaptic, fireSuccessHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';

/** Lets the sheet finish fading in before the medal strikes. */
const MINT_DELAY_MS = 350;
const PRESS_MS = 120;
const POP_MS = 180;
const MEDAL_SIZE = 128;
/** Past this many, the missing days or months are counted instead of named. */
const MISSING_NAMED = 3;

function subtitle(state: BadgeState): string {
  if (state.kind === 'tiered') {
    const amount = badgeAmount(state.key, state.value);
    return state.tier > 0
      ? `${t.badges.levelOf(roman(state.tier), roman(state.tiers.length))} · ${amount}`
      : amount;
  }
  if (state.secret && state.tier === 0) return t.badges.secretAbout;
  if (state.kind === 'slots') {
    return `${t.badges.about[state.key].replace(/\.$/, '')} · ${t.badges.slotsOf(state.value, state.tiers[0])}`;
  }
  return t.badges.about[state.key];
}

/** Both levels are drawn on top of each other; the swap happens on the UI thread at the strike. */
function useMint(minting: boolean) {
  const reduceMotion = useReduceMotion();
  const scale = useSharedValue(1);
  const landed = useSharedValue(minting ? 0 : 1);

  useEffect(() => {
    if (!minting) return;
    const haptics = useSettingsStore.getState().hapticEnabled;
    const strike = () => {
      if (haptics) fireHeavyImpactHaptic();
    };
    let settle: ReturnType<typeof setTimeout> | undefined;
    const start = setTimeout(() => {
      settle = setTimeout(() => {
        if (haptics) fireSuccessHaptic();
      }, reduceMotion ? 0 : PRESS_MS + POP_MS);
      if (reduceMotion) {
        landed.value = 1;
        strike();
        return;
      }
      scale.value = withTiming(0.9, { duration: PRESS_MS, easing: Easing.in(Easing.quad) }, (finished) => {
        if (!finished) return;
        landed.value = 1;
        runOnJS(strike)();
        scale.value = withSequence(
          withTiming(1.08, { duration: POP_MS, easing: Easing.out(Easing.cubic) }),
          withSpring(1, { damping: 14, stiffness: 220 }),
        );
      });
    }, MINT_DELAY_MS);
    return () => {
      clearTimeout(start);
      if (settle) clearTimeout(settle);
    };
    // Mints once per opening; the reduce-motion flag is read when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minting]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const before = useAnimatedStyle(() => ({ opacity: 1 - landed.value }));
  const after = useAnimatedStyle(() => ({ opacity: landed.value }));
  return { style, before, after };
}

function Slots({ state }: { state: BadgeState }) {
  const days = state.key === 'weekdays';
  const labels = days ? t.badges.weekdays : t.badges.months;
  const names = days ? t.badges.weekdayNames : t.badges.monthNames;
  const have = new Set(state.slots);
  const slotValue = (index: number) => (days ? index : index + 1);
  const missing = labels.map((_, index) => index).filter((index) => !have.has(slotValue(index)));
  const rows = days ? [labels] : [labels.slice(0, 6), labels.slice(6)];

  return (
    <View style={styles.slotsBlock}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.slotsRow}>
          {row.map((label, column) => {
            const index = rowIndex * 6 + column;
            const on = have.has(slotValue(index));
            return (
              <View
                key={label}
                style={styles.slot}
                accessible
                accessibilityLabel={`${names[index]}, ${on ? t.badges.a11yEarned : t.badges.a11yMissing}`}
              >
                <View style={[styles.slotDisc, on ? styles.slotDiscOn : styles.slotDiscOff]}>
                  {on ? <CheckIcon size={20} color={Colors.amber} /> : null}
                </View>
                <Text
                  style={[styles.slotLabel, !on && styles.slotLabelMissing]}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {label}
                </Text>
              </View>
            );
          })}
        </View>
      ))}
      <Text style={styles.slotsMissing} maxFontSizeMultiplier={FontScaleCap.body}>
        {missing.length === 0
          ? days
            ? t.badges.allDays
            : t.badges.allMonths
          : missing.length > MISSING_NAMED
            ? days
              ? t.badges.missingDays(missing.length)
              : t.badges.missingMonths(missing.length)
            : t.badges.missingSlots(missing.map((index) => names[index]))}
      </Text>
      <Text style={styles.slotsKeep} maxFontSizeMultiplier={FontScaleCap.body}>
        {days ? t.badges.keepDays : t.badges.keepMonths}
      </Text>
    </View>
  );
}

function Levels({ state }: { state: BadgeState }) {
  return (
    <>
      <Text style={styles.sectionTitle} accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading}>
        {t.badges.levels}
      </Text>
      {state.tiers.map((threshold, index) => {
        const tier = index + 1;
        const earned = tier <= state.tier;
        const missing = threshold - state.value;
        const isNext = tier === state.tier + 1;
        const label = `${roman(tier)} · ${badgeAmount(state.key, threshold)}`;
        const right = earned || state.volume ? null : t.badges.missing(missing.toLocaleString(intlLocale));
        return (
          <View
            key={tier}
            style={[styles.levelRow, index > 0 && styles.divided]}
            accessible
            accessibilityLabel={[label, earned ? t.badges.a11yEarned : right].filter(Boolean).join(', ')}
          >
            <BadgeMedal badge={state.key} look={medalLook(state, tier)} size={40} />
            <Text
              style={[styles.levelLabel, !earned && styles.levelLabelFuture]}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {label}
            </Text>
            {earned ? (
              <CheckIcon size={18} color={Colors.amber} />
            ) : right ? (
              <Text style={[styles.levelMissing, isNext && styles.levelMissingNext]} maxFontSizeMultiplier={FontScaleCap.body}>
                {right}
              </Text>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

export function BadgeDetailSheet({
  state,
  minting,
  visible,
  now,
  onClose,
}: {
  state: BadgeState;
  minting: boolean;
  visible: boolean;
  now: Date;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const mint = useMint(minting);
  const earned = state.tier > 0;
  const quip = earned ? (t.badges.quips as Partial<Record<string, string>>)[state.key] : undefined;
  const still = stillLine(state);
  const isPublic = PUBLIC_BADGE_KEYS.has(state.key);

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
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          <Pressable
            accessible={false}
            style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}
            onPress={() => undefined}
          >
            <View style={styles.grabber} />
            <Pressable
              onPress={onClose}
              hitSlop={6}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.a11y.counterCloseModal}
            >
              <XIcon size={20} color={Colors.foamMuted} />
            </Pressable>
            <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              <Animated.View style={[styles.medal, mint.style]}>
                {minting ? (
                  <Animated.View style={[styles.medalBefore, mint.before]}>
                    <BadgeMedal badge={state.key} look={medalLook(state, state.tier - 1)} size={MEDAL_SIZE} />
                  </Animated.View>
                ) : null}
                <Animated.View style={mint.after}>
                  <BadgeMedal badge={state.key} look={medalLook(state)} size={MEDAL_SIZE} />
                </Animated.View>
              </Animated.View>
              {minting ? (
                <Text style={styles.kicker} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.badges.newMedal}
                </Text>
              ) : null}
              <Text style={styles.title} accessibilityRole="header" maxFontSizeMultiplier={FontScaleCap.heading}>
                {badgeName(state)}
              </Text>
              <Text style={styles.subtitle} maxFontSizeMultiplier={FontScaleCap.body}>
                {subtitle(state)}
              </Text>
              {quip ? (
                <Text style={styles.quip} maxFontSizeMultiplier={FontScaleCap.body}>
                  {quip}
                </Text>
              ) : null}

              {still && state.next != null ? (
                <View style={styles.progress}>
                  <Text style={styles.progressLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                    {t.badges.toLevel(roman(state.tier + 1))}
                  </Text>
                  <View style={styles.progressLine}>
                    <Text style={styles.progressStill} maxFontSizeMultiplier={FontScaleCap.heading}>
                      {still}
                    </Text>
                    <Text style={styles.progressCount} maxFontSizeMultiplier={FontScaleCap.body}>
                      {`${state.value} / ${state.next}`}
                    </Text>
                  </View>
                  <ProgressBar share={state.value / state.next} thick />
                </View>
              ) : state.kind === 'tiered' && state.next == null ? (
                <Text style={styles.statusLine} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {t.badges.allLevels}
                </Text>
              ) : null}

              {state.kind === 'slots' ? <Slots state={state} /> : null}
              {state.kind === 'once' && !earned && state.holiday ? (
                <Text style={styles.statusLine} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {t.badges.inDays(daysUntilHoliday(state.holiday, now))}
                </Text>
              ) : null}

              {state.kind === 'tiered' ? (
                <>
                  <Levels state={state} />
                  <Text style={styles.about} maxFontSizeMultiplier={FontScaleCap.body}>
                    {t.badges.about[state.key]}
                  </Text>
                </>
              ) : null}

              <View style={styles.privacy}>
                {isPublic ? (
                  <EyeIcon size={18} color={Colors.mutedText} />
                ) : (
                  <EyeOffIcon size={18} color={Colors.mutedText} />
                )}
                <Text style={styles.privacyText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {isPublic ? t.badges.friendsSee : t.badges.onlyYou}
                </Text>
              </View>
            </ScrollView>
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
  cardWrap: {
    width: '100%',
    maxHeight: '92%',
  },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
  },
  close: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    zIndex: 1,
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.65,
  },
  scroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  content: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  medal: {
    alignSelf: 'center',
  },
  medalBefore: {
    position: 'absolute',
  },
  kicker: {
    marginTop: Spacing.sm,
    fontSize: 13,
    fontWeight: '700',
    color: Colors.amber,
    textAlign: 'center',
  },
  title: {
    marginTop: Spacing.xs,
    fontSize: 28,
    fontWeight: '700',
    color: Colors.foam,
    textAlign: 'center',
  },
  subtitle: {
    marginTop: Spacing.xs,
    fontSize: 15,
    lineHeight: 20,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  quip: {
    marginTop: Spacing.md,
    fontSize: 16,
    lineHeight: 22,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  progress: {
    marginTop: Spacing.xl,
  },
  progressLabel: {
    fontSize: 13,
    color: Colors.mutedText,
  },
  progressLine: {
    marginTop: 2,
    marginBottom: Spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  progressStill: {
    flexShrink: 1,
    fontSize: 22,
    fontWeight: '700',
    color: Colors.foam,
  },
  progressCount: {
    fontSize: 15,
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  statusLine: {
    marginTop: Spacing.lg,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.foam,
    textAlign: 'center',
  },
  slotsBlock: {
    marginTop: Spacing.xl,
    gap: Spacing.md,
  },
  slotsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  slot: {
    alignItems: 'center',
    gap: 6,
  },
  slotDisc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotDiscOn: {
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderColor: Colors.amber,
  },
  slotDiscOff: {
    borderColor: withAlpha(Colors.foam, 0.32),
    borderStyle: 'dashed',
  },
  slotLabel: {
    fontSize: 13,
    color: Colors.mutedText,
  },
  slotLabelMissing: {
    fontWeight: '700',
    color: Colors.foam,
  },
  slotsMissing: {
    marginTop: Spacing.sm,
    fontSize: 20,
    fontWeight: '700',
    color: Colors.foam,
    textAlign: 'center',
  },
  slotsKeep: {
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  sectionTitle: {
    marginTop: Spacing.xl,
    marginBottom: Spacing.xs,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
    color: Colors.foam,
  },
  levelRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  levelLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.foam,
  },
  levelLabelFuture: {
    fontWeight: '500',
    color: Colors.foamMuted,
  },
  levelMissing: {
    fontSize: 15,
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  levelMissingNext: {
    fontWeight: '700',
    color: Colors.amber,
  },
  about: {
    marginTop: Spacing.md,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
  },
  privacy: {
    marginTop: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  privacyText: {
    flexShrink: 1,
    fontSize: 14,
    color: Colors.mutedText,
  },
});
