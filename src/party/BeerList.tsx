/**
 * DESIGN MOCK — what you are drinking, as a running order.
 *
 * The primary button pours the pub's own tap without asking, because one tap is
 * the whole ritual and a picker in front of it turns a reflex into a form. What
 * you get instead is a ROW: the beer that just landed, named, with a counter you
 * can correct and other taps you can switch to. Like a bar tab, or a shopping
 * list — one line per kind, a number beside it.
 *
 * Anything not on the pub's list you can type in, because a pub's tap list in
 * our data is always a little out of date and "not in the list" must never mean
 * "cannot log it".
 */

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';

import { MinusIcon, PlusIcon, XIcon } from '@/components/shared/IconGlyph';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

export function BeerList({
  rows,
  onTap,
  onTaps,
  onAdd,
  onRemove,
}: {
  /** What you have had, per kind, in the order you first ordered it. */
  rows: { beer: string; count: number }[];
  /** The pub's tap list — offered once you have not had them yet. */
  onTaps: { name: string; priceCzk: number | null }[];
  onTap: (beer: string) => void;
  onAdd: (beer: string) => void;
  onRemove: (beer: string) => void;
}) {
  const [custom, setCustom] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const insets = useSafeAreaInsets();

  const had = new Set(rows.map((row) => row.beer));
  const rest = onTaps.filter((tap) => !had.has(tap.name));

  const commit = () => {
    const name = draft.trim();
    if (name) onAdd(name);
    setDraft('');
    setCustom(false);
  };

  return (
    <View style={styles.wrap}>
      {rows.map((row) => (
        <View key={row.beer} style={styles.row}>
          <Text
            style={styles.name}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {row.beer}
          </Text>
          <View style={styles.counter}>
            <Pressable
              onPress={() => onRemove(row.beer)}
              style={({ pressed }) => [styles.step, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`O jedno ${row.beer} míň`}
              hitSlop={6}
            >
              <MinusIcon size={16} color={Colors.foam} />
            </Pressable>
            <Text style={styles.count} allowFontScaling={false}>
              {row.count}
            </Text>
            <Pressable
              onPress={() => onAdd(row.beer)}
              style={({ pressed }) => [
                styles.step,
                styles.stepOn,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Ještě jedno ${row.beer}`}
              hitSlop={6}
            >
              <PlusIcon size={16} color={Colors.stout} />
            </Pressable>
          </View>
        </View>
      ))}

      {/* Switching taps mid-night is normal, so the rest of the list stays one
          tap away rather than behind a picker. */}
      {rest.length > 0 || true ? (
        <View style={styles.others}>
          {rest.map((tap) => (
            <Pressable
              key={tap.name}
              onPress={() => onAdd(tap.name)}
              style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Dát si ${tap.name}`}
            >
              <PlusIcon size={13} color={Colors.amber} />
              <Text
                style={styles.chipText}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {tap.name}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setCustom(true)}
            style={({ pressed }) => [
              styles.chip,
              styles.chipGhost,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel="Zapsat vlastní pivo"
          >
            <Text style={styles.chipGhostText} allowFontScaling={false}>
              Jiné pivo
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* A one-field dialog, so it keeps its own keyboard lift rather than a
          scroll view (AGENTS.md: short non-scrolling dialogs lift on the wrap). */}
      <BottomSheetModal visible={custom} onClose={() => setCustom(false)}>
        <View
          style={[styles.dialog, { marginBottom: insets.bottom + Spacing.lg }]}
        >
          <View style={styles.dialogHead}>
            <Text
              style={styles.dialogTitle}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              Co piješ?
            </Text>
            <Pressable
              onPress={() => setCustom(false)}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Zavřít"
              hitSlop={8}
            >
              <XIcon size={16} color={Colors.mutedText} />
            </Pressable>
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
            <Text
              style={styles.saveText}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              Zapsat
            </Text>
          </Pressable>
        </View>
      </BottomSheetModal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  pressed: { opacity: 0.65 },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: HitArea.min,
  },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: Colors.foam },
  counter: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  step: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.09),
  },
  stepOn: { backgroundColor: Colors.amber },
  count: {
    minWidth: 22,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  others: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 34,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.amber,
    maxWidth: 160,
  },
  chipGhost: { backgroundColor: withAlpha(Colors.foam, 0.07) },
  chipGhostText: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },

  dialog: {
    marginHorizontal: Spacing.md,
    padding: Spacing.md,
    gap: Spacing.sm,
    borderRadius: MockLayout.cardRadius,
    backgroundColor: Colors.stout2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  dialogHead: { flexDirection: 'row', alignItems: 'center' },
  dialogTitle: {
    ...MockType.titleS,
    fontSize: 20,
    color: Colors.foam,
    flex: 1,
  },
  close: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
  },
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
    height: MockLayout.buttonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  saveText: { ...MockType.buttonLabel, color: Colors.stout },
});
