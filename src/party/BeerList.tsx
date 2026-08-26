/**
 * DESIGN MOCK — the pub's taps, as a running order.
 *
 * One list, one row type. Every tap the pub has is a row: its name, its price,
 * and the amber mug-and-plus. Tap it and the sheet closes with the beer in the
 * log — one gesture, done.
 *
 * There is no stepper. It made this sheet a place you STAY, adjusting numbers,
 * when the only thing you came for was to say what you are drinking; and it was
 * a second, worse editor for something the log row's own menu now does properly
 * — where you can see WHICH beer you are correcting.
 *
 * It used to be two things stacked — the beers you had as rows, the rest as a
 * wrap of chips. That read as a cramped chip cloud, could not show a price, and
 * split one question ("what are you drinking") across two shapes. As the first
 * thing you see when starting a night, it was also the worst possible picker.
 *
 * Anything not on the pub's list you can type in, because a tap list in our data
 * is always a little out of date and "not in the list" must never mean "cannot
 * log it".
 */

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { BeerIcon, PlusIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

export function BeerList({
  rows,
  onTaps,
  onAdd,
}: {
  /** What you have had, per kind — shown as a quiet tally, not as a control. */
  rows: { beer: string; count: number }[];
  /** The pub's tap list. */
  onTaps: { name: string; priceCzk: number | null }[];
  onAdd: (beer: string) => void;
}) {
  const [custom, setCustom] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const insets = useSafeAreaInsets();

  const counts = new Map(rows.map((row) => [row.beer, row.count]));

  // The pub's taps first, in its own order, then anything you typed in. A beer
  // you added by hand should not jump above the list you are choosing from.
  const listed = onTaps.map((tap) => ({ name: tap.name, price: tap.priceCzk }));
  const extra = rows
    .filter((row) => !onTaps.some((tap) => tap.name === row.beer))
    .map((row) => ({ name: row.beer, price: null }));

  const commit = () => {
    const name = draft.trim();
    if (name) onAdd(name);
    setDraft('');
    setCustom(false);
  };

  return (
    <View>
      {[...listed, ...extra].map((beer) => {
        const count = counts.get(beer.name) ?? 0;
        return (
          <Pressable
            key={beer.name}
            onPress={() => onAdd(beer.name)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={t.partyBeers.a11yAdd(beer.name)}
          >
            <View style={styles.grow}>
              <Text
                style={[styles.name, count > 0 && styles.nameOn]}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {beer.name}
              </Text>
              <Text style={styles.price} allowFontScaling={false}>
                {beer.price !== null ? t.partyBeers.price(beer.price) : ''}
                {beer.price !== null && count > 0 ? ' · ' : ''}
                {count > 0 ? t.partyBeers.alreadyCount(count) : ''}
              </Text>
            </View>

            <View style={styles.addPill}>
              <BeerIcon size={17} color={Colors.stout} />
              <PlusIcon size={14} color={Colors.stout} />
            </View>
          </Pressable>
        );
      })}

      <Pressable
        onPress={() => setCustom(true)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={t.partyBeers.a11yOwnBeer}
      >
        <Text style={styles.other} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.partyBeers.otherBeer}
        </Text>
        <View style={styles.otherPlus}>
          <PlusIcon size={17} color={Colors.mutedText} />
        </View>
      </Pressable>

      <BottomSheetModal visible={custom} onClose={() => setCustom(false)} keyboardLift>
        <View style={[styles.dialogWrap, { marginBottom: -insets.bottom }]}>
          <View style={[styles.dialog, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.grabber} />
            <View style={styles.dialogHead}>
              <Text style={styles.dialogTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                {t.partyBeers.customTitle}
              </Text>
              <CloseButton onPress={() => setCustom(false)} />
            </View>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={t.partyBeers.customPlaceholder}
              placeholderTextColor={MockColors.fieldHint}
              style={styles.input}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={commit}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
            <Pressable
              onPress={commit}
              style={({ pressed }) => [styles.save, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.partyBeers.save}
            >
              <Text style={styles.saveText} maxFontSizeMultiplier={FontScaleCap.heading}>
                {t.partyBeers.save}
              </Text>
            </Pressable>
          </View>
        </View>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 68,
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.foam, 0.08),
  },
  name: { fontSize: 17, fontWeight: '600', color: Colors.foam },
  nameOn: { color: Colors.amber, fontWeight: '700' },
  price: {
    fontSize: 13,
    fontWeight: '500',
    color: Colors.mutedText,
    marginTop: 2,
  },
  other: { flex: 1, fontSize: 16, fontWeight: '600', color: Colors.mutedText },

  otherPlus: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.07),
  },
  addPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },

  dialogWrap: { width: '100%', maxHeight: '92%' },
  dialog: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.sm,
    gap: Spacing.md,
    ...softDrop(),
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
  },
  dialogHead: { flexDirection: 'row', alignItems: 'center' },
  dialogTitle: {
    ...MockType.titleS,
    fontSize: 22,
    color: Colors.foam,
    flex: 1,
  },
  input: {
    height: MockLayout.buttonHeight,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: MockColors.field,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MockColors.fieldBorder,
    color: Colors.foam,
    fontSize: 16,
    fontWeight: '600',
  },
  save: {
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  saveText: { ...MockType.buttonLabel, color: Colors.stout },
});
