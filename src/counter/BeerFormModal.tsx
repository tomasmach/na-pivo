/**
 * One modal used for the app's beer-entry flows:
 *   • add a brand-new beer (name + price + volume),
 *   • prompt for a missing price on a menu beer (price + volume; name locked),
 *   • edit the price of a menu beer (price + volume; name locked),
 *   • add or edit a pub-menu row from ContributeScreen (name unlocked, price optional).
 *
 * Mirrors the ContributeScreen beer-entry precedent: name max 80, number-pad
 * price digits-only 1..1000, volume pills 0,3 l / 0,4 l / 0,5 l / Jiné (custom ml).
 *
 * Keyboard handling: a React Native `Modal` hosts its own UIWindow, so
 * `KeyboardAvoidingView` measures the keyboard against the wrong window on iOS
 * and the lower inputs end up hidden behind the keyboard. Instead we track the
 * real keyboard height via `Keyboard` events and lift the bottom sheet above
 * it, capping it with `maxHeight` + an inner `ScrollView` so it always fits.
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  Platform,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardHeight } from '@/utils/useKeyboardHeight';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';

import { MockColors } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing, HitArea } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { GlowButton } from '@/components/shared/GlowButton';
import { CameraIcon, PlusIcon, Trash2Icon, XIcon } from '@/components/shared/IconGlyph';
import { BetaBadge } from '@/components/shared/BetaBadge';
import { fireLightImpactHaptic } from '@/utils/haptics';
import { cs, formatVolume } from '@/i18n/cs';
import { isAllowedBeerVolume, type CommunityBeer } from '@/data/communityHours';
import type { DrinkType, PlaceContext, ServingType } from '@/drinks/drinkTypes';
import { suggestBeerBrands, type BeerBrandSuggestion } from '@/data/beerSuggestionsClient';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  currencyFractionDigits,
  currencySuffix,
  formatPriceInputFromCzk,
  parsePriceInputToCzk,
  pricePlaceholder,
  sanitizePriceInput,
} from '@/utils/currency';

const VOLUME_SMALL = 300;
const VOLUME_MEDIUM = 400;
const VOLUME_DEFAULT = 500;
const BEER_VOLUME_PRESETS = [VOLUME_SMALL, VOLUME_MEDIUM, VOLUME_DEFAULT];
// Outside a pub the natural beer formats are the lahváč/plechovka sizes.
const OUTSIDE_BEER_VOLUME_PRESETS = [330, VOLUME_DEFAULT];
const SHOT_VOLUME_PRESETS = [20, 40, 50];
// Pub wine pours: 1 dl / 1,5 dl / "dvojka" (the default order at the bar).
const WINE_VOLUME_PRESETS = [100, 150, 200];

// Serving choices offered outside a pub, lahváč first (the most common case);
// draft last for the keg-at-the-cottage crowd. In a pub the row never shows.
const OUTSIDE_SERVING_TYPES: readonly ServingType[] = ['bottle', 'can', 'plastic_bottle', 'draft'];

function volumePresets(drinkType: DrinkType, outside: boolean): number[] {
  if (drinkType === 'shot') return SHOT_VOLUME_PRESETS;
  if (drinkType === 'wine') return WINE_VOLUME_PRESETS;
  return outside ? OUTSIDE_BEER_VOLUME_PRESETS : BEER_VOLUME_PRESETS;
}

function defaultVolume(drinkType: DrinkType): number {
  if (drinkType === 'shot') return 40;
  if (drinkType === 'wine') return 200;
  return VOLUME_DEFAULT;
}

/**
 * Sanitize custom volume (10..200 ml for shots, otherwise 10..3000). Beer is
 * further restricted to the community-menu set — the drinks endpoint rejects
 * other beer volumes with a 400, which would silently drop the queued drink.
 */
function parseCustomMl(text: string, drinkType: DrinkType): number | undefined {
  const digits = text.replace(/[^0-9]/g, '');
  if (!digits) return undefined;
  const n = parseInt(digits, 10);
  if (drinkType === 'beer') return isAllowedBeerVolume(n) ? n : undefined;
  const max = drinkType === 'shot' ? 200 : 3000;
  if (!Number.isFinite(n) || n < 10 || n > max) return undefined;
  return n;
}

export type BeerFormMode = 'add' | 'price' | 'edit' | 'menu';

