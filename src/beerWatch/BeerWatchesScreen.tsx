/**
 * Hlídaná piva — pushed route `/profile/beer-watches`: how far to watch, the
 * watched beers with a remove button, and why a push might not come.
 */

import { useCallback, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';

import { ChevronLeftIcon, XIcon } from '@/components/shared/IconGlyph';
import { BEER_WATCH_RADII } from '@/data/beerWatchClient';
import HairlineRow from '@/friends/HairlineRow';
import SectionHeader from '@/friends/SectionHeader';
import { t } from '@/i18n';
import BoardSegmented from '@/leaderboards/BoardSegmented';
import { notificationsAllowed } from '@/notifications/beerWatchPush';
import { useBeerWatchStore } from '@/stores/beerWatchStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';

import { syncBeerWatchLocation } from './beerWatchLocation';

const RADIUS_LABELS = BEER_WATCH_RADII.map((m) => t.beerWatch.radiusOption(m / 1000));
const RADIUS_TEST_IDS = BEER_WATCH_RADII.map((m) => `beer-watch-radius-${m}`);

export default function BeerWatchesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);
  const watches = useBeerWatchStore((s) => s.watches);
  const radiusM = useBeerWatchStore((s) => s.radiusM);
  const loaded = useBeerWatchStore((s) => s.loaded);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notificationsOff, setNotificationsOff] = useState(false);
  const [locationOff, setLocationOff] = useState(false);

  const load = useCallback(async () => {
    const ok = await useBeerWatchStore.getState().refresh();
    setLoadFailed(!ok);
    if (ok) void syncBeerWatchLocation();
  }, []);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void load();
      void Promise.all([
        notificationsAllowed(),
        Location.getForegroundPermissionsAsync().then(
          (p) => p.status === Location.PermissionStatus.GRANTED,
          () => false,
        ),
      ]).then(([notifications, location]) => {
        if (!alive) return;
        setNotificationsOff(!notifications);
        setLocationOff(!location);
      });
      return () => {
        alive = false;
      };
    }, [load]),
  );

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/profile' as Href);
  }, [router]);

  const changeRadius = useCallback(
    (index: number) => {
      const next = BEER_WATCH_RADII[index];
      if (next === undefined || next === useBeerWatchStore.getState().radiusM) return;
      void useBeerWatchStore
        .getState()
        .setRadius(next)
        .then((ok) => {
          if (!ok) showToast(t.beerWatch.radiusFailed);
        });
    },
    [showToast],
  );

  const remove = useCallback(
    (productKey: string) => {
      void useBeerWatchStore
        .getState()
        .unwatch(productKey)
        .then((ok) => showToast(ok ? t.beerWatch.unwatchedToast : t.beerWatch.failedToast));
    },
    [showToast],
  );

  const radiusIndex = Math.max(0, BEER_WATCH_RADII.findIndex((m) => m === radiusM));
  const hints = watches.length > 0
    ? [notificationsOff ? t.beerWatch.notificationsOff : null, locationOff ? t.beerWatch.locationOff : null].filter(
        (hint): hint is string => hint !== null,
      )
    : [];

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.header}>
        <Pressable
          onPress={goBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t.beerWatch.backA11y}
          style={({ pressed }) => [styles.headerBtn, pressed && styles.pressed]}
        >
          <ChevronLeftIcon size={26} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.beerWatch.title}
        </Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom + 18, 32) }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />}
        showsVerticalScrollIndicator={false}
      >
        {loadFailed && !loaded ? (
          <View style={styles.section}>
            <Text style={styles.bodyText} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.beerWatch.loadFailed}
            </Text>
            <Pressable
              onPress={() => void load()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.beerWatch.retry}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Text style={styles.linkText} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.beerWatch.retry}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {hints.length > 0 ? (
          <View style={styles.section}>
            {hints.map((hint) => (
              <Text key={hint} style={styles.bodyText} maxFontSizeMultiplier={FontScaleCap.body}>
                {hint}
              </Text>
            ))}
            <Pressable
              onPress={() => void Linking.openSettings()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.beerWatch.openSettings}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
            >
              <Text style={styles.linkText} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.beerWatch.openSettings}
              </Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.section}>
          <SectionHeader label={t.beerWatch.radiusHeader} />
          <BoardSegmented
            options={RADIUS_LABELS}
            value={radiusIndex}
            onChange={changeRadius}
            accessibilityLabel={t.beerWatch.radiusA11y}
            optionTestIDs={RADIUS_TEST_IDS}
          />
        </View>

        <View style={styles.section}>
          <SectionHeader label={t.beerWatch.listHeader} />
          {watches.length > 0 ? (
            watches.map((watch, i) => (
              <HairlineRow key={watch.productKey} first={i === 0}>
                <View style={styles.row} testID={`beer-watch-row-${watch.productKey}`}>
                  <Text style={styles.rowTitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
                    {watch.name}
                  </Text>
                  <Pressable
                    testID={`beer-watch-remove-${watch.productKey}`}
                    onPress={() => remove(watch.productKey)}
                    style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={t.beerWatch.unwatchA11y(watch.name)}
                  >
                    <XIcon size={18} color={Colors.mutedText} />
                  </Pressable>
                </View>
              </HairlineRow>
            ))
          ) : loaded ? (
            <Text style={styles.bodyText} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.beerWatch.empty}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  headerBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
  },
  pressed: {
    opacity: 0.65,
  },
  content: {
    paddingTop: Spacing.sm,
  },
  section: {
    marginTop: Spacing.xl,
    gap: Spacing.xs,
  },
  bodyText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 19,
    color: Colors.mutedText,
  },
  link: {
    minHeight: HitArea.min,
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  linkText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.amber,
  },
  row: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowTitle: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.ui.semibold,
    fontSize: 16,
    color: Colors.foam,
  },
  removeBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
