/**
 * Production Hospody screen, as a Packeta-style branch list.
 *
 * The shape borrowed from Packeta is the LIST, not the palette: a search field
 * pinned at the top, then dense cells that answer the question on the cell
 * itself. You never tap a row to find out whether it is open.
 *
 * The compass is the list's head cell (§17.5) rather than a separate view, so
 * there is one road to "where do I go" instead of two. It is compact on
 * purpose — the compass is now a part of the app, not the whole of it — but it
 * keeps the one thing that made it iconic: a big distance and the pub it is
 * pointing at.
 *
 * Every row carries: distance, open state with the actual hour, the beer people
 * come for, its price and a rating — plus a heart when you have been here
 * before. How many times and when is a detail-screen answer; as a sentence on
 * every row it competed with the facts you actually scan.
 */

import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import {
  ChevronDownIcon,
  LocateFixedIcon,
  ChevronRightIcon,
  HeartIcon,
  MapPinnedIcon,
  SearchIcon,
  StarIcon,
} from '@/components/shared/IconGlyph';
import { GlassIconButton, GlassPill } from '@/components/shared/GlassIconButton';
import {
  fallbackPopularBeerBrands,
  fetchPopularBeerBrands,
  type BeerBrandFilterOption,
} from '@/data/beerSuggestionsClient';
import { geohash8 } from '@/data/geohash';
import { getAllLoadedPubs, hydratePubsSnapshot, type Pub } from '@/data/pubs';
import { useCompass } from '@/hooks/useCompass';
import { MenuChip } from '@/mocks/MenuChip';
import { BeerFilterSheet } from '@/pubs/BeerFilterSheet';
import { CompassCell } from '@/pubs/CompassCell';
import { DETENT_TOP, PEEK_VISIBLE, PlacesSheet, type Detent } from '@/pubs/PlacesSheet';
import { PubCarousel } from '@/pubs/PubCarousel';
import { PubDetailBody } from '@/pubs/PubDetailBody';
import { PubsMap } from '@/pubs/PubsMap';
import {
  buildPubVisitIndex,
  presentPub,
  filterReportedPubs,
  pubMatchesFilters,
  serverFiltersForPubList,
  sortPubs,
  type PubListFilters,
  type PubPresentation,
  type PubSort,
} from '@/pubs/pubPresentation';
import { usePubAmenities } from '@/pubs/usePubAmenities';
import { usePubVisits } from '@/pubs/usePubVisits';
import { usePubStore } from '@/stores/pubStore';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/** The distance stays readable without making the list row taller. */
const THUMB = 56;

/** Height of the swipeable card that stands in for the list at `peek`. */
const CAROUSEL_H = 140;

/**
 * How the list is ordered. "Nejbližší" is the default because standing
 * somewhere and asking "where do I go" is the whole job of this screen;
 * "Vše" was never an answer to anything.
 */
const SORTS = ['Nejbližší', 'Nejlépe hodnocené', 'Náhodně v okolí'] as const;
type Sort = (typeof SORTS)[number];

/** What the head cell's badge says, per sort — it has to explain why THIS pub
 *  is the one the compass points at. */
const BADGE: Record<Sort, string> = {
  'Nejbližší': 'Nejbližší',
  'Nejlépe hodnocené': 'Nejlíp hodnocená',
  'Náhodně v okolí': 'Náhodná',
};

const SORT_KEY: Record<Sort, PubSort> = {
  'Nejbližší': 'nearest',
  'Nejlépe hodnocené': 'rating',
  'Náhodně v okolí': 'random',
};

/**
 * Independent toggles, on top of whatever the sort is. These are real
 * `mapFilterable` amenity keys from `src/data/amenities.ts`
 * (`practical_tank_beer`, `seating_garden`) plus the open-now state — not
 * invented labels.
 */
const TOGGLES = ['Otevřeno', 'Tank', 'Zahrádka'] as const;

