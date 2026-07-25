import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  type MapPressEvent,
  type Region,
} from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { PubFilterSheet } from '@/components/compass/PubFilterSheet';
import { ReportPubModal } from '@/components/compass/ReportPubModal';
import {
  BeerIcon,
  ChevronRightIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FlagIcon,
  ListFilterIcon,
  LocateFixedIcon,
  MapPinnedIcon,
  RefreshCwIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { CardSheen, CardSurface } from '@/components/shared/CardSurface';
import { ExploreSwitch } from '@/components/shared/ExploreSwitch';
import { GlowButton } from '@/components/shared/GlowButton';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import type { Pub } from '@/data/pubs';
import { enqueuePubReport } from '@/data/pubReportQueue';
import type { PubReportReason } from '@/data/pubReportsClient';
import { usePubStore } from '@/stores/pubStore';
import { fetchPubHours, type PubHoursResult } from '@/data/hoursClient';
import {
  EMPTY_PUB_SEARCH_FILTERS,
  activePubSearchFilterCount,
  type PubSearchFilters,
} from '@/data/pubSearchFilters';
import type { FocusedPub } from '@/stores/focusedPubStore';
import { useFocusedPubStore } from '@/stores/focusedPubStore';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { useReduceMotion } from '@/utils/useReduceMotion';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAccountStore } from '@/stores/accountStore';
import { openPubInMaps } from '@/utils/maps';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import {
  buildMapPubPoints,
  clusterCoordinates,
  type LivePubSummary,
  type MapPubPoint,
  type VisitedCitySummary,
} from './mapModel';
import { useBeerMap } from './useBeerMap';

const DEFAULT_REGION: Region = {
  latitude: 49.8175,
  longitude: 15.473,
  latitudeDelta: 4.7,
  longitudeDelta: 4.2,
};

const PUB_DETAIL_LOADING_TIMEOUT_MS = 3_000;
const SHEET_DISMISS_MS = 260;

type Layer = 'all' | 'visited' | 'friends';
type MapSelection =
  | { kind: 'pub'; key: string; accountId: string | null }
  | { kind: 'live'; key: string; accountId: string | null }
  | { kind: 'city'; key: string; accountId: string | null };

let rememberedRegion: Region | null = null;
let rememberedLayer: Layer = 'all';
let rememberedSelection: MapSelection | null = null;

export interface BeerMapScreenProps {
  initialPub?: Pub | null;
  filters: PubSearchFilters;
  onApplyFilters: (filters: PubSearchFilters) => void;
  onShowCompass: () => void;
}

function friendName(live: LivePubSummary): string {
  const first = live.activities[0]?.account;
  return first?.displayName?.trim() || first?.nickname?.trim() || cs.map.friendFallback;
}

function formatRating(value: number): string {
  return value.toLocaleString('cs-CZ', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: 1,
  });
}

function localTimeFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const tIndex = iso.indexOf('T');
  if (tIndex === -1) return null;
  const hhmm = iso.slice(tIndex + 1, tIndex + 6);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

type MetaTone = 'open' | 'closed' | 'unknown' | 'neutral';

function openingMeta(
  pub: Pub,
  status: Pub['hoursStatus'] | 'loading' | undefined,
): { text: string; tone: MetaTone } {
  if ((status === 'loading' || status === 'pending') && pub.isOpenNow == null) {
    return { text: cs.compass.detailsLoading, tone: 'neutral' };
  }

  const time = localTimeFromIso(pub.nextChange);
  if (pub.isOpenNow === true) {
    return {
      text: time ? cs.compass.openUntil(time) : cs.compass.openNow,
      tone: 'open',
    };
  }
  if (pub.isOpenNow === false) {
    return {
      text: time ? cs.compass.closedUntil(time) : cs.compass.closedNow,
      tone: 'closed',
    };
  }
  // 'unknown' still earns the dot: the line is about opening hours either way,
  // and the compass card draws it the same. 'neutral' is for lines that are not
  // hours at all (the viewport summary, a city, a friend).
  return { text: cs.compass.hoursUnknown, tone: 'unknown' };
}

function metaToneColor(tone: MetaTone): string {
  if (tone === 'open') return Colors.open;
  if (tone === 'closed') return Colors.closed;
  return Colors.mutedText;
}

/** Only an hours line gets the status dot. */
function showsStatusDot(tone: MetaTone): boolean {
  return tone !== 'neutral';
}

interface PlaceCardProps {
  /**
   * The loud line: the pub's name when one is selected, otherwise what the
   * viewport is showing. There is no separate section title — the layer switch
   * in the footer already names the mode, and "Parta teď" printed directly above
   * a highlighted "Parta teď" segment was the same word twice.
   */
  title: string;
  /** Opening hours, with the status dot. Null when the card is not about a pub. */
  meta: string | null;
  metaTone: MetaTone;
  /** The quiet line under it (city, rating, "navštíveno"), or null. */
  fact: string | null;
  titlePress?: {
    onPress: () => void;
    accessibilityLabel: string;
  };
  door?: {
    label: string;
    onPress: () => void;
    accessibilityLabel: string;
  };
  /** The layer switch, rendered as the card's own footer. */
  layers: React.ReactNode;
}

