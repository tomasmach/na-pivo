import React, { type ComponentType, useCallback, useEffect, useMemo, useState } from 'react';
import {
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import {
  AccessibilityIcon,
  BeerIcon,
  CheckIcon,
  CircleDotIcon,
  CreditCardIcon,
  MicIcon,
  MapPinnedIcon,
  RadioIcon,
  RefreshCwIcon,
  SearchIcon,
  SoccerBallIcon,
  SquareParkingIcon,
  TargetIcon,
  TreePineIcon,
  TvIcon,
  WifiIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import {
  AMENITIES,
  type AmenityDef,
  type AmenityKey,
  sectionForGroup,
} from '@/data/amenities';
import {
  MAX_AMENITY_FILTERS,
  PRICE_FILTER_STEPS,
  normalizePubSearchFilters,
  type BeerBrandFilterValue,
  type PubSearchFilters,
} from '@/data/pubSearchFilters';
import { formatPrice } from '@/utils/currency';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  POPULAR_BEER_BRANDS,
  suggestBeerBrands,
  type BeerBrandSuggestion,
} from '@/data/beerSuggestionsClient';
import { cs } from '@/i18n/cs';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

type Glyph = ComponentType<{ size?: number; color: string }>;

const AMENITY_ICONS: Record<AmenityKey, Glyph> = {
  payment_card: CreditCardIcon,
  seating_garden: TreePineIcon,
  seating_barrier_free: AccessibilityIcon,
  game_darts: TargetIcon,
  game_billiards: CircleDotIcon,
  game_foosball: SoccerBallIcon,
  game_jukebox: RadioIcon,
  atmosphere_live_music: MicIcon,
  atmosphere_sports_tv: TvIcon,
  practical_wifi: WifiIcon,
  practical_parking: SquareParkingIcon,
};

const SECTION_ORDER = ['fun', 'practical', 'seating'] as const;
const SECTION_LABELS = cs.compass.amenityFilterSections;

const FILTERABLE_AMENITIES = AMENITIES.filter((amenity) => amenity.mapFilterable);

interface PubFilterSheetProps {
  visible: boolean;
  value: PubSearchFilters;
  /** Known reference prices (CZK) of the currently loaded pubs, price-cap NOT
   *  applied — drives the histogram and the live match count. */
  nearbyPrices?: number[];
  onClose: () => void;
  onApply: (value: PubSearchFilters) => void;
}

export function PubFilterSheet({
  visible,
  value,
  nearbyPrices = [],
  onClose,
  onApply,
}: PubFilterSheetProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<PubSearchFilters>(() => normalizePubSearchFilters(value));
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<BeerBrandSuggestion[]>([]);
  const [suggestionsQuery, setSuggestionsQuery] = useState('');
  const [limitReached, setLimitReached] = useState(false);
  const searching = query.trim().length >= 2;
  const normalizedQuery = query.trim();
  const visibleSuggestions = suggestionsQuery === normalizedQuery ? suggestions : [];
  const suggestionsPending = searching && suggestionsQuery !== normalizedQuery;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const requestedQuery = normalizedQuery;
    const timeout = setTimeout(() => {
      suggestBeerBrands(query, controller.signal, 8)
        .then((items) => {
          if (!controller.signal.aborted) {
            setSuggestions(items);
            setSuggestionsQuery(requestedQuery);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSuggestions([]);
            setSuggestionsQuery(requestedQuery);
          }
        });
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [normalizedQuery, query, searching]);

  const groupedAmenities = useMemo(
    () =>
      SECTION_ORDER.map((section) => ({
        section,
        items: FILTERABLE_AMENITIES.filter(
          (amenity) => sectionForGroup(amenity.group) === section,
        ),
      })).filter((group) => group.items.length > 0),
    [],
  );

  const chooseBrand = useCallback((beerBrand: BeerBrandFilterValue | null) => {
    setDraft((current) => ({ ...current, beerBrand }));
    setQuery('');
    setSuggestions([]);
    setSuggestionsQuery('');
  }, []);

  const chooseSuggestion = useCallback(
    (suggestion: BeerBrandSuggestion) => {
      chooseBrand({
        key: suggestion.brandSlug ?? suggestion.slug,
        label: suggestion.brandName ?? suggestion.name,
      });
    },
    [chooseBrand],
  );

  const toggleAmenity = useCallback((key: AmenityKey) => {
    if (draft.amenityKeys.includes(key)) {
      setLimitReached(false);
      setDraft({
        ...draft,
        amenityKeys: draft.amenityKeys.filter((item) => item !== key),
      });
      return;
    }
    if (draft.amenityKeys.length >= MAX_AMENITY_FILTERS) {
      setLimitReached(true);
      return;
    }
    setLimitReached(false);
    setDraft({ ...draft, amenityKeys: [...draft.amenityKeys, key] });
  }, [draft]);

  const clear = useCallback(() => {
    setDraft({
      beerBrand: null,
      amenityKeys: [],
      includeOtherPlaces: false,
      priceMinCzk: null,
      priceMaxCzk: null,
    });
    setQuery('');
    setSuggestions([]);
    setSuggestionsQuery('');
    setLimitReached(false);
  }, []);

  const setPriceRange = useCallback((priceMinCzk: number | null, priceMaxCzk: number | null) => {
    setDraft((current) => ({ ...current, priceMinCzk, priceMaxCzk }));
  }, []);

  const apply = useCallback(() => {
    onApply(normalizePubSearchFilters(draft));
    onClose();
  }, [draft, onApply, onClose]);

  const hasDraftFilters =
    draft.beerBrand !== null ||
    draft.amenityKeys.length > 0 ||
    draft.includeOtherPlaces === true ||
    draft.priceMinCzk !== null ||
    draft.priceMaxCzk !== null;

  return (
    <BottomSheetModal visible={visible} onClose={onClose} keyboardLift>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.titleRow}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.compass.pubFilterTitle}
            </Text>
            <CloseButton onPress={onClose} label={cs.a11y.closePubFilters} />
          </View>

          <KeyboardAwareScrollView
            style={styles.content}
            contentContainerStyle={styles.contentContainer}
            keyboardAvoidedExternally
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.compass.beerFilterSection}
            </Text>
            <View style={styles.searchRow}>
              <SearchIcon size={16} color={Colors.mutedText} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={draft.beerBrand?.label ?? cs.compass.beerFilterSearchPlaceholder}
                placeholderTextColor={draft.beerBrand ? Colors.foam : Colors.mutedText}
                style={styles.searchInput}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="search"
                maxFontSizeMultiplier={FontScaleCap.body}
                accessibilityLabel={cs.a11y.beerBrandFilterInput}
              />
              {(query.length > 0 || draft.beerBrand) && (
                <Pressable
                  onPress={() => (query.length > 0 ? setQuery('') : chooseBrand(null))}
                  hitSlop={10}
                  style={styles.searchClear}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.clearBeerBrandFilter}
                >
                  <XIcon size={15} color={Colors.foamMuted} />
                </Pressable>
              )}
            </View>

            {searching ? (
              <View style={styles.results}>
                {suggestionsPending || visibleSuggestions.length === 0 ? (
                  <Text style={styles.noResults} maxFontSizeMultiplier={FontScaleCap.body}>
                    {suggestionsPending
                      ? cs.compass.beerFilterSearching
                      : cs.compass.beerFilterNoResults}
                  </Text>
                ) : (
                  visibleSuggestions.map((suggestion, index) => (
                    <Pressable
                      key={suggestion.slug}
                      onPress={() => chooseSuggestion(suggestion)}
                      style={[styles.resultRow, index > 0 && styles.resultRowDivider]}
                      accessibilityRole="button"
                      accessibilityLabel={cs.a11y.beerBrandFilterSuggestion(suggestion.name)}
                    >
                      <BeerIcon size={15} color={Colors.mutedText} />
                      <Text
                        style={styles.resultText}
                        numberOfLines={1}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {suggestion.name}
                      </Text>
                    </Pressable>
                  ))
                )}
              </View>
            ) : (
              <View style={styles.chipsWrap}>
                {POPULAR_BEER_BRANDS.map((brand) => {
                  const active = draft.beerBrand?.key === brand.key;
                  return (
                    <FilterChip
                      key={brand.key}
                      label={brand.short}
                      active={active}
                      icon={BeerIcon}
                      onPress={() => chooseBrand(active ? null : { key: brand.key, label: brand.short })}
                      accessibilityLabel={cs.a11y.selectBeerBrand(brand.label)}
                    />
                  );
                })}
              </View>
            )}

            {draft.beerBrand ? (
              <View style={styles.rotatingFilterHint}>
                <RefreshCwIcon size={14} color={Colors.amber} />
                <Text style={styles.rotatingFilterHintText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.compass.beerFilterRotatingHint}
                </Text>
              </View>
            ) : null}

            <PriceFilterSection
              nearbyPrices={nearbyPrices}
              priceMinCzk={draft.priceMinCzk}
              priceMaxCzk={draft.priceMaxCzk}
              onChange={setPriceRange}
            />

            <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.compass.otherPlacesSection}
            </Text>
            <View style={styles.chipsWrap}>
              <FilterChip
                label={cs.compass.otherPlacesFilter}
                active={draft.includeOtherPlaces === true}
                icon={MapPinnedIcon}
                onPress={() =>
                  setDraft((current) => ({
                    ...current,
                    includeOtherPlaces: current.includeOtherPlaces !== true,
                  }))
                }
                accessibilityLabel={cs.a11y.toggleOtherTapPlaces}
              />
            </View>
            {groupedAmenities.map(({ section, items }) => (
              <View key={section}>
                <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {SECTION_LABELS[section]}
                </Text>
                <View style={styles.amenityGrid}>
                  {items.map((amenity) => (
                    <AmenityChip
                      key={amenity.key}
                      amenity={amenity}
                      active={draft.amenityKeys.includes(amenity.key)}
                      onPress={() => toggleAmenity(amenity.key)}
                    />
                  ))}
                </View>
              </View>
            ))}

            <Text
              style={[styles.matchHint, limitReached && styles.limitHint]}
              maxFontSizeMultiplier={FontScaleCap.body}
              accessibilityLiveRegion="polite"
            >
              {limitReached
                ? cs.compass.pubFilterLimit(MAX_AMENITY_FILTERS)
                : cs.compass.pubFilterMatchAll}
            </Text>
          </KeyboardAwareScrollView>

          <View style={styles.actions}>
            {hasDraftFilters ? (
              <Pressable
                onPress={clear}
                style={styles.secondaryButton}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.clearPubFilters}
              >
                <Text
                  style={styles.secondaryButtonText}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.compass.pubFilterClear}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={apply}
              style={styles.primaryButton}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.applyPubFilters}
            >
              <Text
                style={styles.primaryButtonText}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {cs.compass.pubFilterApply}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

