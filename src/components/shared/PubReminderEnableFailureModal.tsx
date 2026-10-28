import React, { useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { BellRingIcon, MapPinIcon } from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { t } from '@/i18n';
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
  return <MapPinIcon size={28} color={color} />;
}

export function PubReminderEnableFailureModal() {
  const reason = usePubReminderEnableFailureStore((s) => s.reason);
  const hide = usePubReminderEnableFailureStore((s) => s.hide);
  const insets = useSafeAreaInsets();
  const canOpenSettings = Platform.OS === 'ios' || Platform.OS === 'android';


  // The card keeps its text while it slides away after `hide`.
  const [shownReason, setShownReason] = useState(reason);
  if (reason && reason !== shownReason) setShownReason(reason);
  if (!shownReason) return null;

  const copy = t.settings.pubReminders.denied[shownReason];

  const openSettings = () => {
    hide();
    void Linking.openSettings();
  };

  return (
    <BottomSheetModal visible={!!reason} onClose={hide} onClosed={() => setShownReason(null)} scrimColor={SCRIM}>
      <View style={[styles.backdrop, { paddingTop: insets.top + Spacing.lg }]} pointerEvents="box-none">
        <View style={[styles.card, softDrop()]}>
          <View style={styles.headerRow}>
            <View style={styles.iconWell}>
              <FailureIcon reason={shownReason} />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.settings.pubReminders.failureEyebrow}
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
                label={t.settings.pubReminders.openSettings}
                onPress={openSettings}
                glow="none"
                height={56}
                accessibilityLabel={t.settings.pubReminders.openSettings}
              />
            )}
            <Pressable
              onPress={hide}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryPressed]}
              accessibilityRole="button"
              accessibilityLabel={t.common.ok}
            >
              <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.common.ok}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const SCRIM = withAlpha(Colors.black, 0.82);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
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
    backgroundColor: withAlpha(Colors.foam, 0.07),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.12),
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
