import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  Modal,
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
import { generateUuidV4 } from '@/data/account';
import { type BeerCheckInInput, type BeerCheckInVisibility } from '@/data/beerCheckinsClient';
import { enqueueBeerCheckInOp } from '@/data/beerCheckinsQueue';
import { suggestBeerBrands, type BeerBrandSuggestion } from '@/data/beerSuggestionsClient';
import { cs } from '@/i18n/cs';
import { useToastStore } from '@/stores/toastStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
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

  const sheetBottomOffset = keyboardHeight > 0 ? keyboardHeight : 0;
  const bottomPad = keyboardHeight > 0 ? Spacing.sm : Math.max(insets.bottom, Spacing.md);
  const maxHeight = windowHeight - insets.top - sheetBottomOffset - Spacing.md;

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" />
        <View style={[styles.sheet, { marginBottom: sheetBottomOffset, paddingBottom: bottomPad, maxHeight }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.myBeers.historicalTitle}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.myBeers.historicalSubtitle}
              </Text>
              <Text style={styles.hint} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.myBeers.historicalRequiredHint}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityRole="button">
              <XIcon size={18} color={Colors.foamMuted} />
            </Pressable>
          </View>

          <KeyboardAwareScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
            bounces={false}
          >
            <View style={styles.sectionLabelRow}>
              <Text style={styles.label}>{cs.myBeers.historicalBeersLabel}</Text>
              <Pressable
                onPress={addBeerLine}
                disabled={beerLines.length >= MAX_BEER_LINES}
                style={[styles.addBeerButton, beerLines.length >= MAX_BEER_LINES && styles.dim]}
                accessibilityRole="button"
              >
                <PlusIcon size={15} color={Colors.stout} />
                <Text style={styles.addBeerText}>{cs.myBeers.historicalAddBeer}</Text>
              </Pressable>
            </View>
            <View style={styles.beerLines}>
              {beerLines.map((line, index) => {
                const parsed = parsedBeerLines[index];
                return (
                  <View key={line.id} style={styles.beerLine}>
                    <View style={styles.beerLineTop}>
                      <TextInput
                        value={line.beerName}
                        onFocus={() => setActiveBeerLineId(line.id)}
                        onChangeText={(value) => onChangeBeerName(line.id, value)}
                        placeholder={index === 0 ? cs.beerCheckins.beerPlaceholder : cs.myBeers.historicalNextBeerPlaceholder}
                        placeholderTextColor={Colors.mutedText}
                        style={[styles.input, styles.beerNameInput]}
                        maxLength={80}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      />
                      {beerLines.length > 1 ? (
                        <Pressable
                          onPress={() => removeBeerLine(line.id)}
                          style={styles.removeBeerButton}
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
                            style={[styles.suggestionRow, suggestionIndex > 0 && styles.suggestionRowDivider]}
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
                        <Text style={styles.miniLabel}>{cs.myBeers.historicalQuantityLabel}</Text>
                        <TextInput
                          value={line.quantityText}
                          onChangeText={(value) =>
                            updateBeerLine(line.id, { quantityText: value.replace(/\D/g, '').slice(0, 2) })
                          }
                          placeholder="1"
                          placeholderTextColor={Colors.mutedText}
                          style={[styles.input, styles.compactInput, !parsed.quantityValid && styles.inputError]}
                          keyboardType="number-pad"
                          maxFontSizeMultiplier={FontScaleCap.body}
                        />
                      </View>
                      <View style={styles.priceCol}>
                        <Text style={styles.miniLabel}>{cs.myBeers.historicalPriceLabel}</Text>
                        <View style={[styles.priceInputWrap, styles.compactPriceInputWrap, !parsed.priceValid && styles.inputError]}>
                          <TextInput
                            value={line.priceText}
                            onChangeText={(value) =>
                              updateBeerLine(line.id, { priceText: sanitizePriceInput(value, priceCurrency) })
                            }
                            placeholder={cs.myBeers.historicalPricePlaceholder}
                            placeholderTextColor={Colors.mutedText}
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
            </View>

            <Text style={styles.label}>{cs.myBeers.historicalPubLabel}</Text>
            <TextInput
              value={pubName}
              onChangeText={setPubName}
              placeholder={cs.myBeers.historicalPubPlaceholder}
              placeholderTextColor={Colors.mutedText}
              style={styles.input}
              maxLength={120}
              maxFontSizeMultiplier={FontScaleCap.body}
            />

            <View style={styles.dateTimeRow}>
              <View style={styles.dateCol}>
                <Text style={styles.label}>{cs.myBeers.historicalDateLabel}</Text>
                <TextInput
                  value={dateText}
                  onChangeText={(value) => {
                    setDateError(false);
                    setDateText(value);
                  }}
                  placeholder={cs.myBeers.historicalDatePlaceholder}
                  placeholderTextColor={Colors.mutedText}
                  style={[styles.input, dateError && styles.inputError]}
                  keyboardType="numbers-and-punctuation"
                  maxFontSizeMultiplier={FontScaleCap.body}
                />
              </View>
              <View style={styles.timeCol}>
                <Text style={styles.label}>{cs.myBeers.historicalTimeFromLabel}</Text>
                <TextInput
                  value={startTimeText}
                  onChangeText={(value) => {
                    setDateError(false);
                    setStartTimeText(value);
                  }}
                  placeholder={cs.myBeers.historicalTimePlaceholder}
                  placeholderTextColor={Colors.mutedText}
                  style={[styles.input, dateError && styles.inputError]}
                  keyboardType="numbers-and-punctuation"
                  maxFontSizeMultiplier={FontScaleCap.body}
                />
              </View>
              <View style={styles.timeCol}>
                <Text style={styles.label}>{cs.myBeers.historicalTimeToLabel}</Text>
                <TextInput
                  value={endTimeText}
                  onChangeText={(value) => {
                    setDateError(false);
                    setEndTimeText(value);
                  }}
                  placeholder={cs.myBeers.historicalTimeToPlaceholder}
                  placeholderTextColor={Colors.mutedText}
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

            <Text style={styles.label}>{cs.beerCheckins.noteLabel}</Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={cs.beerCheckins.notePlaceholder}
              placeholderTextColor={Colors.mutedText}
              style={[styles.input, styles.noteInput]}
              multiline
              maxLength={1000}
              maxFontSizeMultiplier={FontScaleCap.body}
            />

            <Text style={styles.label}>{cs.beerCheckins.visibilityLabel}</Text>
            <Text style={styles.visibilityHint} maxFontSizeMultiplier={FontScaleCap.body}>
              {visibility === 'friends'
                ? cs.myBeers.historicalVisibilityFriendsHint
                : cs.myBeers.historicalVisibilityPrivateHint}
            </Text>
            <View style={styles.visibilityRow}>
              <Pressable
                onPress={() => setVisibility('private')}
                style={[styles.visibilityButton, visibility === 'private' && styles.visibilityButtonActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: visibility === 'private' }}
              >
                <LockKeyholeIcon size={16} color={visibility === 'private' ? Colors.stout : Colors.mutedText} />
                <Text style={[styles.visibilityText, visibility === 'private' && styles.visibilityTextActive]}>
                  {cs.beerCheckins.visibilityPrivate}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setVisibility('friends')}
                style={[styles.visibilityButton, visibility === 'friends' && styles.visibilityButtonActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: visibility === 'friends' }}
              >
                <UsersIcon size={16} color={visibility === 'friends' ? Colors.stout : Colors.mutedText} />
                <Text style={[styles.visibilityText, visibility === 'friends' && styles.visibilityTextActive]}>
                  {cs.beerCheckins.visibilityFriends}
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              style={({ pressed }) => [styles.submit, (pressed || !canSubmit) && styles.dim]}
              accessibilityRole="button"
            >
              <Text style={styles.submitText}>{cs.myBeers.historicalSubmit}</Text>
            </Pressable>
          </KeyboardAwareScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: withAlpha(Colors.stout, 0.76),
  },
  sheet: {
    maxHeight: '92%',
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  headerText: { flex: 1 },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 21,
    color: Colors.foam,
  },
  subtitle: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    lineHeight: 16,
    color: Colors.foamMuted,
  },
  hint: {
    marginTop: 3,
    fontFamily: Fonts.ui.medium,
    fontSize: 11,
    lineHeight: 15,
    color: Colors.mutedText,
  },
  closeBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: {
    paddingBottom: Spacing.sm,
  },
  sectionLabelRow: {
    marginTop: Spacing.sm,
    marginBottom: 5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  label: {
    marginTop: Spacing.sm,
    marginBottom: 5,
    fontFamily: Fonts.display.bold,
    fontSize: 12,
    color: Colors.mutedText,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  miniLabel: {
    marginBottom: 4,
    fontFamily: Fonts.display.bold,
    fontSize: 10,
    color: Colors.mutedText,
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },
  addBeerButton: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    paddingHorizontal: 10,
  },
  addBeerText: {
    fontFamily: Fonts.display.bold,
    fontSize: 11,
    color: Colors.stout,
  },
  beerLines: {
    gap: Spacing.xs,
  },
  beerLine: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.xs,
    gap: Spacing.xs,
  },
  beerLineTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  beerNameInput: {
    flex: 1,
    minHeight: 42,
    backgroundColor: Colors.stout,
  },
  removeBeerButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  lineMetaRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  input: {
    minHeight: 46,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    color: Colors.foam,
    paddingHorizontal: Spacing.md,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
  },
  inputError: {
    borderColor: Colors.glow,
  },
  errorText: {
    marginTop: Spacing.xs,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.glow,
  },
  noteInput: {
    minHeight: 56,
    paddingTop: Spacing.sm,
    textAlignVertical: 'top',
  },
  dateTimeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  dateCol: {
    flex: 1.25,
  },
  timeCol: {
    flex: 1,
  },
  countCol: {
    flex: 0.8,
  },
  priceCol: {
    flex: 1.2,
  },
  timeInput: {
    paddingHorizontal: Spacing.sm,
  },
  compactInput: {
    minHeight: 40,
    backgroundColor: Colors.stout,
  },
  priceInputWrap: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    paddingHorizontal: Spacing.md,
  },
  compactPriceInputWrap: {
    minHeight: 40,
    backgroundColor: Colors.stout,
  },
  priceInput: {
    flex: 1,
    color: Colors.foam,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    padding: 0,
  },
  priceSuffix: {
    fontFamily: Fonts.display.bold,
    fontSize: 12,
    color: Colors.mutedText,
  },
  suggestionsBox: {
    marginTop: Spacing.xs,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    overflow: 'hidden',
  },
  suggestionRow: {
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
  },
  suggestionRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  suggestionText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  visibilityHint: {
    marginTop: -2,
    marginBottom: Spacing.xs,
    fontFamily: Fonts.ui.medium,
    fontSize: 11,
    lineHeight: 15,
    color: Colors.mutedText,
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  visibilityButton: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  visibilityButtonActive: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  visibilityText: {
    fontFamily: Fonts.display.bold,
    fontSize: 12,
    color: Colors.foamMuted,
  },
  visibilityTextActive: {
    color: Colors.stout,
  },
  submit: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  submitText: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.stout,
  },
  dim: {
    opacity: 0.6,
  },
});