/** Bucket ceilings for the histogram — the numeric slider steps; prices above
 *  the last step land in a trailing overflow bar. */
const PRICE_BUCKET_VALUES = PRICE_FILTER_STEPS.filter((step): step is number => step !== null);
const HISTOGRAM_MIN_PRICES = 5;
const HISTOGRAM_MAX_BAR_HEIGHT = 56;
const HISTOGRAM_MIN_BAR_HEIGHT = 3;
const THUMB_SIZE = 24;

function bucketIndexForPrice(czk: number): number {
  const first = PRICE_BUCKET_VALUES[0];
  const step = PRICE_BUCKET_VALUES[1] - PRICE_BUCKET_VALUES[0];
  if (czk <= first) return 0;
  const index = Math.ceil((czk - first) / step);
  // Prices above the top step fall into the overflow bar after the last value.
  return Math.min(index, PRICE_BUCKET_VALUES.length);
}

function priceIndexFromTouch(locationX: number, trackWidth: number): number | undefined {
  if (trackWidth <= 0) return undefined;
  const fraction = Math.max(0, Math.min(1, locationX / trackWidth));
  return Math.round(fraction * (PRICE_FILTER_STEPS.length - 1));
}

function minPriceForIndex(index: number): number | null {
  return index === 0 ? null : PRICE_BUCKET_VALUES[index];
}

