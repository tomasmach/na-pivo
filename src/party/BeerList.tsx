/**
 * DESIGN MOCK — the pub's taps, as a running order.
 *
 * One list, one row type. Every tap the pub has is a row: its name, its price,
 * and a counter. Nought means you have not had it, so the row shows a single
 * plus; once you have, the same spot becomes `− N +`.
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
import { MinusIcon, PlusIcon } from '@/components/shared/IconGlyph';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

export function BeerList({
  rows,
  onTaps,
  onAdd,
  onRemove,
}: {
  /** What you have had, per kind. */
  rows: { beer: string; count: number }[];
  /** The pub's tap list. */
  onTaps: { name: string; priceCzk: number | null }[];
  onAdd: (beer: string) => void;
  onRemove: (beer: string) => void;
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
          <View key={beer.name} style={styles.row}>
            <View style={styles.grow}>
              <Text
                style={[styles.name, count > 0 && styles.nameOn]}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {beer.name}
              </Text>
              {beer.price !== null ? (
                <Text style={styles.price} allowFontScaling={false}>
                  {beer.price} Kč
                </Text>
              ) : null}
            </View>

            {count > 0 ? (
              <View style={styles.counter}>
                <Pressable
                  onPress={() => onRemove(beer.name)}
                  style={({ pressed }) => [styles.step, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`O jedno ${beer.name} míň`}
                  hitSlop={6}
                >
                  <MinusIcon size={16} color={Colors.foam} />
                </Pressable>
                <Text style={styles.count} allowFontScaling={false}>
                  {count}
                </Text>
                <Pressable
                  onPress={() => onAdd(beer.name)}
                  style={({ pressed }) => [styles.step, styles.stepOn, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Ještě jedno ${beer.name}`}
                  hitSlop={6}
                >
                  <PlusIcon size={16} color={Colors.stout} />
                </Pressable>
              </View>
            ) : (
              <Pressable
                onPress={() => onAdd(beer.name)}
                style={({ pressed }) => [styles.step, styles.stepOn, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Dát si ${beer.name}`}
                hitSlop={6}
              >
                <PlusIcon size={17} color={Colors.stout} />
              </Pressable>
            )}
          </View>
        );
      })}

      <Pressable
        onPress={() => setCustom(true)}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel="Zapsat vlastní pivo"
      >
        <Text style={styles.other} maxFontSizeMultiplier={FontScaleCap.body}>
          Jiné pivo
        </Text>
        <View style={[styles.step, styles.stepGhost]}>
          <PlusIcon size={17} color={Colors.mutedText} />
        </View>
      </Pressable>

      <BottomSheetModal visible={custom} onClose={() => setCustom(false)}>
        <View style={[styles.dialog, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.dialogHead}>
            <Text style={styles.dialogTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              Co piješ?
            </Text>
            <CloseButton onPress={() => setCustom(false)} />
          </View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Značka a stupně"
            placeholderTextColor={Colors.mutedText}
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
            accessibilityLabel="Zapsat"
          >
            <Text style={styles.saveText} maxFontSizeMultiplier={FontScaleCap.heading}>
              Zapsat
            </Text>
          </Pressable>
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
    minHeight: HitArea.min + 16,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.foam, 0.08),
  },
  name: { fontSize: 16, fontWeight: '600', color: Colors.foam },
  nameOn: { color: Colors.amber, fontWeight: '700' },
  price: { fontSize: 13, fontWeight: '500', color: Colors.mutedText, marginTop: 2 },
  other: { flex: 1, fontSize: 16, fontWeight: '600', color: Colors.mutedText },

  counter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  step: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.09),
  },
  stepOn: { backgroundColor: Colors.amber },
  stepGhost: { backgroundColor: withAlpha(Colors.foam, 0.07) },
  count: {
    minWidth: 20,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  dialog: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: MockLayout.cardRadius + 6,
    borderTopRightRadius: MockLayout.cardRadius + 6,
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  dialogHead: { flexDirection: 'row', alignItems: 'center' },
  dialogTitle: { ...MockType.titleS, fontSize: 22, color: Colors.foam, flex: 1 },
  input: {
    height: MockLayout.buttonHeight,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
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