export interface BeerFormResult {
  drinkType: DrinkType;
  name: string;
  /** Absent only outside a pub (price optional there). */
  priceCzk?: number;
  volumeMl?: number;
  /** Set only outside a pub, for beer. */
  servingType?: ServingType;
}

interface BeerFormModalProps {
  visible: boolean;
  mode: BeerFormMode;
  /** Prefilled beer (name locked in 'price'/'edit'; price/volume seed the form). */
  beer?: CommunityBeer | null;
  initialDrinkType?: DrinkType;
  lockNameInEdit?: boolean;
  /** Where the drink is being logged. Outside a pub ('private'/'outdoors'/
   *  'other') the form asks how the beer is served and the price is optional. */
  placeContext?: PlaceContext;
  /** Seed for the serving row — the session's last used choice. */
  initialServingType?: ServingType;
  /** Changes per open so the form body remounts with fresh, prop-seeded state. */
  formKey?: string | number;
  onCancel: () => void;
  onSubmit: (result: BeerFormResult) => void;
  /** Optional copy overrides when the shared form is used outside the live counter. */
  titleOverride?: string;
  submitLabelOverride?: string;
  /** 'add' mode only: shows the "vyfoť celý lístek" shortcut into the AI menu scan. */
  onScanMenu?: () => void;
  /** Menu mode only: remove the current row from the pub's draft menu. */
  onRemove?: () => void;
  /** Menu mode only: add a 0,3 l sibling directly below this row. */
  onAddSmallVariant?: () => void;
  canAddSmallVariant?: boolean;
}

/**
 * Outer shell: owns the RN Modal + visibility. The inner form body is keyed by
 * the open instance (`formKey`) so every open mounts a FRESH body whose state is
 * initialized from props — no re-seeding effect, no setState-in-effect.
 */
export function BeerFormModal({
  visible,
  mode,
  beer,
  initialDrinkType = 'beer',
  lockNameInEdit = true,
  placeContext = 'pub',
  initialServingType,
  formKey,
  onCancel,
  onSubmit,
  titleOverride,
  submitLabelOverride,
  onScanMenu,
  onRemove,
  onAddSmallVariant,
  canAddSmallVariant = false,
}: BeerFormModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onCancel}
    >
      {visible ? (
        <BeerFormBody
          key={formKey ?? 0}
          mode={mode}
          beer={beer}
          initialDrinkType={initialDrinkType}
          lockNameInEdit={lockNameInEdit}
          placeContext={placeContext}
          initialServingType={initialServingType}
          onCancel={onCancel}
          onSubmit={onSubmit}
          titleOverride={titleOverride}
          submitLabelOverride={submitLabelOverride}
          onScanMenu={onScanMenu}
          onRemove={onRemove}
          onAddSmallVariant={onAddSmallVariant}
          canAddSmallVariant={canAddSmallVariant}
        />
      ) : null}
    </Modal>
  );
}

interface BeerFormBodyProps {
  mode: BeerFormMode;
  beer?: CommunityBeer | null;
  initialDrinkType: DrinkType;
  lockNameInEdit: boolean;
  placeContext: PlaceContext;
  initialServingType?: ServingType;
  onCancel: () => void;
  onSubmit: (result: BeerFormResult) => void;
  titleOverride?: string;
  submitLabelOverride?: string;
  onScanMenu?: () => void;
  onRemove?: () => void;
  onAddSmallVariant?: () => void;
  canAddSmallVariant: boolean;
}

