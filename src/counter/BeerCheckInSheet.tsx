import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';

import { BeerTagChips } from '@/components/shared/BeerTagChips';
import { BeerIcon, LockKeyholeIcon, StarIcon, UsersIcon } from '@/components/shared/IconGlyph';
import { generateUuidV4 } from '@/data/account';
import {
  BEER_TAGS,
  fetchBeerMemory,
  MAX_BEER_TAGS,
  type BeerMemory,
  type BeerTag,
} from '@/data/beerCheckinsClient';
import {
  enqueueBeerCheckInOp,
  getOrCreateBeerCheckInActionTicket,
  removeBeerCheckInActionTicket,
  saveBeerCheckInActionTicket,
} from '@/data/beerCheckinsQueue';
import { suggestBeerBrands, type BeerBrandSuggestion } from '@/data/beerSuggestionsClient';
import {
  PrivateAccountMutationFrozenError,
  isPrivateAccountMutationScopeCurrent,
  runPrivateAccountMutation,
} from '@/data/privateAccountBoundary';
import type { Pub } from '@/data/pubs';
import SkeletonBlock from '@/friends/SkeletonBlock';
import { cs } from '@/i18n/cs';
import { useToastStore } from '@/stores/toastStore';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { useReduceMotion } from '@/utils/useReduceMotion';

/** ~400 ms debounce for the memory lookup while the beer name is being typed. */
const MEMORY_DEBOUNCE_MS = 400;
const SUGGEST_DEBOUNCE_MS = 220;

function shortDate(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
  });
}

interface BeerCheckInSheetProps {
  visible: boolean;
  beerName: string;
  pub: Pub;
  pubKey: string;
  visitClientId?: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}

