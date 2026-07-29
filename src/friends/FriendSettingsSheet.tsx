/**
 * FriendSettingsSheet — the "Nastavení party" bottom sheet (spec §14).
 *
 * A direct clone of MapPubSheet's scaffold: a transparent fade Modal with an
 * absolute-fill backdrop Pressable for tap-to-dismiss, a drag handle, an
 * absolute close button, and a Reanimated `progress` shared value that springs
 * the card up on open (slide preset) / times it down on close (140ms) /
 * snaps instantly under reduce-motion. On top of that it renders two settings
 * rows on the bare stout ground (HairlineRow, no cards):
 *
 *   1. Neviditelný režim (ghost mode) — a Toggle that suppresses my broadcast.
 *   2. Klid v noci (quiet hours) — a Toggle that, when on, reveals an Od/Do pair
 *      of HourStepper controls bounded by a wrap-aware range summary.
 *
 * Every change is an optimistic local commit (draft state + onSaved → parent)
 * with a server PATCH (updateFriendSettings). Toggle PATCHes fire immediately;
 * the hour steppers debounce so a burst of taps collapses to one request. On
 * failure the draft reverts to the last server-confirmed snapshot and the
 * in-sheet Toast explains it. The Toast is mounted INSIDE the Modal because the
 * root toast host sits below this native window on iOS.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { XIcon } from '@/components/shared/IconGlyph';
import { Toast } from '@/components/shared/Toast';
import { updateFriendSettings, type FriendSocialSettings } from '@/data/friendsClient';
import { disableFriendPush, registerFriendPush } from '@/notifications/friendPush';
import { cs } from '@/i18n/cs';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { useReduceMotion } from '@/utils/useReduceMotion';

import HairlineRow from './HairlineRow';
import HourStepper from './HourStepper';
import Toggle from './Toggle';

/** Slide preset shared across the redesign (matches MapPubSheet / Reveal). */
const SLIDE_SPRING = { damping: 18, stiffness: 180, mass: 0.9 } as const;
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
  const reduceMotion = useReduceMotion();
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

  // ── Card slide-up (clone of MapPubSheet). ──
  const progress = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      progress.value = 0;
      progress.value = reduceMotion
        ? withTiming(1, { duration: 0 })
        : withSpring(1, SLIDE_SPRING);
    } else {
      progress.value = withTiming(0, { duration: reduceMotion ? 0 : 140 });
    }
  }, [visible, reduceMotion, progress]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 48 }],
  }));

  const quietOn = draft.quietHoursEnabled;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        {/* Backdrop sits BEHIND the card as an absolute-fill sibling so an outside
            tap dismisses while taps on the card are absorbed by its own views.
            The card must NOT be wrapped in a Pressable (it would steal the pan). */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={cs.friends.settingsClose}
        />

        <Animated.View
          style={[
            styles.card,
            softDrop(),
            // Float the card above the home indicator so its border reads as a
            // fully closed panel, never a line running off the screen bottom.
            { marginBottom: Math.max(insets.bottom, Spacing.md) },
            cardAnim,
          ]}
        >
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <Text
              style={styles.title}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {cs.friends.settingsTitle}
            </Text>
          </View>

          <Pressable
            onPress={onClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressedDim]}
            accessibilityRole="button"
            accessibilityLabel={cs.friends.settingsClose}
          >
            <XIcon size={18} color={Colors.foamMuted} />
          </Pressable>

          <ScrollView
            style={styles.body}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Neviditelný režim */}
            <HairlineRow first>
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text
                    style={styles.settingTitle}
                    maxFontSizeMultiplier={FontScaleCap.heading}
                  >
                    {cs.friends.ghostTitle}
                  </Text>
                  <Text
                    style={styles.settingSubtitle}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {cs.friends.ghostSubtitle}
                  </Text>
                </View>
                <Toggle
                  value={draft.ghostMode}
                  onToggle={handleGhostToggle}
                  accessibilityLabel={cs.friends.ghostTitle}
                />
              </View>
            </HairlineRow>

            {/* Ukazovat partě, kde sedím — the switch behind the whole "kdo kde
                sedí" block. Disabled and forced off while ghost mode is on, so
                the sheet never claims the party can see something it cannot. */}
            <HairlineRow>
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text
                    style={styles.settingTitle}
                    maxFontSizeMultiplier={FontScaleCap.heading}
                  >
                    {cs.friends.shareDrinksTitle}
                  </Text>
                  <Text
                    style={styles.settingSubtitle}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {cs.friends.shareDrinksSubtitle}
                  </Text>
                </View>
                <Toggle
                  value={draft.shareDrinksWithParta && !draft.ghostMode}
                  onToggle={handleShareDrinksToggle}
                  disabled={draft.ghostMode}
                  accessibilityLabel={cs.friends.shareDrinksTitle}
                />
              </View>
            </HairlineRow>

            {/* Klid v noci */}
            <HairlineRow>
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text
                    style={styles.settingTitle}
                    maxFontSizeMultiplier={FontScaleCap.heading}
                  >
                    {cs.friends.quietTitle}
                  </Text>
                  <Text
                    style={styles.settingSubtitle}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {cs.friends.quietSubtitle}
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
                  <Text
                    style={styles.quietSummary}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {cs.friends.quietRange(draft.quietHoursStart, draft.quietHoursEnd)}
                  </Text>

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
            </HairlineRow>

            {/* Upozornění na partu (§E3) */}
            <HairlineRow>
              <View style={styles.settingRow}>
                <View style={styles.settingText}>
                  <Text
                    style={styles.settingTitle}
                    maxFontSizeMultiplier={FontScaleCap.heading}
                  >
                    {cs.friends.pushToggleTitle}
                  </Text>
                  <Text
                    style={styles.settingSubtitle}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {cs.friends.pushToggleSub}
                  </Text>
                </View>
                <Toggle
                  value={friendPushEnabled}
                  onToggle={handlePushToggle}
                  accessibilityLabel={cs.friends.pushToggleTitle}
                />
              </View>
            </HairlineRow>
          </ScrollView>
        </Animated.View>

        {/* Toast host INSIDE the Modal: the root <Toast> sits below this native
            window on iOS, so an error fired here would surface behind the card. */}
        <Toast />
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
  card: {
    maxHeight: '90%',
    marginHorizontal: Spacing.sm,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    marginBottom: Spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: HitArea.min, // room for the absolute close button
  },
  title: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  closeBtn: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedDim: {
    opacity: 0.6,
  },
  body: {
    flexShrink: 1,
    marginTop: Spacing.md,
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
    fontFamily: Fonts.ui.semibold,
    fontSize: 16,
    color: Colors.foam,
  },
  settingSubtitle: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  quietRange: {
    marginTop: Spacing.md,
  },
  quietSummary: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: withAlpha(Colors.amberLight, 0.9),
  },
  stepperLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  stepperCaption: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.mutedText,
  },
});

export default React.memo(FriendSettingsSheet);
