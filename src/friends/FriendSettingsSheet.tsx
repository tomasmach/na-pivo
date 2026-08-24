/**
 * FriendSettingsSheet — the "Nastavení party" bottom sheet (spec §14).
 *
 * Uses the canonical intent-sheet scaffold and renders settings as flat rows
 * on the stout ground. The shared wrapper owns the scrim, motion, outside tap,
 * Android back handling and reduced-motion behavior.
 *
 *   1. Neviditelný režim (ghost mode) — a Toggle that suppresses my broadcast.
 *   2. Klid v noci (quiet hours) — a Toggle that, when on, reveals an Od/Do pair
 *      of HourStepper controls bounded by a wrap-aware range summary.
 *
 * Every change is an optimistic local commit (draft state + onSaved → parent)
 * with a server PATCH (updateFriendSettings). Toggle PATCHes fire immediately;
 * the hour steppers debounce so a burst of taps collapses to one request. On
 * failure the draft reverts to the last server-confirmed snapshot and the
 * in-sheet Toast explains it. The Toast is mounted inside the sheet window because the
 * root toast host sits below this native window on iOS.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { XIcon } from '@/components/shared/IconGlyph';
import { Toast } from '@/components/shared/Toast';
import { updateFriendSettings, type FriendSocialSettings } from '@/data/friendsClient';
import { disableFriendPush, registerFriendPush } from '@/notifications/friendPush';
import { cs } from '@/i18n/cs';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { MockLayout, MockType } from '@/mocks/mockTheme';

import HourStepper from './HourStepper';
import Toggle from './Toggle';

/** Coalesce a burst of stepper taps into one PATCH. */
const HOUR_DEBOUNCE_MS = 500;

type QuietHourField = 'quietHoursStart' | 'quietHoursEnd';

/** Type-safe single-key copy: restore one key from `source` into `target`. */
function restoreKey<K extends keyof FriendSocialSettings>(
  target: FriendSocialSettings,
  source: FriendSocialSettings,
  key: K,
): void {
  target[key] = source[key];
}

export interface FriendSettingsSheetProps {
  visible: boolean;
  onClose: () => void;
  settings: FriendSocialSettings;
  onSaved: (settings: FriendSocialSettings) => void;
}

