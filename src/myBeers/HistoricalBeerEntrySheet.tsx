import { useCallback, useEffect, useRef, useState } from 'react';
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

import { BeerIcon, LockKeyholeIcon, UsersIcon, XIcon } from '@/components/shared/IconGlyph';
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
import { currencySuffix, parsePriceInputToCzk, sanitizePriceInput } from '@/utils/currency';
import {
  buildHistoricalInterval,
  formatHistoricalDate,
  formatHistoricalTime,
} from '@/myBeers/historicalBeerEntry';

interface HistoricalBeerEntrySheetProps {
  visible: boolean;
  onClose: () => void;
  onSaved: (entry: BeerCheckInInput) => void;
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
  const pickedBeerRef = useRef<string | null>(null);

  const [dateText, setDateText] = useState(() => formatHistoricalDate(initialDate));
  const [startTimeText, setStartTimeText] = useState(() => formatHistoricalTime(initialDate));
  const [endTimeText, setEndTimeText] = useState('');
  const [quantityText, setQuantityText] = useState('1');
  const [priceText, setPriceText] = useState('');
  const [pubName, setPubName] = useState('');
  const [beerName, setBeerName] = useState('');
  const [suggestions, setSuggestions] = useState<BeerBrandSuggestion[]>([]);
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<BeerCheckInVisibility>('friends');
  const [dateError, setDateError] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      const date = new Date();
      setDateText(formatHistoricalDate(date));
      setStartTimeText(formatHistoricalTime(date));
      setEndTimeText('');
      setQuantityText('1');
      setPriceText('');
      setPubName('');
      setBeerName('');
      setSuggestions([]);
      pickedBeerRef.current = null;
      setNote('');
      setVisibility('friends');
      setDateError(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [visible]);

  const cleanBeer = beerName.trim();
  const cleanPub = pubName.trim();
  const quantity = Number(quantityText || '0');
  const cleanPrice = priceText.trim();
  const priceCzk = cleanPrice ? parsePriceInputToCzk(cleanPrice, priceCurrency) : null;
  const quantityValid = Number.isInteger(quantity) && quantity >= 1 && quantity <= 99;
  const priceValid = cleanPrice.length === 0 || priceCzk !== null;
  const canSubmit = cleanBeer.length > 0 && cleanPub.length > 0 && quantityValid && priceValid;

  const onChangeBeerName = useCallback((value: string) => {
    pickedBeerRef.current = null;
    setBeerName(value);
  }, []);

  const selectSuggestion = useCallback((suggestion: BeerBrandSuggestion) => {
    pickedBeerRef.current = suggestion.name;
    setBeerName(suggestion.name);
    setSuggestions([]);
    Keyboard.dismiss();
  }, []);

  useEffect(() => {
    const query = cleanBeer;
    if (!visible || query.length < 2 || pickedBeerRef.current === beerName) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      suggestBeerBrands(query, controller.signal, 6).then((items) => {
        if (!controller.signal.aborted) setSuggestions(items);
      });
    }, 220);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [beerName, cleanBeer, visible]);

  const reset = useCallback(() => {
    setPubName('');
    setBeerName('');
    setEndTimeText('');
    setQuantityText('1');
    setPriceText('');
    setSuggestions([]);
    pickedBeerRef.current = null;
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
    const payload: BeerCheckInInput = {
      clientId: generateUuidV4(),
      beerName: cleanBeer,
      breweryName: '',
      beerStyle: '',
      quantity,
      priceCzk,
      rating: null,
      note: note.trim(),
      tags: [],
      pubName: cleanPub,
      pubCity: '',
      visitClientId: null,
      visibility,
      checkedInAt: checked.iso,
      endedAt: checked.endedIso ?? null,
    };
    void enqueueBeerCheckInOp({
      op: 'checkin',
      payload,
    }).then(() => {
      showToast(cs.myBeers.historicalSaved, { icon: <BeerIcon size={20} color={Colors.amber} /> });
      reset();
      onSaved(payload);
      onClose();
    });
  }, [
    canSubmit,
    cleanBeer,
    cleanPub,
    dateText,
    endTimeText,
    note,
    onClose,
    onSaved,
    reset,
    showToast,
    startTimeText,
    priceCzk,
    quantity,
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

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.scrollContent}
            bounces={false}
          >
            <Text style={styles.label}>{cs.beerCheckins.beerLabel}</Text>
            <TextInput
              value={beerName}
              onChangeText={onChangeBeerName}
              placeholder={cs.beerCheckins.beerPlaceholder}
              placeholderTextColor={Colors.mutedText}
              style={styles.input}
              maxLength={80}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
            {suggestions.length > 0 ? (
              <View style={styles.suggestionsBox}>
                {suggestions.map((suggestion, index) => (
                  <Pressable
                    key={suggestion.slug}
                    onPress={() => selectSuggestion(suggestion)}
                    style={[styles.suggestionRow, index > 0 && styles.suggestionRowDivider]}
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

            <View style={styles.countPriceRow}>
              <View style={styles.countCol}>
                <Text style={styles.label}>{cs.myBeers.historicalQuantityLabel}</Text>
                <TextInput
                  value={quantityText}
                  onChangeText={(value) => setQuantityText(value.replace(/\D/g, '').slice(0, 2))}
                  placeholder="1"
                  placeholderTextColor={Colors.mutedText}
                  style={[styles.input, !quantityValid && styles.inputError]}
                  keyboardType="number-pad"
                  maxFontSizeMultiplier={FontScaleCap.body}
                />
              </View>
              <View style={styles.priceCol}>
                <Text style={styles.label}>{cs.myBeers.historicalPriceLabel}</Text>
                <View style={[styles.priceInputWrap, !priceValid && styles.inputError]}>
                  <TextInput
                    value={priceText}
                    onChangeText={(value) => setPriceText(sanitizePriceInput(value, priceCurrency))}
                    placeholder={cs.myBeers.historicalPricePlaceholder}
                    placeholderTextColor={Colors.mutedText}
                    style={styles.priceInput}
                    keyboardType={priceCurrency === 'EUR' ? 'decimal-pad' : 'number-pad'}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  />
                  <Text style={styles.priceSuffix} maxFontSizeMultiplier={FontScaleCap.body}>
                    {currencySuffix(priceCurrency)}
                  </Text>
                </View>
              </View>
            </View>

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
          </ScrollView>
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
  label: {
    marginTop: Spacing.sm,
    marginBottom: 5,
    fontFamily: Fonts.display.bold,
    fontSize: 12,
    color: Colors.mutedText,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
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
  countPriceRow: {
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
