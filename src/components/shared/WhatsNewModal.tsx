/**
 * "Co je nového" popup. Shown once after the app updates to a new version.
 *
 * Renders as a centered card over a dimmed backdrop (RN Modal, transparent) —
 * a true popup, not a full-screen route — driven entirely by releaseStore's
 * `pendingNote`. The store sets `pendingNote` on launch when a newer version's
 * note is fetched; tapping the CTA (or Android back) calls `dismissNote`, which
 * clears it and advances the seen-baseline.
 *
 * Visual language is editorial rather than celebratory: left-aligned header
 * with a quiet version label, an amber rule framing the highlights list, and
 * clean unboxed rows that stagger in after the card springs up. No glow.
 */

import React, { useEffect } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { GlowButton } from '@/components/shared/GlowButton';
import { cs } from '@/i18n/cs';
import { useReleaseStore } from '@/stores/releaseStore';

export function WhatsNewModal() {
  const note = useReleaseStore((s) => s.pendingNote);
  const dismissNote = useReleaseStore((s) => s.dismissNote);

  // Card spring-in: the Modal fades the backdrop, this pops the card on top.
  // `reveal` then sweeps 0→1 and each row reads its own slice of it, so the
  // highlights cascade in without depending on mount-time layout animations
  // (which are unreliable inside RN Modal).
  const progress = useSharedValue(0);
  const reveal = useSharedValue(0);
  useEffect(() => {
    if (note) {
      progress.value = 0;
      reveal.value = 0;
      progress.value = withSpring(1, { damping: 15, stiffness: 150, mass: 0.9 });
      reveal.value = withDelay(
        140,
        withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }),
      );
    } else {
      progress.value = withTiming(0, { duration: 120 });
      reveal.value = 0;
    }
  }, [note, progress, reveal]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { scale: 0.9 + progress.value * 0.1 },
      { translateY: (1 - progress.value) * 16 },
    ],
  }));

  const itemCount = note?.items.length ?? 0;

  return (
    <Modal
      visible={note !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissNote}
    >
      <View style={styles.backdrop}>
        <Animated.View style={[styles.card, softDrop(), cardAnim]}>
          {/* ── Header: eyebrow + quiet version label, big left title ── */}
          <View style={styles.header}>
            <View style={styles.eyebrowRow}>
              <Text
                style={styles.eyebrow}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {cs.whatsNew.eyebrow}
              </Text>
              {note?.version ? (
                <Text
                  style={styles.versionText}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.whatsNew.versionLabel(note.version)}
                </Text>
              ) : null}
            </View>
            <Text
              style={styles.title}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {note?.title ?? cs.whatsNew.defaultTitle}
            </Text>
          </View>

          {/* Warm rule framing the list from above */}
          <View style={styles.ruleAmber} />

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {note?.items.map((item, i) => (
              <StaggeredRow key={i} index={i} total={itemCount} reveal={reveal}>
                <View style={styles.marker}>
                  {item.icon ? (
                    <Text style={styles.icon}>{item.icon}</Text>
                  ) : (
                    <View style={styles.diamond} />
                  )}
                </View>
                <Text
                  style={styles.itemText}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {item.text}
                </Text>
              </StaggeredRow>
            ))}
          </ScrollView>

          {/* Neutral rule closing the list from below */}
          <View style={styles.rule} />

          <View style={styles.footer}>
            <GlowButton
              label={cs.whatsNew.cta}
              onPress={dismissNote}
              glow="none"
              height={58}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

/**
 * One highlight row. Reads its slice of the shared `reveal` sweep so rows
 * fade + lift in sequence, top to bottom.
 */
function StaggeredRow({
  index,
  total,
  reveal,
  children,
}: {
  index: number;
  total: number;
  reveal: SharedValue<number>;
  children: React.ReactNode;
}) {
  const anim = useAnimatedStyle(() => {
    const start = total > 1 ? (index / total) * 0.55 : 0;
    const p = interpolate(
      reveal.value,
      [start, start + 0.45],
      [0, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity: p,
      transform: [{ translateY: (1 - p) * 8 }],
    };
  });

  return <Animated.View style={[styles.row, anim]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.8),
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    // Never taller than most of the screen — the items list scrolls inside.
    maxHeight: '82%',
    // Sections carry their own horizontal padding so the rules run full-bleed.
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
  },
  header: {
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  eyebrow: {
    fontWeight: '600',
    fontSize: 11,
    letterSpacing: 2,
    color: Colors.amber,
  },
  versionText: {
    fontWeight: '500',
    fontSize: 12,
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
    color: Colors.mutedText,
  },
  title: {
    fontWeight: '800',
    fontSize: 30,
    lineHeight: 36,
    color: Colors.foam,
  },
  ruleAmber: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: withAlpha(Colors.amber, 0.35),
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: withAlpha(Colors.border, 0.7),
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    paddingVertical: Spacing.lg,
    paddingHorizontal: Spacing.xl,
    gap: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  marker: {
    width: 26,
    alignItems: 'center',
  },
  icon: {
    fontSize: 18,
    lineHeight: 22,
  },
  diamond: {
    width: 7,
    height: 7,
    marginTop: 8,
    backgroundColor: Colors.amber,
    transform: [{ rotate: '45deg' }],
  },
  itemText: {
    flex: 1,
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: Colors.foamMuted,
  },
  footer: {
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
});