function PlaceCard({
  title,
  meta,
  metaTone,
  fact,
  titlePress,
  door,
  layers,
}: PlaceCardProps) {
  const titleContent = (
    <>
      {/* Two lines, and the whole row to itself: "Charles Bridge Restau…" was the
          name losing a fight with a door it had no reason to share a row with. */}
      <Text
        style={styles.placeTitle}
        numberOfLines={2}
        maxFontSizeMultiplier={FontScaleCap.heading}
      >
        {title}
      </Text>
      {titlePress ? <ExternalLinkIcon size={15} color={Colors.amber} /> : null}
    </>
  );

  return (
    <View style={styles.placeCard}>
      <CardSheen />

      <View style={styles.placeHeadRow}>
        {titlePress ? (
          <Pressable
            onPress={titlePress.onPress}
            hitSlop={12}
            style={({ pressed }) => [styles.placeTitleRow, pressed && styles.pressedSoft]}
            accessibilityRole="button"
            accessibilityLabel={titlePress.accessibilityLabel}
          >
            {titleContent}
          </Pressable>
        ) : (
          <View style={styles.placeTitleRow}>{titleContent}</View>
        )}

        {door ? (
          <Pressable
            onPress={door.onPress}
            hitSlop={8}
            style={({ pressed }) => [styles.placeDoor, pressed && styles.pressedSoft]}
            accessibilityRole="button"
            accessibilityLabel={door.accessibilityLabel}
          >
            <Text
              style={styles.placeDoorLabel}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {door.label}
            </Text>
            <ChevronRightIcon size={15} color={Colors.amber} />
          </Pressable>
        ) : null}
      </View>

      {meta ? (
        <View style={styles.placeMetaRow}>
          {showsStatusDot(metaTone) ? (
            <View style={[styles.placeDot, { backgroundColor: metaToneColor(metaTone) }]} />
          ) : null}
          <Text
            style={[styles.placeMeta, { color: metaToneColor(metaTone) }]}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {meta}
          </Text>
        </View>
      ) : null}

      {fact ? (
        <Text
          style={styles.placeFact}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {fact}
        </Text>
      ) : null}

      <View style={styles.placeLayers}>{layers}</View>
    </View>
  );
}

/**
 * Which slice of the map you are looking at, as a control instead of a caption.
 *
 * It used to be three rows inside the "…" sheet, and the card only printed the
 * name of the active one — so the map's main mode switch was two taps deep and
 * looked like a label. Same segmented track as the Kompas/Mapa switch: neutral
 * foam, never a second amber surface.
 */