function BeerFormBody({
  mode,
  beer,
  initialDrinkType,
  lockNameInEdit,
  placeContext,
  initialServingType,
  onCancel,
  onSubmit,
  titleOverride,
  submitLabelOverride,
  onScanMenu,
  onRemove,
  onAddSmallVariant,
  canAddSmallVariant,
}: BeerFormBodyProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const menuMode = mode === 'menu';
  const nameLocked = mode === 'price' || (mode === 'edit' && lockNameInEdit);
  const outside = placeContext !== 'pub';
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const [drinkType, setDrinkType] = useState<DrinkType>(initialDrinkType);
  // "Jak je podané?" — asked only outside a pub, beer only. Seeded with the
  // session's last choice so the second lahváč is a single confirm.
  const [servingType, setServingType] = useState<ServingType>(initialServingType ?? 'bottle');

  // Initialized once at mount from props (the body is remounted per open).
  const [name, setName] = useState(beer?.name ?? '');

  // Beer-name autocomplete (only in 'add' mode; 'price'/'edit' lock the name).
  const [suggestions, setSuggestions] = useState<BeerBrandSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  // After picking a suggestion we keep the list dismissed until the user edits
  // the field again — otherwise the effect would instantly re-fetch the pick.
  const pickedNameRef = useRef<string | null>(null);

  const onChangeName = (text: string) => {
    pickedNameRef.current = null;
    setName(text);
  };

  const selectSuggestion = (suggestion: BeerBrandSuggestion) => {
    pickedNameRef.current = suggestion.name;
    setName(suggestion.name);
    setSuggestions([]);
    setSuggestionsLoading(false);
    Keyboard.dismiss();
  };

  const [priceText, setPriceText] = useState(
    typeof beer?.priceCzk === 'number' ? formatPriceInputFromCzk(beer.priceCzk, priceCurrency) : '',
  );

  // Volume: either a preset pill (300/400/500) or a free-typed custom ml ("Jiné").
  const initialPresets = menuMode
    ? [VOLUME_SMALL, VOLUME_DEFAULT]
    : volumePresets(drinkType, outside);
  const seedVolume = beer?.volumeMl ?? (mode === 'add' ? defaultVolume(initialDrinkType) : undefined);
  const seedIsPreset = typeof seedVolume === 'number' && initialPresets.includes(seedVolume);
  const [selectedPreset, setSelectedPreset] = useState<number | undefined>(seedIsPreset ? seedVolume : undefined);
  const [customActive, setCustomActive] = useState<boolean>(
    (menuMode && seedVolume == null) || (typeof seedVolume === 'number' && !seedIsPreset),
  );
  const [customMl, setCustomMl] = useState<string>(
    typeof seedVolume === 'number' && !seedIsPreset ? String(seedVolume) : '',
  );

  const trimmedName = name.trim();
  const priceCzk = parsePriceInputToCzk(priceText, priceCurrency);
  // Outside a pub the price is optional: an empty field is fine (unknown stays
  // unknown), a non-empty one must still parse.
  const priceValid =
    outside || menuMode ? priceText.trim() === '' || priceCzk !== null : priceCzk !== null;
  const nameValid = nameLocked || trimmedName.length > 0;
  const canSubmit = priceValid && nameValid;
  const placeholder = menuMode
    ? cs.contribute.beerPriceOptional
    : outside
      ? cs.counter.outsidePricePlaceholder
      : pricePlaceholder(priceCurrency);

  // Debounced beer-name suggestions: fetch once the name is 2+ chars and was
  // typed (not just picked). Falls back to a local brand list when offline.
  useEffect(() => {
    if (nameLocked || drinkType !== 'beer') return;
    const query = trimmedName;
    if (query.length < 2 || pickedNameRef.current === name) {
      const reset = setTimeout(() => {
        setSuggestions([]);
        setSuggestionsLoading(false);
      }, 0);
      return () => clearTimeout(reset);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      if (!controller.signal.aborted) setSuggestionsLoading(true);
      suggestBeerBrands(query, controller.signal, 6)
        .then((items) => {
          if (!controller.signal.aborted) setSuggestions(items);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSuggestionsLoading(false);
        });
    }, 220);
    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [drinkType, name, trimmedName, nameLocked]);

  // The effective volume: custom ml when "Jiné" is active, otherwise the pill.
  // Volume stays optional — an empty/invalid custom field simply omits it.
  const volumeMl = customActive
    ? menuMode
      ? undefined
      : parseCustomMl(customMl, drinkType)
    : selectedPreset;

  const title =
    titleOverride ??
    (mode === 'add'
      ? cs.counter.addDrinkModalTitle(drinkType)
      : mode === 'edit'
        ? cs.counter.editModalTitle
        : mode === 'menu'
          ? beer
            ? cs.contribute.editBeerSheetTitle
            : cs.contribute.addBeerSheetTitle
          : cs.counter.priceModalTitle);

  const submitLabel =
    submitLabelOverride ??
    (mode === 'edit'
      ? cs.counter.confirmSave
      : mode === 'menu'
        ? cs.contribute.done
        : cs.counter.confirmDrink(drinkType));

  const selectPreset = (value: number) => {
    setSelectedPreset(value);
    setCustomActive(false);
  };

  const selectCustom = () => {
    setCustomActive(true);
    setSelectedPreset(undefined);
  };

  const selectDrinkType = (next: DrinkType) => {
    setDrinkType(next);
    setSuggestions([]);
    setSelectedPreset(defaultVolume(next));
    setCustomActive(false);
    setCustomMl('');
  };

  const handleSubmit = () => {
    if (!canSubmit) return;
    const result: BeerFormResult = {
      drinkType,
      name: nameLocked ? (beer?.name ?? '') : trimmedName.slice(0, 80),
    };
    if (typeof priceCzk === 'number') result.priceCzk = priceCzk;
    if (typeof volumeMl === 'number') result.volumeMl = volumeMl;
    if (outside && drinkType === 'beer') result.servingType = servingType;
    onSubmit(result);
  };

  // Lift the whole sheet above the keyboard; keep bottom padding for safe-area
  // comfort only. Padding the card by the keyboard height grows the hidden part
  // of the sheet instead of moving inputs into view inside a modal UIWindow.
  const sheetBottomOffset = keyboardHeight > 0 ? keyboardHeight : -insets.bottom;
  // Behind the keyboard there is no home-indicator to clear, so the safe-area
  // bottom padding would just be a dead brown strip sitting on the keyboard.
  const bottomPad = keyboardHeight > 0 ? Spacing.lg : insets.bottom + Spacing.lg;
  const maxHeight =
    windowHeight - insets.top - Math.max(keyboardHeight, 0) - Spacing.lg;

  return (
    <View style={styles.backdrop}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onCancel}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
      <View style={[styles.cardWrap, { marginBottom: sheetBottomOffset, maxHeight }]}>
        <Pressable
          style={[styles.card, { paddingBottom: bottomPad }]}
          onPress={() => undefined}
        >
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text
              style={styles.title}
              numberOfLines={2}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {title}
            </Text>
            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.counter.cancel}
            >
              <XIcon size={20} color={Colors.foamMuted} />
            </Pressable>
          </View>

          <KeyboardAwareScrollView
            style={styles.list}
            keyboardAvoidedExternally
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.cardContent}
            bounces={false}
          >
            {mode === 'add' || (mode === 'edit' && !lockNameInEdit) ? (
              <View style={styles.typeGroup}>
                {(['beer', 'wine', 'soft_drink', 'shot'] as const).map((type) => {
                  const selected = drinkType === type;
                  return (
                    <Pressable
                      key={type}
                      onPress={() => selectDrinkType(type)}
                      style={[styles.typePill, selected && styles.typePillSelected]}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={cs.counter.drinkTypeLabel(type)}
                    >
                      <Text
                        style={[styles.typePillText, selected && styles.typePillTextSelected]}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {cs.counter.drinkTypeLabel(type)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}

            {nameLocked && beer?.name ? (
              <Text
                style={styles.lockedName}
                numberOfLines={2}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {beer.name}
              </Text>
            ) : (
              <TextInput
                style={styles.nameInput}
                value={name}
                onChangeText={onChangeName}
                placeholder={cs.counter.drinkNamePlaceholder(drinkType)}
                placeholderTextColor={MockColors.fieldHint}
                maxLength={80}
                autoFocus
                accessibilityLabel={cs.counter.drinkNamePlaceholder(drinkType)}
              />
            )}

            {!nameLocked && (suggestions.length > 0 || suggestionsLoading) ? (
              <View style={styles.suggestionsBox}>
                {suggestions.map((suggestion, index) => (
                  <Pressable
                    key={suggestion.slug}
                    onPress={() => selectSuggestion(suggestion)}
                    style={[styles.suggestionRow, index > 0 && styles.suggestionRowDivider]}
                    accessibilityRole="button"
                    accessibilityLabel={suggestion.name}
                  >
                    <Text
                      style={styles.suggestionText}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {suggestion.name}
                    </Text>
                  </Pressable>
                ))}
                {suggestionsLoading && suggestions.length === 0 ? (
                  <Text style={styles.suggestionsLoading} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.contribute.beerSuggestionsLoading}
                  </Text>
                ) : null}
              </View>
            ) : null}

            {!nameLocked && drinkType === 'beer' && onScanMenu ? (
              <Pressable
                onPress={() => {
                  fireLightImpactHaptic();
                  Keyboard.dismiss();
                  onScanMenu();
                }}
                style={({ pressed }) => [
                  styles.scanShortcut,
                  pressed && styles.scanShortcutPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={cs.counter.scanMenuShortcut}
              >
                <CameraIcon size={16} color={Colors.amber} />
                <Text style={styles.scanShortcutText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.counter.scanMenuShortcut}
                </Text>
                <BetaBadge tone="muted" />
              </Pressable>
            ) : null}

            {outside && drinkType === 'beer' ? (
              <>
                <Text style={styles.volumeLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.counter.servingLabel}
                </Text>
                <View style={styles.volumeGroup}>
                  {OUTSIDE_SERVING_TYPES.map((value) => {
                    const isSelected = servingType === value;
                    return (
                      <Pressable
                        key={value}
                        onPress={() => setServingType(value)}
                        style={[styles.volumePill, isSelected && styles.volumePillSelected]}
                        hitSlop={4}
                        accessibilityRole="button"
                        accessibilityState={{ selected: isSelected }}
                        accessibilityLabel={cs.counter.servingTypeLabel(value)}
                      >
                        <Text
                          style={[
                            styles.volumePillText,
                            isSelected && styles.volumePillTextSelected,
                          ]}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {cs.counter.servingTypeLabel(value)}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}

            <View style={styles.priceRow}>
              <TextInput
                style={styles.priceInput}
                value={priceText}
                onChangeText={(value) =>
                  setPriceText(sanitizePriceInput(value, priceCurrency))
                }
                placeholder={placeholder}
                placeholderTextColor={MockColors.fieldHint}
                keyboardType={
                  currencyFractionDigits(priceCurrency) > 0 ? 'decimal-pad' : 'number-pad'
                }
                maxLength={currencyFractionDigits(priceCurrency) > 0 ? 10 : 7}
                autoFocus={nameLocked}
                accessibilityLabel={placeholder}
                maxFontSizeMultiplier={FontScaleCap.heading}
              />
              <Text style={styles.priceSuffix} maxFontSizeMultiplier={FontScaleCap.heading}>
                {currencySuffix(priceCurrency)}
              </Text>
            </View>

            <Text style={styles.volumeLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.counter.priceLabel}
            </Text>
            <View style={styles.volumeGroup}>
              {initialPresets.map((value) => {
                const isSelected = !customActive && selectedPreset === value;
                return (
                  <Pressable
                    key={value}
                    onPress={() => selectPreset(value)}
                    style={[styles.volumePill, isSelected && styles.volumePillSelected]}
                    hitSlop={4}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    accessibilityLabel={formatVolume(value)}
                  >
                    <Text
                      style={[
                        styles.volumePillText,
                        isSelected && styles.volumePillTextSelected,
                      ]}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {formatVolume(value)}
                    </Text>
                  </Pressable>
                );
              })}
              <Pressable
                onPress={selectCustom}
                style={[styles.volumePill, customActive && styles.volumePillSelected]}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityState={{ selected: customActive }}
                accessibilityLabel={cs.counter.volumeOther}
              >
                <Text
                  style={[
                    styles.volumePillText,
                    customActive && styles.volumePillTextSelected,
                  ]}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.counter.volumeOther}
                </Text>
              </Pressable>
            </View>

            {customActive && !menuMode ? (
              <View style={styles.customRow}>
                <TextInput
                  style={styles.customInput}
                  value={customMl}
                  onChangeText={(value) =>
                    setCustomMl(value.replace(/[^0-9]/g, '').slice(0, 4))
                  }
                  placeholder={cs.counter.volumeCustomPlaceholder}
                  placeholderTextColor={MockColors.fieldHint}
                  keyboardType="number-pad"
                  maxLength={4}
                  autoFocus
                  accessibilityLabel={cs.counter.volumeCustomPlaceholder}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                />
                <Text style={styles.customSuffix} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {cs.counter.volumeUnitMl}
                </Text>
              </View>
            ) : null}
          </KeyboardAwareScrollView>

          <View style={styles.actions}>
            <View style={styles.submitWrap}>
              <GlowButton
                label={submitLabel}
                onPress={handleSubmit}
                glow={canSubmit ? 'soft' : 'none'}
                accessibilityLabel={submitLabel}
              />
              {!canSubmit ? (
                <View style={styles.submitDisabledOverlay} pointerEvents="auto" />
              ) : null}
            </View>

            {menuMode && (canAddSmallVariant || onRemove) ? (
              <View style={styles.menuActions}>
                {canAddSmallVariant && onAddSmallVariant ? (
                  <Pressable
                    onPress={onAddSmallVariant}
                    style={({ pressed }) => [styles.menuAction, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.contribute.addSmallBeer}
                  >
                    <PlusIcon size={16} color={Colors.amber} />
                    <Text style={styles.menuActionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.contribute.addSmallBeer}
                    </Text>
                  </Pressable>
                ) : null}
                {onRemove ? (
                  <Pressable
                    onPress={onRemove}
                    style={({ pressed }) => [styles.menuAction, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.a11y.contributeRemoveBeer}
                  >
                    <Trash2Icon size={16} color={Colors.mutedText} />
                    <Text
                      style={styles.menuActionMuted}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {cs.contribute.removeBeer}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}

            <Pressable
              onPress={onCancel}
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.counter.cancel}
            >
              <Text style={styles.cancelText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.counter.cancel}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.7),
    justifyContent: 'flex-end',
  },
  cardWrap: {
    width: '100%',
    minHeight: '56%',
    maxHeight: '92%',
  },
  card: {
    flex: 1,
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    ...softDrop(),
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: Spacing.sm,
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
  cardContent: {
    gap: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
    includeFontPadding: false,
  },
  typeGroup: {
    flexDirection: 'row',
    padding: 3,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  typePill: {
    flex: 1,
    minHeight: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 9,
    borderRadius: Radius.pill,
  },
  typePillSelected: {
    backgroundColor: withAlpha(Colors.amber, 0.18),
  },
  typePillText: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  typePillTextSelected: {
    color: Colors.amber,
  },
  lockedName: {
    fontWeight: '700',
    fontSize: 17,
    color: Colors.amber,
    includeFontPadding: false,
  },
  nameInput: {
    backgroundColor: Colors.stout3,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.small,
    color: Colors.foam,
    fontWeight: '400',
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },
  suggestionsBox: {
    marginTop: -8,
    backgroundColor: Colors.stout3,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.small,
    overflow: 'hidden',
  },
  suggestionRow: {
    minHeight: HitArea.min,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  suggestionRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  suggestionText: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  suggestionsLoading: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  scanShortcut: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: HitArea.min,
    marginTop: -4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.3),
    backgroundColor: withAlpha(Colors.amber, 0.06),
  },
  scanShortcutPressed: {
    transform: [{ scale: 0.98 }],
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  scanShortcutText: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.amber,
    includeFontPadding: false,
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  priceInput: {
    flex: 1,
    backgroundColor: Colors.stout3,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.small,
    color: Colors.foam,
    fontWeight: '700',
    fontSize: 22,
    lineHeight: 30,
    fontVariant: ['tabular-nums'],
    minHeight: 56,
    paddingHorizontal: 14,
    // The single-line field centres itself on iOS. Extra vertical padding
    // pushes Baloo's tall line box into the clipping edge of UITextField.
    paddingVertical: Platform.OS === 'ios' ? 0 : 10,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  priceSuffix: {
    fontWeight: '700',
    fontSize: 22,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  volumeLabel: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.mutedText,
    marginBottom: -6,
    includeFontPadding: false,
  },
  volumeGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  volumePill: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  volumePillSelected: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  volumePillText: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  volumePillTextSelected: {
    color: Colors.stout,
  },
  customRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  customInput: {
    flex: 1,
    backgroundColor: Colors.stout3,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.small,
    color: Colors.foam,
    fontWeight: '700',
    fontSize: 20,
    lineHeight: 28,
    fontVariant: ['tabular-nums'],
    minHeight: 52,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 0 : 8,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  customSuffix: {
    fontWeight: '700',
    fontSize: 20,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  actions: {
    gap: 4,
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  submitWrap: {
    position: 'relative',
  },
  submitDisabledOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: withAlpha(Colors.stout, 0.5),
    borderRadius: Radius.pill,
  },
  menuActions: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  menuAction: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  menuActionLabel: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.amber,
    includeFontPadding: false,
  },
  menuActionMuted: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  cancelButton: {
    alignSelf: 'center',
    minHeight: HitArea.min,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  cancelText: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.6,
  },
});