function RatingChip({
  value,
  active,
  onPress,
}: {
  value: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.ratingChip,
        active && styles.ratingChipActive,
        pressed && styles.dim,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={cs.beerCheckins.ratingA11y(value)}
    >
      <StarIcon size={15} color={active ? Colors.stout : Colors.amber} />
      <Text style={[styles.ratingText, active && styles.ratingTextActive]} allowFontScaling={false}>
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
      style={({ pressed }) => [
        styles.tagChip,
        active && styles.ratingChipActive,
        pressed && styles.dim,
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={
        active ? cs.beerCheckins.tagRemoveA11y(label) : cs.beerCheckins.tagAddA11y(label)
      }
    >
      <Text
        style={[styles.tagChipText, active && styles.ratingTextActive]}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function BeerCheckInSheet({
  visible,
  beerName,
  pub,
  pubKey,
  visitClientId,
  onClose,
  onSubmitted,
}: BeerCheckInSheetProps) {
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const reduceMotion = useReduceMotion();
  const showToast = useToastStore((s) => s.show);
  const [name, setName] = useState(beerName);
  const [brewery, setBrewery] = useState('');
  const [style, setStyle] = useState('');
  const [rating, setRating] = useState<number | null>(4);
  const [note, setNote] = useState('');
  const [tags, setTags] = useState<BeerTag[]>([]);
  const [visibility, setVisibility] = useState<'private' | 'friends'>('friends');
  const [memory, setMemory] = useState<BeerMemory | null>(null);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<BeerBrandSuggestion[]>([]);
  const pickedSuggestionRef = useRef('');
  const submittingRef = useRef(false);
  const generationRef = useRef(0);
  const [submitting, setSubmitting] = useState(false);

  useLayoutEffect(() => {
    generationRef.current += 1;
  }, [visible]);

  const cleanName = name.trim();
  const canSubmit = cleanName.length > 0;
  const ratingValues = useMemo(() => [1, 2, 3, 4, 5], []);

  const toggleTag = useCallback((tag: BeerTag) => {
    setTags((current) => {
      if (current.includes(tag)) return current.filter((t) => t !== tag);
      if (current.length >= MAX_BEER_TAGS) {
        // Silent no-op at the cap — just a light haptic tick, no error text.
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return current;
      }
      return [...current, tag];
    });
  }, []);

  // Clear per-beer state when the sheet closes so the next open starts fresh.
  // State updates run off a microtask timer (never synchronously in the effect
  // body) to avoid cascading re-renders.
  useEffect(() => {
    if (visible) return;
    submittingRef.current = false;
    const t = setTimeout(() => {
      setSubmitting(false);
      setTags([]);
      setMemory(null);
      setMemoryLoading(false);
      setSuggestions([]);
    }, 0);
    return () => clearTimeout(t);
  }, [visible]);

  // Memory strip: fetch on open (near-immediate), debounce subsequent
  // name/brewery edits. Stale requests are aborted; any failure collapses the
  // strip silently. All setState happens inside the timer/async callbacks.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (!visible) {
      wasVisibleRef.current = false;
      return;
    }
    const justOpened = !wasVisibleRef.current;
    wasVisibleRef.current = true;

    const beer = name.trim();
    const brew = brewery.trim();
    const controller = new AbortController();

    const clear = () => {
      setMemory(null);
      setMemoryLoading(false);
    };
    const run = () => {
      setMemoryLoading(true);
      void fetchBeerMemory(beer, brew, controller.signal).then((result) => {
        if (controller.signal.aborted) return;
        setMemory(result);
        setMemoryLoading(false);
      });
    };

    const timer = setTimeout(beer ? run : clear, justOpened ? 0 : MEMORY_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [visible, name, brewery]);

  useEffect(() => {
    if (
      !visible ||
      name.trim().length < 2 ||
      pickedSuggestionRef.current === `${name}|${brewery}`
    ) {
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void suggestBeerBrands(name, controller.signal, 5, brewery).then((items) => {
        if (!controller.signal.aborted) setSuggestions(items);
      });
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [visible, name, brewery]);

  const selectSuggestion = useCallback((suggestion: BeerBrandSuggestion) => {
    pickedSuggestionRef.current = `${suggestion.name}|${suggestion.brandName ?? ''}`;
    setName(suggestion.name);
    if (suggestion.brandName) setBrewery(suggestion.brandName);
    setSuggestions([]);
  }, []);

  const closeSheet = useCallback(() => {
    generationRef.current += 1;
    submittingRef.current = false;
    setSubmitting(false);
    onClose();
  }, [onClose]);

  const submit = useCallback(() => {
    if (!canSubmit || submittingRef.current) return;
    const generation = generationRef.current;
    submittingRef.current = true;
    setSubmitting(true);
    void runPrivateAccountMutation(async (scope) => {
      const actionKey = JSON.stringify([
        'counter-checkin',
        pubKey,
        visitClientId ?? null,
        cleanName,
        brewery.trim(),
        style.trim(),
        rating,
        note.trim(),
        tags,
        visibility,
      ]);
      const ticket = await getOrCreateBeerCheckInActionTicket(actionKey, () => ({
        key: actionKey,
        visitClientId: visitClientId ?? null,
        clientIds: [generateUuidV4()],
        checkedInAt: new Date().toISOString(),
        createdAt: Date.now(),
      }));
      if (!ticket) {
        if (generationRef.current !== generation) return;
        submittingRef.current = false;
        setSubmitting(false);
        showToast(cs.beerCheckins.saveError, {
          icon: <BeerIcon size={20} color={Colors.foamMuted} />,
        });
        return;
      }
      const result = await enqueueBeerCheckInOp({
        op: 'checkin',
        payload: {
          clientId: ticket.clientIds[0],
          beerName: cleanName,
          breweryName: brewery.trim(),
          beerStyle: style.trim(),
          rating,
          note: note.trim(),
          tags,
          pubCacheKey: pubKey,
          pubName: pub.name,
          pubCity: pub.city ?? '',
          visitClientId: visitClientId ?? null,
          visibility,
          checkedInAt: ticket.checkedInAt,
        },
      });
      if (!isPrivateAccountMutationScopeCurrent(scope)) {
        throw new PrivateAccountMutationFrozenError();
      }
      if (generationRef.current !== generation) return;
      if (result === 'storage-error') {
        submittingRef.current = false;
        setSubmitting(false);
        showToast(cs.beerCheckins.saveError, {
          icon: <BeerIcon size={20} color={Colors.foamMuted} />,
        });
        return;
      }
      if (!(await removeBeerCheckInActionTicket(actionKey))) {
        submittingRef.current = false;
        setSubmitting(false);
        showToast(cs.beerCheckins.saveError, {
          icon: <BeerIcon size={20} color={Colors.foamMuted} />,
        });
        return;
      }
      if (generationRef.current !== generation) {
        await saveBeerCheckInActionTicket(ticket);
        return;
      }
      submittingRef.current = false;
      setSubmitting(false);
      showToast(cs.beerCheckins.saved, {
        icon: <BeerIcon size={20} color={Colors.amber} />,
      });
      onSubmitted();
      closeSheet();
    })
      .catch(() => {
        if (generationRef.current !== generation) return;
        submittingRef.current = false;
        setSubmitting(false);
        showToast(cs.beerCheckins.saveError, {
          icon: <BeerIcon size={20} color={Colors.foamMuted} />,
        });
      });
  }, [
    brewery,
    canSubmit,
    cleanName,
    closeSheet,
    note,
    onSubmitted,
    pub,
    pubKey,
    rating,
    showToast,
    style,
    tags,
    visibility,
    visitClientId,
  ]);

  return (
    <BottomSheetModal visible={visible} onClose={closeSheet} keyboardLift>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text
                style={styles.title}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {cs.beerCheckins.sheetTitle}
              </Text>
              <Text
                style={styles.subtitle}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {pub.name}
              </Text>
            </View>
            <CloseButton onPress={closeSheet} label={cs.common.cancel} />
          </View>

          <KeyboardAwareScrollView
            style={styles.list}
            keyboardAvoidedExternally
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {memoryLoading ? (
              <View style={styles.memoryStrip}>
                <SkeletonBlock width="55%" height={13} reduceMotion={reduceMotion} />
                <SkeletonBlock width="80%" height={12} reduceMotion={reduceMotion} />
              </View>
            ) : memory && memory.myCount > 0 ? (
              <View style={styles.memoryStrip}>
                <Text style={styles.memoryLead} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.beerCheckins.memoryKnownLead}
                </Text>
                <Text style={styles.memoryMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.beerCheckins.memoryKnown({
                    count: memory.myCount,
                    lastDate: shortDate(memory.lastCheckedInAt ?? ''),
                    lastPub: memory.lastPubName,
                    lastRating: memory.lastRating,
                  })}
                </Text>
                <BeerTagChips tags={memory.topTags} />
              </View>
            ) : memory ? (
              <View style={styles.memoryStrip}>
                <Text style={styles.memoryFirst} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.beerCheckins.memoryFirstTime}
                </Text>
              </View>
            ) : null}

            <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.beerCheckins.beerLabel}
            </Text>
            <TextInput
              value={name}
              onChangeText={(value) => {
                pickedSuggestionRef.current = '';
                setName(value);
              }}
              placeholder={cs.beerCheckins.beerPlaceholder}
              placeholderTextColor={MockColors.fieldHint}
              style={styles.input}
              maxLength={120}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
            {suggestions.length > 0 ? (
              <View style={styles.suggestionsBox}>
                {suggestions.map((suggestion, index) => (
                  <Pressable
                    key={suggestion.slug}
                    onPress={() => selectSuggestion(suggestion)}
                    style={[styles.suggestionRow, index > 0 && styles.suggestionDivider]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.beerCheckins.useSuggestion(suggestion.name)}
                  >
                    <Text
                      style={styles.suggestionName}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {suggestion.name}
                    </Text>
                    {suggestion.brandName && suggestion.brandName !== suggestion.name ? (
                      <Text
                        style={styles.suggestionBrand}
                        numberOfLines={1}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {suggestion.brandName}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={[styles.twoCols, fontScale > 1.15 && styles.twoColsStacked]}>
              <View style={styles.col}>
                <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.beerCheckins.breweryLabel}
                </Text>
                <TextInput
                  value={brewery}
                  onChangeText={(value) => {
                    pickedSuggestionRef.current = '';
                    setBrewery(value);
                  }}
                  placeholder={cs.beerCheckins.optionalPlaceholder}
                  placeholderTextColor={MockColors.fieldHint}
                  style={styles.input}
                  maxLength={120}
                  maxFontSizeMultiplier={FontScaleCap.body}
                />
              </View>
              <View style={styles.col}>
                <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.beerCheckins.styleLabel}
                </Text>
                <TextInput
                  value={style}
                  onChangeText={setStyle}
                  placeholder={cs.beerCheckins.optionalPlaceholder}
                  placeholderTextColor={MockColors.fieldHint}
                  style={styles.input}
                  maxLength={80}
                  maxFontSizeMultiplier={FontScaleCap.body}
                />
              </View>
            </View>

            <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.beerCheckins.ratingLabel}
            </Text>
            <View style={styles.ratingRow}>
              {ratingValues.map((value) => (
                <RatingChip
                  key={value}
                  value={value}
                  active={rating === value}
                  onPress={() => setRating((current) => (current === value ? null : value))}
                />
              ))}
            </View>

            <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.beerCheckins.tagsLabel}
            </Text>
            <View style={styles.ratingRow}>
              {BEER_TAGS.map((tag) => (
                <TagChip
                  key={tag}
                  tag={tag}
                  active={tags.includes(tag)}
                  onPress={() => toggleTag(tag)}
                />
              ))}
            </View>

            <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.beerCheckins.noteLabel}
            </Text>
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder={cs.beerCheckins.notePlaceholder}
              placeholderTextColor={MockColors.fieldHint}
              style={[styles.input, styles.noteInput]}
              multiline
              maxLength={1000}
              maxFontSizeMultiplier={FontScaleCap.body}
            />

            <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.beerCheckins.visibilityLabel}
            </Text>
            <View style={styles.visibilityRow}>
              <Pressable
                onPress={() => setVisibility('private')}
                style={[
                  styles.visibilityButton,
                  visibility === 'private' && styles.visibilityButtonActive,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: visibility === 'private' }}
              >
                <LockKeyholeIcon
                  size={16}
                  color={visibility === 'private' ? Colors.stout : Colors.mutedText}
                />
                <Text
                  style={[
                    styles.visibilityText,
                    visibility === 'private' && styles.visibilityTextActive,
                  ]}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.beerCheckins.visibilityPrivate}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setVisibility('friends')}
                style={[
                  styles.visibilityButton,
                  visibility === 'friends' && styles.visibilityButtonActive,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: visibility === 'friends' }}
              >
                <UsersIcon
                  size={16}
                  color={visibility === 'friends' ? Colors.stout : Colors.mutedText}
                />
                <Text
                  style={[
                    styles.visibilityText,
                    visibility === 'friends' && styles.visibilityTextActive,
                  ]}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {cs.beerCheckins.visibilityFriends}
                </Text>
              </Pressable>
            </View>
          </KeyboardAwareScrollView>

          <Pressable
            onPress={submit}
            disabled={!canSubmit || submitting}
            style={({ pressed }) => [
              styles.submit,
              (pressed || !canSubmit || submitting) && styles.dim,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSubmit || submitting }}
          >
            <Text style={styles.submitText} maxFontSizeMultiplier={FontScaleCap.display}>
              {cs.beerCheckins.submit}
            </Text>
          </Pressable>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  cardWrap: { width: '100%', maxHeight: '92%' },
  sheet: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    ...softDrop(),
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
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: {
    ...MockType.titleS,
    color: Colors.foam,
  },
  subtitle: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.foamMuted,
  },
  list: { flexGrow: 0, flexShrink: 1 },
  label: {
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
    ...MockType.bodySmall,
    fontWeight: '600',
    color: Colors.foamMuted,
  },
  input: {
    minHeight: 50,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    color: Colors.foam,
    paddingHorizontal: Spacing.md,
    fontWeight: '500',
    fontSize: 15,
  },
  suggestionsBox: {
    marginTop: 4,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    overflow: 'hidden',
  },
  suggestionRow: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  suggestionDivider: { borderTopWidth: 1, borderTopColor: Colors.border },
  suggestionName: { fontWeight: '700', fontSize: 14, color: Colors.foam },
  suggestionBrand: {
    fontWeight: '400',
    fontSize: 11,
    color: Colors.mutedText,
    marginTop: 2,
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
  twoColsStacked: {
    flexDirection: 'column',
    gap: 0,
  },
  col: {
    flex: 1,
  },
  ratingRow: {
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
  ratingChipActive: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
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
  tagChipText: {
    fontWeight: '700',
    fontSize: 13,
    color: Colors.foam,
  },
  memoryStrip: {
    marginTop: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    gap: Spacing.xs,
  },
  memoryLead: {
    fontWeight: '700',
    fontSize: 13,
    color: Colors.amber,
  },
  memoryMeta: {
    fontWeight: '500',
    fontSize: 12,
    color: Colors.foamMuted,
  },
  memoryFirst: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
  },
  ratingText: {
    fontWeight: '700',
    fontSize: 13,
    color: Colors.foam,
  },
  ratingTextActive: {
    color: Colors.stout,
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
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
  visibilityButtonActive: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  visibilityText: {
    fontWeight: '700',
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
    fontWeight: '700',
    fontSize: 16,
    color: Colors.stout,
  },
  dim: {
    opacity: 0.6,
  },
});
