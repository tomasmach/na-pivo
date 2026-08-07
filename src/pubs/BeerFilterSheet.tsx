/** Beer-brand filter using the existing one-brand backend contract. */

import React, { useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { BottomSheetModal } from "@/components/shared/BottomSheetModal";
import { CloseButton } from "@/components/shared/CloseButton";
import { CheckIcon } from "@/components/shared/IconGlyph";
import { MockLayout, MockType } from "@/mocks/mockTheme";
import { Colors, withAlpha } from "@/theme/colors";
import { FontScaleCap } from "@/theme/fonts";
import { HitArea, Radius, Spacing } from "@/theme/layout";
import type { PopularBeerBrand } from '@/data/beerSuggestionsClient';
import type { BeerBrandFilterValue } from '@/data/pubSearchFilters';

export function BeerFilterSheet({
  visible,
  options,
  value,
  onClose,
  onApply,
}: {
  visible: boolean;
  options: readonly PopularBeerBrand[];
  value: BeerBrandFilterValue | null;
  onClose: () => void;
  onApply: (next: BeerBrandFilterValue | null) => void;
}) {
  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      {/* The body mounts on open, so its draft seeds from `value` naturally.
          Re-seeding an existing component from an effect would be state set in
          an effect — the same result, one render later, and lint is right to
          flag it. */}
      {visible ? (
        <SheetBody
          options={options}
          value={value}
          onClose={onClose}
          onApply={onApply}
        />
      ) : null}
    </BottomSheetModal>
  );
}

function SheetBody({
  options,
  value,
  onClose,
  onApply,
}: {
  options: readonly PopularBeerBrand[];
  value: BeerBrandFilterValue | null;
  onClose: () => void;
  onApply: (next: BeerBrandFilterValue | null) => void;
}) {
  const insets = useSafeAreaInsets();
  // Local draft, so cancelling really cancels.
  const [draft, setDraft] = useState<BeerBrandFilterValue | null>(value);

  const toggle = (beer: PopularBeerBrand) =>
    setDraft((current) =>
      current?.key === beer.key ? null : { key: beer.key, label: beer.label },
    );

  return (
      <View style={styles.cardWrap}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text
              style={styles.title}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              Pivo
            </Text>
            <View style={styles.grow} />
            <CloseButton onPress={onClose} />
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
          >
            {options.map((beer, index) => {
              const on = draft?.key === beer.key;
              return (
                <Pressable
                  key={beer.key}
                  onPress={() => toggle(beer)}
                  style={({ pressed }) => [
                    styles.row,
                    index === 0 && styles.rowFirst,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={beer.label}
                >
                  <Text
                    style={[styles.rowText, on && styles.rowTextOn]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {beer.label}
                  </Text>
                  <View style={[styles.box, on && styles.boxOn]}>
                    {on ? <CheckIcon size={14} color={Colors.stout} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>

          <View
            style={[
              styles.footer,
              { paddingBottom: Math.max(insets.bottom, Spacing.md) },
            ]}
          >
            <Pressable
              onPress={() => setDraft(null)}
              style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Zrušit výběr"
            >
              <Text
                style={styles.clearText}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                Vymazat
              </Text>
            </Pressable>
            <Pressable
              onPress={() => onApply(draft)}
              style={({ pressed }) => [
                styles.apply,
                pressed && styles.applyPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Použít filtr"
            >
              <Text
                style={styles.applyText}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {draft ? 'Ukázat' : 'Ukázat vše'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },

  // Height bounds live here, never on the card (§7.5).
  cardWrap: { maxHeight: "78%" },
  card: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: MockLayout.cardRadius + 4,
    borderTopRightRadius: MockLayout.cardRadius + 4,
    borderTopWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.12),
    paddingTop: Spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: MockLayout.screenPad,
    paddingBottom: Spacing.sm,
  },
  title: { ...MockType.titleS, fontSize: 22, color: Colors.foam },

  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: MockLayout.screenPad },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    minHeight: HitArea.min + 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  rowFirst: { borderTopWidth: 0 },
  rowText: { flex: 1, ...MockType.body, color: Colors.foam },
  rowTextOn: { color: Colors.amber, fontWeight: "600" },
  box: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: withAlpha(Colors.foam, 0.28),
  },
  boxOn: { backgroundColor: Colors.amber, borderColor: Colors.amber },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  clear: {
    height: MockLayout.buttonHeight,
    paddingHorizontal: Spacing.md,
    justifyContent: "center",
  },
  clearText: {
    ...MockType.bodySmall,
    fontWeight: "600",
    color: Colors.mutedText,
  },
  apply: {
    flex: 1,
    height: MockLayout.buttonHeight,
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.amber,
  },
  applyPressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  applyText: { ...MockType.buttonLabel, color: Colors.stout },
});
