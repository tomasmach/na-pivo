/**
 * "Co je nového" popup. Shown once after the app updates to a new version.
 *
 * Renders as a centered card over a dimmed backdrop (RN Modal, transparent) —
 * a true popup, not a full-screen route — driven entirely by releaseStore's
 * `pendingNote`. The store sets `pendingNote` on launch when a newer version's
 * note is fetched; tapping the CTA (or Android back) calls `dismissNote`, which
 * clears it and advances the seen-baseline.
 *
 * Visually it leans on the Brass Taproom system: a glowing amber medallion as a
 * celebratory hero, a version badge, and each note item as a raised stout panel
 * with an amber icon chip. The card springs in on top of the backdrop fade.
 */

import React, { useEffect } from 'react';
import { Modal, View, Text, ScrollView, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { GlowButton } from '@/components/shared/GlowButton';
import { cs } from '@/i18n/cs';
import { useReleaseStore } from '@/stores/releaseStore';

export function WhatsNewModal() {
  const note = useReleaseStore((s) => s.pendingNote);
  const dismissNote = useReleaseStore((s) => s.dismissNote);
  const insets = useSafeAreaInsets();

  // Card spring-in: the Modal fades the backdrop, this pops the card on top.
  const progress = useSharedValue(0);
  useEffect(() => {
    if (note) {
      progress.value = 0;
      progress.value = withSpring(1, { damping: 15, stiffness: 150, mass: 0.9 });
    } else {
      progress.value = withTiming(0, { duration: 120 });
    }
  }, [note, progress]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { scale: 0.9 + progress.value * 0.1 },
      { translateY: (1 - progress.value) * 16 },
    ],
  }));

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
          {/* Celebratory hero medallion */}
          <View style={styles.medallion}>
            <Text style={styles.medallionEmoji}>🍺</Text>
          </View>

          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>{cs.whatsNew.eyebrow}</Text>
            {note?.version ? (
              <View style={styles.versionPill}>
                <Text style={styles.versionText}>
                  {cs.whatsNew.versionLabel(note.version)}
                </Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.title}>{note?.title ?? cs.whatsNew.defaultTitle}</Text>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {note?.items.map((item, i) => (
              <View key={i} style={styles.row}>
                <View style={styles.chip}>
                  {item.icon ? (
                    <Text style={styles.icon}>{item.icon}</Text>
                  ) : (
                    <View style={styles.bullet} />
                  )}
                </View>
                <Text style={styles.itemText}>{item.text}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.xs) }]}>
            <GlowButton label={cs.whatsNew.cta} onPress={dismissNote} glow="none" />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.78),
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.lg,
    // Never taller than most of the screen — the items list scrolls inside.
    maxHeight: '82%',
  },
  medallion: {
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.5),
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.md,
  },
  medallionEmoji: {
    fontSize: 32,
    lineHeight: 38,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  eyebrow: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  versionPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  versionText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 11,
    letterSpacing: 0.3,
    color: Colors.amberLight,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    lineHeight: 34,
    color: Colors.foam,
    textAlign: 'center',
    marginBottom: Spacing.lg,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: Spacing.sm,
    paddingBottom: Spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.stout3,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
  },
  chip: {
    width: 40,
    height: 40,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.amber, 0.16),
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 20,
    lineHeight: 24,
    textAlign: 'center',
  },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  itemText: {
    flex: 1,
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.foamMuted,
  },
  footer: {
    marginTop: Spacing.lg,
  },
});
