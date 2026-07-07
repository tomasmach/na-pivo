/**
 * Beer-brand filter as a bottom sheet.
 *
 * Replaces the always-on text field that used to sit above the compass and eat
 * a row of vertical space even when unused. The trigger now lives as an icon in
 * the TitleBar; this sheet is an overlay, so it costs the home screen zero
 * permanent height.
 *
 * Interaction is tap-first: the dominant Czech/Slovak brands are offered as
 * one-tap chips (POPULAR_BEER_BRANDS) so a user standing in a pub never has to
 * type. The search field stays pinned at the top — always above the keyboard —
 * for the long tail; once the query is 2+ chars the chips swap out for live
 * suggestions (suggestBeerBrands, backend with local fallback).
 *
 * Visuals follow the Brass Taproom system: stout sheet, amber accents, a spring
 * slide-up over a dimmed scrim.
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing, HitArea } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { BeerIcon, SearchIcon, XIcon, CheckIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import {
  suggestBeerBrands,
  POPULAR_BEER_BRANDS,
  type BeerBrandSuggestion,
} from '@/data/beerSuggestionsClient';

export interface BeerBrandFilterValue {
  key: string;
  label: string;
}

interface BeerBrandFilterSheetProps {
  visible: boolean;
  value: BeerBrandFilterValue | null;
  onClose: () => void;
  /** Pass null to clear the filter ("Všechna piva"). */
  onSelect: (value: BeerBrandFilterValue | null) => void;
}

