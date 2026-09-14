import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { ChevronDownIcon } from '@/components/shared/IconGlyph';
import { PubFilterSheet } from '@/components/compass/PubFilterSheet';
import type { AmenityKey } from '@/data/amenities';
import type { BeerBrandFilterOption } from '@/data/beerSuggestionsClient';
import {
  MAX_AMENITY_FILTERS,
  normalizeAmenityFilterKeys,
} from '@/data/pubSearchFilters';
import { t } from '@/i18n';
import { MenuChip } from '@/mocks/MenuChip';
import { MockLayout } from '@/mocks/mockTheme';
import { BeerFilterSheet } from '@/pubs/BeerFilterSheet';
import type { PubListFilters } from '@/pubs/pubPresentation';
import { Colors, withAlpha } from '@/theme/colors';
import { Radius, Spacing } from '@/theme/layout';

const SORTS = ['nearest', 'rating', 'random'] as const;
export type PubListSort = (typeof SORTS)[number];

const SORT_LABELS: Record<PubListSort, string> = {
  nearest: t.pubList.sortNearest,
  rating: t.pubList.sortRating,
  random: t.pubList.sortRandom,
};
const SORT_OPTIONS = SORTS.map((key) => SORT_LABELS[key]);
const sortFromLabel = (label: string): PubListSort =>
  SORTS.find((key) => SORT_LABELS[key] === label) ?? 'nearest';

const CARD_KEY: AmenityKey = 'payment_card';
const GARDEN_KEY: AmenityKey = 'seating_garden';
const FUN_KEYS = new Set<AmenityKey>([
  'game_darts',
  'game_billiards',
  'game_foosball',
  'atmosphere_sports_tv',
]);