function LayerSwitch({
  layer,
  liveCount,
  onSelect,
}: {
  layer: Layer;
  liveCount: number;
  onSelect: (next: Layer) => void;
}) {
  const segments: { key: Layer; label: string; badge?: number }[] = [
    { key: 'all', label: cs.map.layerAll },
    { key: 'visited', label: cs.map.layerVisited },
    { key: 'friends', label: cs.map.layerFriends, badge: liveCount },
  ];

  return (
    <View style={styles.layerTrack} accessibilityRole="tablist">
      {segments.map((segment) => {
        const active = segment.key === layer;
        return (
          <Pressable
            key={segment.key}
            onPress={() => onSelect(segment.key)}
            disabled={active}
            style={({ pressed }) => [
              styles.layerSegment,
              active && styles.layerSegmentActive,
              pressed && styles.pressedSoft,
            ]}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled: active }}
            accessibilityLabel={segment.label}
          >
            <Text
              style={[styles.layerLabel, active && styles.layerLabelActive]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.85}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {segment.label}
            </Text>
            {segment.badge ? (
              <Text
                style={[styles.layerBadge, active && styles.layerLabelActive]}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {segment.badge > 9 ? '9+' : segment.badge}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function pubWithDetails(pub: Pub, details: PubHoursResult | undefined): Pub {
  if (!details) return pub;
  return {
    ...pub,
    openingHours: details.openingHours,
    isOpenNow: details.isOpenNow,
    nextChange: details.nextChange,
    hoursStatus: details.status,
    ...(details.source ? { hoursSource: details.source } : {}),
    communityHours: details.communityHours ?? undefined,
    beers: details.beers,
    historicalBeers: details.historicalBeers,
    beersUpdatedAt: details.beersUpdatedAt,
    rating: details.rating,
    ratingCount: details.ratingCount,
    ratingLabel: details.ratingLabel,
    hasGarden: details.hasGarden,
    venueKind: details.venueKind,
  };
}

function PubMarker({ visited, selected }: { visited: boolean; selected: boolean }) {
  return (
    <View style={[styles.pinHit, selected && styles.pinHitSelected]}>
      <View style={[styles.pubPin, visited && styles.pubPinVisited, selected && styles.pubPinSelected]}>
        <BeerIcon size={selected ? 18 : 15} color={visited ? Colors.stout : Colors.foam} />
      </View>
      {visited ? <View style={styles.visitedNotch} /> : null}
    </View>
  );
}

function clusterTier(count: number): { size: number; fontSize: number } {
  if (count >= 30) return { size: 52, fontSize: 16 };
  if (count >= 10) return { size: 42, fontSize: 14 };
  return { size: 34, fontSize: 13 };
}

function ClusterMarker({ count, visited }: { count: number; visited: boolean }) {
  const { size, fontSize } = clusterTier(count);
  return (
    <View style={styles.clusterHit}>
      <View
        style={[
          styles.clusterPin,
          { minWidth: size, height: size, borderRadius: size / 2 },
          visited && styles.clusterPinVisited,
        ]}
      >
        <Text
          style={[
            styles.clusterText,
            { fontSize },
            visited && styles.clusterTextVisited,
          ]}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {count}
        </Text>
      </View>
    </View>
  );
}

function LiveMarker({ live, selected }: { live: LivePubSummary; selected: boolean }) {
  const account = live.activities[0]?.account;
  const avatarUrl = account?.avatarUrl;
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const showAvatar = Boolean(avatarUrl && avatarUrl !== failedAvatarUrl);

  return (
    <View style={styles.liveMarkerHit}>
      <View style={[styles.livePin, selected && styles.livePinSelected]}>
        {showAvatar && avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={styles.liveAvatar}
            onError={() => setFailedAvatarUrl(avatarUrl)}
            accessibilityIgnoresInvertColors
            testID="live-map-avatar"
          />
        ) : (
          <Text
            style={styles.liveInitial}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {friendName(live).charAt(0).toLocaleUpperCase('cs-CZ')}
          </Text>
        )}
      </View>
      <View style={styles.liveCount}>
        <Text
          style={styles.liveCountText}
          maxFontSizeMultiplier={FontScaleCap.display}
        >
          {live.activities.length}
        </Text>
      </View>
    </View>
  );
}

export default function BeerMapScreen({
  initialPub,
  filters,
  onApplyFilters,
  onShowCompass,
}: BeerMapScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const mapColorScheme = colorScheme === 'dark' ? 'dark' : 'light';
  const mapRef = useRef<MapView>(null);
  const reduceMotion = useReduceMotion();
  const hapticEnabled = useSettingsStore((state) => state.hapticEnabled);
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const {
    pubs,
    nearbyPrices,
    visitedPubs,
    visitedCities,
    livePubs,
    position,
    permissionState,
    loadingPubs,
    stale,
    requestPermission,
    loadRegion,
    refresh,
  } = useBeerMap(filters);
  const activeFilterCount = activePubSearchFilterCount(filters);
  const initialRegion = useMemo<Region>(
    () =>
      rememberedRegion ?? (initialPub
        ? {
            latitude: initialPub.lat,
            longitude: initialPub.lng,
            latitudeDelta: 0.035,
            longitudeDelta: 0.035,
          }
        : DEFAULT_REGION),
    [initialPub],
  );
  const [region, setRegion] = useState<Region>(initialRegion);
  const [layer, setLayer] = useState<Layer>(rememberedLayer);
  const [selection, setSelection] = useState<MapSelection | null>(rememberedSelection);
  const [detailOpen, setDetailOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [detailsByPubKey, setDetailsByPubKey] = useState<Record<string, PubHoursResult>>({});
  const [loadingDetailKey, setLoadingDetailKey] = useState<string | null>(null);
  const [timedOutDetailKey, setTimedOutDetailKey] = useState<string | null>(null);
  const didAutoLocate = useRef(Boolean(initialPub || rememberedRegion));
  const sheetActionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (sheetActionTimer.current) clearTimeout(sheetActionTimer.current);
    },
    [],
  );

  useEffect(() => {
    loadRegion(initialRegion);
  }, [initialRegion, loadRegion]);

  useEffect(() => {
    if (!position || didAutoLocate.current) return;
    didAutoLocate.current = true;
    const next: Region = {
      latitude: position.lat,
      longitude: position.lng,
      latitudeDelta: 0.055,
      longitudeDelta: 0.055,
    };
    mapRef.current?.animateToRegion(next, reduceMotion ? 0 : 420);
    setRegion(next);
    rememberedRegion = next;
    loadRegion(next);
  }, [loadRegion, position, reduceMotion]);

  const points = useMemo(
    () => buildMapPubPoints(
      pubs,
      visitedPubs,
      layer === 'visited',
      false,
      activeFilterCount === 0,
    ).points,
    [activeFilterCount, layer, pubs, visitedPubs],
  );

  const activeSelection =
    selection && selection.accountId && accountId && selection.accountId !== accountId
      ? null
      : selection;
  const selectedPub = useMemo(
    () =>
      activeSelection?.kind === 'pub'
        ? points.find((point) => point.key === activeSelection.key) ?? null
        : null,
    [activeSelection, points],
  );
  const selectedLive = useMemo(
    () =>
      activeSelection?.kind === 'live'
        ? livePubs.find((live) => live.cacheKey === activeSelection.key) ?? null
        : null,
    [activeSelection, livePubs],
  );
  const selectedCity = useMemo(
    () =>
      activeSelection?.kind === 'city'
        ? visitedCities.find((city) => city.key === activeSelection.key) ?? null
        : null,
    [activeSelection, visitedCities],
  );
  const selectedPubForLookup = selectedPub?.pub ?? null;

  useEffect(() => {
    if (!selectedPub || !selectedPubForLookup) return;
    const key = selectedPub.key;
    const controller = new AbortController();
    const loadingTimeout = setTimeout(() => {
      setTimedOutDetailKey(key);
      setLoadingDetailKey((current) => current === key ? null : current);
    }, PUB_DETAIL_LOADING_TIMEOUT_MS);
    void fetchPubHours([selectedPubForLookup], controller.signal)
      .then((result) => {
        const details = result.get(selectedPubForLookup.id);
        if (!controller.signal.aborted && details) {
          setDetailsByPubKey((current) => ({ ...current, [key]: details }));
        }
        if (!details || details.status !== 'pending') clearTimeout(loadingTimeout);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingDetailKey((current) => current === key ? null : current);
        }
      });
    return () => {
      clearTimeout(loadingTimeout);
      controller.abort();
    };
  }, [selectedPub, selectedPubForLookup]);

  const selectedDetailPub = selectedPub
    ? pubWithDetails(selectedPub.pub, detailsByPubKey[selectedPub.key])
    : null;
  const rawSelectedHoursStatus =
    selectedPub && loadingDetailKey === selectedPub.key && !selectedDetailPub?.hoursStatus
      ? 'loading'
      : selectedDetailPub?.hoursStatus;
  const selectedHoursStatus =
    selectedPub &&
    timedOutDetailKey === selectedPub.key &&
    (rawSelectedHoursStatus === 'loading' || rawSelectedHoursStatus === 'pending')
      ? 'unknown'
      : rawSelectedHoursStatus;
  const selectedRating =
    typeof selectedDetailPub?.rating === 'number' && Number.isFinite(selectedDetailPub.rating)
      ? formatRating(selectedDetailPub.rating)
      : null;
  const selectedRatingCount =
    typeof selectedDetailPub?.ratingCount === 'number' && selectedDetailPub.ratingCount > 0
      ? selectedDetailPub.ratingCount.toLocaleString('cs-CZ')
      : null;
  const selectedRatingLine = selectedRating
    ? selectedRatingCount
      ? `${selectedRating} (${selectedRatingCount})`
      : selectedRating
    : null;

  const visiblePoints = useMemo(() => {
    const latMargin = region.latitudeDelta * 0.65;
    const lngMargin = region.longitudeDelta * 0.65;
    return points.filter(
      (point) =>
        Math.abs(point.lat - region.latitude) <= latMargin &&
        Math.abs(point.lng - region.longitude) <= lngMargin,
    ).sort((a, b) => {
      const aDistance =
        (a.lat - region.latitude) ** 2 + (a.lng - region.longitude) ** 2;
      const bDistance =
        (b.lat - region.latitude) ** 2 + (b.lng - region.longitude) ** 2;
      return aDistance - bDistance;
    });
  }, [points, region]);

  const visibleLivePubs = useMemo(() => {
    const latMargin = region.latitudeDelta * 0.65;
    const lngMargin = region.longitudeDelta * 0.65;
    return livePubs
      .filter(
        (live) =>
          Math.abs(live.lat - region.latitude) <= latMargin &&
          Math.abs(live.lng - region.longitude) <= lngMargin,
      )
      .sort((a, b) => {
        const aDistance =
          (a.lat - region.latitude) ** 2 + (a.lng - region.longitude) ** 2;
        const bDistance =
          (b.lat - region.latitude) ** 2 + (b.lng - region.longitude) ** 2;
        return aDistance - bDistance;
      });
  }, [livePubs, region]);

  const showCities = region.latitudeDelta > 0.85 && visitedCities.length > 0;
  const clusters = useMemo(() => {
    if (showCities || layer === 'friends') return [];
    // Cluster only the viewport-filtered points — clustering the full
    // accumulated catalogue (up to 600) and discarding offscreen clusters
    // afterwards wastes work on every pan.
    return clusterCoordinates(visiblePoints, region);
  }, [layer, region, showCities, visiblePoints]);

  const handleRegionChange = useCallback(
    (next: Region) => {
      setRegion(next);
      rememberedRegion = next;
      loadRegion(next);
    },
    [loadRegion],
  );

  const clearSelection = useCallback(() => {
    rememberedSelection = null;
    setSelection(null);
  }, []);

  // Report from the map detail — same semantics as the compass: hide locally by
  // both signals (id + geohash cell, via the persisted pubStore arrays that
  // useBeerMap filters against), then queue the durable report.
  const addReportedPub = usePubStore((s) => s.addReportedPub);
  const reportSelectedPub = (reason: PubReportReason) => {
    if (!selectedPub) return;
    const pub = selectedDetailPub ?? selectedPub.pub;
    addReportedPub(pub.id, selectedPub.key);
    setDetailOpen(false);
    clearSelection();
    void enqueuePubReport(pub, reason);
  };

  const openSelectedPubReport = useCallback(() => {
    if (selectedPub) setReportOpen(true);
  }, [selectedPub]);

  const addPubNearSelection = useCallback(() => {
    if (!selectedPub) return;
    router.push({
      pathname: '/add-pub' as never,
      params: { lat: String(selectedPub.pub.lat), lng: String(selectedPub.pub.lng) },
    });
  }, [router, selectedPub]);

  const renameSelectedPub = useCallback(() => setDetailOpen(true), []);

  const handleMapPress = useCallback(
    (event: MapPressEvent) => {
      if (event.nativeEvent.action !== 'marker-press') clearSelection();
    },
    [clearSelection],
  );

  const selectPub = useCallback(
    (point: MapPubPoint) => {
      if (hapticEnabled) fireLightImpactHaptic();
      const next: MapSelection = { kind: 'pub', key: point.key, accountId };
      rememberedSelection = next;
      setTimedOutDetailKey((current) => current === point.key ? current : null);
      setLoadingDetailKey(point.key);
      setSelection(next);
      void AccessibilityInfo.announceForAccessibility(point.pub.name);
      mapRef.current?.animateCamera(
        {
          center: {
            latitude: point.lat,
            longitude: point.lng,
          },
        },
        { duration: reduceMotion ? 0 : 220 },
      );
    },
    [accountId, hapticEnabled, reduceMotion],
  );

  const selectLive = useCallback(
    (live: LivePubSummary) => {
      if (hapticEnabled) fireLightImpactHaptic();
      const next: MapSelection = { kind: 'live', key: live.cacheKey, accountId };
      rememberedSelection = next;
      setSelection(next);
      void AccessibilityInfo.announceForAccessibility(
        cs.a11y.mapLive(friendName(live), live.name),
      );
      mapRef.current?.animateCamera(
        {
          center: {
            latitude: live.lat,
            longitude: live.lng,
          },
        },
        { duration: reduceMotion ? 0 : 220 },
      );
    },
    [accountId, hapticEnabled, reduceMotion],
  );

  const selectLayer = useCallback((next: Layer) => {
    rememberedLayer = next;
    rememberedSelection = null;
    setLayer(next);
    setSelection(null);
  }, []);

  const aimCompass = useCallback(
    (target: FocusedPub) => {
      useFocusedPubStore.getState().setFocusedPub(target);
      onShowCompass();
    },
    [onShowCompass],
  );

  const locate = useCallback(() => {
    if (!position) {
      void requestPermission();
      return;
    }
    const next = {
      latitude: position.lat,
      longitude: position.lng,
      // Recentring must not silently change the zoom. Cluster membership follows
      // the zoom level, so forcing a new delta here made unchanged pub markers
      // regroup whenever the user tapped the location button.
      latitudeDelta: region.latitudeDelta,
      longitudeDelta: region.longitudeDelta,
    };
    mapRef.current?.animateToRegion(next, reduceMotion ? 0 : 360);
    handleRegionChange(next);
  }, [
    handleRegionChange,
    position,
    reduceMotion,
    region.latitudeDelta,
    region.longitudeDelta,
    requestPermission,
  ]);

  const openCluster = useCallback(
    (lat: number, lng: number) => {
      const next = {
        latitude: lat,
        longitude: lng,
        latitudeDelta: Math.max(region.latitudeDelta * 0.42, 0.018),
        longitudeDelta: Math.max(region.longitudeDelta * 0.42, 0.018),
      };
      mapRef.current?.animateToRegion(next, reduceMotion ? 0 : 340);
      handleRegionChange(next);
    },
    [handleRegionChange, reduceMotion, region.latitudeDelta, region.longitudeDelta],
  );

  const focusCity = useCallback(
    (city: VisitedCitySummary) => {
      const next = {
        latitude: city.lat,
        longitude: city.lng,
        latitudeDelta: 0.22,
        longitudeDelta: 0.22,
      };
      clearSelection();
      mapRef.current?.animateToRegion(next, reduceMotion ? 0 : 360);
      handleRegionChange(next);
    },
    [clearSelection, handleRegionChange, reduceMotion],
  );

  // Two parts, not one sentence: the count is the card's loud line and the rest
  // is the quiet line under it.
  const visitedInView = visiblePoints.filter((point) => point.visit).length;
  const viewportHeadline =
    layer === 'friends'
      ? cs.map.liveShort(visibleLivePubs.length)
      : cs.map.viewportPubs(visiblePoints.length);
  const viewportDetail =
    layer === 'friends' || visitedInView === 0 ? null : cs.map.viewportKnown(visitedInView);

  const cardState = useMemo(() => {
    if (selectedPub) {
      const hours = openingMeta(selectedDetailPub ?? selectedPub.pub, selectedHoursStatus);
      return {
        kind: 'pub' as const,
        title: selectedPub.pub.name,
        // Hours alone on the loud line, with the status dot. Everything else is
        // the quiet line under it — the old single sentence truncated the hours
        // first, which is the one thing worth reading here.
        meta: hours.text,
        metaTone: hours.tone,
        // City, rating, and "been here" — but never "Tady ještě nemáš čárku":
        // an absent tally is already what the pin says, and as a second stacked
        // sentence under the hours it just made the card noisy.
        fact:
          [
            selectedPub.pub.city,
            selectedRatingLine,
            selectedPub.visit ? cs.map.visited : null,
          ]
            .filter(Boolean)
            .join(' · ') || null,
      };
    }
    if (selectedLive) {
      return {
        kind: 'live' as const,
        title: selectedLive.name,
        meta: null,
        metaTone: 'neutral' as const,
        fact:
          selectedLive.activities.length === 1
            ? cs.map.friendIsHere(friendName(selectedLive))
            : cs.map.friendsAreHere(
                friendName(selectedLive),
                selectedLive.activities.length - 1,
              ),
      };
    }
    if (selectedCity) {
      return {
        kind: 'city' as const,
        title: selectedCity.name,
        meta: null,
        metaTone: 'neutral' as const,
        fact: cs.map.citySummary(selectedCity.visitCount, selectedCity.pubCount),
      };
    }
    // Nothing selected: what the viewport holds is the whole message. The layer
    // switch below says which slice it is, so there is no title above it.
    return {
      kind: 'idle' as const,
      title: viewportHeadline,
      meta: null,
      metaTone: 'neutral' as const,
      fact: viewportDetail,
    };
  }, [
    selectedCity,
    selectedDetailPub,
    selectedHoursStatus,
    selectedLive,
    selectedPub,
    selectedRatingLine,
    viewportDetail,
    viewportHeadline,
  ]);

  const nudge = useMemo<Nudge | null>(() => {
    if (stale) {
      return {
        kind: 'counted',
        text: cs.map.offline,
        undoLabel: cs.map.retry,
        onUndo: refresh,
      };
    }
    if (activeFilterCount > 0) {
      return {
        kind: 'rapid',
        text: cs.compass.nudgeFilters(activeFilterCount),
        confirmLabel: cs.compass.nudgeFiltersClear,
        onConfirm: () => onApplyFilters(EMPTY_PUB_SEARCH_FILTERS),
      };
    }
    if (loadingPubs) {
      return {
        kind: 'dopito',
        label: cs.map.loading,
        onPress: () => undefined,
      };
    }
    if (region.latitudeDelta > 1.5 && layer !== 'friends') {
      return {
        kind: 'dopito',
        label: cs.map.zoomForPubs,
        onPress: () => undefined,
      };
    }
    // Without the big "Najdi mě · potřebuju tvoji polohu" button, the permission
    // ask needs a home. The strip offers it and the glyph fires it.
    if (permissionState !== 'granted') {
      return { kind: 'dopito', label: cs.map.permissionHint, onPress: locate };
    }
    return null;
  }, [
    activeFilterCount,
    layer,
    loadingPubs,
    locate,
    onApplyFilters,
    permissionState,
    refresh,
    region.latitudeDelta,
    stale,
  ]);

  const primaryAction = useMemo(() => {
    if (cardState.kind === 'pub' && selectedPub) {
      return {
        label: cs.map.aimCompass,
        subLabel: null as string | null,
        accessibilityLabel: cs.map.aimCompass,
        onPress: () =>
          aimCompass({
            lat: selectedPub.pub.lat,
            lng: selectedPub.pub.lng,
            name: selectedPub.pub.name,
            cacheKey: selectedPub.key,
          }),
      };
    }
    if (cardState.kind === 'live' && selectedLive) {
      return {
        label: cs.map.aimCompass,
        subLabel: null as string | null,
        accessibilityLabel: cs.map.aimCompass,
        onPress: () =>
          aimCompass({
            lat: selectedLive.lat,
            lng: selectedLive.lng,
            name: selectedLive.name,
            cacheKey: selectedLive.cacheKey,
          }),
      };
    }
    if (cardState.kind === 'city' && selectedCity) {
      return {
        label: cs.map.showMyPubs,
        subLabel: null as string | null,
        accessibilityLabel: cs.map.showMyPubs,
        onPress: () => focusCity(selectedCity),
      };
    }
    // Nothing selected, nothing to promise: locating yourself is the glyph in the
    // header now, and the map gets the bottom of the screen back. The object is
    // still returned so the value stays non-nullable — the render below gates on
    // `cardState.kind`, because branching on this object itself makes the React
    // Compiler rules treat its ref-capturing closures as a ref read in render.
    return {
      label: cs.map.findMe,
      subLabel: null as string | null,
      accessibilityLabel: cs.a11y.mapLocate,
      onPress: locate,
    };
  }, [aimCompass, cardState.kind, focusCity, locate, selectedCity, selectedLive, selectedPub]);

  const runAfterMoreClose = useCallback((action: () => void) => {
    setMoreOpen(false);
    if (sheetActionTimer.current) clearTimeout(sheetActionTimer.current);
    sheetActionTimer.current = setTimeout(() => {
      sheetActionTimer.current = null;
      action();
    }, SHEET_DISMISS_MS);
  }, []);

  const moreRows = useMemo<MoreRow[]>(() => {
    const rows: MoreRow[] = [
      {
        key: 'filters',
        label: cs.compass.moreFilters,
        value:
          activeFilterCount > 0
            ? cs.compass.moreFiltersActive(activeFilterCount)
            : null,
        icon: ListFilterIcon,
        onPress: () => runAfterMoreClose(() => setFilterSheetOpen(true)),
      },
      {
        key: 'refresh',
        label: cs.map.refresh,
        icon: RefreshCwIcon,
        onPress: () => {
          setMoreOpen(false);
          refresh();
        },
        accessibilityLabel: cs.a11y.mapRefresh,
      },
    ];
    return selectedPub
      ? [
          ...rows,
          {
            key: 'report',
            label: cs.compass.moreReport,
            icon: FlagIcon,
            onPress: () => runAfterMoreClose(openSelectedPubReport),
            accessibilityLabel: cs.a11y.mapReportClosed(selectedPub.pub.name),
          },
        ]
      : rows;
  }, [
    activeFilterCount,
    openSelectedPubReport,
    refresh,
    runAfterMoreClose,
    selectedPub,
  ]);

  return (
    <View style={styles.root}>
      <MapView
        key={mapColorScheme}
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        onRegionChangeComplete={handleRegionChange}
        onPress={handleMapPress}
        mapType="standard"
        userInterfaceStyle={mapColorScheme}
        showsUserLocation={permissionState === 'granted'}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        loadingBackgroundColor={mapColorScheme === 'dark' ? Colors.stout : Colors.foam}
        loadingIndicatorColor={Colors.amber}
        accessibilityLabel={cs.a11y.beerMap}
      >
        {showCities && layer !== 'friends'
          ? visitedCities.map((city) => (
              <Marker
                key={`city:${city.key}`}
                stopPropagation
                coordinate={{ latitude: city.lat, longitude: city.lng }}
                onPress={() => {
                  const next: MapSelection = { kind: 'city', key: city.key, accountId };
                  rememberedSelection = next;
                  setSelection(next);
                  void AccessibilityInfo.announceForAccessibility(
                    cs.a11y.mapCity(city.name, city.visitCount),
                  );
                }}
                accessibilityLabel={cs.a11y.mapCity(city.name, city.visitCount)}
              >
                <View style={styles.cityMarker}>
                  <MapPinnedIcon size={17} color={Colors.stout} />
                  <Text
                    style={styles.cityMarkerText}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.heading}
                  >
                    {city.name}
                  </Text>
                  <Text
                    style={styles.cityMarkerCount}
                    maxFontSizeMultiplier={FontScaleCap.display}
                  >
                    {city.visitCount}
                  </Text>
                </View>
              </Marker>
            ))
          : null}

        {clusters.map((cluster) => {
          if (cluster.items.length === 1) {
            const point = cluster.items[0];
            const selected = selectedPub?.key === point.key;
            return (
              <Marker
                key={`${point.key}:${point.visit?.visitCount ?? 0}:${selected ? 'selected' : 'idle'}`}
                stopPropagation
                coordinate={{ latitude: point.lat, longitude: point.lng }}
                onPress={() => selectPub(point)}
                tracksViewChanges={false}
                accessibilityLabel={cs.a11y.mapPub(
                  point.pub.name,
                  point.visit?.visitCount ?? 0,
                )}
              >
                <PubMarker visited={Boolean(point.visit)} selected={selected} />
              </Marker>
            );
          }
          return (
            <Marker
              key={`cluster:${cluster.id}:${cluster.items.length}`}
              stopPropagation
              coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
              onPress={() => openCluster(cluster.lat, cluster.lng)}
              tracksViewChanges={false}
              accessibilityLabel={cs.a11y.mapCluster(cluster.items.length)}
            >
              <ClusterMarker
                count={cluster.items.length}
                visited={cluster.items.some((item) => item.visit != null)}
              />
            </Marker>
          );
        })}

        {layer !== 'visited' ? livePubs.map((live) => (
          <Marker
            key={`live:${live.cacheKey}:${selectedLive?.cacheKey === live.cacheKey ? 'selected' : 'idle'}`}
            stopPropagation
            coordinate={{ latitude: live.lat, longitude: live.lng }}
            onPress={() => selectLive(live)}
            zIndex={10}
            accessibilityLabel={cs.a11y.mapLive(friendName(live), live.name)}
          >
            <LiveMarker live={live} selected={selectedLive?.cacheKey === live.cacheKey} />
          </Marker>
        )) : null}
      </MapView>

      <View
        style={[styles.topStack, { paddingTop: insets.top + 8 }]}
        pointerEvents="box-none"
      >
        <View style={styles.header}>
          <ExploreSwitch
            activeView="map"
            onSelectCompass={onShowCompass}
            onSelectMap={() => undefined}
          />
          <View style={styles.headerSpacer} />
          {/* Centring the map on yourself is the classic map glyph, not an 84pt
              amber promise. It used to be the screen's primary button, which
              spent the whole bottom of the map on the least interesting verb. */}
          <Pressable
            onPress={locate}
            style={({ pressed }) => [styles.mapGlyphButton, pressed && styles.pressedSoft]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.mapLocate}
          >
            <LocateFixedIcon size={19} color={Colors.amber} />
          </Pressable>
          <Pressable
            onPress={() => setMoreOpen(true)}
            style={({ pressed }) => [
              styles.moreButton,
              pressed && styles.pressedSoft,
            ]}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={cs.a11y.compassMore}
          >
            <EllipsisIcon size={20} color={Colors.foamMuted} />
          </Pressable>
        </View>
        <View style={styles.nudgeWrap}>
          <NudgeSlot nudge={nudge} />
        </View>
      </View>

      <View
        style={[
          styles.bottomStack,
          { paddingBottom: Math.max(insets.bottom, Spacing.sm) },
        ]}
        pointerEvents="box-none"
      >
        <PlaceCard
          title={cardState.title}
          meta={cardState.meta}
          metaTone={cardState.metaTone}
          fact={cardState.fact}
          titlePress={
            cardState.kind === 'pub' && selectedPub
              ? {
                  onPress: () =>
                    void openPubInMaps(selectedDetailPub ?? selectedPub.pub),
                  accessibilityLabel: cs.a11y.pubPillRevealed(
                    selectedPub.pub.name,
                  ),
                }
              : undefined
          }
          door={
            cardState.kind === 'pub'
              ? {
                  label: cs.compass.mapPubLink,
                  onPress: () => setDetailOpen(true),
                  accessibilityLabel: cs.compass.mapPubLink,
                }
              : cardState.kind === 'idle'
                ? {
                    label: cs.map.listLink,
                    onPress: () => setListOpen(true),
                    accessibilityLabel: cs.a11y.mapList,
                  }
                : undefined
          }
          layers={
            <LayerSwitch
              layer={layer}
              liveCount={visibleLivePubs.length}
              onSelect={selectLayer}
            />
          }
        />
        {/* Only a selection earns a button. */}
        {cardState.kind !== 'idle' ? (
          <GlowButton
            label={primaryAction.label}
            subLabel={primaryAction.subLabel}
            onPress={primaryAction.onPress}
            variant="primary"
            glow="soft"
            height={62}
            accessibilityLabel={primaryAction.accessibilityLabel}
          />
        ) : null}
      </View>

      <Modal
        visible={listOpen}
        transparent
        statusBarTranslucent
        presentationStyle="overFullScreen"
        animationType="fade"
        onRequestClose={() => setListOpen(false)}
      >
        <View style={styles.listBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setListOpen(false)}
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          <View
            style={[styles.listCardWrap, { marginBottom: -insets.bottom }]}
          >
            <Pressable
              style={[
                styles.listCard,
                { paddingBottom: insets.bottom + Spacing.lg },
              ]}
              onPress={() => undefined}
            >
              <View style={styles.listGrabber} />
              <View style={styles.listHeader}>
                <Text
                  style={styles.listTitle}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {layer === 'friends' ? cs.map.layerFriends : cs.map.listTitle}
                </Text>
                <Pressable
                  onPress={() => setListOpen(false)}
                  style={({ pressed }) => [
                    styles.closeButton,
                    pressed && styles.pressedSoft,
                  ]}
                  accessibilityLabel={cs.map.closeList}
                  accessibilityRole="button"
                >
                  <XIcon size={20} color={Colors.foamMuted} />
                </Pressable>
              </View>
              {layer === 'friends' ? (
                <FlatList
                  style={styles.list}
                  data={visibleLivePubs}
                  keyExtractor={(item) => item.cacheKey}
                  contentContainerStyle={styles.listContent}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item, index }) => (
                    <Pressable
                      onPress={() => {
                        setListOpen(false);
                        selectLive(item);
                        const next = {
                          latitude: item.lat,
                          longitude: item.lng,
                          latitudeDelta: 0.025,
                          longitudeDelta: 0.025,
                        };
                        mapRef.current?.animateToRegion(
                          next,
                          reduceMotion ? 0 : 300,
                        );
                        handleRegionChange(next);
                      }}
                      style={({ pressed }) => [
                        styles.listRow,
                        index > 0 && styles.listRowDivider,
                        pressed && styles.pressedSoft,
                      ]}
                      accessibilityLabel={cs.a11y.mapLive(
                        friendName(item),
                        item.name,
                      )}
                      accessibilityRole="button"
                    >
                      <View style={styles.listRowCopy}>
                        <Text
                          style={styles.listRowTitle}
                          numberOfLines={1}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {item.name}
                        </Text>
                        <Text
                          style={styles.listRowMeta}
                          numberOfLines={1}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {cs.map.friendIsHere(friendName(item))}
                        </Text>
                      </View>
                      <ChevronRightIcon size={18} color={Colors.mutedText} />
                    </Pressable>
                  )}
                  ListEmptyComponent={
                    <Text
                      style={styles.emptyList}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {cs.map.emptyList}
                    </Text>
                  }
                />
              ) : (
                <FlatList
                  style={styles.list}
                  data={visiblePoints}
                  keyExtractor={(item) => item.key}
                  contentContainerStyle={styles.listContent}
                  showsVerticalScrollIndicator={false}
                  renderItem={({ item, index }) => (
                    <Pressable
                      onPress={() => {
                        setListOpen(false);
                        selectPub(item);
                        const next = {
                          latitude: item.lat,
                          longitude: item.lng,
                          latitudeDelta: 0.025,
                          longitudeDelta: 0.025,
                        };
                        mapRef.current?.animateToRegion(
                          next,
                          reduceMotion ? 0 : 300,
                        );
                        handleRegionChange(next);
                      }}
                      style={({ pressed }) => [
                        styles.listRow,
                        index > 0 && styles.listRowDivider,
                        pressed && styles.pressedSoft,
                      ]}
                      accessibilityLabel={cs.a11y.mapPub(
                        item.pub.name,
                        item.visit?.visitCount ?? 0,
                      )}
                      accessibilityRole="button"
                    >
                      <View style={styles.listRowCopy}>
                        <Text
                          style={styles.listRowTitle}
                          numberOfLines={1}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {item.pub.name}
                        </Text>
                        <Text
                          style={styles.listRowMeta}
                          numberOfLines={1}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {item.pub.city ||
                            (item.visit ? cs.map.visited : cs.map.notVisited)}
                        </Text>
                      </View>
                      <ChevronRightIcon size={18} color={Colors.mutedText} />
                    </Pressable>
                  )}
                  ListEmptyComponent={
                    <Text
                      style={styles.emptyList}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {cs.map.emptyList}
                    </Text>
                  }
                />
              )}
            </Pressable>
          </View>
        </View>
      </Modal>

      <MoreSheet
        visible={moreOpen}
        rows={moreRows}
        onClose={() => setMoreOpen(false)}
      />

      {filterSheetOpen ? (
        <PubFilterSheet
          visible
          value={filters}
          nearbyPrices={nearbyPrices}
          onClose={() => setFilterSheetOpen(false)}
          onApply={onApplyFilters}
        />
      ) : null}

      {selectedPub ? (
        <MapPubSheet
          visible={detailOpen}
          pubKey={selectedPub.key}
          pubName={selectedPub.pub.name}
          info={pubInfoFromPub(selectedDetailPub ?? selectedPub.pub)}
          hoursLabel={cardState.kind === 'pub' ? cardState.meta : null}
          hoursTone={
            cardState.metaTone === 'open' || cardState.metaTone === 'closed'
              ? cardState.metaTone
              : 'unknown'
          }
          onClose={() => setDetailOpen(false)}
          onReport={() => {
            setDetailOpen(false);
            setTimeout(() => setReportOpen(true), 250);
          }}
        />
      ) : null}

      {selectedPub ? (
        <ReportPubModal
          visible={reportOpen}
          pubName={selectedPub.pub.name}
          onClose={() => setReportOpen(false)}
          onAddPub={addPubNearSelection}
          onRename={renameSelectedPub}
          onReportReason={reportSelectedPub}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  pressedSoft: { opacity: 0.6 },

  topStack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  header: {
    minHeight: 44,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSpacer: {
    flex: 1,
    minWidth: Spacing.sm,
  },
  // The only place in the app where the overflow glyph needs a surface under
  // it: everywhere else it sits on stout, here it floats over a light map and
  // a bare muted glyph simply disappears into the streets. Same dark pill as
  // the Kompas/Mapa switch beside it, so the header reads as one row.
  // Round glyph target that has to stay legible over the map, so unlike the
  // header buttons on the tácek screens it carries its own surface.
  mapGlyphButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.16),
    marginRight: Spacing.sm,
    ...softDrop(),
  },
  moreButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.86),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.12),
  },
  nudgeWrap: {
    paddingHorizontal: 24,
  },

  pinHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pinHitSelected: { transform: [{ scale: 1.12 }] },
  pubPin: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout3, 0.96),
    borderWidth: 1.5,
    borderColor: withAlpha(Colors.foamMuted, 0.7),
  },
  pubPinVisited: { backgroundColor: Colors.amber, borderColor: Colors.stout, borderWidth: 3 },
  pubPinSelected: { width: 38, height: 38, borderRadius: 19, borderColor: Colors.foam },
  visitedNotch: {
    position: 'absolute',
    bottom: 2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.foam,
    borderWidth: 1,
    borderColor: Colors.stout,
  },
  clusterHit: {
    minWidth: HitArea.min,
    minHeight: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clusterPin: {
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout2, 0.92),
    borderWidth: 1.5,
    borderColor: withAlpha(Colors.foamMuted, 0.55),
  },
  clusterPinVisited: { borderColor: Colors.amber, borderWidth: 2.5 },
  clusterText: {
    fontFamily: Fonts.display.extrabold,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  clusterTextVisited: { color: Colors.amberLight },
  liveMarkerHit: {
    width: 57,
    height: 57,
    alignItems: 'center',
    justifyContent: 'center',
  },
  livePin: {
    width: 45,
    height: 45,
    borderRadius: 23,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    borderWidth: 3,
    borderColor: Colors.foam,
  },
  livePinSelected: { transform: [{ scale: 1.14 }], borderColor: Colors.neon },
  liveAvatar: { width: '100%', height: '100%' },
  liveInitial: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 19,
    color: Colors.stout,
    includeFontPadding: false,
  },
  liveCount: {
    position: 'absolute',
    right: 0,
    top: 0,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    backgroundColor: Colors.foam,
    borderWidth: 2,
    borderColor: Colors.stout,
    alignItems: 'center',
    justifyContent: 'center',
  },
  liveCountText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    color: Colors.stout,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  cityMarker: {
    maxWidth: 190,
    minHeight: 44,
    paddingHorizontal: 11,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: Colors.amber,
    borderWidth: 2,
    borderColor: Colors.foam,
  },
  cityMarkerText: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 15,
    color: Colors.stout,
    includeFontPadding: false,
  },
  cityMarkerCount: {
    fontFamily: Fonts.ui.bold,
    fontSize: 12,
    color: withAlpha(Colors.stout, 0.72),
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },

  bottomStack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 24,
    gap: 12,
  },
  // Same surface as every hero card, only shorter and floating over the map.
  // `minHeight`, not `height`: with the biggest system font the rows grow instead
  // of getting shaved off, and the stack is anchored to the bottom anyway.
  placeCard: {
    ...CardSurface.card,
    paddingTop: 16,
    paddingBottom: 10,
  },
  placeHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
  },
  placeTitleRow: {
    flexShrink: 1,
    minWidth: 0,
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  placeTitle: {
    flexShrink: 1,
    minWidth: 0,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  placeMetaRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // The one dot allowed to be decoration-shaped, because it carries real state.
  placeDot: {
    width: 6,
    height: 6,
    borderRadius: Radius.pill,
  },
  placeMeta: {
    flex: 1,
    minWidth: 0,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  placeFact: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  placeLayers: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  placeDoor: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  placeDoorLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },

  // — Layer switch (§2.2: neutral track, never a second amber surface) —
  layerTrack: {
    height: 38,
    padding: 3,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.04),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.08),
  },
  layerSegment: {
    flex: 1,
    minWidth: 0,
    height: 30,
    borderRadius: Radius.pill,
    paddingHorizontal: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  layerSegmentActive: {
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  layerLabel: {
    flexShrink: 1,
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  layerLabelActive: {
    color: Colors.foam,
  },
  layerBadge: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 12,
    color: Colors.amber,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },

  listBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: withAlpha(Colors.black, 0.6),
  },
  listCardWrap: {
    width: '100%',
    minHeight: '56%',
    maxHeight: '92%',
  },
  listCard: {
    flex: 1,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    ...softDrop(),
  },
  listGrabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    marginBottom: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  listTitle: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    includeFontPadding: false,
  },
  closeButton: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    flex: 1,
    marginTop: Spacing.sm,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  listRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.sm,
  },
  listRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  listRowCopy: { flex: 1, minWidth: 0 },
  listRowTitle: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  listRowMeta: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  emptyList: {
    paddingVertical: 40,
    textAlign: 'center',
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
});