function FilterChips({
  sort,
  onSort,
  beerOptions,
  filters,
  onFilters,
}: {
  sort: Sort;
  /** Fires on EVERY pick, including re-picking the current one — that is how
   *  "Náhodně v okolí" reshuffles a second time. */
  onSort: (next: Sort) => void;
  beerOptions: readonly BeerBrandFilterOption[];
  filters: PubListFilters;
  onFilters: (next: PubListFilters) => void;
}) {
  const [beerSheet, setBeerSheet] = React.useState(false);
  const labelByKey = React.useMemo(
    () => new Map(beerOptions.map((option) => [option.key, option.label])),
    [beerOptions],
  );
  const selectedLabels = filters.beers.map((key) => labelByKey.get(key) ?? key);
  const beerLabel =
    filters.beers.length === 0
      ? 'Pivo'
      : filters.beers.length === 1
        ? selectedLabels[0]
        : `Pivo (${filters.beers.length})`;

  const activeToggle = (label: (typeof TOGGLES)[number]) => {
    if (label === 'Otevřeno') return filters.openOnly;
    if (label === 'Tank') return filters.tankOnly;
    return filters.gardenOnly;
  };

  const toggle = (label: (typeof TOGGLES)[number]) => {
    if (label === 'Otevřeno') onFilters({ ...filters, openOnly: !filters.openOnly });
    else if (label === 'Tank') onFilters({ ...filters, tankOnly: !filters.tankOnly });
    else onFilters({ ...filters, gardenOnly: !filters.gardenOnly });
  };

  return (
    <ScrollView
      horizontal
      style={styles.chipsScroller}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipsRow}
      keyboardShouldPersistTaps="handled"
    >
      {/* The sort is a dropdown, not one of the toggles — it answers a
          different question and only ever has one answer at a time. It is now a
          real anchored UIMenu: the earlier note here said this needed
          `react-native-ios-context-menu` and could not link ("cannot link
          directly with 'SwiftUICore'"), which was true of that library and not
          of the problem — `@expo/ui` ships SwiftUI's own Menu and was already in
          the Podfile. */}
      <MenuChip
        value={sort}
        options={SORTS}
        title="Seřadit"
        onChange={(next) => onSort(next as Sort)}
      />

      {/* Beer is an ANY-of multi-select backed by canonical server brand keys. */}
      {beerOptions.length > 0 || filters.beers.length > 0 ? (
        <>
          <Pressable
            onPress={() => setBeerSheet(true)}
            style={({ pressed }) => [
              styles.chip,
              filters.beers.length > 0 && styles.chipActive,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              filters.beers.length > 0 ? `Pivo: ${selectedLabels.join(', ')}` : 'Vybrat piva'
            }
          >
            <Text
              style={[styles.chipText, filters.beers.length > 0 && styles.chipTextActive]}
              allowFontScaling={false}
            >
              {beerLabel}
            </Text>
            <ChevronDownIcon
              size={14}
              color={filters.beers.length > 0 ? Colors.amber : Colors.mutedText}
            />
          </Pressable>

          <BeerFilterSheet
            visible={beerSheet}
            options={beerOptions}
            value={[...filters.beers]}
            onClose={() => setBeerSheet(false)}
            onApply={(next) => {
              onFilters({ ...filters, beers: next });
              setBeerSheet(false);
            }}
          />
        </>
      ) : null}

      {TOGGLES.map((label) => {
        const active = activeToggle(label);
        return (
          <Pressable
            key={label}
            onPress={() => toggle(label)}
            style={({ pressed }) => [
              styles.chip,
              active && styles.chipActive,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
          >
            <Text
              style={[styles.chipText, active && styles.chipTextActive]}
              allowFontScaling={false}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

// Memoized: the list re-renders on every GPS-driven presentation pass, and
// without this every mounted row rebuilds its whole subtree each time.
const PubRow = React.memo(function PubRow({
  pub,
  first,
  onPress,
}: {
  pub: PubPresentation;
  first?: boolean;
  onPress: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(pub.id)}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${pub.name}, detail`}
    >
      {/* The distance tile replaces the old map preview in the same 56pt well.
          It keeps the primary scanning fact visible without mounting a native
          map for every row. The full map remains available above the list. */}
      <View
        style={styles.distanceTile}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {pub.distanceLabel ? (
          <Text
            style={styles.distanceTileText}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.75}
            allowFontScaling={false}
          >
            {pub.distanceLabel}
          </Text>
        ) : (
          <MapPinnedIcon size={20} color={Colors.mutedText} />
        )}
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.pubName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {pub.name}
          </Text>
          {pub.rating != null ? (
            <>
              <StarIcon size={12} color={Colors.amber} />
              <Text style={styles.rating} allowFontScaling={false}>
                {pub.rating.toFixed(1)}
              </Text>
            </>
          ) : null}
          {/* Been here before. Just the fact — how many times and when is a
              detail-screen answer, and spelling it out on every row was a
              second sentence competing with the ones you actually scan. */}
          {pub.visitCount > 0 ? (
            <View accessible accessibilityLabel="Už jsi tu byl">
              <HeartIcon size={13} color={Colors.amber} />
            </View>
          ) : null}
        </View>

        <Text style={styles.address} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pub.address}
        </Text>

        {/* No "Nejbližší" tag down here: the nearest pub is the tinted compass
            row at the top of the list, so repeating it on a row is the same
            claim twice. The line that is left is the one you actually scan. */}
        <Text
          style={[
            styles.factText,
            { color: pub.openState === 'open' ? Colors.open : Colors.mutedText },
          ]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {pub.openLabel}
        </Text>

        {pub.beerLine ? (
          <Text style={styles.beer} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {pub.beerLine}
          </Text>
        ) : null}

      </View>

      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
});

/** Row height of the search field plus its bottom padding. */
const SEARCH_HEIGHT = 46 + 8;
/** How far you scroll before it is fully folded. */
const SEARCH_COLLAPSE = 64;

function mergeCurrentPub(pubs: Pub[], current: Pub | null): Pub[] {
  if (!current) return pubs;
  const index = pubs.findIndex((pub) => pub.id === current.id);
  if (index === -1) return [current, ...pubs];
  const next = pubs.slice();
  next[index] = current;
  return next;
}

export default function PubListMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const reportedPubIds = usePubStore((state) => state.reportedPubIds);
  const reportedCacheKeys = usePubStore((state) => state.reportedCacheKeys);
  const [filters, setFilters] = React.useState<PubListFilters>({
    beers: [],
    openOnly: false,
    tankOnly: false,
    gardenOnly: false,
  });
  const serverFilters = serverFiltersForPubList(filters);
  const compass = useCompass(
    serverFilters.beerBrandKeys,
    serverFilters.amenityKeys,
    null,
    null,
    true,
    false,
  );
  const visits = usePubVisits();
  const [beerOptions, setBeerOptions] = React.useState<BeerBrandFilterOption[]>(() =>
    fallbackPopularBeerBrands(),
  );
  const [snapshotReady, setSnapshotReady] = React.useState(false);
  const [detent, setDetent] = React.useState<Detent>('half');
  // One move signal with its destination, bumped by whoever wants the sheet
  // somewhere. See `PlacesSheet` for why it is not three booleans.
  const [moveTo, setMoveTo] = React.useState<{ nonce: number; to: Detent }>({
    nonce: 0,
    to: 'half',
  });
  const moveSheet = React.useCallback((to: Detent) => {
    setMoveTo((current) => ({ nonce: current.nonce + 1, to }));
  }, []);
  // Map onPanDrag fires on every drag frame. Re-requesting 'peek' on each one
  // would bump the nonce — and re-render this whole screen — dozens of times
  // per second, freezing the drag. Guard on the sheet's ACTUAL detent (via a
  // ref, so this callback stays stable): the sheet's own tap/drag gestures
  // settle detents without going through moveSheet, so the last requested
  // move is not a reliable signal of where the sheet is.
  const detentRef = React.useRef(detent);
  // One extra latch for the frames between requesting 'peek' and the detent
  // state committing — without it a fast drag still lands a few redundant
  // nonce bumps. Reset whenever the sheet is back on screen.
  const peekRequestedRef = React.useRef(false);
  React.useEffect(() => {
    detentRef.current = detent;
    if (detent !== 'peek') peekRequestedRef.current = false;
  }, [detent]);
  const sheetAwayForPan = React.useCallback(() => {
    if (detentRef.current === 'peek' || peekRequestedRef.current) return;
    peekRequestedRef.current = true;
    setMoveTo((current) => ({ nonce: current.nonce + 1, to: 'peek' }));
  }, []);
  const [listAtTop, setListAtTop] = React.useState(true);
  // Handed to the sheet so its drag can out-rank the list's own scrolling.
  const listRef = React.useRef<React.ComponentType<object> | null>(null);

  /**
   * The search field folds away as the list scrolls.
   *
   * A sheet at full height still spends its top third on a field you are not
   * typing in and chips you already set — scroll far enough to want more list,
   * and the field is the part you are not using. It comes straight back the
   * moment you scroll to the top, so it is never gone, only out of the way.
   *
   * Reduce motion keeps it: this follows a finger rather than animating on its
   * own, which is the kind of movement §10 allows.
   */
  const listScrollY = useSharedValue(0);
  const onListScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      listScrollY.value = event.contentOffset.y;
      // The sheet's own drag needs to know whether the list still has room
      // above it — at the top, a downward drag belongs to the sheet.
      const atTop = event.contentOffset.y <= 0.5;
      runOnJS(setListAtTop)(atTop);
    },
  });
  const searchAnim = useAnimatedStyle(() => {
    const shut = Math.min(1, Math.max(0, listScrollY.value / SEARCH_COLLAPSE));
    return {
      height: SEARCH_HEIGHT * (1 - shut),
      opacity: 1 - shut,
      transform: [{ translateY: -8 * shut }],
    };
  });
  const [selectedPub, setSelectedPub] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<Sort>('Nejbližší');
  const [recenterSignal, setRecenterSignal] = React.useState(0);
  // The detail opens INSIDE the sheet rather than as a push: the map behind is
  // the context for the place you just tapped, and pushing a screen throws that
  // away to show you a second map of the same pin.
  const [openPubId, setOpenPubId] = React.useState<string | null>(null);
  // Bumped on every pick of "Náhodně v okolí", so picking it again genuinely
  // deals a new order instead of returning the same "random" one.
  const [shuffleSeed, setShuffleSeed] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    void hydratePubsSnapshot().finally(() => {
      if (active) setSnapshotReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  React.useEffect(() => {
    const controller = new AbortController();
    void fetchPopularBeerBrands(controller.signal).then((options) => {
      if (!controller.signal.aborted) setBeerOptions(options);
    });
    return () => controller.abort();
  }, []);

  const hasServerFilters = filters.beers.length > 0 || filters.tankOnly || filters.gardenOnly;
  // Keep the previous catalogue out of sight while a hard server filter is in
  // flight. It has not been acknowledged for the new selection yet.
  const rawPubs = React.useMemo(
    () => {
      const loaded = getAllLoadedPubs();
      if (!snapshotReady && loaded.length === 0) return [];
      const merged = hasServerFilters && compass.isLoading
        ? []
        : mergeCurrentPub(loaded, compass.pub);
      return filterReportedPubs(merged, reportedPubIds, reportedCacheKeys);
    },
    [
      compass.isLoading,
      compass.pub,
      hasServerFilters,
      reportedCacheKeys,
      reportedPubIds,
      snapshotReady,
    ],
  );
  const amenitiesByKey = usePubAmenities(rawPubs);
  const visitIndex = React.useMemo(() => buildPubVisitIndex(visits), [visits]);
  const presentations = React.useMemo(
    () =>
      rawPubs.map((pub) =>
        presentPub(
          pub,
          compass.currentPosition,
          visitIndex,
          amenitiesByKey.get(geohash8(pub.lat, pub.lng)),
        ),
      ),
    [amenitiesByKey, compass.currentPosition, rawPubs, visitIndex],
  );
  const ordered = React.useMemo(
    () =>
      sortPubs(
        presentations.filter((pub) => pubMatchesFilters(pub, filters)),
        SORT_KEY[sort],
        shuffleSeed,
      ),
    [filters, presentations, shuffleSeed, sort],
  );

  // The compass head cell points at whatever the sort put first, so the needle
  // and the list always agree about where you are being sent.
  const head = compass.currentPosition ? ordered[0] : null;
  const listPubs = head ? ordered.slice(1) : ordered;
  const effectiveSelected =
    selectedPub && ordered.some((pub) => pub.id === selectedPub)
      ? selectedPub
      : ordered[0]?.id ?? null;
  const openPub = openPubId
    ? (presentations.find((pub) => pub.id === openPubId) ?? null)
    : null;
  const hasActiveFilters = hasServerFilters || filters.openOnly;

  // Opening a detail raises the sheet in the SAME action, not in an effect
  // watching the id: at `peek` the detail would land in a one-line slot, and an
  // effect that setStates on every id change is the cascading-render trap
  // (`react-hooks/set-state-in-effect`).
  const openPubDetail = React.useCallback(
    (id: string) => {
      setSelectedPub(id);
      setOpenPubId(id);
      // `full`, not `half`: the detail is a screen's worth — map, actions, two
      // tabs, the tap list — and reading it through a half-height slot means
      // dragging before you can read anything.
      moveSheet('full');
    },
    [moveSheet],
  );

  const renderPubRow = React.useCallback(
    ({ item: pub, index }: { item: PubPresentation; index: number }) => (
      <PubRow pub={pub} first={index === 0} onPress={openPubDetail} />
    ),
    [openPubDetail],
  );

  const pickSort = React.useCallback((next: Sort) => {
    setSort(next);
    if (next === 'Náhodně v okolí') setShuffleSeed((n) => n + 1);
  }, []);

  // The locate button rides just above the sheet's resting top, so collapsing
  // the sheet walks the button down with it instead of stranding it.
  const sheetTop = height * DETENT_TOP[detent];
  // At `peek` the sheet is off screen entirely, so the floating things stack up
  // from the tab bar. Anchored by their BOTTOM edge: computed down from the top
  // they drifted away from the bar on taller screens.
  // Above the sheet's peek sliver, so the floating cards never sit on top of
  // the grabber strip that pulls the list back up.
  const carouselBottom = PEEK_VISIBLE + Spacing.sm;
  const hasCarousel =
    detent === 'peek' && compass.currentPosition != null && ordered.length > 0;
  const controlsBottom =
    carouselBottom + (hasCarousel ? CAROUSEL_H : HitArea.min) - Spacing.sm;

  return (
    <View style={styles.screen}>
      {/* The map is the screen; the places ride over it in a sheet you drag. */}
      <View style={styles.map}>
        <PubsMap
          pubs={ordered}
          currentPosition={compass.currentPosition}
          recenterSignal={recenterSignal}
          onPressPub={openPubDetail}
          onPan={sheetAwayForPan}
          selectedId={effectiveSelected}
        />
      </View>

      {/* Map mode: one card above the sheet, swipeable, and the map follows it.
          At the other detents the list is on screen, so this would be the same
          pubs twice. */}
      {hasCarousel && compass.currentPosition ? (
        <View style={[styles.carousel, { bottom: carouselBottom }]}>
          <PubCarousel
            pubs={ordered}
            position={compass.currentPosition}
            onSelect={setSelectedPub}
            onOpen={openPubDetail}
          />
        </View>
      ) : null}

      {/* Same glass as the cards it floats beside. The glyph is the real SF
          Symbol, not a lookalike: this control means what Apple Maps' tracking
          button means, so it should be the same shape. */}
      {/* Two ways of looking at the same places, mirrored: the list on the left,
          where you are on the right. The list used to be a one-line bar at the
          bottom of the sheet whose only content was the words "Seznam hospod" —
          a row of chrome naming itself, over the map it was covering. */}
      {detent === 'peek' ? (
        <View style={[styles.places, { bottom: controlsBottom }]}>
        {/* Labelled, not a bare glyph. A list icon alone on a map is a guess;
            the two words cost nothing and the pill still floats. */}
        <GlassPill accessibilityLabel="Seznam hospod" onPress={() => moveSheet('half')}>
          <SymbolView
            name="list.bullet"
            size={17}
            tintColor={Colors.foam}
            resizeMode="scaleAspectFit"
            fallback={<ChevronRightIcon size={18} color={Colors.foam} />}
          />
          <Text style={styles.placesLabel} allowFontScaling={false}>
            Seznam hospod
          </Text>
        </GlassPill>
        </View>
      ) : null}

      <View
        style={[
          styles.locate,
          detent === 'peek' ? { bottom: controlsBottom } : { top: sheetTop - 56 },
        ]}
      >
        <GlassIconButton
          size={44}
          accessibilityLabel={
            compass.currentPosition ? 'Vycentrovat na mě' : 'Povolit polohu'
          }
          onPress={() => {
            if (compass.currentPosition) setRecenterSignal((n) => n + 1);
            else void compass.requestPermission();
          }}
        >
          <SymbolView
            name="location.fill"
            size={19}
            tintColor={Colors.foam}
            resizeMode="scaleAspectFit"
            fallback={<LocateFixedIcon size={20} color={Colors.foam} />}
          />
        </GlassIconButton>
      </View>

      <PlacesSheet
        initial="half"
        onDetentChange={setDetent}
        moveTo={moveTo}
        listAtTop={listAtTop}
        scrollRef={listRef}
      >
        {openPub ? (
          <ScrollView
            contentContainerStyle={[styles.detailContent, { paddingBottom: insets.bottom + 120 }]}
            showsVerticalScrollIndicator={false}
            scrollEnabled={detent === 'full'}
            scrollEventThrottle={16}
            onScroll={(event) => {
              const atTop = event.nativeEvent.contentOffset.y <= 0.5;
              setListAtTop((current) => (current === atTop ? current : atTop));
            }}
          >
            <PubDetailBody
              key={openPub.id}
              pub={openPub}
              position={compass.currentPosition}
              visits={visits}
              onClose={() => setOpenPubId(null)}
            />
          </ScrollView>
        ) : (
          <>
            <Animated.View style={[styles.searchWrap, searchAnim]}>
              {/* A field you tap to OPEN search, not one you type in here: the
                  sheet is half a screen tall and a keyboard would take the rest
                  of it. Apple Maps does the same. */}
              <Pressable
                onPress={() => router.push('/search' as Href)}
                style={({ pressed }) => [styles.searchField, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Hledat hospodu nebo pivo"
              >
                <SearchIcon size={17} color={Colors.mutedText} />
                <Text style={styles.searchPlaceholder} maxFontSizeMultiplier={FontScaleCap.body}>
                  Hledej hospodu nebo pivo
                </Text>
              </Pressable>
            </Animated.View>

            {/* The chips stay. They are how you change what the list IS, so
                losing them on scroll would mean scrolling back up to filter. */}
            <FilterChips
              sort={sort}
              onSort={pickSort}
              beerOptions={beerOptions}
              filters={filters}
              onFilters={setFilters}
            />

            <Animated.FlatList
              ref={listRef as never}
              data={listPubs}
              keyExtractor={(pub) => pub.id}
              renderItem={renderPubRow}
              initialNumToRender={8}
              maxToRenderPerBatch={8}
              windowSize={7}
              removeClippedSubviews
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              scrollEnabled={detent === 'full'}
              scrollEventThrottle={16}
              onScroll={onListScroll}
              ListHeaderComponent={
                <>
                  {compass.searchFailed && presentations.length > 0 ? (
                    <View style={styles.statusBanner}>
                      <Text style={styles.statusBannerText}>Ukazuju poslední uložené hospody.</Text>
                      <Pressable onPress={compass.retrySearch} accessibilityRole="button">
                        <Text style={styles.statusActionText}>Obnovit</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {compass.permissionState === 'denied' && presentations.length > 0 ? (
                    <View style={styles.statusBanner}>
                      <Text style={styles.statusBannerText}>Vzdálenost bez polohy nespočítám.</Text>
                      <Pressable
                        onPress={() => void compass.requestPermission()}
                        accessibilityRole="button"
                      >
                        <Text style={styles.statusActionText}>Povolit</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {head && compass.currentPosition ? (
                    <CompassCell
                      pub={head}
                      position={compass.currentPosition}
                      badge={BADGE[sort]}
                      // It is a pub row, so it opens the pub. It used to open the
                      // map, which meant the one cell naming a place was the one
                      // cell that would not take you to it.
                      onPress={() => openPubDetail(head.id)}
                    />
                  ) : null}
                </>
              }
              ListFooterComponent={
                <>
                  {!snapshotReady ||
                  (presentations.length === 0 &&
                    compass.isLoading &&
                    compass.permissionState !== 'denied') ? (
                    <View style={styles.listState}>
                      <ActivityIndicator color={Colors.amber} />
                      <Text style={styles.listStateText}>Hledám hospody…</Text>
                    </View>
                  ) : null}

                  {snapshotReady &&
                  presentations.length === 0 &&
                  compass.permissionState === 'denied' ? (
                    <View style={styles.listState}>
                      <Text style={styles.listStateText}>Povol polohu a mrkneme, co je kolem.</Text>
                      <Pressable
                        onPress={() => void compass.requestPermission()}
                        style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}
                        accessibilityRole="button"
                      >
                        <Text style={styles.stateButtonText}>Povolit polohu</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {snapshotReady &&
                  presentations.length === 0 &&
                  compass.permissionState !== 'denied' &&
                  !compass.isLoading ? (
                    <View style={styles.listState}>
                      <Text style={styles.listStateText}>
                        {compass.searchFailed
                          ? 'Hospody se teď nenačetly.'
                          : 'V okolí zatím nic nemáme.'}
                      </Text>
                      <Pressable
                        onPress={compass.retrySearch}
                        style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}
                        accessibilityRole="button"
                      >
                        <Text style={styles.stateButtonText}>Zkusit znovu</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {presentations.length > 0 && ordered.length === 0 ? (
                    <View style={styles.listState}>
                      <Text style={styles.listStateText}>Tahle kombinace je prázdná.</Text>
                      {hasActiveFilters ? (
                        <Pressable
                          onPress={() =>
                            setFilters({
                              beers: [],
                              openOnly: false,
                              tankOnly: false,
                              gardenOnly: false,
                            })
                          }
                          style={({ pressed }) => [styles.stateButton, pressed && styles.pressed]}
                          accessibilityRole="button"
                        >
                          <Text style={styles.stateButtonText}>Zrušit filtry</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </>
              }
            />
          </>
        )}
      </PlacesSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  // No gutter of its own: `PubDetailBody` sets the app's one width, and adding
  // 16 here on top of its 20 put the text at 36 while every full-bleed band
  // still bled only 20 — three different edges on one sheet.
  detailContent: {},
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  screenTitle: { ...MockType.titleXL, color: Colors.foam },
  headerButton: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // — Compass head cell —
  compassCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.card,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
  },
  compassDial: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  compassKicker: {
    fontWeight: '700',
    fontSize: 13,
    color: withAlpha(Colors.amber, 0.9),
  },
  compassDistanceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5, marginTop: 1 },
  compassDistance: {
    fontWeight: '800',
    fontSize: 34,
    color: Colors.foam,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  compassUnit: { fontWeight: '500', fontSize: 13, color: Colors.mutedText },
  compassPub: { fontWeight: '700', fontSize: 16, color: Colors.foam, marginTop: 1 },
  compassMeta: { fontWeight: '400', fontSize: 12, color: Colors.mutedText, marginTop: 1 },

  // Packeta section header: 18pt Bold, sentence case, foam — NOT an 11pt
  // uppercase muted kicker. The kicker was the loudest "old app" tell.
  sectionTitle: {
    ...MockType.titleS,
    color: Colors.foam,
    marginTop: MockLayout.sectionGap,
    marginBottom: Spacing.sm,
  },


  // — Search + filters, inside the sheet —
  // Tight around the filter row: the sheet is half a screen and the padding
  // above and below the chips was costing a whole pub row.
  searchWrap: {
    paddingHorizontal: MockLayout.screenPad,
    paddingBottom: Spacing.xs,
    overflow: 'hidden',
  },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 46,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: MockColors.field,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MockColors.fieldBorder,
  },
  searchPlaceholder: { ...MockType.body, color: MockColors.fieldHint },
  // `flexGrow: 0` matters: a horizontal ScrollView inside a column otherwise
  // takes a full flex slot, which is where the band of dead space under the
  // filters came from.
  chipsScroller: { flexGrow: 0 },
  chipsRow: {
    paddingHorizontal: MockLayout.screenPad,
    gap: Spacing.xs,
    alignItems: 'center',
    paddingBottom: Spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: MockLayout.pillHeight,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipActive: { borderColor: withAlpha(Colors.amber, 0.5) },
  chipText: { fontSize: 14, fontWeight: '600', color: Colors.mutedText },
  chipTextActive: { color: Colors.amber },

  // — Rows (Packeta list item: photo well + title + facts) —
  // Rows sit straight on the sheet, separated by a hairline. Wrapping each one
  // in its own bordered card put a rectangle inside a rectangle inside the
  // sheet — three frames deep, and §14.10 kills exactly that. The list reads as
  // a list; nothing needs a container to prove it is a row.
  list: {},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  /** The first row follows the tinted compass panel — a hairline right under a
   *  filled block reads as an underline on it, not as a list separator. */
  rowFirst: { borderTopWidth: 0 },
  distanceTile: {
    width: THUMB,
    height: THUMB,
    paddingHorizontal: Spacing.xs,
    borderRadius: MockLayout.thumbRadius,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
  },
  distanceTileText: {
    ...MockType.bodySmall,
    fontWeight: '700',
    color: Colors.foam,
    textAlign: 'center',
  },
  rowBody: { flex: 1, gap: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pubName: { ...MockType.bodySemibold, color: Colors.foam, letterSpacing: -0.2 },
  rating: { fontSize: 12, fontWeight: '700', color: Colors.amber },
  address: { fontSize: 13, fontWeight: '400', color: Colors.mutedText },
  factText: { fontSize: 13, fontWeight: '600' },
  beer: { ...MockType.bodySmall, color: Colors.foam, marginTop: 2 },
  price: { fontWeight: '700', color: Colors.mutedText },

  statusBanner: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  statusBannerText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: Colors.mutedText,
  },
  statusActionText: { fontSize: 13, fontWeight: '700', color: Colors.amber },
  listState: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
  },
  listStateText: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.mutedText,
    textAlign: 'center',
  },
  stateButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  stateButtonText: { fontSize: 15, fontWeight: '700', color: Colors.foam },

  carousel: { position: 'absolute', left: 0, right: 0 },
  locate: { position: 'absolute', right: MockLayout.screenPad },
  places: { position: 'absolute', left: MockLayout.screenPad },
  placesLabel: { fontSize: 14, fontWeight: '700', color: Colors.foam },
});
