import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { BeerIcon, LockKeyholeIcon, StarIcon, UsersIcon, XIcon } from '@/components/shared/IconGlyph';
import { generateUuidV4 } from '@/data/account';
import {
  BEER_TAGS,
  MAX_BEER_TAGS,
  type BeerCheckInVisibility,
  type BeerTag,
} from '@/data/beerCheckinsClient';
import { enqueueBeerCheckInOp } from '@/data/beerCheckinsQueue';
import { cs } from '@/i18n/cs';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import {
  buildHistoricalCheckedInAt,
  formatHistoricalDate,
  formatHistoricalTime,
} from '@/myBeers/historicalBeerEntry';

interface HistoricalBeerEntrySheetProps {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function RatingChip({ value, active, onPress }: { value: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ratingChip, active && styles.chipActive, pressed && styles.dim]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={cs.beerCheckins.ratingA11y(value)}
    >
      <StarIcon size={15} color={active ? Colors.stout : Colors.amber} />
      <Text style={[styles.ratingText, active && styles.chipTextActive]} allowFontScaling={false}>
        {value.toFixed(1)}
      </Text>
    </Pressable>
  );
}

function TagChip({ tag, active, onPress }: { tag: BeerTag; active: boolean; onPress: () => void }) {
  const label = cs.beerCheckins.tags[tag];
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.tagChip, active && styles.chipActive, pressed && styles.dim]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={active ? cs.beerCheckins.tagRemoveA11y(label) : cs.beerCheckins.tagAddA11y(label)}
    >
      <Text style={[styles.tagText, active && styles.chipTextActive]} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </Pressable>
  );
}

