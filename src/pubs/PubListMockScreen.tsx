/**
 * DESIGN MOCK — Hospody, as a Packeta-style branch list.
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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { SymbolView } from 'expo-symbols';

import {
  BeerIcon,
  ChevronDownIcon,
  LocateFixedIcon,
  ChevronRightIcon,
  HeartIcon,
  SearchIcon,
  StarIcon,
} from '@/components/shared/IconGlyph';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { GlassIconButton, GlassPill } from '@/components/shared/GlassIconButton';
import { MenuChip } from '@/mocks/MenuChip';
import { BeerFilterSheet } from '@/pubs/BeerFilterSheet';
import { CompassCell } from '@/pubs/CompassCell';
import { DETENT_TOP, PlacesSheet, type Detent } from '@/pubs/PlacesSheet';
import { PubCarousel } from '@/pubs/PubCarousel';
import { PubThumbMap } from '@/pubs/PubThumbMap';
import { PubDetailBody } from '@/pubs/PubDetailBody';
import { PubsMap } from '@/pubs/PubsMap';
import { MOCK_PUBS, shuffled, type MockPub } from '@/pubs/mockPubs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/** A map needs more than Packeta's 48pt photo well to show a street. */
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

/**
 * The beer is why you pick one pub over another, so it gets its own pill next
 * to "Otevřeno" rather than hiding behind the sliders. This maps onto the
 * filter the app already has — `PubSearchFilters.beerBrand`.
 */
