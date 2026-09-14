import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { BellRingIcon, MapPinIcon, ShieldIcon } from '@/components/shared/IconGlyph';
import { getCurrentAppVersion } from '@/data/releaseNotesClient';
import { t } from '@/i18n';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { showPubReminderEnableFailure } from '@/notifications/pubReminderEnableFailure';
import { enablePubReminderNotifications } from '@/notifications/pubReminderNotifications';
import {
  getSeenPubReminderOnboardingVersion,
  markPubReminderOnboardingSeen,
  shouldShowPubReminderOnboarding,
} from '@/notifications/pubReminderOnboarding';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useReleaseStore } from '@/stores/releaseStore';
import { useSettingsStore, waitForSettingsHydration } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

/**
 * Store policy gate: true whenever enabling reminders will trigger (or needs)
 * the OS background-location prompt, so both entry points can show the
 * prominent disclosure BEFORE any system dialog appears.
 */
export async function pubReminderNeedsBackgroundDisclosure(): Promise<boolean> {
  try {
    const status = await Location.getBackgroundPermissionsAsync();
    return status.status !== 'granted';
  } catch {
    return true;
  }
}

interface DisclosureProps {
  visible: boolean;
  onAllow: () => void;
  onDeny: () => void;
}

/**
 * Prominent in-app disclosure required by store policy before the
 * background-location system prompt. It must say explicitly that location is
 * accessed while the app is closed / not in use and solely for the
 * nearby-pub reminder purpose.
 */
export function PubReminderBackgroundLocationDisclosure({
  visible,
  onAllow,
  onDeny,
}: DisclosureProps) {
  const insets = useSafeAreaInsets();

  return (
    <BottomSheetModal visible={visible} onClose={onDeny} presentationId="pub-reminder-disclosure">
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <Text style={styles.disclosureTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {t.pubReminderOnboarding.backgroundDisclosureTitle}
          </Text>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            <Text style={styles.disclosureBody} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.pubReminderOnboarding.backgroundDisclosureBody}
            </Text>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              onPress={onAllow}
              accessibilityRole="button"
              accessibilityLabel={t.pubReminderOnboarding.backgroundDisclosureConfirm}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryPressed]}
            >
              <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.display}>
                {t.pubReminderOnboarding.backgroundDisclosureConfirm}
              </Text>
            </Pressable>
            <Pressable
              onPress={onDeny}
              accessibilityRole="button"
              accessibilityLabel={t.pubReminderOnboarding.backgroundDisclosureDeny}
              hitSlop={{ top: 8, bottom: 8 }}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryPressed]}
            >
              <Text
                style={styles.secondaryText}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {t.pubReminderOnboarding.backgroundDisclosureDeny}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

function ReasonRow({
  icon,
  title,
  first = false,
}: {
  icon: React.ReactNode;
  title: string;
  first?: boolean;
}) {
  return (
    <View style={[styles.reasonRow, first && styles.reasonRowFirst]}>
      <View style={styles.reasonIcon}>{icon}</View>
      <Text style={styles.reasonTitle} maxFontSizeMultiplier={FontScaleCap.body}>
        {title}
      </Text>
    </View>
  );
}

