/**
 * "Pravidla pro sdílený obsah" — the one place the user accepts the UGC policy.
 *
 * The server refuses every public write (vyvěšený večer, fotka pro partu,
 * komentář, nová hospoda, hlas v mapování) with a 428 until the account has
 * accepted the current policy version. Without this sheet those writes sit in
 * the offline queues forever and the diary shows "čeká na odeslání" with no
 * explanation.
 *
 * Canonical intent sheet (§7.2): `BottomSheetModal`, stout ground, grabber,
 * fixed header with `CloseButton`, the copy in the only scrolling part, and
 * the actions pinned below it. One intent: accept, or not now.
 */

import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { t } from '@/i18n';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

/** Same document the auth screen links to. */
const TERMS_URL = 'https://tomasmach.github.io/na-pivo/terms.html';

export function UgcConsentSheet({
  visible,
  busy,
  onAccept,
  onLater,
}: {
  visible: boolean;
  busy: boolean;
  onAccept: () => void;
  onLater: () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <BottomSheetModal visible={visible} onClose={onLater} presentationId="ugc-consent">
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.ugcConsent.title}
            </Text>
            <CloseButton onPress={onLater} label={t.ugcConsent.later} disabled={busy} />
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
          >
            {t.ugcConsent.lines.map((line) => (
              <Text key={line} style={styles.line} maxFontSizeMultiplier={FontScaleCap.body}>
                {line}
              </Text>
            ))}

            <Text
              style={styles.termsLink}
              accessibilityRole="link"
              onPress={() => void Linking.openURL(TERMS_URL)}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {t.ugcConsent.termsLink}
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={onAccept}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t.ugcConsent.accept}
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [
                styles.primary,
                busy && styles.primaryDisabled,
                pressed && styles.primaryPressed,
              ]}
            >
              <Text style={styles.primaryLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                {busy ? t.ugcConsent.acceptBusy : t.ugcConsent.accept}
              </Text>
            </Pressable>

            <Pressable
              onPress={onLater}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t.ugcConsent.later}
              accessibilityState={{ disabled: busy }}
              style={({ pressed }) => [styles.secondary, pressed && styles.secondaryPressed]}
            >
              <Text style={styles.secondaryLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.ugcConsent.later}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  cardWrap: {
    width: '100%',
    maxHeight: '92%',
  },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    ...softDrop(),
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,
    color: Colors.foam,
  },
  body: { flexGrow: 0, flexShrink: 1, marginTop: Spacing.sm },
  bodyContent: { paddingBottom: Spacing.sm, gap: Spacing.sm },
  line: {
    ...MockType.bodySmall,
    lineHeight: 20,
    color: Colors.mutedText,
  },
  termsLink: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.amber,
  },
  actions: {
    gap: 8,
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  primary: {
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  primaryDisabled: { opacity: 0.45 },
  primaryPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  primaryLabel: {
    ...MockType.buttonLabel,
    color: Colors.stout,
  },
  secondary: {
    minHeight: 48,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  secondaryPressed: { opacity: 0.65 },
  secondaryLabel: { fontSize: 14, fontWeight: '700', color: Colors.foam },
});
