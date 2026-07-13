import React, { type ComponentType, useCallback, useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AccessibilityIcon,
  BeerIcon,
  CheckIcon,
  CircleDotIcon,
  CreditCardIcon,
  MicIcon,
  RadioIcon,
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
  normalizePubSearchFilters,
  type BeerBrandFilterValue,
  type PubSearchFilters,
} from '@/data/pubSearchFilters';
import {
  POPULAR_BEER_BRANDS,
  suggestBeerBrands,
  type BeerBrandSuggestion,
} from '@/data/beerSuggestionsClient';
import { cs } from '@/i18n/cs';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
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
const SECTION_LABELS = {
  fun: 'ZÁBAVA',
  practical: 'PRAKTICKÉ',
  seating: 'POSEZENÍ',
} as const;

const FILTERABLE_AMENITIES = AMENITIES.filter((amenity) => amenity.mapFilterable);

interface PubFilterSheetProps {
  visible: boolean;
  value: PubSearchFilters;
  onClose: () => void;
  onApply: (value: PubSearchFilters) => void;
}

export function PubFilterSheet({ visible, value, onClose, onApply }: PubFilterSheetProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<PubSearchFilters>(() => normalizePubSearchFilters(value));
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<BeerBrandSuggestion[]>([]);
  const [suggestionsQuery, setSuggestionsQuery] = useState('');
  const [limitReached, setLimitReached] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      progress.value = 0;
      progress.value = withSpring(1, { damping: 18, stiffness: 180, mass: 0.9 });
    } else {
      progress.value = withTiming(0, { duration: 140 });
    }
  }, [progress, value, visible]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 48 }],
  }));
  const searching = query.trim().length >= 2;
  const normalizedQuery = query.trim();
  const visibleSuggestions = suggestionsQuery === normalizedQuery ? suggestions : [];
  const suggestionsPending = searching && suggestionsQuery !== normalizedQuery;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const requestedQuery = normalizedQuery;
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
    return () => controller.abort();
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
    setDraft({ beerBrand: null, amenityKeys: [] });
    setQuery('');
    setSuggestions([]);
    setSuggestionsQuery('');
    setLimitReached(false);
  }, []);

  const apply = useCallback(() => {
    onApply(normalizePubSearchFilters(draft));
    onClose();
  }, [draft, onApply, onClose]);

  const hasDraftFilters = draft.beerBrand !== null || draft.amenityKeys.length > 0;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessible={false}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.kav}
          pointerEvents="box-none"
        >
          <Pressable onPress={() => undefined} accessible={false}>
            <Animated.View
              style={[
                styles.card,
                softDrop(),
                cardAnim,
              ]}
            >
              <View style={styles.handle} />
              <View style={styles.titleRow}>
                <View style={styles.titleTextWrap}>
                  <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {cs.compass.pubFilterTitle}
                  </Text>
                  <Text style={styles.subtitle} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.compass.pubFilterSubtitle}
                  </Text>
                </View>
                <Pressable
                  onPress={onClose}
                  hitSlop={12}
                  style={styles.closeBtn}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.closePubFilters}
                >
                  <XIcon size={18} color={Colors.foamMuted} />
                </Pressable>
              </View>

              <KeyboardAwareScrollView
                style={styles.content}
                contentContainerStyle={{
                  paddingBottom: 50 + Math.max(insets.bottom, Spacing.md) + Spacing.xl,
                }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                  PIVO
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
                      visibleSuggestions.map((suggestion) => (
                        <Pressable
                          key={suggestion.slug}
                          onPress={() => chooseSuggestion(suggestion)}
                          style={styles.resultRow}
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

                {groupedAmenities.map(({ section, items }) => (
                  <View key={section}>
                    <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
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

              <View
                style={[
                  styles.actions,
                  { bottom: Math.max(insets.bottom, Spacing.md) },
                ]}
              >
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
            </Animated.View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
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
        <CheckIcon size={14} color={Colors.stout} />
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
  backdrop: { flex: 1, backgroundColor: withAlpha(Colors.black, 0.64), justifyContent: 'flex-end' },
  kav: { flex: 1, justifyContent: 'flex-end' },
  card: {
    maxHeight: '88%',
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  handle: {
    alignSelf: 'center', width: 40, height: 4, borderRadius: Radius.pill,
    backgroundColor: Colors.border, marginBottom: Spacing.md,
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  titleTextWrap: { flex: 1 },
  title: { fontFamily: Fonts.display.extrabold, fontSize: 24, color: Colors.foam },
  subtitle: { marginTop: 2, fontFamily: Fonts.ui.regular, fontSize: 13, lineHeight: 18, color: Colors.mutedText },
  closeBtn: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center', marginTop: -Spacing.xs },
  content: { marginTop: Spacing.sm },
  sectionLabel: {
    marginTop: Spacing.md, marginBottom: Spacing.sm, fontFamily: Fonts.ui.semibold,
    fontSize: 11, letterSpacing: 1.1, color: Colors.mutedText,
  },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 46,
    paddingHorizontal: 12, borderRadius: Radius.medium, borderWidth: 1,
    borderColor: Colors.border, backgroundColor: Colors.stout3,
  },
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 0, fontFamily: Fonts.ui.semibold, fontSize: 15, color: Colors.foam },
  searchClear: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  results: { marginTop: Spacing.xs },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, borderBottomWidth: 1, borderBottomColor: withAlpha(Colors.border, 0.6) },
  resultText: { flex: 1, fontFamily: Fonts.ui.semibold, fontSize: 15, color: Colors.foam },
  noResults: { paddingVertical: Spacing.md, textAlign: 'center', fontFamily: Fonts.ui.regular, fontSize: 14, color: Colors.mutedText },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: Spacing.md },
  amenityGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: HitArea.min,
    paddingHorizontal: 14, borderRadius: Radius.pill, borderWidth: 1,
    borderColor: Colors.border, backgroundColor: Colors.stout3,
  },
  chipActive: { borderColor: Colors.amber, backgroundColor: Colors.amber },
  chipText: { fontFamily: Fonts.ui.semibold, fontSize: 14, color: Colors.foam },
  chipTextActive: { color: Colors.stout },
  pressed: { opacity: 0.76, transform: [{ scale: 0.97 }] },
  matchHint: { marginTop: Spacing.lg, marginBottom: Spacing.md, fontFamily: Fonts.ui.regular, fontSize: 12, lineHeight: 17, color: Colors.mutedText },
  limitHint: { color: Colors.amberLight },
  actions: {
    position: 'absolute', left: Spacing.lg, right: Spacing.lg,
    zIndex: 1, flexDirection: 'row', gap: Spacing.sm,
  },
  secondaryButton: { minHeight: 50, paddingHorizontal: Spacing.md, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.medium, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.stout2 },
  secondaryButtonText: { fontFamily: Fonts.ui.semibold, fontSize: 14, color: Colors.foamMuted },
  primaryButton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.medium, backgroundColor: Colors.amber },
  primaryButtonText: { fontFamily: Fonts.ui.bold, fontSize: 15, color: Colors.stout },
});
