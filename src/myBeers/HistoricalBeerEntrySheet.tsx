/**
 * "Dopsat piva" — the one way to put an evening into the diary from memory.
 *
 * It is the canonical 3.0 sheet (§7): the shared `BottomSheetModal` so the card
 * rises and the scrim fades, `MockLayout.screenPad` inside it, a fixed header
 * with the shared `CloseButton`, `KeyboardAwareScrollView` for the body (§13.12)
 * and the single amber action pinned below the scroll, where the thumb can
 * always reach it even with the keyboard up.
 *
 * What the design pass changed, and why:
 *
 *   uppercase micro-labels    12pt letter-spaced capitals over every field is
 *                             the Tácek habit that made this read as a form
 *                             rather than as a page of the diary (§0.5)
 *   two lines of helper copy  the section labels say what the fields are; a
 *                             subtitle and a hint under the title said it twice
 *   fields darker than the    a field is a hole you type into, so it is LIGHTER
 *   sheet                     than what it lies on and carries a hairline (§20.9)
 *   three amber surfaces      "Přidat pivo", both visibility pills and the
 *                             submit button were all filled amber. One filled
 *                             amber surface per screen (§2.2) — the submit. The
 *                             rest is the outline recipe from §6.2.
 *   `Colors.glow` on errors   glow is a shadow colour and nothing else (§2.1);
 *                             "needs your attention" is amber (§2.2)
 *
 * Everything it does is unchanged: many beers per evening with brand
 * suggestions, pub, interval, note, visibility, and one enqueue per beer line
 * through the released offline queue.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type KeyboardEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BeerIcon, LockKeyholeIcon, PlusIcon, UsersIcon, XIcon } from '@/components/shared/IconGlyph';
import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { generateUuidV4 } from '@/data/account';
import { type BeerCheckInInput, type BeerCheckInVisibility } from '@/data/beerCheckinsClient';
import { enqueueBeerCheckInOp } from '@/data/beerCheckinsQueue';
import { suggestBeerBrands, type BeerBrandSuggestion } from '@/data/beerSuggestionsClient';
import { cs } from '@/i18n/cs';
import { useToastStore } from '@/stores/toastStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { MockColors, MockLayout } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { currencyFractionDigits, currencySuffix, parsePriceInputToCzk, sanitizePriceInput } from '@/utils/currency';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import {
  buildHistoricalInterval,
  formatHistoricalDate,
  formatHistoricalTime,
} from '@/myBeers/historicalBeerEntry';

interface HistoricalBeerEntrySheetProps {
  visible: boolean;
  onClose: () => void;
  onSaved: (entries: BeerCheckInInput[]) => void;
}

interface BeerLine {
  id: string;
  beerName: string;
  quantityText: string;
  priceText: string;
  suggestions: BeerBrandSuggestion[];
  pickedBeerName: string | null;
}

interface ParsedBeerLine {
  beerName: string;
  quantity: number;
  priceCzk: number | null;
  quantityValid: boolean;
  priceValid: boolean;
}

const MAX_BEER_LINES = 10;

function createBeerLine(): BeerLine {
  return {
    id: generateUuidV4(),
    beerName: '',
    quantityText: '1',
    priceText: '',
    suggestions: [],
    pickedBeerName: null,
  };
}

function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (event: KeyboardEvent) => setHeight(event.endCoordinates?.height ?? 0);
    const onHide = () => setHeight(0);
    const showSub = Keyboard.addListener(showEvt, onShow);
    const hideSub = Keyboard.addListener(hideEvt, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  return height;
}

/** Sentence-case section label — the shape of a heading, not a kicker. */
function FieldLabel({ children, first = false }: { children: string; first?: boolean }) {
  return (
    <Text
      style={[styles.label, first && styles.labelFirst]}
      maxFontSizeMultiplier={FontScaleCap.body}
    >
      {children}
    </Text>
  );
}