function maxPriceForIndex(index: number): number | null {
  return index === PRICE_FILTER_STEPS.length - 1 ? null : PRICE_BUCKET_VALUES[index];
}

const PRICE_AXIS_LABELS = ['≤30', '35', '40', '45', '50', '55', '60', '65', '70', '70+'];

/**
 * Airbnb-style price section: distribution histogram of the nearby known
 * prices over a two-thumb range slider. Everything is local state — the filter
 * itself applies client-side, so the bars and the match count react instantly.
 */
function PriceFilterSection({
  nearbyPrices,
  priceMinCzk,
  priceMaxCzk,
  onChange,
}: {
  nearbyPrices: number[];
  priceMinCzk: number | null;
  priceMaxCzk: number | null;
  onChange: (priceMinCzk: number | null, priceMaxCzk: number | null) => void;
}) {
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const [trackWidth, setTrackWidth] = useState(0);
  const [activeThumb, setActiveThumb] = useState<'min' | 'max'>('max');

  const onTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const minIndex =
    priceMinCzk === null
      ? 0
      : Math.max(1, PRICE_BUCKET_VALUES.findIndex((step) => step >= priceMinCzk));
  const maxIndex =
    priceMaxCzk === null
      ? PRICE_FILTER_STEPS.length - 1
      : Math.max(
          0,
          PRICE_BUCKET_VALUES.findIndex((step) => step >= priceMaxCzk),
        );

  const panResponder = useMemo(() => {
    const handleTouch = (locationX: number, chooseThumb: boolean) => {
      const touchedIndex = priceIndexFromTouch(locationX, trackWidth);
      if (touchedIndex === undefined) return;
      const selectedThumb = chooseThumb
        ? Math.abs(touchedIndex - minIndex) <= Math.abs(touchedIndex - maxIndex)
          ? 'min'
          : 'max'
        : activeThumb;
      if (chooseThumb) setActiveThumb(selectedThumb);
      if (selectedThumb === 'min') {
        const nextIndex = Math.min(touchedIndex, maxIndex);
        onChange(minPriceForIndex(nextIndex), priceMaxCzk);
      } else {
        const nextIndex = Math.max(touchedIndex, minIndex);
        onChange(priceMinCzk, maxPriceForIndex(nextIndex));
      }
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => handleTouch(event.nativeEvent.locationX, true),
      onPanResponderMove: (event) => handleTouch(event.nativeEvent.locationX, false),
    });
  }, [activeThumb, maxIndex, minIndex, onChange, priceMaxCzk, priceMinCzk, trackWidth]);

  const buckets = useMemo(() => {
    const counts = new Array<number>(PRICE_BUCKET_VALUES.length + 1).fill(0);
    for (const czk of nearbyPrices) counts[bucketIndexForPrice(czk)] += 1;
    return counts;
  }, [nearbyPrices]);
  const maxBucket = Math.max(...buckets, 1);

  const matchCount = useMemo(
    () =>
      priceMinCzk === null && priceMaxCzk === null
        ? nearbyPrices.length
        : nearbyPrices.filter(
            (czk) =>
              (priceMinCzk === null || czk >= priceMinCzk) &&
              (priceMaxCzk === null || czk <= priceMaxCzk),
          ).length,
    [nearbyPrices, priceMaxCzk, priceMinCzk],
  );

  const minValueLabel =
    priceMinCzk === null
      ? cs.compass.priceFilterFromLowest
      : cs.compass.priceFilterFrom(formatPrice(priceMinCzk, priceCurrency));
  const maxValueLabel =
    priceMaxCzk === null
      ? cs.compass.priceFilterNoLimit
      : cs.compass.priceFilterMax(formatPrice(priceMaxCzk, priceCurrency));

  const onMinAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      const next =
        event.nativeEvent.actionName === 'increment'
          ? Math.min(maxIndex, minIndex + 1)
          : Math.max(0, minIndex - 1);
      onChange(minPriceForIndex(next), priceMaxCzk);
    },
    [maxIndex, minIndex, onChange, priceMaxCzk],
  );
  const onMaxAccessibilityAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      const next =
        event.nativeEvent.actionName === 'increment'
          ? Math.min(PRICE_FILTER_STEPS.length - 1, maxIndex + 1)
          : Math.max(minIndex, maxIndex - 1);
      onChange(priceMinCzk, maxPriceForIndex(next));
    },
    [maxIndex, minIndex, onChange, priceMinCzk],
  );

  if (nearbyPrices.length === 0 && priceMinCzk === null && priceMaxCzk === null) {
    return (
      <View>
        <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.compass.priceFilterLabel}
        </Text>
        <Text style={styles.priceNoData} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.compass.priceFilterNoData}
        </Text>
      </View>
    );
  }

  const thumbTravel = Math.max(0, trackWidth - THUMB_SIZE);
  const minFraction = minIndex / (PRICE_FILTER_STEPS.length - 1);
  const maxFraction = maxIndex / (PRICE_FILTER_STEPS.length - 1);
  const rangeActive = priceMinCzk !== null || priceMaxCzk !== null;

  return (
    <View>
      <View style={styles.priceHeaderRow}>
        <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.compass.priceFilterLabel}
        </Text>
        {rangeActive && (
          <Text style={styles.priceCount} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.compass.priceFilterPubCount(matchCount)}
          </Text>
        )}
      </View>
      <View
        style={styles.priceSliderArea}
        {...panResponder.panHandlers}
      >
        {nearbyPrices.length >= HISTOGRAM_MIN_PRICES && (
          <View style={styles.priceHistogram} pointerEvents="none">
            {buckets.map((count, index) => {
              const included = index >= minIndex && index <= maxIndex;
              return (
                <View key={index} style={styles.priceBucket}>
                  <View style={styles.priceBarSlot}>
                    <View
                      style={[
                        styles.priceBar,
                        {
                          height:
                            HISTOGRAM_MIN_BAR_HEIGHT +
                            (count / maxBucket) *
                              (HISTOGRAM_MAX_BAR_HEIGHT - HISTOGRAM_MIN_BAR_HEIGHT),
                        },
                        !included && styles.priceBarExcluded,
                      ]}
                    />
                  </View>
                  <Text style={styles.priceAxisLabel} allowFontScaling={false}>
                    {PRICE_AXIS_LABELS[index]}
                  </Text>
                </View>
              );
            })}
          </View>
        )}
        <View style={styles.priceTrack} onLayout={onTrackLayout} pointerEvents="none">
          <View style={styles.priceTrackBase} />
          <View
            style={[
              styles.priceTrackFill,
              {
                left: minFraction * thumbTravel + THUMB_SIZE / 2,
                width: Math.max(0, (maxFraction - minFraction) * thumbTravel),
              },
            ]}
          />
          <View
            style={[styles.priceThumb, { transform: [{ translateX: minFraction * thumbTravel }] }]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={cs.a11y.priceFilterMinSlider}
            accessibilityValue={{ text: minValueLabel }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={onMinAccessibilityAction}
          />
          <View
            style={[styles.priceThumb, { transform: [{ translateX: maxFraction * thumbTravel }] }]}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={cs.a11y.priceFilterMaxSlider}
            accessibilityValue={{ text: maxValueLabel }}
            accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
            onAccessibilityAction={onMaxAccessibilityAction}
          />
        </View>
      </View>

      <View style={styles.priceValueRow}>
        <Text style={styles.priceValue} maxFontSizeMultiplier={FontScaleCap.body}>
          {minValueLabel}
        </Text>
        <Text
          style={[styles.priceValue, styles.priceValueEnd]}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {maxValueLabel}
        </Text>
      </View>
      {rangeActive && (
        <Text style={styles.priceHint} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.compass.priceFilterHidesUnknown}
        </Text>
      )}
    </View>
  );
}

