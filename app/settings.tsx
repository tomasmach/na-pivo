/**
 * Nastavení in the Tácek composition.
 *
 * The screen has two quiet cards and one amber account door. Search radius,
 * filters and notification preferences stay directly editable; one-off doors
 * live in the shared "Co ještě?" sheet. Store writes, server preference sync
 * and notification permission flows are unchanged.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  MenuIcon,
  HouseIcon,
  InfoIcon,
  MapIcon,
  MapPinIcon,
  MessageSquareIcon,
  PlusIcon,
  ShieldIcon,
  StarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from '@/components/shared/IconGlyph';
import {
  PubReminderBackgroundLocationDisclosure,
  pubReminderNeedsBackgroundDisclosure,
} from '@/components/shared/PubReminderOnboardingModal';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { CounterCta } from '@/counter/CounterCta';
import { enqueueAccountPreferences } from '@/data/accountPreferencesQueue';
import {
  DEFAULT_FRIEND_SOCIAL_SETTINGS,
  fetchFriendSettings,
  type FriendSocialSettings,
} from '@/data/friendsClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import FriendSettingsSheet from '@/friends/FriendSettingsSheet';
import { cs } from '@/i18n/cs';
import {
  disableBeerCountReminderNotifications,
  enableBeerCountReminderNotifications,
  reschedulePendingBeerCountReminder,
} from '@/notifications/beerCountReminder';
import { showPubReminderEnableFailure } from '@/notifications/pubReminderEnableFailure';
import {
  disablePubReminderNotifications,
  enablePubReminderNotifications,
} from '@/notifications/pubReminderNotifications';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import {
  BEER_COUNT_REMINDER_INTERVAL_OPTIONS,
  useSettingsStore,
  type BeerCountReminderIntervalMinutes,
} from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { getAppVersionLabel } from '@/utils/appVersion';

const SLIDER_POSITIONS: (number | null)[] = [0.5, 1, 1.5, 2, 2.5, 5, 10, null];
const SLIDER_STEPS = SLIDER_POSITIONS.length - 1;
const TRACK_HEIGHT = 14;
const THUMB_SIZE = 28;

function positionIndexForKm(km: number | null): number {
  if (km === null) return SLIDER_POSITIONS.length - 1;
  const index = SLIDER_POSITIONS.indexOf(km);
  return index === -1 ? SLIDER_POSITIONS.length - 1 : index;
}

function formatCzKm(km: number): string {
  return km.toString().replace('.', ',').replace(/,0$/, '');
}

function distanceReadout(km: number | null): { value: string; unit: string } {
  if (km === null) {
    return { value: '∞', unit: cs.settings.distance.unlimitedUnit };
  }
  if (km === 0.5) {
    return { value: '500', unit: cs.compass.distanceUnitMeters };
  }
  const singularForm = km === 1 || km === 1.5 || km === 2.5;
  return {
    value: formatCzKm(km),
    unit: cs.compass.distanceUnitKm(singularForm ? 1 : km),
  };
}

function numeralFontSize(value: string): number {
  const digits = value.match(/\d/g)?.length ?? 1;
  if (digits <= 1) return 88;
  if (digits === 2) return 72;
  return 56;
}

interface ToggleProps {
  value: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
}

function Toggle({ value, onToggle, accessibilityLabel }: ToggleProps) {
  const offset = useSharedValue(value ? 24 : 2);

  useEffect(() => {
    offset.value = withSpring(value ? 24 : 2, {
      mass: 0.6,
      damping: 14,
      stiffness: 200,
    });
  }, [offset, value]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  return (
    <Pressable
      onPress={onToggle}
      style={[styles.toggle, value ? styles.toggleOn : styles.toggleOff]}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 7, bottom: 7, left: 4, right: 4 }}
    >
      <Animated.View
        style={[
          styles.toggleThumb,
          value ? styles.toggleThumbOn : styles.toggleThumbOff,
          softDrop(),
          thumbStyle,
        ]}
      />
    </Pressable>
  );
}

interface DistanceSliderProps {
  positionIndex: number;
  valueLabel: string;
  onSnap: (index: number) => void;
}

function DistanceSlider({ positionIndex, valueLabel, onSnap }: DistanceSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const snapIndex = useSharedValue(positionIndex);

  const commitSnap = useCallback(
    (index: number) => {
      onSnap(index);
    },
    [onSnap],
  );

  const snapFromX = useCallback(
    (x: number) => {
      if (trackWidth === 0) return;
      const fraction = Math.max(0, Math.min(1, x / trackWidth));
      commitSnap(Math.round(fraction * SLIDER_STEPS));
    },
    [commitSnap, trackWidth],
  );

  const pan = Gesture.Pan()
    .onUpdate((event) => {
      if (trackWidth === 0) return;
      const fraction = Math.max(0, Math.min(1, event.x / trackWidth));
      const next = Math.round(fraction * SLIDER_STEPS);
      if (next === snapIndex.value) return;
      snapIndex.value = next;
      runOnJS(commitSnap)(next);
    })
    .onEnd((event) => {
      if (trackWidth === 0) return;
      const fraction = Math.max(0, Math.min(1, event.x / trackWidth));
      const next = Math.round(fraction * SLIDER_STEPS);
      snapIndex.value = next;
      runOnJS(commitSnap)(next);
    });

  const fillStyle = useAnimatedStyle(() => {
    const fraction = SLIDER_STEPS > 0 ? snapIndex.value / SLIDER_STEPS : 0;
    return { width: fraction * (trackWidth - THUMB_SIZE) + THUMB_SIZE / 2 };
  });

  const thumbStyle = useAnimatedStyle(() => {
    const fraction = SLIDER_STEPS > 0 ? snapIndex.value / SLIDER_STEPS : 0;
    return { transform: [{ translateX: fraction * (trackWidth - THUMB_SIZE) }] };
  });

  useEffect(() => {
    snapIndex.value = positionIndex;
  }, [positionIndex, snapIndex]);

  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const delta = event.nativeEvent.actionName === 'increment' ? 1 : -1;
      const next = Math.max(0, Math.min(SLIDER_STEPS, positionIndex + delta));
      if (next !== positionIndex) commitSnap(next);
    },
    [commitSnap, positionIndex],
  );

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  return (
    <View style={styles.sliderWrapper}>
      <GestureDetector gesture={pan}>
        <View
          style={styles.sliderTouchArea}
          onLayout={handleLayout}
          accessibilityRole="adjustable"
          accessibilityLabel={cs.settings.distance.accessibilityLabel}
          accessibilityValue={{
            min: 0,
            max: SLIDER_STEPS,
            now: positionIndex,
            text: valueLabel,
          }}
          accessibilityActions={[
            { name: 'increment', label: cs.settings.distance.increase },
            { name: 'decrement', label: cs.settings.distance.decrease },
          ]}
          onAccessibilityAction={handleAccessibilityAction}
          onTouchEnd={(event) => snapFromX(event.nativeEvent.locationX)}
        >
          <View style={styles.track}>
            <Animated.View style={[styles.trackFill, fillStyle]} />
            <Animated.View style={[styles.thumb, softDrop(), thumbStyle]} />
          </View>
        </View>
      </GestureDetector>
      <View style={styles.rangeLabels}>
        <Text style={styles.rangeLabel} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.settings.distance.rangeMin}
        </Text>
        <Text style={styles.rangeLabel} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.settings.distance.rangeMax}
        </Text>
      </View>
    </View>
  );
}

interface PreferenceRowProps {
  title: string;
  subtitle: string;
  value: boolean;
  onToggle: () => void;
  toggleLabel: string;
  divider?: boolean;
  edgeToEdge?: boolean;
}

function PreferenceRow({
  title,
  subtitle,
  value,
  onToggle,
  toggleLabel,
  divider = false,
  edgeToEdge = true,
}: PreferenceRowProps) {
  return (
    <View
      style={[
        styles.preferenceRow,
        edgeToEdge && styles.preferenceRowEdge,
        divider && styles.rowDivider,
      ]}
    >
      <View style={styles.preferenceText}>
        <Text
          style={styles.preferenceTitle}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {title}
        </Text>
        <Text
          style={styles.preferenceSubtitle}
          numberOfLines={2}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {subtitle}
        </Text>
      </View>
      <Toggle value={value} onToggle={onToggle} accessibilityLabel={toggleLabel} />
    </View>
  );
}

function BeerCountReminderRow({
  enabled,
  intervalMinutes,
  onToggle,
  onIntervalChange,
}: {
  enabled: boolean;
  intervalMinutes: BeerCountReminderIntervalMinutes;
  onToggle: () => void;
  onIntervalChange: (minutes: BeerCountReminderIntervalMinutes) => void;
}) {
  const { fontScale } = useWindowDimensions();
  const useLargeTypeLayout = fontScale > 1.5;

  return (
    <View style={[styles.beerCountReminder, styles.rowDivider]}>
      <PreferenceRow
        title={cs.settings.beerCountReminder.title}
        subtitle={cs.settings.beerCountReminder.subtitle}
        value={enabled}
        onToggle={onToggle}
        toggleLabel={`${cs.settings.beerCountReminder.title}: ${enabled ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
        edgeToEdge={false}
      />
      {enabled ? (
        <View
          style={[
            styles.reminderIntervalRow,
            useLargeTypeLayout && styles.reminderIntervalRowLargeType,
          ]}
        >
          <Text
            style={styles.reminderIntervalLabel}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {cs.settings.beerCountReminder.intervalLabel}
          </Text>
          <View
            style={[
              styles.reminderIntervalOptions,
              useLargeTypeLayout && styles.reminderIntervalOptionsLargeType,
            ]}
          >
            {BEER_COUNT_REMINDER_INTERVAL_OPTIONS.map((minutes) => {
              const selected = intervalMinutes === minutes;
              return (
                <Pressable
                  key={minutes}
                  onPress={() => onIntervalChange(minutes)}
                  style={[
                    styles.reminderIntervalOption,
                    useLargeTypeLayout && styles.reminderIntervalOptionLargeType,
                    selected && styles.reminderIntervalOptionSelected,
                  ]}
                  hitSlop={{ top: 8, bottom: 8 }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={cs.settings.beerCountReminder.intervalOption(minutes)}
                >
                  <Text
                    style={[
                      styles.reminderIntervalOptionText,
                      selected && styles.reminderIntervalOptionTextSelected,
                    ]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {cs.settings.beerCountReminder.intervalShort(minutes)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function SectionLabel({ children, spaced = false }: { children: string; spaced?: boolean }) {
  return (
    <Text
      style={[styles.sectionLabel, spaced && styles.sectionLabelSpaced]}
      maxFontSizeMultiplier={FontScaleCap.body}
    >
      {children}
    </Text>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const maxDistanceKm = useSettingsStore((state) => state.maxDistanceKm);
  const homePoint = useSettingsStore((state) => state.homePoint);
  const navigationProvider = useSettingsStore((state) => state.navigationProvider);
  const priceCurrency = useSettingsStore((state) => state.priceCurrency);
  const hapticEnabled = useSettingsStore((state) => state.hapticEnabled);
  const soundEnabled = useSettingsStore((state) => state.soundEnabled);
  const waterNudgeEnabled = useSettingsStore((state) => state.waterNudgeEnabled);
  const hideClosedPubs = useSettingsStore((state) => state.hideClosedPubs);
  const preferRatedPubs = useSettingsStore((state) => state.preferRatedPubs);
  const hidePubNames = useSettingsStore((state) => state.hidePubNames);
  const marketingEmailsEnabled = useSettingsStore((state) => state.marketingEmailsEnabled);
  const pubReminderEnabled = useSettingsStore((state) => state.pubReminderEnabled);
  const beerCountReminderEnabled = useSettingsStore((state) => state.beerCountReminderEnabled);
  const beerCountReminderIntervalMinutes = useSettingsStore(
    (state) => state.beerCountReminderIntervalMinutes,
  );

  const setMaxDistanceKm = useSettingsStore((state) => state.setMaxDistanceKm);
  const setNavigationProvider = useSettingsStore((state) => state.setNavigationProvider);
  const setHapticEnabled = useSettingsStore((state) => state.setHapticEnabled);
  const setSoundEnabled = useSettingsStore((state) => state.setSoundEnabled);
  const setWaterNudgeEnabled = useSettingsStore((state) => state.setWaterNudgeEnabled);
  const setHideClosedPubs = useSettingsStore((state) => state.setHideClosedPubs);
  const setPreferRatedPubs = useSettingsStore((state) => state.setPreferRatedPubs);
  const setHidePubNames = useSettingsStore((state) => state.setHidePubNames);
  const setMarketingEmailsEnabled = useSettingsStore(
    (state) => state.setMarketingEmailsEnabled,
  );
  const setPubReminderEnabled = useSettingsStore((state) => state.setPubReminderEnabled);
  const setBeerCountReminderIntervalMinutes = useSettingsStore(
    (state) => state.setBeerCountReminderIntervalMinutes,
  );

  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const hasAccount = accountId !== null;
  const showToast = useToastStore((state) => state.show);

  const [moreOpen, setMoreOpen] = useState(false);
  const [pubReminderBusy, setPubReminderBusy] = useState(false);
  const [pubReminderDisclosureOpen, setPubReminderDisclosureOpen] = useState(false);
  const [beerCountReminderBusy, setBeerCountReminderBusy] = useState(false);
  const [privacyOpenFor, setPrivacyOpenFor] = useState<string | null>(null);
  const [privacyLoadingFor, setPrivacyLoadingFor] = useState<string | null>(null);
  const [friendSettingsResource, setFriendSettingsResource] = useState<{
    accountId: string;
    settings: FriendSocialSettings;
  } | null>(null);
  const privacyControllerRef = React.useRef<AbortController | null>(null);

  const privacySettings =
    friendSettingsResource?.accountId === accountId
      ? friendSettingsResource.settings
      : DEFAULT_FRIEND_SOCIAL_SETTINGS;
  const privacyReady = friendSettingsResource?.accountId === accountId;
  const privacyBusy = accountId !== null && privacyLoadingFor === accountId;

  // Rendering is account-keyed below, so A's switches disappear in the same
  // render that selects B. Cleanup then cancels A's in-flight GET.
  useEffect(
    () => () => {
      privacyControllerRef.current?.abort();
      privacyControllerRef.current = null;
    },
    [accountId],
  );

  const openPrivacySettings = useCallback(async () => {
    if (!accountId || privacyBusy) return;
    trackUiInteraction('settings_privacy_open');
    if (privacyReady) {
      setPrivacyOpenFor(accountId);
      return;
    }

    const requestedAccountId = accountId;
    const controller = new AbortController();
    privacyControllerRef.current?.abort();
    privacyControllerRef.current = controller;
    setPrivacyLoadingFor(requestedAccountId);
    const settings = await fetchFriendSettings(controller.signal);
    const viewerStillMatches =
      useAccountStore.getState().session?.accountId === requestedAccountId;
    if (!controller.signal.aborted && viewerStillMatches) {
      if (settings) {
        setFriendSettingsResource({ accountId: requestedAccountId, settings });
        setPrivacyOpenFor(requestedAccountId);
      } else {
        showToast(cs.friends.settingsError);
      }
    }
    if (privacyControllerRef.current === controller) {
      privacyControllerRef.current = null;
      setPrivacyLoadingFor((current) =>
        current === requestedAccountId ? null : current,
      );
    }
  }, [accountId, privacyBusy, privacyReady, showToast]);

  const savePrivacySettings = useCallback(
    (settings: FriendSocialSettings) => {
      if (!accountId) return;
      setFriendSettingsResource({ accountId, settings });
    },
    [accountId],
  );

  const sliderIndex = positionIndexForKm(maxDistanceKm);
  const readout = distanceReadout(maxDistanceKm);
  const numeralSize = numeralFontSize(readout.value);
  const appVersionLabel = getAppVersionLabel();

  const handleSliderSnap = useCallback(
    (index: number) => {
      const next = SLIDER_POSITIONS[index] ?? null;
      trackUiInteraction('settings_distance_change', 'select');
      setMaxDistanceKm(next);
      void enqueueAccountPreferences({ maxDistanceKm: next }, accountId);
    },
    [accountId, setMaxDistanceKm],
  );

  const toggleHaptic = useCallback(() => {
    const next = !hapticEnabled;
    trackUiInteraction('settings_haptics', next ? 'toggle_on' : 'toggle_off');
    setHapticEnabled(next);
    void enqueueAccountPreferences({ hapticEnabled: next }, accountId);
  }, [accountId, hapticEnabled, setHapticEnabled]);

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    trackUiInteraction('settings_sound', next ? 'toggle_on' : 'toggle_off');
    setSoundEnabled(next);
    void enqueueAccountPreferences({ soundEnabled: next }, accountId);
  }, [accountId, setSoundEnabled, soundEnabled]);

  const toggleWaterNudge = useCallback(() => {
    const next = !waterNudgeEnabled;
    trackUiInteraction('settings_water_nudge', next ? 'toggle_on' : 'toggle_off');
    setWaterNudgeEnabled(next);
  }, [setWaterNudgeEnabled, waterNudgeEnabled]);

  const toggleHideClosed = useCallback(() => {
    const next = !hideClosedPubs;
    trackUiInteraction('settings_hide_closed', next ? 'toggle_on' : 'toggle_off');
    setHideClosedPubs(next);
    void enqueueAccountPreferences({ hideClosedPubs: next }, accountId);
  }, [accountId, hideClosedPubs, setHideClosedPubs]);

  const togglePreferRated = useCallback(() => {
    const next = !preferRatedPubs;
    trackUiInteraction('settings_prefer_rated', next ? 'toggle_on' : 'toggle_off');
    setPreferRatedPubs(next);
  }, [preferRatedPubs, setPreferRatedPubs]);

  const toggleHidePubNames = useCallback(() => {
    const next = !hidePubNames;
    trackUiInteraction('settings_hide_names', next ? 'toggle_on' : 'toggle_off');
    setHidePubNames(next);
    void enqueueAccountPreferences({ hidePubNames: next }, accountId);
  }, [accountId, hidePubNames, setHidePubNames]);

  const toggleMarketingEmails = useCallback(() => {
    const next = !marketingEmailsEnabled;
    trackUiInteraction('settings_marketing_emails', next ? 'toggle_on' : 'toggle_off');
    setMarketingEmailsEnabled(next);
    void enqueueAccountPreferences({ marketingEmailsEnabled: next }, accountId);
  }, [accountId, marketingEmailsEnabled, setMarketingEmailsEnabled]);

  const togglePubReminders = useCallback(async () => {
    if (pubReminderBusy) return;
    trackUiInteraction(
      'settings_pub_reminders',
      pubReminderEnabled ? 'toggle_off' : 'toggle_on',
    );
    setPubReminderBusy(true);
    try {
      if (pubReminderEnabled) {
        setPubReminderEnabled(false);
        await disablePubReminderNotifications();
        return;
      }

      // Store policy: the toggle can never prompt for background location
      // directly — the prominent disclosure always comes first.
      if (await pubReminderNeedsBackgroundDisclosure()) {
        setPubReminderDisclosureOpen(true);
        return;
      }
      const result = await enablePubReminderNotifications();
      if (result.ok) {
        setPubReminderEnabled(true);
        return;
      }

      setPubReminderEnabled(false);
      showPubReminderEnableFailure(result.reason);
    } finally {
      setPubReminderBusy(false);
    }
  }, [pubReminderBusy, pubReminderEnabled, setPubReminderEnabled]);

  const allowPubReminderDisclosure = useCallback(async () => {
    setPubReminderDisclosureOpen(false);
    if (pubReminderBusy) return;
    setPubReminderBusy(true);
    try {
      const result = await enablePubReminderNotifications();
      if (result.ok) {
        setPubReminderEnabled(true);
        return;
      }
      setPubReminderEnabled(false);
      showPubReminderEnableFailure(result.reason);
    } finally {
      setPubReminderBusy(false);
    }
  }, [pubReminderBusy, setPubReminderEnabled]);

  const toggleBeerCountReminder = useCallback(async () => {
    if (beerCountReminderBusy) return;
    trackUiInteraction(
      'settings_beer_reminders',
      beerCountReminderEnabled ? 'toggle_off' : 'toggle_on',
    );
    setBeerCountReminderBusy(true);
    try {
      if (beerCountReminderEnabled) {
        await disableBeerCountReminderNotifications();
        return;
      }

      const result = await enableBeerCountReminderNotifications();
      if (!result.ok) showPubReminderEnableFailure('notifications-denied');
    } finally {
      setBeerCountReminderBusy(false);
    }
  }, [beerCountReminderBusy, beerCountReminderEnabled]);

  const changeBeerCountReminderInterval = useCallback(
    (minutes: BeerCountReminderIntervalMinutes) => {
      setBeerCountReminderIntervalMinutes(minutes);
      void reschedulePendingBeerCountReminder();
    },
    [setBeerCountReminderIntervalMinutes],
  );

  const openFromMore = useCallback(
    (href: Href) => {
      setMoreOpen(false);
      router.push(href);
    },
    [router],
  );

  const moreRows = useMemo<MoreRow[]>(
    () => [
      {
        key: 'home',
        label: cs.settings.more.homePoint,
        value: homePoint ? cs.settings.more.configured : cs.settings.more.notConfigured,
        icon: HouseIcon,
        onPress: () => openFromMore('/home-point' as Href),
      },
      {
        key: 'google',
        label: cs.settings.more.navigateGoogle,
        icon: MapPinIcon,
        selected: navigationProvider === 'google',
        accessibilityRole: 'radio',
        onPress: () => {
          trackUiInteraction('settings_navigation_google', 'select');
          setNavigationProvider('google');
          setMoreOpen(false);
        },
      },
      {
        key: 'mapy',
        label: cs.settings.more.navigateMapy,
        icon: MapIcon,
        selected: navigationProvider === 'mapy',
        accessibilityRole: 'radio',
        onPress: () => {
          trackUiInteraction('settings_navigation_mapy', 'select');
          setNavigationProvider('mapy');
          setMoreOpen(false);
        },
      },
      {
        key: 'add-pub',
        label: cs.settings.addPub,
        icon: PlusIcon,
        onPress: () => openFromMore('/add-pub' as Href),
      },
      {
        key: 'my-pubs',
        label: cs.settings.more.myAddedPubs,
        icon: StarIcon,
        onPress: () => openFromMore('/my-added-pubs' as Href),
      },
      {
        key: 'feedback',
        label: cs.settings.feedback,
        icon: MessageSquareIcon,
        onPress: () => openFromMore('/report' as Href),
      },
      {
        key: 'about',
        label: cs.settings.about.title,
        value: appVersionLabel || null,
        icon: InfoIcon,
        onPress: () => openFromMore('/about' as Href),
      },
      {
        key: 'privacy',
        label: cs.settings.privacy,
        icon: ShieldIcon,
        onPress: () => openFromMore('/privacy' as Href),
      },
    ],
    [
      appVersionLabel,
      homePoint,
      navigationProvider,
      openFromMore,
      setNavigationProvider,
    ],
  );

  const accountSubLabel = hasAccount
    ? cs.settings.accountCard.manageDataSubtitle
    : cs.settings.accountCard.ctaSignedOutSubtitle;

  return (
    <View
      style={[
        styles.root,
        { paddingBottom: Math.max(insets.bottom, Spacing.sm) },
      ]}
    >
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text
          style={styles.headerTitle}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.8}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {cs.settings.title}
        </Text>
        <Pressable
          onPress={() => {
            trackUiInteraction('settings_more_open');
            setMoreOpen(true);
          }}
          style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={cs.settings.more.accessibilityLabel}
        >
          <MenuIcon size={20} color={Colors.mutedText} />
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Privacy first, because this app publishes evenings, pubs and a
            drinking history, and until now there was no door to any of that
            from the place people look for it. The switches themselves already
            exist on the Parta screen — this is a door, not a second copy. */}
        <SectionLabel>{cs.settings.privacySection}</SectionLabel>
        <View style={styles.notificationsCard}>
          <Pressable
            onPress={() => void openPrivacySettings()}
            disabled={!accountId || privacyBusy}
            style={({ pressed }) => [styles.privacyRow, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={cs.settings.privacyDoor.title}
            accessibilityState={{ disabled: !accountId || privacyBusy, busy: privacyBusy }}
          >
            <View style={styles.privacyText}>
              <Text style={styles.privacyTitle} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.settings.privacyDoor.title}
              </Text>
              <Text style={styles.privacySub} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.settings.privacyDoor.subtitle}
              </Text>
            </View>
            {privacyBusy ? (
              <ActivityIndicator color={Colors.amber} />
            ) : (
              <ChevronRightIcon size={18} color={Colors.mutedText} />
            )}
          </Pressable>
        </View>

        <SectionLabel spaced>{cs.settings.notificationsSection}</SectionLabel>
        <View style={styles.notificationsCard}>
          <PreferenceRow
            title={cs.settings.pubReminders.title}
            subtitle={cs.settings.pubReminders.subtitle}
            value={pubReminderEnabled}
            onToggle={() => void togglePubReminders()}
            toggleLabel={`${cs.settings.pubReminders.title}: ${pubReminderEnabled ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
          />
          <BeerCountReminderRow
            enabled={beerCountReminderEnabled}
            intervalMinutes={beerCountReminderIntervalMinutes}
            onToggle={() => void toggleBeerCountReminder()}
            onIntervalChange={changeBeerCountReminderInterval}
          />
          <PreferenceRow
            title={cs.settings.haptics.title}
            subtitle={cs.settings.haptics.subtitle}
            value={hapticEnabled}
            onToggle={toggleHaptic}
            toggleLabel={`${cs.settings.haptics.title}: ${hapticEnabled ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
            divider
          />
          <PreferenceRow
            title={cs.settings.sound.title}
            subtitle={cs.settings.sound.subtitle}
            value={soundEnabled}
            onToggle={toggleSound}
            toggleLabel={`${cs.settings.sound.title}: ${soundEnabled ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
            divider
          />
          <PreferenceRow
            title={cs.settings.waterNudge.title}
            subtitle={cs.settings.waterNudge.subtitle}
            value={waterNudgeEnabled}
            onToggle={toggleWaterNudge}
            toggleLabel={`${cs.settings.waterNudge.title}: ${waterNudgeEnabled ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
            divider
          />
          <PreferenceRow
            title={cs.settings.marketingEmails.title}
            subtitle={cs.settings.marketingEmails.subtitle}
            value={marketingEmailsEnabled}
            onToggle={toggleMarketingEmails}
            toggleLabel={`${cs.settings.marketingEmails.title}: ${marketingEmailsEnabled ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
            divider
          />
        </View>

        {/* Search settings last. They are the compass MVP's screen, and two of
            these three toggles are the same filters the Hospody screen already
            has on it — kept here only because deleting a stored preference
            silently changes what shipped users see. */}
        <SectionLabel spaced>{cs.settings.compassSection}</SectionLabel>
        <View style={styles.distanceCard}>
          <Text
            style={[
              styles.distanceNumber,
              { fontSize: numeralSize, lineHeight: numeralSize * 1.24 },
            ]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.display}
          >
            {readout.value}
          </Text>
          <Text
            style={styles.distanceUnit}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.8}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {readout.unit}
          </Text>

          <DistanceSlider
            positionIndex={sliderIndex}
            valueLabel={`${readout.value} ${readout.unit.toLocaleLowerCase('cs-CZ')}`}
            onSnap={handleSliderSnap}
          />

          <View style={styles.distancePreferences}>
            <PreferenceRow
              title={cs.settings.hideClosed.title}
              subtitle={cs.settings.hideClosed.subtitle}
              value={hideClosedPubs}
              onToggle={toggleHideClosed}
              toggleLabel={`${cs.settings.hideClosed.title}: ${hideClosedPubs ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
            />
            <PreferenceRow
              title={cs.settings.preferRated.title}
              subtitle={cs.settings.preferRated.subtitle}
              value={preferRatedPubs}
              onToggle={togglePreferRated}
              toggleLabel={`${cs.settings.preferRated.title}: ${preferRatedPubs ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
              divider
            />
            <PreferenceRow
              title={cs.settings.hidePubNames.title}
              subtitle={cs.settings.hidePubNames.subtitle}
              value={hidePubNames}
              onToggle={toggleHidePubNames}
              toggleLabel={`${cs.settings.hidePubNames.title}: ${hidePubNames ? cs.a11y.toggleOn : cs.a11y.toggleOff}`}
              divider
            />
          </View>
        </View>


        <View style={styles.footer}>
          <Text style={styles.footerPromise} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.settings.locationPrivacy}
          </Text>
          <Text style={styles.footerPromise} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.settings.currency.footer(priceCurrency)}
          </Text>
          <Text style={styles.footerTagline} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.settings.footer}
          </Text>
        </View>
      </ScrollView>

      <CounterCta
        label={
          hasAccount
            ? cs.settings.accountCard.ctaManageData
            : cs.settings.accountCard.signedOutTitle
        }
        subLabel={accountSubLabel}
        onPress={() => {
          trackUiInteraction('settings_account_open');
          router.push((hasAccount ? '/account' : '/auth') as Href);
        }}
        accessibilityLabel={
          hasAccount ? cs.a11y.accountManageData : cs.a11y.profileSignUp
        }
      />

      <MoreSheet
        visible={moreOpen}
        title={cs.settings.more.title}
        rows={moreRows}
        onClose={() => setMoreOpen(false)}
      />

      <FriendSettingsSheet
        key={accountId ?? 'no-account'}
        visible={
          accountId !== null &&
          privacyReady &&
          privacyOpenFor === accountId
        }
        onClose={() => setPrivacyOpenFor(null)}
        settings={privacySettings}
        onSaved={savePrivacySettings}
      />

      <PubReminderBackgroundLocationDisclosure
        visible={pubReminderDisclosureOpen}
        onAllow={() => void allowPubReminderDisclosure()}
        onDeny={() => setPubReminderDisclosureOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: 24,
    gap: 12,
  },
  header: {
    minHeight: 44,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 24,
    color: Colors.foam,
    includeFontPadding: false,
  },
  moreButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 12 },
  sectionLabel: {
    marginBottom: 8,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  sectionLabelSpaced: { marginTop: 24 },
  distanceCard: {
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 4,
  },
  distanceNumber: {
    alignSelf: 'stretch',
    fontWeight: '800',
    color: Colors.amber,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  distanceUnit: {
    marginTop: -8,
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 3,
    color: Colors.mutedText,
    includeFontPadding: false,
    textAlign: 'center',
  },
  sliderWrapper: { marginTop: 20 },
  sliderTouchArea: {
    height: 44,
    justifyContent: 'center',
  },
  track: {
    height: TRACK_HEIGHT,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'visible',
    position: 'relative',
    justifyContent: 'center',
  },
  trackFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  thumb: {
    position: 'absolute',
    top: -(THUMB_SIZE / 2 - TRACK_HEIGHT / 2),
    left: 0,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: Radius.pill,
    backgroundColor: Colors.foam,
    borderWidth: 3,
    borderColor: Colors.amber,
  },
  rangeLabels: {
    marginTop: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rangeLabel: {
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  distancePreferences: {
    marginTop: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  notificationsCard: {
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingHorizontal: 24,
    paddingVertical: 4,
  },
  preferenceRow: {
    minHeight: 58,
    paddingHorizontal: 24,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  preferenceRowEdge: { marginHorizontal: -24 },
  beerCountReminder: { marginHorizontal: -24 },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  preferenceText: {
    flex: 1,
    minWidth: 0,
  },
  preferenceTitle: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  preferenceSubtitle: {
    marginTop: 2,
    fontWeight: '400',
    fontSize: 12,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  toggle: {
    width: 50,
    height: 30,
    borderRadius: Radius.pill,
    borderWidth: 1,
    justifyContent: 'center',
  },
  toggleOn: {
    backgroundColor: withAlpha(Colors.amber, 0.32),
    borderColor: withAlpha(Colors.amber, 0.45),
  },
  toggleOff: {
    backgroundColor: Colors.stout3,
    borderColor: withAlpha(Colors.foam, 0.08),
  },
  toggleThumb: {
    width: 24,
    height: 24,
    borderRadius: Radius.pill,
  },
  toggleThumbOn: { backgroundColor: Colors.foam },
  toggleThumbOff: { backgroundColor: Colors.mutedText },
  reminderIntervalRow: {
    minHeight: 44,
    paddingLeft: 24,
    paddingRight: 24,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reminderIntervalRowLargeType: { alignItems: 'flex-start' },
  reminderIntervalLabel: {
    fontWeight: '500',
    fontSize: 11,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  reminderIntervalOptions: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 4,
  },
  reminderIntervalOptionsLargeType: {
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
  },
  reminderIntervalOption: {
    minWidth: 45,
    height: 28,
    paddingHorizontal: 7,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.08),
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reminderIntervalOptionLargeType: {
    width: '48%',
    minWidth: 0,
  },
  reminderIntervalOptionSelected: {
    backgroundColor: withAlpha(Colors.foam, 0.1),
    borderColor: withAlpha(Colors.foam, 0.18),
  },
  reminderIntervalOptionText: {
    fontWeight: '500',
    fontSize: 11,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  reminderIntervalOptionTextSelected: { color: Colors.foam },
  footer: {
    alignItems: 'center',
    marginTop: 24,
    gap: 4,
  },
  footerPromise: {
    fontWeight: '500',
    fontSize: 12,
    lineHeight: 17,
    color: Colors.mutedText,
    textAlign: 'center',
    includeFontPadding: false,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 68,
    paddingHorizontal: 16,
  },
  privacyText: { flex: 1 },
  privacyTitle: { fontSize: 16, fontWeight: '600', color: Colors.foam },
  privacySub: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },
  footerTagline: {
    fontWeight: '500',
    fontSize: 11,
    letterSpacing: 0.5,
    color: Colors.mutedText,
    textAlign: 'center',
    includeFontPadding: false,
  },
});