export function HistoricalBeerEntrySheet({ visible, onClose, onSaved }: HistoricalBeerEntrySheetProps) {
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((s) => s.show);
  const initialDate = new Date();

  const [dateText, setDateText] = useState(() => formatHistoricalDate(initialDate));
  const [timeText, setTimeText] = useState(() => formatHistoricalTime(initialDate));
  const [pubName, setPubName] = useState('');
  const [pubCity, setPubCity] = useState('');
  const [beerName, setBeerName] = useState('');
  const [brewery, setBrewery] = useState('');
  const [style, setStyle] = useState('');
  const [rating, setRating] = useState<number | null>(4);
  const [tags, setTags] = useState<BeerTag[]>([]);
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<BeerCheckInVisibility>('private');
  const [dateError, setDateError] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      const date = new Date();
      setDateText(formatHistoricalDate(date));
      setTimeText(formatHistoricalTime(date));
      setPubName('');
      setPubCity('');
      setBeerName('');
      setBrewery('');
      setStyle('');
      setRating(4);
      setTags([]);
      setNote('');
      setVisibility('private');
      setDateError(false);
    }, 0);
    return () => clearTimeout(timer);
  }, [visible]);

  const cleanBeer = beerName.trim();
  const cleanPub = pubName.trim();
  const canSubmit = cleanBeer.length > 0 && cleanPub.length > 0;

  const toggleTag = useCallback((tag: BeerTag) => {
    setTags((current) => {
      if (current.includes(tag)) return current.filter((t) => t !== tag);
      if (current.length >= MAX_BEER_TAGS) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return current;
      }
      return [...current, tag];
    });
  }, []);

  const reset = useCallback(() => {
    setPubName('');
    setPubCity('');
    setBeerName('');
    setBrewery('');
    setStyle('');
    setRating(4);
    setTags([]);
    setNote('');
    setVisibility('private');
    setDateError(false);
  }, []);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    const checked = buildHistoricalCheckedInAt(dateText, timeText);
    if (!checked) {
      setDateError(true);
      return;
    }
    setDateError(false);
    void enqueueBeerCheckInOp({
      op: 'checkin',
      payload: {
        clientId: generateUuidV4(),
        beerName: cleanBeer,
        breweryName: brewery.trim(),
        beerStyle: style.trim(),
        rating,
        note: note.trim(),
        tags,
        pubName: cleanPub,
        pubCity: pubCity.trim(),
        visitClientId: null,
        visibility,
        checkedInAt: checked.iso,
      },
    }).then(() => {
      showToast(cs.myBeers.historicalSaved, { icon: <BeerIcon size={20} color={Colors.amber} /> });
      reset();
      onSaved();
      onClose();
    });
  }, [
    brewery,
    canSubmit,
    cleanBeer,
    cleanPub,
    dateText,
    note,
    onClose,
    onSaved,
    pubCity,
    rating,
    reset,
    showToast,
    style,
    tags,
    timeText,
    visibility,
  ]);

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
          <View style={styles.header}>
            <View style={styles.headerText}>
              <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.myBeers.historicalTitle}
              </Text>
              <Text style={styles.subtitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.myBeers.historicalSubtitle}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityRole="button">
              <XIcon size={18} color={Colors.foamMuted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <View style={styles.twoCols}>
              <View style={styles.col}>
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
              <View style={styles.col}>
                <Text style={styles.label}>{cs.myBeers.historicalTimeLabel}</Text>
                <TextInput
                  value={timeText}
                  onChangeText={(value) => {
                    setDateError(false);
                    setTimeText(value);
                  }}
                  placeholder={cs.myBeers.historicalTimePlaceholder}
                  placeholderTextColor={Colors.mutedText}
                  style={[styles.input, dateError && styles.inputError]}
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

            <Text style={styles.label}>{cs.myBeers.historicalCityLabel}</Text>
            <TextInput
              value={pubCity}
              onChangeText={setPubCity}
              placeholder={cs.beerCheckins.optionalPlaceholder}
              placeholderTextColor={Colors.mutedText}
              style={styles.input}
              maxLength={80}
              maxFontSizeMultiplier={FontScaleCap.body}
            />

            <Text style={styles.label}>{cs.beerCheckins.beerLabel}</Text>
            <TextInput
              value={beerName}
              onChangeText={setBeerName}
              placeholder={cs.beerCheckins.beerPlaceholder}
              placeholderTextColor={Colors.mutedText}
              style={styles.input}
              maxLength={80}
              maxFontSizeMultiplier={FontScaleCap.body}
            />

            <View style={styles.twoCols}>
              <View style={styles.col}>
                <Text style={styles.label}>{cs.beerCheckins.breweryLabel}</Text>
                <TextInput
                  value={brewery}
                  onChangeText={setBrewery}
                  placeholder={cs.beerCheckins.optionalPlaceholder}
                  placeholderTextColor={Colors.mutedText}
                  style={styles.input}
                  maxLength={80}
                  maxFontSizeMultiplier={FontScaleCap.body}
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.label}>{cs.beerCheckins.styleLabel}</Text>
                <TextInput
                  value={style}
                  onChangeText={setStyle}
                  placeholder={cs.beerCheckins.optionalPlaceholder}
                  placeholderTextColor={Colors.mutedText}
                  style={styles.input}
                  maxLength={80}
                  maxFontSizeMultiplier={FontScaleCap.body}
                />
              </View>
            </View>

            <Text style={styles.label}>{cs.beerCheckins.ratingLabel}</Text>
            <View style={styles.wrapRow}>
              {[1, 2, 3, 4, 5].map((value) => (
                <RatingChip
                  key={value}
                  value={value}
                  active={rating === value}
                  onPress={() => setRating((current) => (current === value ? null : value))}
                />
              ))}
            </View>

            <Text style={styles.label}>{cs.beerCheckins.tagsLabel}</Text>
            <View style={styles.wrapRow}>
              {BEER_TAGS.map((tag) => (
                <TagChip key={tag} tag={tag} active={tags.includes(tag)} onPress={() => toggleTag(tag)} />
              ))}
            </View>

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
              {cs.myBeers.historicalVisibilityHint}
            </Text>
            <View style={styles.visibilityRow}>
              <Pressable
                onPress={() => setVisibility('private')}
                style={[styles.visibilityButton, visibility === 'private' && styles.visibilityActive]}
              >
                <LockKeyholeIcon size={16} color={visibility === 'private' ? Colors.stout : Colors.mutedText} />
                <Text style={[styles.visibilityText, visibility === 'private' && styles.visibilityTextActive]}>
                  {cs.beerCheckins.visibilityPrivate}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setVisibility('friends')}
                style={[styles.visibilityButton, visibility === 'friends' && styles.visibilityActive]}
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
    maxHeight: '90%',
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  headerText: { flex: 1 },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  subtitle: {
    marginTop: 3,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.foamMuted,
  },
  closeBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
    fontFamily: Fonts.display.bold,
    fontSize: 12,
    color: Colors.mutedText,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 50,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    color: Colors.foam,
    paddingHorizontal: Spacing.md,
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
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
    minHeight: 92,
    paddingTop: Spacing.sm,
    textAlignVertical: 'top',
  },
  twoCols: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  col: {
    flex: 1,
  },
  wrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  ratingChip: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  tagChip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  chipActive: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  ratingText: {
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    color: Colors.foam,
  },
  tagText: {
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    color: Colors.foam,
  },
  chipTextActive: {
    color: Colors.stout,
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  visibilityHint: {
    marginTop: -2,
    marginBottom: Spacing.sm,
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
  },
  visibilityButton: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  visibilityActive: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  visibilityText: {
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  visibilityTextActive: {
    color: Colors.stout,
  },
  submit: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.lg,
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
