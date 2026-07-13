import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import MapView, { Marker, type MapPressEvent, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { OpenStatusChip } from '@/components/compass/OpenStatusChip';
import { PubFilterSheet } from '@/components/compass/PubFilterSheet';
import {
  BeerIcon,
  ChevronRightIcon,
  CompassIcon,
  ExternalLinkIcon,
  ListIcon,
  LocateFixedIcon,
  ListFilterIcon,
  MapPinnedIcon,
  RefreshCwIcon,
  StarIcon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { ExploreSwitch } from '@/components/shared/ExploreSwitch';
import type { Pub } from '@/data/pubs';
import { fetchPubHours, type PubHoursResult } from '@/data/hoursClient';
import {
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
import { HitArea, Radius } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import {
  buildMapPubPoints,
  clusterCoordinates,
  pubOpeningVerdict,
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

const DARK_MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#25170C' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#C9B38F' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1F1308' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#5A3A20' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#2B1A0E' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#49301C' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#24160B' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#101A1B' }] },
] as const;

type Layer = 'all' | 'visited' | 'friends';
type MapSelection =
  | { kind: 'pub'; key: string; accountId: string | null }
  | { kind: 'live'; key: string; accountId: string | null }
  | { kind: 'city'; key: string; accountId: string | null };

let rememberedRegion: Region | null = null;
let rememberedLayer: Layer = 'all';
let rememberedOpenOnly = false;
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

function LayerButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.layerButton,
        active && styles.layerButtonActive,
        pressed && styles.pressed,
      ]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text style={[styles.layerButtonText, active && styles.layerButtonTextActive]}>{label}</Text>
    </Pressable>
  );
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

function ClusterMarker({ count, visited }: { count: number; visited: boolean }) {
  return (
    <View style={[styles.clusterPin, visited && styles.clusterPinVisited]}>
      <Text style={[styles.clusterText, visited && styles.clusterTextVisited]}>{count}</Text>
    </View>
  );
}

function LiveMarker({ live, selected }: { live: LivePubSummary; selected: boolean }) {
  return (
    <View style={[styles.livePin, selected && styles.livePinSelected]}>
      <Text style={styles.liveInitial}>{friendName(live).charAt(0).toLocaleUpperCase('cs-CZ')}</Text>
      <View style={styles.liveCount}>
        <Text style={styles.liveCountText}>{live.activities.length}</Text>
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
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const reduceMotion = useReduceMotion();
  const hapticEnabled = useSettingsStore((state) => state.hapticEnabled);
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const {
    pubs,
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
  const [openOnly, setOpenOnly] = useState(rememberedOpenOnly);
  const [selection, setSelection] = useState<MapSelection | null>(rememberedSelection);
  const [detailOpen, setDetailOpen] = useState(false);
  const [filterSheetOpen, setFilterSheetOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [detailsByPubKey, setDetailsByPubKey] = useState<Record<string, PubHoursResult>>({});
  const [loadingDetailKey, setLoadingDetailKey] = useState<string | null>(null);
  const didAutoLocate = useRef(Boolean(initialPub || rememberedRegion));

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

  const unfilteredPoints = useMemo(
    () => buildMapPubPoints(
      pubs,
      visitedPubs,
      layer === 'visited',
      false,
      activeFilterCount === 0,
    ).points,
    [activeFilterCount, layer, pubs, visitedPubs],
  );
  const points = useMemo(
    () => openOnly
      ? unfilteredPoints.filter((point) => pubOpeningVerdict(point.pub) !== false)
      : unfilteredPoints,
    [openOnly, unfilteredPoints],
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
    void fetchPubHours([selectedPubForLookup], controller.signal)
      .then((result) => {
        const details = result.get(selectedPubForLookup.id);
        if (!controller.signal.aborted && details) {
          setDetailsByPubKey((current) => ({ ...current, [key]: details }));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingDetailKey((current) => current === key ? null : current);
        }
      });
    return () => controller.abort();
  }, [selectedPub, selectedPubForLookup]);

  const selectedDetailPub = selectedPub
    ? pubWithDetails(selectedPub.pub, detailsByPubKey[selectedPub.key])
    : null;
  const selectedHoursStatus =
    selectedPub && loadingDetailKey === selectedPub.key && !selectedDetailPub?.hoursStatus
      ? 'loading'
      : selectedDetailPub?.hoursStatus;
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
      ? `${selectedRating} · ${selectedRatingCount}`
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

  const visibleUnfilteredPoints = useMemo(() => {
    const latMargin = region.latitudeDelta * 0.65;
    const lngMargin = region.longitudeDelta * 0.65;
    return unfilteredPoints.filter(
      (point) =>
        Math.abs(point.lat - region.latitude) <= latMargin &&
        Math.abs(point.lng - region.longitude) <= lngMargin,
    );
  }, [region, unfilteredPoints]);
  const visibleKnownClosedCount = visibleUnfilteredPoints.filter(
    (point) => pubOpeningVerdict(point.pub) === false,
  ).length;
  const visibleUnknownHoursCount = visibleUnfilteredPoints.filter(
    (point) => pubOpeningVerdict(point.pub) == null,
  ).length;

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
    const latMargin = region.latitudeDelta * 0.75;
    const lngMargin = region.longitudeDelta * 0.75;
    return clusterCoordinates(points, region).filter(
      (cluster) =>
        Math.abs(cluster.lat - region.latitude) <= latMargin &&
        Math.abs(cluster.lng - region.longitude) <= lngMargin,
    );
  }, [layer, points, region, showCities]);

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
      setLoadingDetailKey(point.key);
      setSelection(next);
      void AccessibilityInfo.announceForAccessibility(point.pub.name);
      mapRef.current?.animateCamera(
        { center: { latitude: point.lat - region.latitudeDelta * 0.16, longitude: point.lng } },
        { duration: reduceMotion ? 0 : 220 },
      );
    },
    [accountId, hapticEnabled, reduceMotion, region.latitudeDelta],
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
        { center: { latitude: live.lat - region.latitudeDelta * 0.16, longitude: live.lng } },
        { duration: reduceMotion ? 0 : 220 },
      );
    },
    [accountId, hapticEnabled, reduceMotion, region.latitudeDelta],
  );

  const selectLayer = useCallback((next: Layer) => {
    rememberedLayer = next;
    rememberedSelection = null;
    setLayer(next);
    setSelection(null);
  }, []);

  const toggleOpenOnly = useCallback(() => {
    setOpenOnly((value) => {
      const next = !value;
      rememberedOpenOnly = next;
      void AccessibilityInfo.announceForAccessibility(
        next
          ? cs.map.openFilterAnnouncement(
              visibleKnownClosedCount,
              visibleUnknownHoursCount,
            )
          : cs.map.openFilterOff,
      );
      return next;
    });
  }, [visibleKnownClosedCount, visibleUnknownHoursCount]);

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
      latitudeDelta: 0.04,
      longitudeDelta: 0.04,
    };
    mapRef.current?.animateToRegion(next, reduceMotion ? 0 : 360);
    handleRegionChange(next);
  }, [handleRegionChange, position, reduceMotion, requestPermission]);

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

  const layerDescription =
    region.latitudeDelta > 1.5 && layer !== 'friends'
      ? cs.map.zoomForPubs
      : layer === 'friends'
      ? cs.map.liveCount(visibleLivePubs.length)
      : cs.map.nearbyCount(visiblePoints.length, visiblePoints.filter((point) => point.visit).length);

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={initialRegion}
        onRegionChangeComplete={handleRegionChange}
        onPress={handleMapPress}
        mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'}
        customMapStyle={DARK_MAP_STYLE as unknown as []}
        userInterfaceStyle="dark"
        showsUserLocation={permissionState === 'granted'}
        showsMyLocationButton={false}
        showsCompass={false}
        showsPointsOfInterests={false}
        toolbarEnabled={false}
        loadingBackgroundColor={Colors.stout}
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
                  <Text style={styles.cityMarkerText} numberOfLines={1}>{city.name}</Text>
                  <Text style={styles.cityMarkerCount}>{city.visitCount}</Text>
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

      <View style={[styles.topChrome, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        <ExploreSwitch
          activeView="map"
          onSelectCompass={onShowCompass}
          onSelectMap={() => undefined}
        />
        <Pressable
          onPress={() => setFilterSheetOpen(true)}
          style={({ pressed }) => [
            styles.topFilterButton,
            { top: insets.top + 8 },
            activeFilterCount > 0 && styles.topFilterButtonActive,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            activeFilterCount > 0
              ? cs.a11y.pubFiltersActive(activeFilterCount)
              : cs.a11y.openPubFilters
          }
        >
          <ListFilterIcon
            size={19}
            color={activeFilterCount > 0 ? Colors.stout : Colors.foam}
          />
          {activeFilterCount > 0 ? (
            <View style={styles.topFilterCount}>
              <Text style={styles.topFilterCountText}>{activeFilterCount}</Text>
            </View>
          ) : null}
        </Pressable>
        <View style={styles.layerControls}>
          <View style={styles.layerRow} accessibilityRole="tablist">
            <LayerButton active={layer === 'all'} label={cs.map.layerAll} onPress={() => selectLayer('all')} />
            <LayerButton
              active={layer === 'visited'}
              label={cs.map.layerVisited}
              onPress={() => selectLayer('visited')}
            />
            <LayerButton
              active={layer === 'friends'}
              label={cs.map.layerFriends}
              onPress={() => selectLayer('friends')}
            />
          </View>
          {layer !== 'friends' ? (
            <Pressable
              onPress={toggleOpenOnly}
              style={({ pressed }) => [styles.openFilter, pressed && styles.pressed]}
              accessibilityRole="switch"
              accessibilityState={{ checked: openOnly }}
              accessibilityLabel={cs.map.onlyOpen}
              accessibilityHint={
                openOnly
                  ? cs.map.openFilterSummary(
                      visibleKnownClosedCount,
                      visibleUnknownHoursCount,
                    )
                  : cs.map.openFilterHint
              }
            >
              <Text style={[styles.openFilterLabel, openOnly && styles.openFilterLabelActive]}>
                {cs.map.onlyOpen}
              </Text>
              <View style={[styles.switchTrack, openOnly && styles.switchTrackActive]}>
                <View style={[styles.switchThumb, openOnly && styles.switchThumbActive]} />
              </View>
            </Pressable>
          ) : null}
        </View>
      </View>

      {!selectedPub && !selectedLive && !selectedCity ? <View style={styles.mapRail}>
        <Pressable
          onPress={locate}
          style={({ pressed }) => [styles.railButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.mapLocate}
        >
          <LocateFixedIcon size={20} color={position ? Colors.amber : Colors.foamMuted} />
        </Pressable>
        <Pressable
          onPress={() => setListOpen(true)}
          style={({ pressed }) => [styles.railButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.mapList}
        >
          <ListIcon size={20} color={Colors.foamMuted} />
        </Pressable>
        <Pressable
          onPress={refresh}
          style={({ pressed }) => [styles.railButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.mapRefresh}
        >
          <RefreshCwIcon size={19} color={loadingPubs ? Colors.amber : Colors.foamMuted} />
        </Pressable>
      </View> : null}

      <View
        style={[
          styles.bottomDock,
          selectedPub && styles.bottomDockSelected,
          {
            paddingBottom:
              selectedPub || selectedLive || selectedCity ? Math.max(insets.bottom, 12) : 12,
          },
        ]}
      >
        {stale ? <Text style={styles.offlineText} numberOfLines={2}>{cs.map.offline}</Text> : null}

        {selectedCity ? (
          <ScrollView style={styles.dockScroll} contentContainerStyle={styles.dockContent} showsVerticalScrollIndicator={false}>
            <Text style={styles.dockTitle} maxFontSizeMultiplier={FontScaleCap.heading}>{selectedCity.name}</Text>
            <Text style={styles.dockBody} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.map.citySummary(selectedCity.visitCount, selectedCity.pubCount)}
            </Text>
            <Pressable
              onPress={() => focusCity(selectedCity)}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText} maxFontSizeMultiplier={FontScaleCap.heading}>{cs.map.showMyPubs}</Text>
            </Pressable>
          </ScrollView>
        ) : selectedLive ? (
          <ScrollView style={styles.dockScroll} contentContainerStyle={styles.dockContent} showsVerticalScrollIndicator={false}>
            <View style={styles.liveEyebrow}>
              <View style={styles.liveDot} />
              <Text style={styles.liveEyebrowText}>{cs.map.liveNow}</Text>
            </View>
            <Text style={styles.dockTitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>{selectedLive.name}</Text>
            <Text style={styles.dockBody} maxFontSizeMultiplier={FontScaleCap.body}>
              {selectedLive.activities.length === 1
                ? cs.map.friendIsHere(friendName(selectedLive))
                : cs.map.friendsAreHere(friendName(selectedLive), selectedLive.activities.length - 1)}
            </Text>
            <Pressable
              onPress={() =>
                aimCompass({
                  lat: selectedLive.lat,
                  lng: selectedLive.lng,
                  name: selectedLive.name,
                  cacheKey: selectedLive.cacheKey,
                })
              }
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
              accessibilityRole="button"
            >
              <CompassIcon size={18} color={Colors.stout} />
              <Text style={styles.primaryButtonText} maxFontSizeMultiplier={FontScaleCap.heading}>{cs.map.aimCompass}</Text>
            </Pressable>
          </ScrollView>
        ) : selectedPub ? (
          <ScrollView
            style={styles.dockScroll}
            contentContainerStyle={styles.selectedPubContent}
            showsVerticalScrollIndicator={false}
          >
            <Pressable
              onPress={() => void openPubInMaps(selectedDetailPub ?? selectedPub.pub)}
              style={({ pressed }) => [styles.selectedPubTapArea, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.pubPillRevealed(selectedPub.pub.name)}
            >
              <View style={styles.selectedPubNameRow}>
                <BeerIcon size={18} color={Colors.amber} />
                <Text
                  style={styles.selectedPubName}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {selectedPub.pub.name}
                </Text>
                <ExternalLinkIcon size={16} color={Colors.amber} />
              </View>
              <View style={styles.selectedPubMetaRow}>
                <View style={styles.selectedPubStatus}>
                  <OpenStatusChip
                    isOpenNow={selectedDetailPub?.isOpenNow ?? null}
                    status={selectedHoursStatus}
                    nextChange={selectedDetailPub?.nextChange}
                  />
                </View>
                {selectedRatingLine ? (
                  <View
                    style={styles.selectedPubRating}
                    accessibilityLabel={cs.a11y.pubRating(
                      selectedRating ?? '',
                      selectedRatingCount ?? undefined,
                    )}
                  >
                    <StarIcon size={13} color={Colors.amber} />
                    <Text style={styles.selectedPubRatingText} numberOfLines={1}>
                      {selectedRatingLine}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>

            <View style={styles.selectedPubFooter}>
              <Pressable
                onPress={() =>
                  aimCompass({
                    lat: selectedPub.pub.lat,
                    lng: selectedPub.pub.lng,
                    name: selectedPub.pub.name,
                    cacheKey: selectedPub.key,
                  })
                }
                style={({ pressed }) => [
                  styles.selectedPubAction,
                  styles.selectedPubActionPrimary,
                  pressed && styles.selectedPubActionPressed,
                ]}
                accessibilityRole="button"
              >
                <View style={styles.selectedPubPrimaryIcon}>
                  <CompassIcon size={18} color={Colors.stout} />
                </View>
                <Text
                  style={styles.selectedPubActionTextPrimary}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.map.aimCompass}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setDetailOpen(true)}
                style={({ pressed }) => [
                  styles.selectedPubAction,
                  styles.selectedPubActionSecondary,
                  pressed && styles.selectedPubActionPressed,
                ]}
                accessibilityLabel={cs.map.pubDetail}
                accessibilityRole="button"
              >
                <MapPinnedIcon size={15} color={Colors.foamMuted} />
                <Text
                  style={styles.selectedPubActionText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.78}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.map.pubDetail}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        ) : (
          <ScrollView style={styles.dockScroll} contentContainerStyle={styles.dockContent} showsVerticalScrollIndicator={false}>
            <View style={styles.overviewRow}>
              <View style={styles.overviewIcon}>
                {layer === 'friends' ? (
                  <UsersIcon size={22} color={Colors.amber} />
                ) : (
                  <BeerIcon size={22} color={Colors.amber} />
                )}
              </View>
              <View style={styles.overviewCopy}>
                <Text style={styles.dockTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {layer === 'friends' ? cs.map.friendsOverviewTitle : cs.map.beerTrail}
                </Text>
                <Text style={styles.dockBody} maxFontSizeMultiplier={FontScaleCap.body}>{layerDescription}</Text>
                {openOnly && layer !== 'friends' ? (
                  <Text style={styles.filterFeedback} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.map.openFilterSummary(
                      visibleKnownClosedCount,
                      visibleUnknownHoursCount,
                    )}
                  </Text>
                ) : null}
              </View>
            </View>
            {permissionState !== 'granted' ? (
              <Pressable
                onPress={() => void requestPermission()}
                style={({ pressed }) => [styles.permissionButton, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <LocateFixedIcon size={16} color={Colors.amber} />
                <Text style={styles.permissionButtonText} maxFontSizeMultiplier={FontScaleCap.body}>{cs.map.permissionHint}</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        )}
      </View>

      <Modal
        visible={listOpen}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setListOpen(false)}
      >
        <View style={styles.listBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setListOpen(false)}
            accessibilityLabel={cs.map.closeList}
            accessibilityRole="button"
          />
          <View style={[styles.listSheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
            <View style={styles.sheetHandle} />
            <View style={styles.listHeader}>
              <View style={styles.listHeaderCopy}>
                <Text style={styles.listTitle}>{cs.map.listTitle}</Text>
                <Text style={styles.listSubtitle} numberOfLines={2}>{layerDescription}</Text>
              </View>
              <Pressable
                onPress={() => setListOpen(false)}
                style={styles.closeButton}
                accessibilityLabel={cs.common.cancel}
                accessibilityRole="button"
              >
                <XIcon size={21} color={Colors.foam} />
              </Pressable>
            </View>
            {layer === 'friends' ? (
              <FlatList
                style={styles.list}
                data={visibleLivePubs}
                keyExtractor={(item) => item.cacheKey}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
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
                    mapRef.current?.animateToRegion(next, reduceMotion ? 0 : 300);
                    handleRegionChange(next);
                  }}
                  style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
                  accessibilityLabel={cs.a11y.mapLive(friendName(item), item.name)}
                  accessibilityRole="button"
                >
                  <LiveMarker live={item} selected={false} />
                  <View style={styles.listRowCopy}>
                    <Text style={styles.listRowTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={styles.listRowMeta} numberOfLines={1}>
                      {cs.map.friendIsHere(friendName(item))}
                    </Text>
                  </View>
                  <ChevronRightIcon size={18} color={Colors.mutedText} />
                </Pressable>
                )}
                ListEmptyComponent={<Text style={styles.emptyList}>{cs.map.emptyList}</Text>}
              />
            ) : (
              <FlatList
                style={styles.list}
                data={visiblePoints}
                keyExtractor={(item) => item.key}
                contentContainerStyle={styles.listContent}
                renderItem={({ item }) => (
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
                    mapRef.current?.animateToRegion(next, reduceMotion ? 0 : 300);
                    handleRegionChange(next);
                  }}
                  style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}
                  accessibilityLabel={cs.a11y.mapPub(item.pub.name, item.visit?.visitCount ?? 0)}
                  accessibilityRole="button"
                >
                  <PubMarker visited={Boolean(item.visit)} selected={false} />
                  <View style={styles.listRowCopy}>
                    <Text style={styles.listRowTitle} numberOfLines={1}>{item.pub.name}</Text>
                    <Text style={styles.listRowMeta} numberOfLines={1}>
                      {item.pub.city || (item.visit ? cs.map.visited : cs.map.notVisited)}
                    </Text>
                  </View>
                  <ChevronRightIcon size={18} color={Colors.mutedText} />
                </Pressable>
                )}
                ListEmptyComponent={<Text style={styles.emptyList}>{cs.map.emptyList}</Text>}
              />
            )}
          </View>
        </View>
      </Modal>

      {filterSheetOpen ? (
        <PubFilterSheet
          visible
          value={filters}
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
          onClose={() => setDetailOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] },
  topChrome: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', gap: 9 },
  topFilterButton: {
    position: 'absolute',
    right: 12,
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.16),
  },
  topFilterButtonActive: { backgroundColor: Colors.amber, borderColor: Colors.amber },
  topFilterCount: {
    position: 'absolute',
    right: -3,
    top: -3,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.foam,
    borderWidth: 1,
    borderColor: Colors.stout,
  },
  topFilterCountText: { fontFamily: Fonts.ui.bold, fontSize: 10, color: Colors.stout },
  layerControls: {
    alignSelf: 'stretch',
    marginHorizontal: 12,
    gap: 7,
  },
  layerRow: { flexDirection: 'row', gap: 6 },
  layerButton: {
    flex: 1,
    height: 44,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.stout2, 0.95),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  layerButtonActive: { backgroundColor: Colors.foam, borderColor: Colors.foam },
  layerButtonText: { fontFamily: Fonts.ui.semibold, fontSize: 13, color: Colors.foamMuted },
  layerButtonTextActive: { color: Colors.stout },
  openFilter: {
    alignSelf: 'center',
    minHeight: 40,
    paddingLeft: 14,
    paddingRight: 8,
    flexDirection: 'row',
    gap: 10,
    borderRadius: Radius.pill,
    alignItems: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.2),
  },
  openFilterLabel: { fontFamily: Fonts.ui.semibold, fontSize: 13, color: Colors.foam },
  openFilterLabelActive: { color: Colors.amberLight },
  switchTrack: {
    width: 42,
    height: 24,
    padding: 2,
    borderRadius: 12,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.24),
  },
  switchTrackActive: { backgroundColor: Colors.amber, borderColor: Colors.amber },
  switchThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: Colors.foamMuted,
  },
  switchThumbActive: { transform: [{ translateX: 18 }], backgroundColor: Colors.stout },
  pinHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pinHitSelected: { transform: [{ scale: 1.12 }] },
  pubPin: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
    borderWidth: 2,
    borderColor: Colors.foamMuted,
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
  clusterPin: {
    minWidth: 44,
    height: 44,
    paddingHorizontal: 9,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout2,
    borderWidth: 2,
    borderColor: Colors.foamMuted,
  },
  clusterPinVisited: { borderColor: Colors.amber, borderWidth: 4 },
  clusterText: { fontFamily: Fonts.display.extrabold, fontSize: 15, color: Colors.foam },
  clusterTextVisited: { color: Colors.amberLight },
  livePin: {
    width: 45,
    height: 45,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    borderWidth: 3,
    borderColor: Colors.foam,
  },
  livePinSelected: { transform: [{ scale: 1.14 }], borderColor: Colors.neon },
  liveInitial: { fontFamily: Fonts.display.extrabold, fontSize: 19, color: Colors.stout },
  liveCount: {
    position: 'absolute',
    right: -5,
    top: -5,
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
  liveCountText: { fontFamily: Fonts.ui.bold, fontSize: 10, color: Colors.stout },
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
  cityMarkerText: { flexShrink: 1, fontFamily: Fonts.display.extrabold, fontSize: 15, color: Colors.stout },
  cityMarkerCount: { fontFamily: Fonts.ui.bold, fontSize: 12, color: withAlpha(Colors.stout, 0.72) },
  mapRail: { position: 'absolute', right: 14, top: '42%', gap: 9 },
  railButton: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout2, 0.96),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.16),
  },
  bottomDock: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 8,
    maxHeight: '48%',
    borderRadius: Radius.cardLarge,
    backgroundColor: withAlpha(Colors.stout2, 0.97),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
    shadowColor: Colors.black,
    shadowOpacity: 0.42,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
  },
  bottomDockSelected: {
    borderRadius: Radius.card,
    backgroundColor: Colors.stout2,
    borderColor: Colors.amber,
  },
  dockContent: { paddingHorizontal: 18, paddingTop: 15, paddingBottom: 8, gap: 4 },
  dockScroll: { flexGrow: 0 },
  dockTitle: { fontFamily: Fonts.display.extrabold, fontSize: 25, lineHeight: 29, color: Colors.foam },
  dockBody: { fontFamily: Fonts.ui.regular, fontSize: 14, lineHeight: 20, color: Colors.foamMuted },
  selectedPubContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 4, gap: 8 },
  selectedPubTapArea: { alignSelf: 'stretch', alignItems: 'center', gap: 8 },
  selectedPubNameRow: {
    height: 38,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  selectedPubName: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  selectedPubMetaRow: {
    minHeight: 18,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  selectedPubStatus: { flexShrink: 1, minWidth: 0 },
  selectedPubRating: {
    minHeight: 18,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  selectedPubRatingText: { fontFamily: Fonts.ui.semibold, fontSize: 13, color: Colors.foam },
  selectedPubFooter: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
    paddingTop: 8,
    paddingHorizontal: 4,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.stout, 0.34),
  },
  selectedPubAction: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    paddingHorizontal: 6,
    borderRadius: 11,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  selectedPubActionPrimary: {
    flex: 1.38,
    borderRadius: 12,
    backgroundColor: Colors.amber,
    minHeight: 42,
    position: 'relative',
    shadowColor: Colors.glow,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  selectedPubActionSecondary: {
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.22),
    backgroundColor: withAlpha(Colors.amber, 0.08),
  },
  selectedPubActionPressed: { opacity: 0.78, transform: [{ scale: 0.98 }] },
  selectedPubPrimaryIcon: {
    position: 'absolute',
    left: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  selectedPubActionText: {
    flexShrink: 1,
    fontFamily: Fonts.ui.semibold,
    fontSize: 10.8,
    lineHeight: 13,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  selectedPubActionTextPrimary: {
    width: '100%',
    fontFamily: Fonts.display.extrabold,
    fontSize: 14,
    lineHeight: 17,
    color: Colors.stout,
    textAlign: 'center',
    transform: [{ translateY: 2 }],
  },
  offlineText: {
    position: 'absolute',
    top: -28,
    left: 16,
    right: 16,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.foamMuted,
  },
  liveEyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.success },
  liveEyebrowText: { fontFamily: Fonts.ui.bold, fontSize: 11, letterSpacing: 0.8, color: Colors.success },
  primaryButton: {
    minHeight: 46,
    borderRadius: Radius.pill,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.amber,
    marginTop: 8,
  },
  primaryButtonText: { fontFamily: Fonts.display.extrabold, fontSize: 15, color: Colors.stout },
  secondaryButton: {
    width: 48,
    height: 46,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    marginTop: 8,
  },
  overviewRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  overviewIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
  },
  overviewCopy: { flex: 1, minWidth: 0 },
  filterFeedback: { marginTop: 2, fontFamily: Fonts.ui.medium, fontSize: 12, color: Colors.amberLight },
  permissionButton: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10, minHeight: 34 },
  permissionButtonText: { flex: 1, fontFamily: Fonts.ui.medium, fontSize: 13, color: Colors.foamMuted },
  listBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: withAlpha(Colors.black, 0.58),
  },
  listSheet: {
    maxHeight: '88%',
    flexShrink: 1,
    overflow: 'hidden',
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    backgroundColor: Colors.stout,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  sheetHandle: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    marginTop: 9,
    borderRadius: 2,
    backgroundColor: withAlpha(Colors.foam, 0.28),
  },
  listHeader: {
    minHeight: 74,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  listHeaderCopy: { flex: 1, minWidth: 0, paddingRight: 12 },
  listTitle: { fontFamily: Fonts.display.extrabold, fontSize: 28, color: Colors.foam },
  listSubtitle: { fontFamily: Fonts.ui.regular, fontSize: 13, color: Colors.mutedText },
  closeButton: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { flexGrow: 0, paddingHorizontal: 14, paddingBottom: 10 },
  listRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  listRowCopy: { flex: 1, minWidth: 0 },
  listRowTitle: { fontFamily: Fonts.display.bold, fontSize: 17, color: Colors.foam },
  listRowMeta: { fontFamily: Fonts.ui.regular, fontSize: 13, color: Colors.mutedText },
  emptyList: { padding: 40, textAlign: 'center', fontFamily: Fonts.ui.regular, color: Colors.mutedText },
});