function FilterChip({
  label,
  active,
  icon: Icon,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  active: boolean;
  icon: Glyph;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
    >
      {active ? (
        <CheckIcon size={14} color={Colors.amber} />
      ) : (
        <Icon size={15} color={Colors.foamMuted} />
      )}
      <Text
        style={[styles.chipText, active && styles.chipTextActive]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function AmenityChip({
  amenity,
  active,
  onPress,
}: {
  amenity: AmenityDef;
  active: boolean;
  onPress: () => void;
}) {
  const Icon = AMENITY_ICONS[amenity.key];
  return (
    <FilterChip
      label={amenity.shortLabel}
      active={active}
      icon={Icon}
      onPress={onPress}
      accessibilityLabel={cs.a11y.togglePubAmenityFilter(amenity.label)}
    />
  );
}

const styles = StyleSheet.create({
  cardWrap: { width: '100%', maxHeight: '92%' },
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
    alignSelf: 'center', width: 44, height: 4, borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22), marginBottom: Spacing.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  title: { flex: 1, ...MockType.titleS, color: Colors.foam },
  content: { flexGrow: 0, flexShrink: 1, marginTop: MockLayout.controlGap },
  contentContainer: { paddingBottom: Spacing.lg },
  sectionLabel: {
    marginTop: Spacing.md, marginBottom: MockLayout.controlGap,
    ...MockType.titleS, color: Colors.foam,
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46,
    paddingHorizontal: 12, borderRadius: Radius.medium, borderWidth: 1,
    borderColor: Colors.border, backgroundColor: Colors.stout3,
  },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 0, fontWeight: '600', fontSize: 15, color: Colors.foam },
  searchClear: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  results: { marginTop: Spacing.xs },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 60 },
  resultRowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.foam, 0.1) },
  resultText: { flex: 1, fontWeight: '600', fontSize: 15, color: Colors.foam },
  noResults: { paddingVertical: Spacing.md, textAlign: 'center', fontWeight: '400', fontSize: 14, color: Colors.mutedText },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rotatingFilterHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: Spacing.sm,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.24),
    backgroundColor: withAlpha(Colors.amber, 0.07),
  },
  rotatingFilterHintText: {
    flex: 1,
    fontWeight: '500',
    fontSize: 12,
    lineHeight: 17,
    color: Colors.foamMuted,
  },
  amenityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, height: MockLayout.pillHeight,
    paddingHorizontal: 12, borderRadius: Radius.pill, borderWidth: 1,
    borderColor: 'transparent', backgroundColor: Colors.stout2,
  },
  chipActive: { borderColor: withAlpha(Colors.amber, 0.5) },
  chipText: { fontWeight: '600', fontSize: 13, color: Colors.mutedText },
  chipTextActive: { color: Colors.amber },
  pressed: { opacity: 0.76, transform: [{ scale: 0.97 }] },
  priceHeaderRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  priceCount: { flexShrink: 1, textAlign: 'right', fontWeight: '600', fontSize: 12, color: Colors.amber },
  priceSliderArea: { paddingTop: Spacing.xs },
  priceHistogram: {
    flexDirection: 'row', gap: 3,
    height: 76, marginBottom: 4, paddingHorizontal: 2,
  },
  priceBucket: { flex: 1, minWidth: 0 },
  priceBarSlot: { height: 56, justifyContent: 'flex-end' },
  priceBar: { width: '100%', borderRadius: 3, backgroundColor: Colors.amber },
  priceBarExcluded: { backgroundColor: Colors.border },
  priceAxisLabel: {
    marginTop: 5, height: 15, textAlign: 'center', fontWeight: '500',
    fontSize: 9, color: Colors.mutedText,
  },
  priceTrack: {
    height: 24, justifyContent: 'center',
  },
  priceTrackBase: {
    position: 'absolute', left: 0, right: 0, height: 4, borderRadius: 2,
    backgroundColor: Colors.border,
  },
  priceTrackFill: {
    position: 'absolute', left: 0, height: 4, borderRadius: 2, backgroundColor: Colors.amber,
  },
  priceThumb: {
    position: 'absolute', left: 0,
    width: 24, height: 24, borderRadius: 12, backgroundColor: Colors.foam,
    borderWidth: 2, borderColor: Colors.amber,
  },
  priceValueRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: 6 },
  priceValue: { flex: 1, minWidth: 0, fontWeight: '600', fontSize: 14, color: Colors.foam },
  priceValueEnd: { textAlign: 'right' },
  priceHint: { marginTop: 4, fontWeight: '400', fontSize: 12, lineHeight: 16, color: Colors.mutedText },
  priceNoData: { fontWeight: '400', fontSize: 13, lineHeight: 18, color: Colors.mutedText },
  matchHint: { marginTop: Spacing.lg, marginBottom: Spacing.md, fontWeight: '400', fontSize: 12, lineHeight: 17, color: Colors.mutedText },
  limitHint: { color: Colors.amberLight },
  actions: {
    flexDirection: 'row', gap: Spacing.sm, paddingTop: Spacing.md,
  },
  secondaryButton: { minHeight: 56, paddingHorizontal: Spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Colors.stout3 },
  secondaryButtonText: { fontWeight: '700', fontSize: 14, color: Colors.foam },
  primaryButton: { flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Colors.amber },
  primaryButtonText: { fontWeight: '700', fontSize: 16, color: Colors.stout },
});
