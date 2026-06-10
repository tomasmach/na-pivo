/**
 * "Co je nového" popup. Shown once after the app updates to a new version.
 *
 * Renders as a centered card over a dimmed backdrop (RN Modal, transparent) —
 * a true popup, not a full-screen route — driven entirely by releaseStore's
 * `pendingNote`. The store sets `pendingNote` on launch when a newer version's
 * note is fetched; tapping the CTA (or Android back) calls `dismissNote`, which
 * clears it and advances the seen-baseline.
 */

import React from 'react';
import { Modal, View, Text, ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlowStrong } from '@/theme/shadows';
import { GlowButton } from '@/components/shared/GlowButton';
import { cs } from '@/i18n/cs';
import { useReleaseStore } from '@/stores/releaseStore';

export function WhatsNewModal() {
  const note = useReleaseStore((s) => s.pendingNote);
  const dismissNote = useReleaseStore((s) => s.dismissNote);
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={note !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismissNote}
    >
      <View style={styles.backdrop}>
        <View style={[styles.card, amberGlowStrong(28)]}>
          <Text style={styles.eyebrow}>{cs.whatsNew.eyebrow}</Text>
          <Text style={styles.title}>{note?.title ?? cs.whatsNew.defaultTitle}</Text>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {note?.items.map((item, i) => (
              <View key={i} style={styles.row}>
                {item.icon ? (
                  <Text style={styles.icon}>{item.icon}</Text>
                ) : (
                  <View style={styles.bullet} />
                )}
                <Text style={styles.itemText}>{item.text}</Text>
              </View>
            ))}
          </ScrollView>

          <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, Spacing.xs) }]}>
            <GlowButton label={cs.whatsNew.cta} onPress={dismissNote} glow="strong" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.7),
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
    maxHeight: '80%',
  },
  eyebrow: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginBottom: Spacing.xs,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 30,
    color: Colors.foam,
    marginBottom: Spacing.lg,
  },
  list: {
    flexGrow: 0,
  },
  listContent: {
    gap: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  icon: {
    fontSize: 22,
    lineHeight: 26,
    width: 28,
    textAlign: 'center',
  },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    marginTop: 9,
    marginLeft: 10,
    marginRight: 10,
  },
  itemText: {
    flex: 1,
    fontFamily: Fonts.ui.regular,
    fontSize: 16,
    lineHeight: 23,
    color: Colors.foamMuted,
  },
  footer: {
    marginTop: Spacing.lg,
  },
});
