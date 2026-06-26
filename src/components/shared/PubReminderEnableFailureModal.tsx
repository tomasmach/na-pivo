import React, { useEffect } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BellRingIcon, MapPinIcon, ShieldIcon } from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { cs } from '@/i18n/cs';
import {
  usePubReminderEnableFailureStore,
  type PubReminderEnableFailureReason,
} from '@/stores/pubReminderEnableFailureStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

function FailureIcon({ reason }: { reason: PubReminderEnableFailureReason }) {
  const color = Colors.amberLight;
  if (reason === 'notifications-denied') return <BellRingIcon size={28} color={color} />;
  if (reason === 'foreground-location-denied') return <MapPinIcon size={28} color={color} />;
  return <ShieldIcon size={28} color={color} />;
}

export function PubReminderEnableFailureModal() {
  const reason = usePubReminderEnableFailureStore((s) => s.reason);
  const hide = usePubReminderEnableFailureStore((s) => s.hide);
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);
  const canOpenSettings = Platform.OS === 'ios' || Platform.OS === 'android';

  useEffect(() => {
    progress.value = reason
      ? withSpring(1, { damping: 16, stiffness: 150, mass: 0.9 })
      : withTiming(0, { duration: 140 });
  }, [progress, reason]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [
      { scale: 0.94 + progress.value * 0.06 },
      { translateY: (1 - progress.value) * 18 },
    ],
  }));

  if (!reason) return null;

  const copy = cs.settings.pubReminders.denied[reason];

  const openSettings = () => {
    hide();
    void Linking.openSettings();
  };

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={hide}
    >
      <View style={[styles.backdrop, { paddingTop: insets.top + Spacing.lg }]}>
        <Animated.View style={[styles.card, softDrop(), cardAnim]}>
          <View style={styles.headerRow}>
            <View style={styles.iconWell}>
              <FailureIcon reason={reason} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.settings.pubReminders.failureEyebrow}
              </Text>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {copy.title}
              </Text>
            </View>
          </View>

          <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
            {copy.body}
          </Text>

          <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}>
            {canOpenSettings && (
              <GlowButton
                label={cs.settings.pubReminders.openSettings}
                onPress={openSettings}
                glow="none"
                height={56}
                accessibilityLabel={cs.settings.pubReminders.openSettings}
              />
            )}
            <Pressable
              onPress={hide}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryPressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.common.ok}
            >
              <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.common.ok}
              </Text>
            </Pressable>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: withAlpha(Colors.black, 0.82),
  },
  card: {
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.md,
    overflow: 'hidden',
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.26),
    backgroundColor: Colors.stout2,
    paddingTop: Spacing.xl,
    paddingHorizontal: Spacing.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconWell: {
    width: 58,
    height: 58,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.36),
  },
  headerText: {
    flex: 1,
    gap: Spacing.xs,
  },
  eyebrow: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 11,
    letterSpacing: 1.1,
    color: Colors.amberLight,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 25,
    lineHeight: 30,
    color: Colors.foam,
  },
  body: {
    marginTop: Spacing.lg,
    fontFamily: Fonts.ui.regular,
    fontSize: 16,
    lineHeight: 23,
    color: Colors.foamMuted,
  },
  actions: {
    paddingTop: Spacing.lg,
    gap: Spacing.md,
  },
  secondaryButton: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  secondaryPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.98 }],
  },
  secondaryText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foamMuted,
  },
});
