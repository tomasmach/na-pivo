/**
 * "Co ještě?" — the app's one overflow sheet.
 *
 * Every rebuilt screen shows one card and one amber button, and every remaining
 * door lives exactly one tap deeper in a single flat list. There is one
 * component for that on purpose: three screens with three near-identical
 * overflow sheets was the same "three ways to do one thing" habit the rebuild
 * exists to kill. The host passes the rows and, if it needs one, a title.
 *
 * One intent per sheet (§8): this one only takes you somewhere else or changes what you're looking for. It never counts, never
 * navigates on its own and carries no filled amber surface and no glow, so the
 * screen's one lit element stays the navigate button underneath it.
 *
 * It follows the canonical sheet recipe (§7): backdrop as an absolute sibling,
 * height bounds on `cardWrap` (never on the card — §7.5, or the ScrollView
 * silently stops scrolling), fixed header, scrolling list, no footer.
 *
 * Purely presentational: the parent builds the rows, their order and their
 * labels; this file just draws them and calls back.
 */

import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AccessibilityRole,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon } from '@/components/shared/IconGlyph';
import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { t } from '@/i18n';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

export interface MoreRow {
  key: string;
  label: string;
  /** Quiet right-hand text, e.g. "2 aktivní". */
  value?: string | null;
  /** Leading icon — the parent passes it in from IconGlyph. */
  icon: React.ComponentType<{ size?: number; color: string }>;
  /** Ticked mode (Nejbližší / Překvap mě). */
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  accessibilityLabel?: string;
  accessibilityRole?: AccessibilityRole;
}

export interface MoreSheetProps {
  visible: boolean;
  /** Sheet heading. Defaults to the app-wide "Co ještě?" overflow title. */
  title?: string;
  /** The parent owns which rows exist and in what order. */
  rows: MoreRow[];
  onClose: () => void;
}

export function MoreSheet({ visible, title, rows, onClose }: MoreSheetProps) {
  const insets = useSafeAreaInsets();

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.header}>
            <Text
              style={styles.title}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {title ?? t.compass.moreTitle}
            </Text>
            <CloseButton onPress={onClose} label={t.a11y.counterCloseModal} />
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {rows.map((row, index) => {
              const Icon = row.icon;
              return (
                <Pressable
                  key={row.key}
                  onPress={row.onPress}
                  disabled={row.disabled}
                  style={({ pressed }) => [
                    styles.row,
                    index > 0 && styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                  accessibilityRole={row.accessibilityRole ?? 'button'}
                  accessibilityLabel={row.accessibilityLabel ?? row.label}
                  accessibilityState={{
                    ...(row.selected != null && row.accessibilityRole === 'radio'
                      ? { checked: row.selected }
                      : row.selected != null
                        ? { selected: row.selected }
                        : {}),
                    ...(row.disabled != null ? { disabled: row.disabled } : {}),
                  }}
                >
                  <View style={styles.rowIcon}>
                    <Icon size={18} color={Colors.amber} />
                  </View>
                  <Text
                    style={styles.rowLabel}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {row.label}
                  </Text>
                  {/* A ticked mode outranks its value: the two never show at once. */}
                  {row.selected ? (
                    <CheckIcon size={18} color={Colors.amber} />
                  ) : row.value ? (
                    <Text
                      style={styles.rowValue}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {row.value}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  // The height bounds live here, not on the card (§7.5): the card's parent must
  // have a resolved height or Yoga drops the percentages and the list stops
  // scrolling without a single warning.
  // No minHeight: `flex: 1` on the card resolves its flexBasis against this
  // wrapper, so a minimum here became a maximum — the card sat at 44% and the
  // rows past it were simply cut off. The card measures its own content now and
  // this only caps it.
  cardWrap: {
    width: '100%',
    maxHeight: '92%',
  },
  card: {
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
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,
    color: Colors.foam,
  },
  // Grows with the rows up to the card's 92% cap, then shrinks and scrolls.
  // `flex: 1` here pinned every sheet to the 44% minimum — a ScrollView never
  // asks for more room than its parent offers, so a full list was stuck
  // scrolling inside a short card with empty screen above it.
  list: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: Spacing.sm,
  },
  listContent: {
    paddingBottom: Spacing.sm,
  },
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.sm,
  },
  // Hairlines between rows only — the first one needs no lid.
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  rowPressed: { opacity: 0.6 },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  rowLabel: {
    flex: 1,
    fontWeight: '600',
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
  },
  rowValue: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
});