export function BeerBrandFilterSheet({
  visible,
  value,
  onClose,
  onSelect,
}: BeerBrandFilterSheetProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<BeerBrandSuggestion[]>([]);

  // Clear the field on every close path (event handlers — never in render/effect)
  // so the next open starts fresh without resetting state from an effect.
  const handleClose = useCallback(() => {
    setQuery('');
    setSuggestions([]);
    onClose();
  }, [onClose]);

  // Spring the card up over the scrim (Reanimated shared value — not React state).
  const progress = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      progress.value = 0;
      progress.value = withSpring(1, { damping: 18, stiffness: 180, mass: 0.9 });
    } else {
      progress.value = withTiming(0, { duration: 140 });
    }
  }, [visible, progress]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 48 }],
  }));

  const searching = query.trim().length >= 2;

  // Fetch suggestions only while actively searching. Stale results stay in state
  // but are never rendered (the UI gates on `searching`), so there's no need to
  // clear them synchronously here.
  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    suggestBeerBrands(query, controller.signal, 8)
      .then((items) => {
        if (!controller.signal.aborted) setSuggestions(items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSuggestions([]);
      });
    return () => controller.abort();
  }, [query, searching]);

  const handlePickBrand = useCallback(
    (next: BeerBrandFilterValue | null) => {
      onSelect(next);
      handleClose();
    },
    [onSelect, handleClose],
  );

  const handlePickSuggestion = useCallback(
    (suggestion: BeerBrandSuggestion) => {
      handlePickBrand({
        key: suggestion.brandSlug ?? suggestion.slug,
        label: suggestion.brandName ?? suggestion.name,
      });
    },
    [handlePickBrand],
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      <Pressable style={styles.backdrop} onPress={handleClose} accessibilityRole="button">
        <KeyboardAvoidingView
          behavior="padding"
          style={styles.kav}
          pointerEvents="box-none"
        >
          {/* Stop backdrop dismissal when tapping inside the card */}
          <Pressable onPress={() => undefined}>
            <Animated.View
              style={[
                styles.card,
                softDrop(),
                { paddingBottom: Math.max(insets.bottom, Spacing.md) },
                cardAnim,
              ]}
            >
              <View style={styles.handle} />

              <View style={styles.titleRow}>
                <View style={styles.titleTextWrap}>
                  <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {cs.compass.beerFilterSheetTitle}
                  </Text>
                  <Text style={styles.subtitle} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.compass.beerFilterSheetSubtitle}
                  </Text>
                </View>
                <Pressable
                  onPress={handleClose}
                  hitSlop={12}
                  style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.6 }]}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.closeBeerBrandFilter}
                >
                  <XIcon size={18} color={Colors.foamMuted} />
                </Pressable>
              </View>

              {/* Search — pinned at top, always above the keyboard */}
              <View style={styles.searchRow}>
                <SearchIcon size={16} color={Colors.mutedText} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={cs.compass.beerFilterSearchPlaceholder}
                  placeholderTextColor={Colors.mutedText}
                  style={styles.searchInput}
                  autoCapitalize="words"
                  autoCorrect={false}
                  returnKeyType="search"
                  maxFontSizeMultiplier={FontScaleCap.body}
                  accessibilityLabel={cs.a11y.beerBrandFilterInput}
                />
                {query.length > 0 && (
                  <Pressable
                    onPress={() => setQuery('')}
                    hitSlop={10}
                    style={({ pressed }) => [styles.searchClear, pressed && { opacity: 0.6 }]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.a11y.clearBeerBrandFilter}
                  >
                    <XIcon size={15} color={Colors.foamMuted} />
                  </Pressable>
                )}
              </View>

              {searching ? (
                <ScrollView
                  style={styles.results}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                  {suggestions.length === 0 ? (
                    <Text style={styles.noResults} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.compass.beerFilterNoResults}
                    </Text>
                  ) : (
                    suggestions.map((s) => (
                      <Pressable
                        key={s.slug}
                        onPress={() => handlePickSuggestion(s)}
                        style={({ pressed }) => [styles.resultRow, pressed && { opacity: 0.7 }]}
                        accessibilityRole="button"
                        accessibilityLabel={cs.a11y.beerBrandFilterSuggestion(s.name)}
                      >
                        <BeerIcon size={15} color={Colors.mutedText} />
                        <View style={styles.resultTextWrap}>
                          <Text
                            style={styles.resultText}
                            numberOfLines={1}
                            maxFontSizeMultiplier={FontScaleCap.body}
                          >
                            {s.name}
                          </Text>
                          {s.kind === 'product' && s.brandName && (
                            <Text
                              style={styles.resultMeta}
                              numberOfLines={1}
                              maxFontSizeMultiplier={FontScaleCap.body}
                            >
                              {s.brandName}
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    ))
                  )}
                </ScrollView>
              ) : (
                <View>
                  {/* Reset to all beers — only when a filter is active */}
                  {value && (
                    <Pressable
                      onPress={() => handlePickBrand(null)}
                      style={({ pressed }) => [styles.resetRow, pressed && { opacity: 0.7 }]}
                      accessibilityRole="button"
                      accessibilityLabel={cs.compass.beerFilterAll}
                    >
                      <BeerIcon size={15} color={Colors.amber} />
                      <Text style={styles.resetText} maxFontSizeMultiplier={FontScaleCap.body}>
                        {cs.compass.beerFilterAll}
                      </Text>
                    </Pressable>
                  )}

                  <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.compass.beerFilterPopular}
                  </Text>
                  <View style={styles.chipsWrap}>
                    {POPULAR_BEER_BRANDS.map((brand) => {
                      const active = value?.key === brand.key;
                      return (
                        <Pressable
                          key={brand.key}
                          onPress={() =>
                            handlePickBrand({ key: brand.key, label: brand.short })
                          }
                          style={({ pressed }) => [
                            styles.chip,
                            active && styles.chipActive,
                            pressed && { opacity: 0.75 },
                          ]}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          accessibilityLabel={cs.a11y.selectBeerBrand(brand.label)}
                        >
                          {active && <CheckIcon size={14} color={Colors.stout} />}
                          <Text
                            style={[styles.chipText, active && styles.chipTextActive]}
                            numberOfLines={1}
                            maxFontSizeMultiplier={FontScaleCap.body}
                          >
                            {brand.short}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              )}
            </Animated.View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  kav: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  card: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    marginBottom: Spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  titleTextWrap: {
    flex: 1,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  subtitle: {
    marginTop: 2,
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  closeBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -Spacing.xs,
    marginTop: -Spacing.xs,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    marginTop: Spacing.md,
    paddingHorizontal: 12,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 0,
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  searchClear: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  results: {
    maxHeight: 280,
    marginTop: Spacing.sm,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: withAlpha(Colors.border, 0.6),
  },
  resultTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  resultText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  resultMeta: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  noResults: {
    paddingVertical: Spacing.lg,
    textAlign: 'center',
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    color: Colors.mutedText,
  },
  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    marginTop: Spacing.md,
    paddingHorizontal: 12,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },
  resetText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.amberLight,
  },
  sectionLabel: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.mutedText,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
  },
  chipActive: {
    borderColor: Colors.amber,
    backgroundColor: Colors.amber,
  },
  chipText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    color: Colors.foam,
  },
  chipTextActive: {
    color: Colors.stout,
  },
});