function FriendSettingsSheet({
  visible,
  onClose,
  settings,
  onSaved,
}: FriendSettingsSheetProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((s) => s.show);
  const friendPushEnabled = useSettingsStore((s) => s.friendPushEnabled);
  const setFriendPushEnabled = useSettingsStore((s) => s.setFriendPushEnabled);
  const setFriendPushOptedOut = useSettingsStore((s) => s.setFriendPushOptedOut);
  const [pushBusy, setPushBusy] = useState(false);

  // Optimistic display state. `draftRef` mirrors it so the (stable) handlers can
  // read the freshest value without listing `draft` in their deps. The ref is
  // synced in an effect (not during render) so the compiler's refs rule stays
  // satisfied; handlers only ever read it after commit, so this is equivalent.
  const [draft, setDraft] = useState<FriendSocialSettings>(settings);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Last server-confirmed snapshot — the revert target on any failed PATCH.
  const confirmedRef = useRef<FriendSocialSettings>(settings);

  // Guards the async PATCH resolution against setState-after-unmount.
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // Push opt-in toggle (§E3): turning on requests the notification permission and
  // registers the device token; turning off persists an explicit opt-out (so the
  // launch/focus re-register can't flip it back on) AND disables the device
  // server-side so delivery actually stops. Optimistic with revert-on-fail, like
  // the ghost/quiet toggles.
  const handlePushToggle = useCallback(() => {
    if (pushBusy) return;
    if (friendPushEnabled) {
      setFriendPushEnabled(false);
      setFriendPushOptedOut(true);
      setPushBusy(true);
      void disableFriendPush().then((ok) => {
        if (!mountedRef.current) return;
        setPushBusy(false);
        if (!ok) {
          // Server disable failed → revert so the toggle reflects reality.
          setFriendPushEnabled(true);
          setFriendPushOptedOut(false);
          showToast(cs.friends.pushDisableError, {
            icon: <XIcon size={18} color={Colors.closed} />,
          });
        }
      });
      return;
    }
    setPushBusy(true);
    void registerFriendPush().then((result) => {
      if (!mountedRef.current) return;
      setPushBusy(false);
      if (!result.ok) {
        showToast(cs.friends.pushDeniedHint, {
          icon: <XIcon size={18} color={Colors.amber} />,
        });
      }
    });
  }, [friendPushEnabled, pushBusy, setFriendPushEnabled, setFriendPushOptedOut, showToast]);

  // Debounced hour PATCH bookkeeping.
  const hourTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingHours = useRef<Partial<FriendSocialSettings>>({});

  // Re-seed the draft from the freshest server settings only on the closed→open
  // transition, so a parent dashboard refresh mid-edit never clobbers the draft.
  const wasVisible = useRef(false);
  useEffect(() => {
    if (visible && !wasVisible.current) {
      setDraft(settings);
      confirmedRef.current = settings;
      pendingHours.current = {};
    }
    wasVisible.current = visible;
  }, [visible, settings]);

  // ── Network PATCH with revert-on-fail ──
  const sendPatch = useCallback(
    (patch: Partial<FriendSocialSettings>) => {
      void updateFriendSettings(patch).then((res) => {
        if (!mountedRef.current) return;
        if (res.ok) {
          // Confirm the server-accepted keys (so a flushed hour value can't later
          // diverge), then push the confirmed snapshot up so the parent reflects
          // it without relying on a racing reload (close-race fix).
          confirmedRef.current = { ...confirmedRef.current, ...patch };
          onSaved({ ...confirmedRef.current });
          return;
        }
        // Revert ONLY the keys in the failed patch so unrelated in-flight edits
        // (e.g. a still-debouncing quiet-hour change) aren't clobbered.
        const restored = { ...draftRef.current };
        (Object.keys(patch) as (keyof FriendSocialSettings)[]).forEach((key) => {
          restoreKey(restored, confirmedRef.current, key);
        });
        setDraft(restored);
        onSaved(restored);
        showToast(cs.friends.settingsError, {
          icon: <XIcon size={18} color={Colors.closed} />,
        });
      });
    },
    [onSaved, showToast],
  );

  // ── Optimistic local commit (draft + parent) ──
  const applyOptimistic = useCallback(
    (patch: Partial<FriendSocialSettings>) => {
      const next = { ...draftRef.current, ...patch };
      setDraft(next);
      onSaved(next);
    },
    [onSaved],
  );

  const handleGhostToggle = useCallback(() => {
    const ghostMode = !draftRef.current.ghostMode;
    applyOptimistic({ ghostMode });
    sendPatch({ ghostMode });
  }, [applyOptimistic, sendPatch]);

  const handleShareDrinksToggle = useCallback(() => {
    const shareDrinksWithParta = !draftRef.current.shareDrinksWithParta;
    applyOptimistic({ shareDrinksWithParta });
    sendPatch({ shareDrinksWithParta });
  }, [applyOptimistic, sendPatch]);

  const handleQuietToggle = useCallback(() => {
    const quietHoursEnabled = !draftRef.current.quietHoursEnabled;
    applyOptimistic({ quietHoursEnabled });
    sendPatch({ quietHoursEnabled });
  }, [applyOptimistic, sendPatch]);

  const handleHourChange = useCallback(
    (field: QuietHourField, hour: number) => {
      applyOptimistic({ [field]: hour });
      pendingHours.current = { ...pendingHours.current, [field]: hour };
      if (hourTimer.current) clearTimeout(hourTimer.current);
      hourTimer.current = setTimeout(() => {
        hourTimer.current = null;
        const patch = pendingHours.current;
        pendingHours.current = {};
        sendPatch(patch);
      }, HOUR_DEBOUNCE_MS);
    },
    [applyOptimistic, sendPatch],
  );

  const handleStartChange = useCallback(
    (hour: number) => handleHourChange('quietHoursStart', hour),
    [handleHourChange],
  );
  const handleEndChange = useCallback(
    (hour: number) => handleHourChange('quietHoursEnd', hour),
    [handleHourChange],
  );

  // Closing flushes any pending debounced hour PATCH so the last tap isn't lost.
  useEffect(() => {
    if (visible) return;
    if (hourTimer.current) {
      clearTimeout(hourTimer.current);
      hourTimer.current = null;
    }
    if (Object.keys(pendingHours.current).length > 0) {
      const patch = pendingHours.current;
      pendingHours.current = {};
      sendPatch(patch);
    }
  }, [visible, sendPatch]);

  useEffect(
    () => () => {
      if (hourTimer.current) clearTimeout(hourTimer.current);
    },
    [],
  );

  const quietOn = draft.quietHoursEnabled;

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.handle} />
          <View style={styles.headerRow}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.friends.settingsTitle}
            </Text>
            <CloseButton onPress={onClose} label={cs.friends.settingsClose} />
          </View>

          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            <View style={[styles.settingItem, styles.settingItemFirst]}>
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text style={styles.settingTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {cs.friends.ghostTitle}
                  </Text>
                </View>
                <Toggle
                  value={draft.ghostMode}
                  onToggle={handleGhostToggle}
                  accessibilityLabel={cs.friends.ghostTitle}
                />
              </View>
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text style={styles.settingTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {cs.friends.shareDrinksTitle}
                  </Text>
                </View>
                <Toggle
                  value={draft.shareDrinksWithParta && !draft.ghostMode}
                  onToggle={handleShareDrinksToggle}
                  disabled={draft.ghostMode}
                  accessibilityLabel={cs.friends.shareDrinksTitle}
                />
              </View>
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text style={styles.settingTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {cs.friends.quietTitle}
                  </Text>
                </View>
                <Toggle
                  value={draft.quietHoursEnabled}
                  onToggle={handleQuietToggle}
                  accessibilityLabel={cs.friends.quietTitle}
                />
              </View>

              {quietOn && (
                <View style={styles.quietRange}>
                  <View style={styles.stepperLine}>
                    <Text
                      style={styles.stepperCaption}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {cs.contribute.from}
                    </Text>
                    <HourStepper
                      value={draft.quietHoursStart}
                      onChange={handleStartChange}
                      accessibilityLabel={cs.contribute.from}
                    />
                  </View>

                  <View style={styles.stepperLine}>
                    <Text
                      style={styles.stepperCaption}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {cs.contribute.to}
                    </Text>
                    <HourStepper
                      value={draft.quietHoursEnd}
                      onChange={handleEndChange}
                      accessibilityLabel={cs.contribute.to}
                    />
                  </View>
                </View>
              )}
            </View>

            <View style={styles.settingItem}>
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text style={styles.settingTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {cs.friends.pushToggleTitle}
                  </Text>
                </View>
                <Toggle
                  value={friendPushEnabled}
                  onToggle={handlePushToggle}
                  accessibilityLabel={cs.friends.pushToggleTitle}
                />
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
      <Toast />
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
  handle: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    marginBottom: Spacing.md,
  },
  headerRow: {
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
  body: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: Spacing.sm,
  },
  bodyContent: {
    paddingBottom: Spacing.sm,
  },
  settingItem: {
    minHeight: 64,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  settingItemFirst: {
    borderTopWidth: 0,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    minHeight: HitArea.min,
  },
  settingText: {
    flex: 1,
    minWidth: 0,
  },
  settingTitle: {
    ...MockType.bodySemibold,
    color: Colors.foam,
  },
  quietRange: {
    marginTop: Spacing.md,
  },
  stepperLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  stepperCaption: {
    ...MockType.bodySmall,
    color: Colors.mutedText,
  },
});

export default React.memo(FriendSettingsSheet);
