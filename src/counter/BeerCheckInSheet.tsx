import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BeerIcon, LockKeyholeIcon, StarIcon, UsersIcon, XIcon } from '@/components/shared/IconGlyph';
import { generateUuidV4 } from '@/data/account';
import { enqueueBeerCheckInOp } from '@/data/beerCheckinsQueue';
import type { Pub } from '@/data/pubs';
import { cs } from '@/i18n/cs';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

interface BeerCheckInSheetProps {
  visible: boolean;
  beerName: string;
  pub: Pub;
  pubKey: string;
  visitClientId?: string | null;
  onClose: () => void;
  onSubmitted: () => void;
}

function RatingChip({ value, active, onPress }: { value: number; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.ratingChip, active && styles.ratingChipActive, pressed && styles.dim]}
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
  const showToast = useToastStore((s) => s.show);
  const [name, setName] = useState(beerName);
  const [brewery, setBrewery] = useState('');
  const [style, setStyle] = useState('');
  const [rating, setRating] = useState<number | null>(4);
  const [note, setNote] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'friends'>('friends');

  const cleanName = name.trim();
  const canSubmit = cleanName.length > 0;
  const ratingValues = useMemo(() => [1, 2, 3, 4, 5], []);

  const submit = useCallback(() => {
    if (!canSubmit) return;
    void enqueueBeerCheckInOp({
      op: 'checkin',
      payload: {
        clientId: generateUuidV4(),
        beerName: cleanName,
        breweryName: brewery.trim(),
        beerStyle: style.trim(),
        rating,
        note: note.trim(),
        pubCacheKey: pubKey,
        pubName: pub.name,
        pubCity: pub.city ?? '',
        visitClientId: visitClientId ?? null,
        visibility,
        checkedInAt: new Date().toISOString(),
      },
    }).then(() => {
      showToast(cs.beerCheckins.saved, { icon: <BeerIcon size={20} color={Colors.amber} /> });
      onSubmitted();
      onClose();
    });
  }, [brewery, canSubmit, cleanName, note, onClose, onSubmitted, pub, pubKey, rating, showToast, style, visibility, visitClientId]);

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
                {cs.beerCheckins.sheetTitle}
              </Text>
              <Text style={styles.subtitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {pub.name}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.closeBtn} accessibilityRole="button">
              <XIcon size={18} color={Colors.foamMuted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={styles.label}>{cs.beerCheckins.beerLabel}</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder={cs.beerCheckins.beerPlaceholder}
              placeholderTextColor={Colors.mutedText}
              style={styles.input}
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
                  maxFontSizeMultiplier={FontScaleCap.body}
                />
              </View>
            </View>

            <Text style={styles.label}>{cs.beerCheckins.ratingLabel}</Text>
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
            <View style={styles.visibilityRow}>
              <Pressable
                onPress={() => setVisibility('private')}
                style={[styles.visibilityButton, visibility === 'private' && styles.visibilityButtonActive]}
              >
                <LockKeyholeIcon size={16} color={visibility === 'private' ? Colors.stout : Colors.mutedText} />
                <Text style={[styles.visibilityText, visibility === 'private' && styles.visibilityTextActive]}>
                  {cs.beerCheckins.visibilityPrivate}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setVisibility('friends')}
                style={[styles.visibilityButton, visibility === 'friends' && styles.visibilityButtonActive]}
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
              <Text style={styles.submitText}>{cs.beerCheckins.submit}</Text>
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
    backgroundColor: withAlpha(Colors.stout, 0.74),
  },
  sheet: {
    maxHeight: '88%',
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  subtitle: {
    marginTop: 2,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
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
  ratingText: {
    fontFamily: Fonts.display.bold,
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
