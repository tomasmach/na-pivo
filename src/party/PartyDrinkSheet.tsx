import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { CameraIcon, HistoryIcon, PlusIcon } from '@/components/shared/IconGlyph';
import type { DrinkType } from '@/drinks/drinkTypes';
import { cs } from '@/i18n/cs';
import { MockLayout } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

export interface PartyDrinkChoice {
  key: string;
  name: string;
  drinkType: DrinkType;
  priceCzk?: number;
  volumeMl?: number;
  count: number;
  meta: string | null;
}

/** One candidate row, before it is dressed up with a key and a meta line. */
export interface PartyDrinkSource {
  name: string;
  drinkType: DrinkType;
  priceCzk?: number;
  volumeMl?: number;
  /** How many of these are already written down tonight; 0 for a mere offer. */
  count: number;
}

/**
 * The same beer, spelled three ways.
 *
 * The list is fed from three places — what you already logged here, the pub's
 * tap menu and the house default — so one Plzeň came out as "Pilsner Urquell ·
 * 0,5 l · 60 Kč ×2" AND "Pilsner Urquell 12° · 0,5 l". A degree is not a
 * different beer, so the name is normalised down to letters and digits before
 * two rows are compared.
 */
function drinkNameIdentity(name: string): string {
  return name
    .toLocaleLowerCase('cs-CZ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    // "12°", "11 °" — the degree belongs to the same tap.
    .replace(/\d+\s*°/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * One row per drink, in first-seen order.
 *
 * The merged row keeps the price (a fact the other row simply did not have),
 * the fuller spelling and the summed count.
 */
export function mergePartyDrinkChoices(
  sources: readonly PartyDrinkSource[],
): PartyDrinkSource[] {
  const rows: PartyDrinkSource[] = [];
  const positions = new Map<string, number>();

  for (const source of sources) {
    const identity = `${source.drinkType}|${drinkNameIdentity(source.name)}|${source.volumeMl ?? ''}`;
    const at = positions.get(identity);
    if (at === undefined) {
      positions.set(identity, rows.length);
      rows.push({ ...source });
      continue;
    }
    const existing = rows[at];
    rows[at] = {
      ...existing,
      name: source.name.length > existing.name.length ? source.name : existing.name,
      priceCzk: existing.priceCzk ?? source.priceCzk,
      volumeMl: existing.volumeMl ?? source.volumeMl,
      count: existing.count + source.count,
    };
  }

  return rows;
}

const TYPES: readonly DrinkType[] = ['beer', 'wine', 'shot', 'soft_drink'];

export function PartyDrinkSheet({
  visible,
  choices,
  onClose,
  onPick,
  onNew,
  onBackdate,
  onScan,
}: {
  visible: boolean;
  choices: PartyDrinkChoice[];
  onClose: () => void;
  onPick: (choice: PartyDrinkChoice) => void;
  onNew: (type: DrinkType) => void;
  onBackdate?: (nowMs: number) => void;
  onScan: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [type, setType] = React.useState<DrinkType>('beer');
  const rows = choices.filter((choice) => choice.drinkType === type);
  const finish = (action: () => void) => {
    onClose();
    // iOS cannot present the next native modal while this sheet is still
    // finishing its exit animation. Keep the hand-off just behind that exit.
    setTimeout(action, 300);
  };

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              Co si dáš?
            </Text>
            <CloseButton onPress={onClose} />
          </View>
          <View style={styles.tabs}>
            {TYPES.map((value) => {
              const selected = value === type;
              return (
                <Pressable
                  key={value}
                  onPress={() => setType(value)}
                  style={[styles.tab, selected && styles.tabSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                >
                  <Text
                    style={[styles.tabText, selected && styles.tabTextSelected]}
                    allowFontScaling={false}
                  >
                    {cs.counter.drinkTypeLabel(value)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <ScrollView style={styles.list} showsVerticalScrollIndicator={false}>
            {rows.map((row, index) => (
              <Pressable
                key={row.key}
                onPress={() => finish(() => onPick(row))}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 && styles.divider,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={row.meta ? `${row.name}, ${row.meta}` : row.name}
              >
                <View style={styles.rowText}>
                  <Text
                    style={styles.name}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {row.name}
                  </Text>
                  {row.meta ? (
                    <Text style={styles.meta} maxFontSizeMultiplier={FontScaleCap.body}>
                      {row.meta}
                    </Text>
                  ) : null}
                </View>
                {row.count > 0 ? (
                  <Text style={styles.count} allowFontScaling={false}>
                    ×{row.count}
                  </Text>
                ) : null}
              </Pressable>
            ))}
          </ScrollView>
          <View style={styles.actions}>
            <Pressable
              onPress={() => finish(() => onNew(type))}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <PlusIcon size={17} color={Colors.amber} />
              <Text style={styles.actionText} maxFontSizeMultiplier={FontScaleCap.body}>
                Nový nápoj
              </Text>
            </Pressable>
            {onBackdate ? (
              <Pressable
                onPress={() => finish(() => onBackdate(Date.now()))}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={cs.counter.backdateLink}
              >
                <HistoryIcon size={17} color={Colors.amber} />
                <Text style={styles.actionText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.counter.backdateLink}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => finish(onScan)}
              style={({ pressed }) => [styles.action, pressed && styles.pressed]}
            >
              <CameraIcon size={17} color={Colors.amber} />
              <Text style={styles.actionText} maxFontSizeMultiplier={FontScaleCap.body}>
                Naskenovat lístek
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  cardWrap: { width: '100%', maxHeight: '92%' },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.sm,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  title: { color: Colors.foam, fontSize: 22, fontWeight: '800' },
  tabs: { flexDirection: 'row', gap: 6, marginBottom: Spacing.md },
  tab: {
    flex: 1,
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.05),
  },
  tabSelected: {
    backgroundColor: withAlpha(Colors.amber, 0.12),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  tabText: { color: Colors.mutedText, fontSize: 12, fontWeight: '700' },
  tabTextSelected: { color: Colors.amber },
  list: { flexGrow: 0, flexShrink: 1, marginTop: Spacing.sm },
  row: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 9,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowText: { flex: 1 },
  name: { color: Colors.foam, fontSize: 16, fontWeight: '600' },
  meta: { color: Colors.mutedText, fontSize: 13, marginTop: 2 },
  count: { color: Colors.amber, fontSize: 16, fontWeight: '800' },
  actions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    marginTop: Spacing.sm,
  },
  action: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionText: { color: Colors.foam, fontSize: 15, fontWeight: '600' },
  pressed: { opacity: 0.62 },
});