export function PubReminderOnboardingModal() {
  const insets = useSafeAreaInsets();
  const releaseSettled = useReleaseStore((s) => s.checkSettled);
  const releaseNote = useReleaseStore((s) => s.pendingNote);
  const pubReminderEnabled = useSettingsStore((s) => s.pubReminderEnabled);
  const setPubReminderEnabled = useSettingsStore((s) => s.setPubReminderEnabled);
  const firstLaunchSession = useOnboardingStore((s) => s.firstLaunchSession);
  const [eligible, setEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [disclosureOpen, setDisclosureOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  const wantVisible =
    eligible && !pubReminderEnabled && releaseNote === null && !firstLaunchSession;

  useEffect(() => {
    let cancelled = false;
    let showTimer: ReturnType<typeof setTimeout> | null = null;

    async function checkVisibility() {
      if (!releaseSettled || releaseNote) return;
      await waitForSettingsHydration();
      const currentVersion = getCurrentAppVersion();
      const seenVersion = await getSeenPubReminderOnboardingVersion();
      const enabled = useSettingsStore.getState().pubReminderEnabled;
      if (cancelled) return;

      setVersion(currentVersion);
      if (
        !shouldShowPubReminderOnboarding({
          currentVersion,
          seenVersion,
          pubReminderEnabled: enabled,
        })
      ) {
        setEligible(false);
        return;
      }

      showTimer = setTimeout(() => {
        if (!cancelled) setEligible(true);
      }, 600);
    }

    void checkVisibility();
    return () => {
      cancelled = true;
      if (showTimer) clearTimeout(showTimer);
    };
  }, [releaseSettled, releaseNote]);

  const closeAsSeen = useCallback(async () => {
    await markPubReminderOnboardingSeen(version);
    setEligible(false);
  }, [version]);

  const runEnable = useCallback(async () => {
    setBusy(true);
    try {
      const result = await enablePubReminderNotifications();
      await markPubReminderOnboardingSeen(version);
      if (result.ok) {
        setPubReminderEnabled(true);
        setEligible(false);
        return;
      }

      setPubReminderEnabled(false);
      setEligible(false);
      // The canonical dialog participates in the same presentation mutex. It
      // can be requested now and will wait for this native sheet to dismiss.
      showPubReminderEnableFailure(result.reason);
    } finally {
      setBusy(false);
    }
  }, [setPubReminderEnabled, version]);

  const handleEnable = useCallback(async () => {
    if (busy || disclosureOpen) return;
    // Store policy: the prominent disclosure must be the last thing the user
    // confirms BEFORE the OS background-location prompt can appear.
    if (await pubReminderNeedsBackgroundDisclosure()) {
      setDisclosureOpen(true);
      return;
    }
    await runEnable();
  }, [busy, disclosureOpen, runEnable]);

  const handleDisclosureAllow = useCallback(() => {
    setDisclosureOpen(false);
    void runEnable();
  }, [runEnable]);

  return (
    <>
      <BottomSheetModal
        visible={wantVisible && !disclosureOpen}
        onClose={() => void closeAsSeen()}
        presentationId="pub-reminder"
      >
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.pubReminderOnboarding.title}
            </Text>
            <CloseButton onPress={() => void closeAsSeen()} label={t.pubReminderOnboarding.skip} />
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <ReasonRow
              first
              icon={<BellRingIcon size={20} color={Colors.amber} />}
              title={t.pubReminderOnboarding.notificationTitle}
            />
            <ReasonRow
              icon={<MapPinIcon size={20} color={Colors.amber} />}
              title={t.pubReminderOnboarding.locationTitle}
            />
            <ReasonRow
              icon={<ShieldIcon size={20} color={Colors.amber} />}
              title={t.pubReminderOnboarding.privacyTitle}
            />
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={() => void handleEnable()}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={t.pubReminderOnboarding.cta}
              style={({ pressed }) => [
                styles.primaryButton,
                busy && styles.primaryDisabled,
                pressed && styles.primaryPressed,
              ]}
            >
              <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.display}>
                {busy ? t.pubReminderOnboarding.ctaBusy : t.pubReminderOnboarding.cta}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
      </BottomSheetModal>

      <PubReminderBackgroundLocationDisclosure
        visible={disclosureOpen}
        onAllow={handleDisclosureAllow}
        onDeny={() => setDisclosureOpen(false)}
      />
    </>
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
  disclosureTitle: {
    ...MockType.titleS,
    color: Colors.foam,
    marginBottom: Spacing.sm,
  },
  disclosureBody: {
    ...MockType.body,
    lineHeight: MockType.body.fontSize * 1.5,
    color: Colors.foamMuted,
    paddingBottom: Spacing.sm,
  },
  list: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: Spacing.sm,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  reasonRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  reasonRowFirst: {
    borderTopWidth: 0,
  },
  reasonIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  reasonTitle: {
    flex: 1,
    ...MockType.bodySemibold,
    color: Colors.foam,
  },
  actions: {
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  primaryButton: {
    height: 56,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  primaryDisabled: {
    opacity: 0.45,
  },
  primaryPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.97 }],
  },
  primaryText: {
    ...MockType.buttonLabel,
    color: Colors.stout,
  },
  secondaryButton: {
    minHeight: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  secondaryPressed: { opacity: 0.65 },
  secondaryText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.foam,
    includeFontPadding: false,
  },
});