export function HistoricalBeerEntrySheet({ visible, onClose, onSaved }: HistoricalBeerEntrySheetProps) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const keyboardHeight = useKeyboardHeight();
  const showToast = useToastStore((s) => s.show);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const initialDate = new Date();
  const scrollRef = useRef<ScrollView>(null);

  const [dateText, setDateText] = useState(() => formatHistoricalDate(initialDate));
  const [startTimeText, setStartTimeText] = useState(() => formatHistoricalTime(initialDate));
  const [endTimeText, setEndTimeText] = useState('');
  const [pubName, setPubName] = useState('');
  const [beerLines, setBeerLines] = useState<BeerLine[]>(() => [createBeerLine()]);
  const [activeBeerLineId, setActiveBeerLineId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<BeerCheckInVisibility>('friends');
  const [dateError, setDateError] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let frame: number | null = null;
    const timer = setTimeout(() => {
      const date = new Date();
      setDateText(formatHistoricalDate(date));
      setStartTimeText(formatHistoricalTime(date));
      setEndTimeText('');
      setPubName('');
      setBeerLines([createBeerLine()]);
      setActiveBeerLineId(null);
      setNote('');
      setVisibility('friends');
      setDateError(false);
      frame = requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      });
    }, 0);
    return () => {
      clearTimeout(timer);
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [visible]);

  const cleanPub = pubName.trim();
  const parsedBeerLines: ParsedBeerLine[] = useMemo(
    () =>
      beerLines.map((line) => {
        const quantity = Number(line.quantityText || '0');
        const cleanPrice = line.priceText.trim();
        const priceCzk = cleanPrice ? parsePriceInputToCzk(cleanPrice, priceCurrency) : null;
        return {
          beerName: line.beerName.trim(),
          quantity,
          priceCzk,
          quantityValid: Number.isInteger(quantity) && quantity >= 1 && quantity <= 99,
          priceValid: cleanPrice.length === 0 || priceCzk !== null,
        };
      }),
    [beerLines, priceCurrency],
  );
  const beerLinesValid =
    parsedBeerLines.length > 0 &&
    parsedBeerLines.every((line) => line.beerName.length > 0 && line.quantityValid && line.priceValid);
  const canSubmit = cleanPub.length > 0 && beerLinesValid;

  const updateBeerLine = useCallback((id: string, patch: Partial<BeerLine>) => {
    setBeerLines((current) => current.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }, []);

  const onChangeBeerName = useCallback(
    (id: string, value: string) => {
      updateBeerLine(id, { beerName: value, pickedBeerName: null, suggestions: [] });
      setActiveBeerLineId(id);
    },
    [updateBeerLine],
  );

  const selectSuggestion = useCallback(
    (id: string, suggestion: BeerBrandSuggestion) => {
      updateBeerLine(id, {
        beerName: suggestion.name,
        pickedBeerName: suggestion.name,
        suggestions: [],
      });
      Keyboard.dismiss();
    },
    [updateBeerLine],
  );

  /**
   * Suggestions belong to the field you are typing in. They used to survive the
   * jump to "Hospoda", so a list of Kozels sat over a third of the sheet while
   * you typed a pub name into a field it had nothing to do with.
   */
  const dismissSuggestions = useCallback(() => {
    setActiveBeerLineId(null);
    setBeerLines((current) =>
      current.some((line) => line.suggestions.length > 0)
        ? current.map((line) => (line.suggestions.length > 0 ? { ...line, suggestions: [] } : line))
        : current,
    );
  }, []);

  const addBeerLine = useCallback(() => {
    if (beerLines.length >= MAX_BEER_LINES) return;
    const next = createBeerLine();
    setBeerLines((current) => (current.length >= MAX_BEER_LINES ? current : [...current, next]));
    setActiveBeerLineId(next.id);
  }, [beerLines.length]);

  const removeBeerLine = useCallback((id: string) => {
    setBeerLines((current) => (current.length > 1 ? current.filter((line) => line.id !== id) : current));
    setActiveBeerLineId((current) => (current === id ? null : current));
  }, []);

  const activeBeerLine = beerLines.find((line) => line.id === activeBeerLineId);
  const activeBeerName = activeBeerLine?.beerName ?? '';
  const activePickedBeerName = activeBeerLine?.pickedBeerName ?? null;

  useEffect(() => {
    const query = activeBeerName.trim();
    if (!visible || !activeBeerLineId || query.length < 2 || activePickedBeerName === activeBeerName) {
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      suggestBeerBrands(query, controller.signal, 6).then((items) => {
        if (!controller.signal.aborted) updateBeerLine(activeBeerLineId, { suggestions: items });
      });
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [activeBeerLineId, activeBeerName, activePickedBeerName, updateBeerLine, visible]);

  const reset = useCallback(() => {
    setPubName('');
    setEndTimeText('');
    setBeerLines([createBeerLine()]);
    setActiveBeerLineId(null);
    setNote('');
    setVisibility('friends');
    setDateError(false);
  }, []);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const checked = buildHistoricalInterval(dateText, startTimeText, endTimeText);
    if (!checked) {
      setDateError(true);
      return;
    }
    setDateError(false);
    const visitClientId = generateUuidV4();
    const payloads: BeerCheckInInput[] = parsedBeerLines.map((line) => ({
      clientId: generateUuidV4(),
      beerName: line.beerName,
      breweryName: '',
      beerStyle: '',
      quantity: line.quantity,
      priceCzk: line.priceCzk,
      rating: null,
      note: note.trim(),
      tags: [],
      pubName: cleanPub,
      pubCity: '',
      visitClientId,
      visibility,
      checkedInAt: checked.iso,
      endedAt: checked.endedIso ?? null,
    }));
    void Promise.all(payloads.map((payload) => enqueueBeerCheckInOp({ op: 'checkin', payload }))).then(() => {
      showToast(cs.myBeers.historicalSaved(payloads.length), {
        icon: <BeerIcon size={20} color={Colors.amber} />,
      });
      reset();
      onSaved(payloads);
      onClose();
    });
  }, [
    canSubmit,
    cleanPub,
    dateText,
    endTimeText,
    note,
    onClose,
    onSaved,
    parsedBeerLines,
    reset,
    showToast,
    startTimeText,
    visibility,
  ]);

  // The card is lifted above the keyboard rather than shrunk into it, so the
  // pinned action stays reachable while a field is focused. The scroll is told
  // about it (`keyboardAvoidedExternally`) so it does not inset a second time.
  const sheetBottomOffset = keyboardHeight > 0 ? keyboardHeight : 0;
  const bottomPad = keyboardHeight > 0 ? Spacing.md : insets.bottom + Spacing.lg;
  const maxHeight = windowHeight - insets.top - sheetBottomOffset - Spacing.md;
  const isPrivate = visibility === 'private';

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      {/* Height bound and keyboard lift on the card itself, not on a wrapper:
          the bound has to be a definite pixel height (the keyboard changes it),
          and a definite parent is exactly what lets the scroll below shrink and
          keep the pinned action on screen (§7.5). */}
      <View style={[styles.card, { marginBottom: sheetBottomOffset, maxHeight, paddingBottom: bottomPad }]}>
        <View style={styles.grabber} />

        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.myBeers.historicalTitle}
          </Text>
          <CloseButton onPress={onClose} label={cs.myBeers.editDrinkCancel} />
        </View>

        <KeyboardAwareScrollView
          ref={scrollRef}
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardAvoidedExternally
          contentContainerStyle={styles.scrollContent}
        >
          <FieldLabel first>{cs.myBeers.historicalBeersLabel}</FieldLabel>
          {beerLines.map((line, index) => {
            const parsed = parsedBeerLines[index];
            return (
              <View key={line.id} style={[styles.beerLine, index > 0 && styles.beerLineDivider]}>
                <View style={styles.beerLineTop}>
                  <TextInput
                    value={line.beerName}
                    onFocus={() => setActiveBeerLineId(line.id)}
                    onChangeText={(value) => onChangeBeerName(line.id, value)}
                    placeholder={index === 0 ? cs.beerCheckins.beerPlaceholder : cs.myBeers.historicalNextBeerPlaceholder}
                    placeholderTextColor={MockColors.fieldHint}
                    style={[styles.input, styles.beerNameInput]}
                    maxLength={80}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  />
                  {beerLines.length > 1 ? (
                    <Pressable
                      onPress={() => removeBeerLine(line.id)}
                      style={({ pressed }) => [styles.removeBeerButton, pressed && styles.dim]}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={cs.a11y.myBeersRemoveHistoricalBeer(line.beerName || `${index + 1}`)}
                    >
                      <XIcon size={16} color={Colors.mutedText} />
                    </Pressable>
                  ) : null}
                </View>

                {line.suggestions.length > 0 ? (
                  <View style={styles.suggestionsBox}>
                    {line.suggestions.map((suggestion, suggestionIndex) => (
                      <Pressable
                        key={suggestion.slug}
                        onPress={() => selectSuggestion(line.id, suggestion)}
                        style={({ pressed }) => [
                          styles.suggestionRow,
                          suggestionIndex > 0 && styles.suggestionRowDivider,
                          pressed && styles.dim,
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={suggestion.name}
                      >
                        <Text style={styles.suggestionText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                          {suggestion.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}

                <View style={styles.lineMetaRow}>
                  <View style={styles.countCol}>
                    <Text style={styles.miniLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.myBeers.historicalQuantityLabel}
                    </Text>
                    <TextInput
                      value={line.quantityText}
                      onFocus={dismissSuggestions}
                      onChangeText={(value) =>
                        updateBeerLine(line.id, { quantityText: value.replace(/\D/g, '').slice(0, 2) })
                      }
                      placeholder="1"
                      placeholderTextColor={MockColors.fieldHint}
                      style={[styles.input, !parsed.quantityValid && styles.inputError]}
                      keyboardType="number-pad"
                      maxFontSizeMultiplier={FontScaleCap.body}
                    />
                  </View>
                  <View style={styles.priceCol}>
                    <Text style={styles.miniLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.myBeers.historicalPriceLabel}
                    </Text>
                    <View style={[styles.priceInputWrap, !parsed.priceValid && styles.inputError]}>
                      <TextInput
                        value={line.priceText}
                        onFocus={dismissSuggestions}
                        onChangeText={(value) =>
                          updateBeerLine(line.id, { priceText: sanitizePriceInput(value, priceCurrency) })
                        }
                        placeholder={cs.myBeers.historicalPricePlaceholder}
                        placeholderTextColor={MockColors.fieldHint}
                        style={styles.priceInput}
                        keyboardType={currencyFractionDigits(priceCurrency) > 0 ? 'decimal-pad' : 'number-pad'}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      />
                      <Text style={styles.priceSuffix} maxFontSizeMultiplier={FontScaleCap.body}>
                        {currencySuffix(priceCurrency)}
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            );
          })}

          {/* Outline, never filled: the one filled amber surface on this sheet
              is the button that saves the evening (§2.2, §6.2). */}
          {beerLines.length < MAX_BEER_LINES ? (
            <Pressable
              onPress={addBeerLine}
              style={({ pressed }) => [styles.addBeer, pressed && styles.dim]}
              accessibilityRole="button"
              accessibilityLabel={cs.myBeers.historicalAddBeer}
            >
              <PlusIcon size={16} color={Colors.amber} />
              <Text style={styles.addBeerText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.myBeers.historicalAddBeer}
              </Text>
            </Pressable>
          ) : null}

          <FieldLabel>{cs.myBeers.historicalPubLabel}</FieldLabel>
          <TextInput
            value={pubName}
            onFocus={dismissSuggestions}
            onChangeText={setPubName}
            placeholder={cs.myBeers.historicalPubPlaceholder}
            placeholderTextColor={MockColors.fieldHint}
            style={styles.input}
            maxLength={120}
            maxFontSizeMultiplier={FontScaleCap.body}
          />

          <View style={styles.dateTimeRow}>
            <View style={styles.dateCol}>
              <FieldLabel>{cs.myBeers.historicalDateLabel}</FieldLabel>
              <TextInput
                value={dateText}
                onFocus={dismissSuggestions}
                onChangeText={(value) => {
                  setDateError(false);
                  setDateText(value);
                }}
                placeholder={cs.myBeers.historicalDatePlaceholder}
                placeholderTextColor={MockColors.fieldHint}
                style={[styles.input, dateError && styles.inputError]}
                keyboardType="numbers-and-punctuation"
                maxFontSizeMultiplier={FontScaleCap.body}
              />
            </View>
            <View style={styles.timeCol}>
              <FieldLabel>{cs.myBeers.historicalTimeFromLabel}</FieldLabel>
              <TextInput
                value={startTimeText}
                onFocus={dismissSuggestions}
                onChangeText={(value) => {
                  setDateError(false);
                  setStartTimeText(value);
                }}
                placeholder={cs.myBeers.historicalTimePlaceholder}
                placeholderTextColor={MockColors.fieldHint}
                style={[styles.input, styles.timeInput, dateError && styles.inputError]}
                keyboardType="numbers-and-punctuation"
                maxFontSizeMultiplier={FontScaleCap.body}
              />
            </View>
            <View style={styles.timeCol}>
              <FieldLabel>{cs.myBeers.historicalTimeToLabel}</FieldLabel>
              <TextInput
                value={endTimeText}
                onFocus={dismissSuggestions}
                onChangeText={(value) => {
                  setDateError(false);
                  setEndTimeText(value);
                }}
                placeholder={cs.myBeers.historicalTimeToPlaceholder}
                placeholderTextColor={MockColors.fieldHint}
                style={[styles.input, styles.timeInput, dateError && styles.inputError]}
                keyboardType="numbers-and-punctuation"
                maxFontSizeMultiplier={FontScaleCap.body}
              />
            </View>
          </View>
          {dateError ? (
            <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.myBeers.historicalDateError}
            </Text>
          ) : null}

          <FieldLabel>{cs.beerCheckins.noteLabel}</FieldLabel>
          <TextInput
            value={note}
            onFocus={dismissSuggestions}
            onChangeText={setNote}
            placeholder={cs.beerCheckins.notePlaceholder}
            placeholderTextColor={MockColors.fieldHint}
            style={[styles.input, styles.noteInput]}
            multiline
            maxLength={1000}
            maxFontSizeMultiplier={FontScaleCap.body}
          />

          {/* The one place helper copy earns its line: this decides who else
              ever sees the evening, and the two words alone do not say it. */}
          <FieldLabel>{cs.beerCheckins.visibilityLabel}</FieldLabel>
          <Text style={styles.visibilityHint} maxFontSizeMultiplier={FontScaleCap.body}>
            {isPrivate
              ? cs.myBeers.historicalVisibilityPrivateHint
              : cs.myBeers.historicalVisibilityFriendsHint}
          </Text>
          <View style={styles.visibilityRow}>
            <Pressable
              onPress={() => setVisibility('private')}
              style={({ pressed }) => [
                styles.visibilityButton,
                isPrivate && styles.visibilityButtonActive,
                pressed && styles.dim,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: isPrivate }}
              accessibilityLabel={cs.beerCheckins.visibilityPrivate}
            >
              <LockKeyholeIcon size={16} color={isPrivate ? Colors.amber : Colors.mutedText} />
              <Text
                style={[styles.visibilityText, isPrivate && styles.visibilityTextActive]}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {cs.beerCheckins.visibilityPrivate}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setVisibility('friends')}
              style={({ pressed }) => [
                styles.visibilityButton,
                !isPrivate && styles.visibilityButtonActive,
                pressed && styles.dim,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: !isPrivate }}
              accessibilityLabel={cs.beerCheckins.visibilityFriends}
            >
              <UsersIcon size={16} color={!isPrivate ? Colors.amber : Colors.mutedText} />
              <Text
                style={[styles.visibilityText, !isPrivate && styles.visibilityTextActive]}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {cs.beerCheckins.visibilityFriends}
              </Text>
            </Pressable>
          </View>
        </KeyboardAwareScrollView>

        {/* Pinned outside the scroll: the action must never be the thing you
            have to scroll for, and with the card lifted it also stays clear
            of the keyboard (§7.2, §13.11). */}
        <View style={styles.actions}>
          <Pressable
            onPress={submit}
            disabled={!canSubmit}
            style={({ pressed }) => [styles.submit, (pressed || !canSubmit) && styles.dim]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit }}
            accessibilityLabel={cs.myBeers.historicalSubmit}
          >
            <Text style={styles.submitText} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.myBeers.historicalSubmit}
            </Text>
          </Pressable>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  // Height bounds on the wrapper, never on the card: a percentage resolves
  // against the parent, and a card whose scroll is unbounded silently hides
  // everything below the fold (§7.5). This one is capped in points because the
  // keyboard changes the available height.
  card: {
    width: '100%',
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  title: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 22,
    letterSpacing: -0.3,
    color: Colors.foam,
    includeFontPadding: false,
  },

  // `flexShrink` rather than `flex: 1`: the card is sized by its content up to
  // maxHeight, so the scroll must be allowed to be short on a two-field form
  // and to give way to the pinned footer on a ten-beer one.
  scroll: { flexShrink: 1 },
  scrollContent: { paddingBottom: Spacing.md },

  label: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
    fontWeight: '600',
    fontSize: 14,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  labelFirst: { marginTop: Spacing.md },
  miniLabel: {
    marginBottom: 6,
    fontWeight: '500',
    fontSize: 12,
    color: Colors.mutedText,
    includeFontPadding: false,
  },

  // A field is a hole you type into: lighter than the sheet it lies on, with a
  // hairline around it (§20.9). Never darker, never borderless.
  input: {
    minHeight: HitArea.min,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: MockColors.fieldBorder,
    backgroundColor: MockColors.field,
    color: Colors.foam,
    paddingHorizontal: Spacing.md,
    fontWeight: '500',
    fontSize: 15,
  },
  inputError: { borderColor: withAlpha(Colors.amber, 0.5) },
  errorText: {
    marginTop: Spacing.sm,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.amber,
  },
  noteInput: {
    minHeight: 64,
    paddingTop: Spacing.sm,
    textAlignVertical: 'top',
  },

  beerLine: { gap: Spacing.sm },
  beerLineDivider: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.08),
  },
  beerLineTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  beerNameInput: { flex: 1 },
  removeBeerButton: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  lineMetaRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  countCol: { flex: 0.8 },
  priceCol: { flex: 1.2 },
  priceInputWrap: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: MockColors.fieldBorder,
    backgroundColor: MockColors.field,
    paddingHorizontal: Spacing.md,
  },
  priceInput: {
    flex: 1,
    color: Colors.foam,
    fontWeight: '500',
    fontSize: 15,
    padding: 0,
  },
  priceSuffix: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.mutedText,
  },

  addBeer: {
    marginTop: Spacing.md,
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.18),
    backgroundColor: withAlpha(Colors.amber, 0.06),
  },
  addBeerText: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },

  suggestionsBox: {
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: MockColors.fieldBorder,
    backgroundColor: MockColors.field,
    overflow: 'hidden',
  },
  suggestionRow: {
    minHeight: HitArea.min,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  suggestionRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.08),
  },
  suggestionText: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
  },

  dateTimeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  dateCol: { flex: 1.25 },
  timeCol: { flex: 1 },
  timeInput: { paddingHorizontal: Spacing.sm },

  visibilityRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  // Amber marks the ACTIVE state, it does not fill the control (§2.2). Two
  // filled pills beside a filled button was three amber surfaces on one sheet.
  visibilityButton: {
    flex: 1,
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: MockColors.fieldBorder,
    backgroundColor: MockColors.field,
  },
  visibilityButtonActive: {
    backgroundColor: withAlpha(Colors.amber, 0.06),
    borderColor: withAlpha(Colors.amber, 0.32),
  },
  visibilityText: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  visibilityTextActive: { color: Colors.amber },
  visibilityHint: {
    marginTop: -6,
    marginBottom: Spacing.md,
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },

  actions: {
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  submit: {
    height: MockLayout.sheetButtonHeight,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  submitText: {
    fontWeight: '700',
    fontSize: 16,
    color: Colors.stout,
    includeFontPadding: false,
  },
  dim: { opacity: 0.6 },
});
