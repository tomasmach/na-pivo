/**
 * Nastavení — one flat page grouped by what you want to change: your account,
 * what the compass finds, when I get in touch, how the phone behaves and the
 * app itself. Store writes, server preference sync and the notification
 * permission flows are the same as before the regrouping.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Band,
  ListRow,
  PAGE_PAD,
  RoundButton,
  SectionTitle,
  ToggleRow,
} from '@/components/shared/FlatPage';
import { XIcon } from '@/components/shared/IconGlyph';
import { MoreSheet } from '@/components/shared/MoreSheet';
import { updateAccountPreferences } from '@/data/account';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { locale, SUPPORTED_LOCALES, t, type Locale } from '@/i18n';
import { switchLocale } from '@/i18n/switchLocale';
import {
  disableBeerCountReminderNotifications,
  enableBeerCountReminderNotifications,
  reschedulePendingBeerCountReminder,
} from '@/notifications/beerCountReminder';
import {
  disableHomeTransitReminder,
  enableHomeTransitReminder,
} from '@/notifications/homeTransitReminder';
import { showPubReminderEnableFailure } from '@/notifications/pubReminderEnableFailure';
import {
  disablePubReminderNotifications,
  enablePubReminderNotifications,
} from '@/notifications/pubReminderNotifications';
import { askTourReminderPermission, notificationPermissionStatus } from '@/notifications/tourReminder';
import { Avatar } from '@/profile/Avatar';
import {
  selectAvatarUrl,
  selectIsSignedIn,
  selectNickname,
  useAccountStore,
} from '@/stores/accountStore';
import {
  BEER_COUNT_REMINDER_INTERVAL_OPTIONS,
  useSettingsStore,
  type BeerCountReminderIntervalMinutes,
  type NavigationProvider,
} from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';
import { palette, PALETTES, type Palette } from '@/theme/palette';
import { switchPalette } from '@/theme/switchPalette';
import { getAppVersionLabel } from '@/utils/appVersion';
import { numberFormat } from '@/utils/intlFormat';

const DISTANCE_OPTIONS: (number | null)[] = [0.5, 1, 1.5, 2, 2.5, 5, 10, null];

function distanceLabel(km: number | null): string {
  if (km === null) return t.settings.distance.unlimited;
  if (km < 1) return t.settings.distance.meters(Math.round(km * 1000));
  return `${numberFormat({ maximumFractionDigits: 1 }).format(km)} ${t.settings.distance.kmShort}`;
}

function onOff(title: string, value: boolean): string {
  return `${title}: ${value ? t.a11y.toggleOn : t.a11y.toggleOff}`;
}

/** Two or three choices in one row. Each option keeps its own testID. */
function Segment<T extends string>({
  title,
  options,
  value,
  onChange,
  first = false,
}: {
  title: string;
  options: { value: T; label: string; accessibilityLabel: string; testID: string }[];
  value: T;
  onChange: (next: T) => void;
  first?: boolean;
}) {
  return (
    <View style={[styles.segmentRow, !first && styles.rowDivided]}>
      <Text style={styles.segmentTitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {title}
      </Text>
      <View style={styles.segmentTrack} accessibilityRole="radiogroup">
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable
              key={option.value}
              testID={option.testID}
              onPress={() => onChange(option.value)}
              style={[styles.segmentOption, selected && styles.segmentOptionSelected]}
              hitSlop={{ top: 8, bottom: 8 }}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={option.accessibilityLabel}
            >
              <Text
                style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((state) => state.show);

  const maxDistanceKm = useSettingsStore((state) => state.maxDistanceKm);
  const homePoint = useSettingsStore((state) => state.homePoint);
  const navigationProvider = useSettingsStore((state) => state.navigationProvider);
  const hapticEnabled = useSettingsStore((state) => state.hapticEnabled);
  const soundEnabled = useSettingsStore((state) => state.soundEnabled);
  const waterNudgeEnabled = useSettingsStore((state) => state.waterNudgeEnabled);
  const hideClosedPubs = useSettingsStore((state) => state.hideClosedPubs);
  const preferRatedPubs = useSettingsStore((state) => state.preferRatedPubs);
  const hidePubNames = useSettingsStore((state) => state.hidePubNames);
  const pubReminderEnabled = useSettingsStore((state) => state.pubReminderEnabled);
  const tourRemindersPreferred = useSettingsStore((state) => state.tourRemindersEnabled);
  // On only when reminders can really come: a fresh install that was never asked shows off, and a tap asks.
  const [tourPermissionGranted, setTourPermissionGranted] = useState(false);
  useEffect(() => {
    const check = () => void notificationPermissionStatus().then((status) => setTourPermissionGranted(status === 'granted'));
    check();
    const subscription = AppState.addEventListener('change', (next) => { if (next === 'active') check(); });
    return () => subscription.remove();
  }, []);
  const tourRemindersEnabled = tourRemindersPreferred && tourPermissionGranted;
  const beerCountReminderEnabled = useSettingsStore((state) => state.beerCountReminderEnabled);
  const beerCountReminderIntervalMinutes = useSettingsStore(
    (state) => state.beerCountReminderIntervalMinutes,
  );
  const homeTransitReminderEnabled = useSettingsStore(
    (state) => state.homeTransitReminderEnabled,
  );

  const setMaxDistanceKm = useSettingsStore((state) => state.setMaxDistanceKm);
  const setNavigationProvider = useSettingsStore((state) => state.setNavigationProvider);
  const setHapticEnabled = useSettingsStore((state) => state.setHapticEnabled);
  const setSoundEnabled = useSettingsStore((state) => state.setSoundEnabled);
  const setWaterNudgeEnabled = useSettingsStore((state) => state.setWaterNudgeEnabled);
  const setHideClosedPubs = useSettingsStore((state) => state.setHideClosedPubs);
  const setPreferRatedPubs = useSettingsStore((state) => state.setPreferRatedPubs);
  const setHidePubNames = useSettingsStore((state) => state.setHidePubNames);
  const setPubReminderEnabled = useSettingsStore((state) => state.setPubReminderEnabled);
  const setBeerCountReminderIntervalMinutes = useSettingsStore(
    (state) => state.setBeerCountReminderIntervalMinutes,
  );

  const isSignedIn = useAccountStore(selectIsSignedIn);
  const nickname = useAccountStore(selectNickname);
  const avatarUrl = useAccountStore(selectAvatarUrl);
  const profile = useAccountStore((state) => state.profile);

  const [picker, setPicker] = useState<'distance' | 'interval' | null>(null);
  const [pubReminderBusy, setPubReminderBusy] = useState(false);
  const [beerCountReminderBusy, setBeerCountReminderBusy] = useState(false);
  const [homeTransitReminderBusy, setHomeTransitReminderBusy] = useState(false);

  const appVersionLabel = getAppVersionLabel();

  const pickDistance = useCallback(
    (next: number | null) => {
      setPicker(null);
      trackUiInteraction('settings_distance_change', 'select');
      setMaxDistanceKm(next);
      void updateAccountPreferences({ maxDistanceKm: next });
    },
    [setMaxDistanceKm],
  );

  const pickNavigation = useCallback(
    (next: NavigationProvider) => {
      trackUiInteraction(next === 'google' ? 'settings_navigation_google' : 'settings_navigation_mapy', 'select');
      setNavigationProvider(next);
    },
    [setNavigationProvider],
  );

  const toggleHaptic = useCallback(() => {
    const next = !hapticEnabled;
    trackUiInteraction('settings_haptics', next ? 'toggle_on' : 'toggle_off');
    setHapticEnabled(next);
    void updateAccountPreferences({ hapticEnabled: next });
  }, [hapticEnabled, setHapticEnabled]);

  const toggleSound = useCallback(() => {
    const next = !soundEnabled;
    trackUiInteraction('settings_sound', next ? 'toggle_on' : 'toggle_off');
    setSoundEnabled(next);
    void updateAccountPreferences({ soundEnabled: next });
  }, [setSoundEnabled, soundEnabled]);

  const toggleWaterNudge = useCallback(() => {
    const next = !waterNudgeEnabled;
    trackUiInteraction('settings_water_nudge', next ? 'toggle_on' : 'toggle_off');
    setWaterNudgeEnabled(next);
  }, [setWaterNudgeEnabled, waterNudgeEnabled]);

  const toggleHideClosed = useCallback(() => {
    const next = !hideClosedPubs;
    trackUiInteraction('settings_hide_closed', next ? 'toggle_on' : 'toggle_off');
    setHideClosedPubs(next);
    void updateAccountPreferences({ hideClosedPubs: next });
  }, [hideClosedPubs, setHideClosedPubs]);

  const togglePreferRated = useCallback(() => {
    const next = !preferRatedPubs;
    trackUiInteraction('settings_prefer_rated', next ? 'toggle_on' : 'toggle_off');
    setPreferRatedPubs(next);
  }, [preferRatedPubs, setPreferRatedPubs]);

  const toggleHidePubNames = useCallback(() => {
    const next = !hidePubNames;
    trackUiInteraction('settings_hide_names', next ? 'toggle_on' : 'toggle_off');
    setHidePubNames(next);
    void updateAccountPreferences({ hidePubNames: next });
  }, [hidePubNames, setHidePubNames]);

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

  const toggleHomeTransitReminder = useCallback(async () => {
    if (homeTransitReminderBusy) return;
    if (homeTransitReminderEnabled) {
      disableHomeTransitReminder();
      return;
    }
    setHomeTransitReminderBusy(true);
    try {
      const result = await enableHomeTransitReminder();
      if (!result.ok) showPubReminderEnableFailure('notifications-denied');
    } finally {
      setHomeTransitReminderBusy(false);
    }
  }, [homeTransitReminderBusy, homeTransitReminderEnabled]);

  // Off cancels every tour reminder at once; on asks for notifications like the other reminders.
  const toggleTourReminders = useCallback(async () => {
    const settings = useSettingsStore.getState();
    if (tourRemindersEnabled) {
      settings.setTourRemindersEnabled(false);
      return;
    }
    settings.setTourRemindersEnabled(true);
    const answer = await askTourReminderPermission();
    setTourPermissionGranted(answer === 'granted');
    if (answer !== 'granted') useSettingsStore.getState().setTourRemindersEnabled(false);
    // Only a real no sends people to the system settings; without an answer the toggle can simply be tried again.
    if (answer === 'denied') showPubReminderEnableFailure('notifications-denied');
  }, [tourRemindersEnabled]);

  const pickInterval = useCallback(
    (minutes: BeerCountReminderIntervalMinutes) => {
      setPicker(null);
      setBeerCountReminderIntervalMinutes(minutes);
      void reschedulePendingBeerCountReminder();
    },
    [setBeerCountReminderIntervalMinutes],
  );

  const pickLocale = useCallback(
    async (code: Locale) => {
      if (code === locale) return;
      if (!(await switchLocale(code))) showToast(t.account.errorGeneric);
    },
    [showToast],
  );

  const pickPalette = useCallback(
    async (next: Palette) => {
      if (next === palette) return;
      if (!(await switchPalette(next))) showToast(t.account.errorGeneric);
    },
    [showToast],
  );

  const displayName = profile?.displayName?.trim() || '';
  const email = profile?.email?.trim() || '';
  const accountTitle = nickname ? `@${nickname}` : displayName || email || t.settings.accountCard.ctaSignedIn;
  const accountSubtitle = [
    nickname ? displayName : null,
    profile?.emailVerified ? t.settings.accountCard.verifiedInline : null,
  ].filter(Boolean).join(' · ');

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.nav}>
        <RoundButton label={t.a11y.counterCloseModal} onPress={() => router.back()}>
          <XIcon size={22} color={Colors.foam} />
        </RoundButton>
        <Text style={styles.navTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.settings.title}
        </Text>
        <View style={styles.navSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: Math.max(insets.bottom, Spacing.sm) + Spacing.lg },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {isSignedIn ? (
          <ListRow
            first
            title={accountTitle}
            subtitle={accountSubtitle || null}
            leading={
              <Avatar
                uri={avatarUrl}
                nickname={nickname}
                displayName={displayName}
                size={44}
                border="quiet"
              />
            }
            onPress={() => {
              trackUiInteraction('settings_account_open');
              router.push('/account' as Href);
            }}
          />
        ) : (
          <ListRow
            first
            title={t.settings.accountCard.signedOutTitle}
            subtitle={t.settings.accountCard.ctaSignedOutSubtitle}
            onPress={() => {
              trackUiInteraction('settings_account_open');
              router.push('/auth' as Href);
            }}
          />
        )}

        <Band />
        <SectionTitle title={t.settings.compassSection} />
        <ListRow
          first
          testID="settings-distance"
          title={t.settings.distance.title}
          value={distanceLabel(maxDistanceKm)}
          onPress={() => setPicker('distance')}
        />
        <ToggleRow
          title={t.settings.hideClosed.title}
          subtitle={t.settings.hideClosed.subtitle}
          value={hideClosedPubs}
          onToggle={toggleHideClosed}
          toggleLabel={onOff(t.settings.hideClosed.title, hideClosedPubs)}
        />
        <ToggleRow
          title={t.settings.preferRated.title}
          subtitle={t.settings.preferRated.subtitle}
          value={preferRatedPubs}
          onToggle={togglePreferRated}
          toggleLabel={onOff(t.settings.preferRated.title, preferRatedPubs)}
        />
        <ToggleRow
          testID="settings-hide-names"
          title={t.settings.hidePubNames.title}
          subtitle={t.settings.hidePubNames.subtitle}
          value={hidePubNames}
          onToggle={toggleHidePubNames}
          toggleLabel={onOff(t.settings.hidePubNames.title, hidePubNames)}
        />
        <Segment
          title={t.settings.navigation.title}
          value={navigationProvider}
          onChange={pickNavigation}
          options={[
            {
              value: 'google',
              label: t.settings.navigation.google,
              accessibilityLabel: t.settings.navigation.a11y(t.settings.navigation.google),
              testID: 'settings-navigation-google',
            },
            {
              value: 'mapy',
              label: t.settings.navigation.mapy,
              accessibilityLabel: t.settings.navigation.a11y(t.settings.navigation.mapy),
              testID: 'settings-navigation-mapy',
            },
          ]}
        />
        <ListRow
          title={t.settings.homePoint.title}
          value={homePoint ? t.settings.homePoint.configured : t.settings.homePoint.notConfigured}
          onPress={() => router.push('/home-point' as Href)}
        />

        <Band />
        <SectionTitle title={t.settings.notificationsSection} />
        <ToggleRow
          first
          title={t.settings.pubReminders.title}
          subtitle={t.settings.pubReminders.subtitle}
          value={pubReminderEnabled}
          onToggle={() => void togglePubReminders()}
          toggleLabel={onOff(t.settings.pubReminders.title, pubReminderEnabled)}
        />
        <ToggleRow
          title={t.settings.beerCountReminder.title}
          subtitle={t.settings.beerCountReminder.subtitle}
          value={beerCountReminderEnabled}
          onToggle={() => void toggleBeerCountReminder()}
          toggleLabel={onOff(t.settings.beerCountReminder.title, beerCountReminderEnabled)}
        />
        {beerCountReminderEnabled ? (
          <View style={styles.childRow}>
            <ListRow
              title={t.settings.beerCountReminder.intervalTitle}
              value={t.settings.beerCountReminder.intervalShort(beerCountReminderIntervalMinutes)}
              onPress={() => setPicker('interval')}
            />
          </View>
        ) : null}
        <ToggleRow
          testID="settings-home-transit-reminder"
          title={t.settings.homeTransitReminder.title}
          subtitle={t.settings.homeTransitReminder.subtitle}
          value={homeTransitReminderEnabled}
          onToggle={() => void toggleHomeTransitReminder()}
          toggleLabel={onOff(t.settings.homeTransitReminder.title, homeTransitReminderEnabled)}
        />
        <ToggleRow
          title={t.tourReminders.settingsTitle}
          subtitle={t.tourReminders.settingsSubtitle}
          value={tourRemindersEnabled}
          onToggle={() => void toggleTourReminders()}
          toggleLabel={onOff(t.tourReminders.settingsTitle, tourRemindersEnabled)}
        />
        <ToggleRow
          testID="settings-water"
          title={t.settings.waterNudge.title}
          subtitle={t.settings.waterNudge.subtitle}
          value={waterNudgeEnabled}
          onToggle={toggleWaterNudge}
          toggleLabel={onOff(t.settings.waterNudge.title, waterNudgeEnabled)}
        />

        <Band />
        <SectionTitle title={t.settings.phoneSection} />
        <ToggleRow
          first
          testID="settings-haptics"
          title={t.settings.haptics.title}
          subtitle={t.settings.haptics.subtitle}
          value={hapticEnabled}
          onToggle={toggleHaptic}
          toggleLabel={onOff(t.settings.haptics.title, hapticEnabled)}
        />
        <ToggleRow
          title={t.settings.sound.title}
          subtitle={t.settings.sound.subtitle}
          value={soundEnabled}
          onToggle={toggleSound}
          toggleLabel={onOff(t.settings.sound.title, soundEnabled)}
        />
        <Segment
          title={t.settings.languageSection}
          value={locale}
          onChange={(code) => void pickLocale(code)}
          options={SUPPORTED_LOCALES.map((code: Locale) => ({
            value: code,
            label: t.settings.language[code],
            accessibilityLabel: t.settings.language.option(t.settings.language[code]),
            testID: `settings-language-${code}`,
          }))}
        />
        <Segment
          title={t.settings.appearanceSection}
          value={palette}
          onChange={(next) => void pickPalette(next)}
          options={PALETTES.map((option: Palette) => ({
            value: option,
            label: t.settings.appearance[option],
            accessibilityLabel: t.settings.appearance.a11y[option],
            testID: `settings-palette-${option}`,
          }))}
        />
        <Text style={styles.note} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.settings.appearance.brownNote}
        </Text>

        <Band />
        <SectionTitle title={t.settings.appSection} />
        <ListRow first title={t.settings.feedback} onPress={() => router.push('/report' as Href)} />
        <ListRow
          title={t.settings.aboutRow}
          value={appVersionLabel || null}
          onPress={() => router.push('/about' as Href)}
        />

        <View style={styles.footer}>
          <Text style={styles.footerText} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.settings.locationPrivacy}
          </Text>
          <Text style={styles.footerText} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.settings.footer}
          </Text>
        </View>
      </ScrollView>

      <MoreSheet
        visible={picker === 'distance'}
        title={t.settings.distance.sheetTitle}
        onClose={() => setPicker(null)}
        rows={DISTANCE_OPTIONS.map((km) => ({
          key: String(km),
          label: distanceLabel(km),
          selected: km === maxDistanceKm,
          accessibilityRole: 'radio',
          onPress: () => pickDistance(km),
        }))}
      />
      <MoreSheet
        visible={picker === 'interval'}
        title={t.settings.beerCountReminder.intervalTitle}
        onClose={() => setPicker(null)}
        rows={BEER_COUNT_REMINDER_INTERVAL_OPTIONS.map((minutes) => ({
          key: String(minutes),
          label: t.settings.beerCountReminder.intervalShort(minutes),
          accessibilityLabel: t.settings.beerCountReminder.intervalOption(minutes),
          selected: minutes === beerCountReminderIntervalMinutes,
          accessibilityRole: 'radio',
          onPress: () => pickInterval(minutes),
        }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  nav: {
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: Colors.foam,
  },
  navSpacer: {
    width: 44,
  },
  content: {
    paddingHorizontal: PAGE_PAD,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  childRow: {
    paddingLeft: Spacing.md,
  },
  segmentRow: {
    minHeight: 60,
    paddingVertical: Spacing.sm + 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  segmentTitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 16,
    fontWeight: '500',
    color: Colors.foam,
  },
  segmentTrack: {
    flexDirection: 'row',
    padding: 2,
    gap: 2,
    borderRadius: 9,
    backgroundColor: Colors.stout3,
  },
  segmentOption: {
    minWidth: 72,
    height: 32,
    paddingHorizontal: Spacing.sm,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentOptionSelected: {
    backgroundColor: withAlpha(Colors.foam, 0.14),
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.mutedText,
  },
  segmentLabelSelected: {
    fontWeight: '600',
    color: Colors.foam,
  },
  note: {
    paddingBottom: Spacing.sm,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  footer: {
    marginTop: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  footerText: {
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
    textAlign: 'center',
  },
});