const BEERS = ['Pilsner Urquell', 'Kozel', 'Matuška', 'Únětické', 'Kacíř'] as const;

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
}: {
  sort: Sort;
  /** Fires on EVERY pick, including re-picking the current one — that is how
   *  "Náhodně v okolí" reshuffles a second time. */
  onSort: (next: Sort) => void;
}) {
  const [on, setOn] = React.useState<string[]>([]);

  // Several beers at once, so a sheet with checkboxes rather than an action
  // sheet — the latter answers one question with one answer.
  const [beers, setBeers] = React.useState<string[]>([]);
  const [beerSheet, setBeerSheet] = React.useState(false);
  const beerLabel =
    beers.length === 0 ? 'Pivo' : beers.length === 1 ? beers[0] : `Pivo (${beers.length})`;

  const toggle = (label: string) =>
    setOn((current) =>
      current.includes(label) ? current.filter((l) => l !== label) : [...current, label],
    );

  return (
    <ScrollView
      horizontal
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

      {/* Beer is a value, not a toggle — one answer at a time — so it is a
          dropdown like the sort, and sits right beside "Otevřeno". */}
      <Pressable
        onPress={() => setBeerSheet(true)}
        style={({ pressed }) => [
          styles.chip,
          beers.length > 0 && styles.chipActive,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel={beers.length > 0 ? `Pivo: ${beers.join(', ')}` : 'Vybrat piva'}
      >
        <Text
          style={[styles.chipText, beers.length > 0 && styles.chipTextActive]}
          allowFontScaling={false}
        >
          {beerLabel}
        </Text>
        <ChevronDownIcon
          size={14}
          color={beers.length > 0 ? Colors.amber : Colors.mutedText}
        />
      </Pressable>

      <BeerFilterSheet
        visible={beerSheet}
        options={BEERS}
        value={beers}
        onClose={() => setBeerSheet(false)}
        onApply={(next) => {
          setBeers(next);
          setBeerSheet(false);
        }}
      />

      {TOGGLES.map((label) => {
        const active = on.includes(label);
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

function PubRow({
  pub,
  first,
  onPress,
}: {
  pub: MockPub;
  first?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`${pub.name}, detail`}
    >
      {/* The well is a map of where the pub actually is — frozen to a bitmap
          after first paint, so the list scrolls images and not map engines
          (see PubThumbMap). The beer sits in the corner badge: it labels the
          row, it is not the picture. */}
      <View style={styles.thumb}>
        <PubThumbMap lat={pub.lat} lng={pub.lng} size={THUMB} />
        <View style={styles.thumbBadge}>
          <BeerIcon size={11} color={Colors.stout} />
        </View>
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.pubName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {pub.name}
          </Text>
          <StarIcon size={12} color={Colors.amber} />
          <Text style={styles.rating} allowFontScaling={false}>
            {pub.rating.toFixed(1)}
          </Text>
          {/* Been here before. Just the fact — how many times and when is a
              detail-screen answer, and spelling it out on every row was a
              second sentence competing with the ones you actually scan. */}
          {pub.lastParty ? (
            <View accessible accessibilityLabel="Už jsi tu byl">
              <HeartIcon size={13} color={Colors.amber} />
            </View>
          ) : null}
        </View>

        {/* Distance belongs with the address — both answer "where is it", and
            splitting them made the row read as two separate facts. */}
        <Text style={styles.address} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pub.address} · {pub.distance}
        </Text>

        {/* No "Nejbližší" tag down here: the nearest pub is the tinted compass
            row at the top of the list, so repeating it on a row is the same
            claim twice. The line that is left is the one you actually scan. */}
        <Text
          style={[styles.factText, { color: pub.open ? Colors.open : Colors.mutedText }]}
          numberOfLines={1}
          allowFontScaling={false}
        >
          {pub.open ? `Otevřeno ${pub.hours}` : `Zavřeno, ${pub.hours}`}
        </Text>

        <Text style={styles.beer} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pub.beer}
          {pub.priceCzk !== null ? (
            <Text style={styles.price}>{`  (${pub.priceCzk} Kč)`}</Text>
          ) : null}
        </Text>

      </View>

      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

export default function PubListMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height } = useWindowDimensions();
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
  const [listAtTop, setListAtTop] = React.useState(true);
  const [selectedPub, setSelectedPub] = React.useState<string | null>(MOCK_PUBS[0]?.id ?? null);
  const [sort, setSort] = React.useState<Sort>('Nejbližší');
  const [recenterSignal, setRecenterSignal] = React.useState(0);
  // The detail opens INSIDE the sheet rather than as a push: the map behind is
  // the context for the place you just tapped, and pushing a screen throws that
  // away to show you a second map of the same pin.
  const [openPubId, setOpenPubId] = React.useState<string | null>(null);
  // Bumped on every pick of "Náhodně v okolí", so picking it again genuinely
  // deals a new order instead of returning the same "random" one.
  const [shuffleSeed, setShuffleSeed] = React.useState(0);

  const ordered = React.useMemo(() => {
    if (sort === 'Nejlépe hodnocené') {
      return [...MOCK_PUBS].sort((a, b) => b.rating - a.rating);
    }
    if (sort === 'Náhodně v okolí') return shuffled(MOCK_PUBS, shuffleSeed);
    // MOCK_PUBS is already in distance order.
    return MOCK_PUBS;
  }, [sort, shuffleSeed]);

  // The compass head cell points at whatever the sort put first, so the needle
  // and the list always agree about where you are being sent.
  const head = ordered[0];
  const openPub = openPubId ? (MOCK_PUBS.find((pub) => pub.id === openPubId) ?? null) : null;

  // Opening a detail raises the sheet in the SAME action, not in an effect
  // watching the id: at `peek` the detail would land in a one-line slot, and an
  // effect that setStates on every id change is the cascading-render trap
  // (`react-hooks/set-state-in-effect`).
  const openPubDetail = React.useCallback(
    (id: string) => {
      setOpenPubId(id);
      // `full`, not `half`: the detail is a screen's worth — map, actions, two
      // tabs, the tap list — and reading it through a half-height slot means
      // dragging before you can read anything.
      moveSheet('full');
    },
    [moveSheet],
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
  const carouselBottom = TAB_CHROME - 18;
  const controlsBottom = carouselBottom + CAROUSEL_H + Spacing.sm;

  return (
    <View style={styles.screen}>
      {/* The map is the screen; the places ride over it in a sheet you drag. */}
      <View style={styles.map}>
        <PubsMap
          recenterSignal={recenterSignal}
          onPressPub={openPubDetail}
          onPan={() => moveSheet('peek')}
          selectedId={selectedPub}
        />
      </View>

      {/* Map mode: one card above the sheet, swipeable, and the map follows it.
          At the other detents the list is on screen, so this would be the same
          pubs twice. */}
      {detent === 'peek' ? (
        <View style={[styles.carousel, { bottom: carouselBottom }]}>
          <PubCarousel onSelect={setSelectedPub} />
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
          accessibilityLabel="Vycentrovat na mě"
          onPress={() => setRecenterSignal((n) => n + 1)}
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
      >
        {openPub ? (
          <ScrollView
            contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
            showsVerticalScrollIndicator={false}
            scrollEnabled={detent === 'full'}
            scrollEventThrottle={16}
            onScroll={(event) => {
              const atTop = event.nativeEvent.contentOffset.y <= 0.5;
              setListAtTop((current) => (current === atTop ? current : atTop));
            }}
          >
            <PubDetailBody pub={openPub} onClose={() => setOpenPubId(null)} />
          </ScrollView>
        ) : (
          <>
            <View style={styles.searchWrap}>
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
            </View>

            <FilterChips sort={sort} onSort={pickSort} />

            <ScrollView
              contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 120 }]}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              scrollEnabled={detent === 'full'}
              scrollEventThrottle={16}
              onScroll={(event) => {
                const atTop = event.nativeEvent.contentOffset.y <= 0.5;
                setListAtTop((current) => (current === atTop ? current : atTop));
              }}
            >
              {head ? (
                <CompassCell
                  pub={head}
                  badge={BADGE[sort]}
                  // It is a pub row, so it opens the pub. It used to open the
                  // map, which meant the one cell naming a place was the one
                  // cell that would not take you to it.
                  onPress={() => openPubDetail(head.id)}
                />
              ) : null}

              <View style={styles.list}>
                {ordered.slice(1).map((pub, index) => (
                  <PubRow
                    key={pub.id}
                    pub={pub}
                    first={index === 0}
                    onPress={() => openPubDetail(pub.id)}
                  />
                ))}
              </View>

              <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
                Design mock — data jsou napevno.
              </Text>
            </ScrollView>
          </>
        )}
      </PlacesSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: 16 },
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
  searchWrap: { paddingHorizontal: MockLayout.screenPad, paddingBottom: Spacing.xs },
  searchField: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 46,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
  },
  searchPlaceholder: { ...MockType.body, color: Colors.mutedText },
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
  thumb: { width: THUMB, height: THUMB },
  thumbBadge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  rowBody: { flex: 1, gap: 1 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pubName: { ...MockType.bodySemibold, color: Colors.foam, letterSpacing: -0.2 },
  rating: { fontSize: 12, fontWeight: '700', color: Colors.amber },
  address: { fontSize: 13, fontWeight: '400', color: Colors.mutedText },
  factText: { fontSize: 13, fontWeight: '600' },
  beer: { ...MockType.bodySmall, color: Colors.foam, marginTop: 2 },
  price: { fontWeight: '700', color: Colors.mutedText },

  carousel: { position: 'absolute', left: 0, right: 0 },
  locate: { position: 'absolute', right: MockLayout.screenPad },
  places: { position: 'absolute', left: MockLayout.screenPad },
  placesLabel: { fontSize: 14, fontWeight: '700', color: Colors.foam },
  mockNote: {
    fontWeight: '400',
    fontSize: 12,
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
});