export function PubFilterChips({
  sort,
  onSort,
  beerOptions,
  nearbyPrices,
  filters,
  onFilters,
}: {
  sort: PubListSort;
  onSort: (next: PubListSort) => void;
  beerOptions: readonly BeerBrandFilterOption[];
  nearbyPrices: number[];
  filters: PubListFilters;
  onFilters: (next: PubListFilters) => void;
}) {
  const [beerSheet, setBeerSheet] = React.useState(false);
  const [advancedSheetVisible, setAdvancedSheetVisible] = React.useState(false);
  const [advancedSheet, setAdvancedSheet] = React.useState<{
    nonce: number;
    initialSection: 'all' | 'price' | 'games';
    limitReachedInitially: boolean;
  }>({ nonce: 0, initialSection: 'all', limitReachedInitially: false });
  const labelByKey = React.useMemo(
    () => new Map(beerOptions.map((option) => [option.key, option.label])),
    [beerOptions],
  );
  const selectedLabels = filters.beers.map((key) => labelByKey.get(key) ?? key);
  const beerLabel =
    filters.beers.length === 0
      ? t.pubList.beerChip
      : filters.beers.length === 1
        ? selectedLabels[0]
        : t.pubList.beerChipCount(filters.beers.length);

  const hasAmenity = (key: AmenityKey) => filters.amenityKeys.includes(key);
  const toggleAmenity = (key: AmenityKey) => {
    if (hasAmenity(key)) {
      onFilters({
        ...filters,
        amenityKeys: filters.amenityKeys.filter((item) => item !== key),
      });
      return;
    }
    const availableAmenitySlots = MAX_AMENITY_FILTERS - (filters.tankOnly ? 1 : 0);
    if (filters.amenityKeys.length >= availableAmenitySlots) {
      openAdvancedSheet('all', true);
      return;
    }
    const next = [...filters.amenityKeys, key];
    onFilters({ ...filters, amenityKeys: normalizeAmenityFilterKeys(next) });
  };
  const openAdvancedSheet = (
    initialSection: 'all' | 'price' | 'games',
    limitReachedInitially = false,
  ) => {
    setAdvancedSheet((current) => ({
      nonce: current.nonce + 1,
      initialSection,
      limitReachedInitially,
    }));
    setAdvancedSheetVisible(true);
  };
  const priceActive = filters.priceMinCzk !== null || filters.priceMaxCzk !== null;
  const gamesActive = filters.amenityKeys.some((key) => FUN_KEYS.has(key));
  const moreActive =
    filters.tankOnly ||
    filters.includeOtherPlaces ||
    filters.amenityKeys.some(
      (key) => key !== CARD_KEY && key !== GARDEN_KEY && !FUN_KEYS.has(key),
    );

  return (
    <ScrollView
      horizontal
      testID="pub-filter-scroller"
      style={styles.scroller}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      keyboardShouldPersistTaps="handled"
    >
      <MenuChip
        value={SORT_LABELS[sort]}
        options={SORT_OPTIONS}
        title={t.pubList.sortTitle}
        onChange={(next) => onSort(sortFromLabel(next))}
      />

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
              filters.beers.length > 0
                ? t.pubList.beerChipA11y(selectedLabels.join(', '))
                : t.pubList.beerChipPick
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

      <FilterChipButton
        label={t.pubList.toggleOpen}
        active={filters.openOnly}
        onPress={() => onFilters({ ...filters, openOnly: !filters.openOnly })}
      />
      <FilterChipButton
        label={t.pubList.priceChip}
        active={priceActive}
        accessibilityLabel={t.pubList.priceChipA11y}
        onPress={() => openAdvancedSheet('price')}
      />
      <FilterChipButton
        label={t.mapPub.amenities.payment_card.short}
        active={hasAmenity(CARD_KEY)}
        accessibilityLabel={t.a11y.togglePubAmenityFilter(
          t.mapPub.amenities.payment_card.label,
        )}
        onPress={() => toggleAmenity(CARD_KEY)}
      />
      <FilterChipButton
        label={t.pubList.toggleGarden}
        active={hasAmenity(GARDEN_KEY)}
        onPress={() => toggleAmenity(GARDEN_KEY)}
      />
      <FilterChipButton
        label={t.pubList.gamesChip}
        active={gamesActive}
        accessibilityLabel={t.pubList.gamesChipA11y}
        onPress={() => openAdvancedSheet('games')}
      />
      <FilterChipButton
        label={t.pubList.moreFiltersChip}
        active={moreActive}
        accessibilityLabel={t.pubList.moreFiltersChipA11y}
        onPress={() => openAdvancedSheet('all')}
        chevron
      />

      <PubFilterSheet
        key={advancedSheet.nonce}
        visible={advancedSheetVisible}
        value={{
          beerBrand: null,
          amenityKeys: [...filters.amenityKeys],
          includeOtherPlaces: filters.includeOtherPlaces,
          priceMinCzk: filters.priceMinCzk,
          priceMaxCzk: filters.priceMaxCzk,
        }}
        showBeerFilter={false}
        showTankFilter
        tankOnly={filters.tankOnly}
        initialSection={advancedSheet.initialSection}
        limitReachedInitially={advancedSheet.limitReachedInitially}
        nearbyPrices={nearbyPrices}
        onClose={() => setAdvancedSheetVisible(false)}
        onApply={(next, extras) => {
          onFilters({
            ...filters,
            amenityKeys: next.amenityKeys,
            includeOtherPlaces: next.includeOtherPlaces === true,
            priceMinCzk: next.priceMinCzk,
            priceMaxCzk: next.priceMaxCzk,
            tankOnly: extras?.tankOnly ?? filters.tankOnly,
          });
        }}
      />
    </ScrollView>
  );
}

function FilterChipButton({
  label,
  active,
  onPress,
  accessibilityLabel = label,
  chevron = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  chevron?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]} allowFontScaling={false}>
        {label}
      </Text>
      {chevron ? (
        <ChevronDownIcon size={14} color={active ? Colors.amber : Colors.mutedText} />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroller: { flexGrow: 0, marginHorizontal: MockLayout.screenPad },
  row: {
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
  pressed: { opacity: 0.65 },
});
