/**
 * DESIGN MOCK — where are we drinking.
 *
 * A list, not a menu. A menu would answer "which of these names", but the
 * question before a night starts is "which of these places", and that needs the
 * distance, whether it is open and what is on tap — the same three facts the pub
 * list row carries, because it is the same decision.
 *
 * Reachable both before the night (you are choosing) and during it (you moved),
 * which is why the header row it hangs off is a control in both states.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon, XIcon } from '@/components/shared/IconGlyph';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { MOCK_PUBS } from '@/pubs/mockPubs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

export function PubPickerSheet({
  visible,
  current,
  onClose,
  onPick,
}: {
  visible: boolean;
  current: string;
  onClose: () => void;
  onPick: (pub: { name: string; beer: string }) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Zavřít"
        />

        <View style={styles.card}>
          <View style={styles.header}>
            <View style={styles.grow}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                Kde jste?
              </Text>
              <Text style={styles.sub} maxFontSizeMultiplier={FontScaleCap.body}>
                Hospody kolem tebe. Změnit ji jde i uprostřed večera.
              </Text>
            </View>
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Zavřít"
              hitSlop={8}
            >
              <XIcon size={17} color={Colors.mutedText} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, Spacing.lg) }}
            showsVerticalScrollIndicator={false}
          >
            {MOCK_PUBS.map((pub) => {
              const here = pub.name === current;
              return (
                <Pressable
                  key={pub.id}
                  onPress={() => onPick({ name: pub.name, beer: pub.beer })}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: here }}
                  accessibilityLabel={`${pub.name}, ${pub.distance}`}
                >
                  <View style={styles.grow}>
                    <Text
                      style={[styles.name, here && styles.nameHere]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {pub.name}
                    </Text>
                    <Text
                      style={styles.meta}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {pub.distance} ·{' '}
                      <Text style={{ color: pub.open ? Colors.open : Colors.mutedText }}>
                        {pub.open ? `otevřeno ${pub.hours}` : `zavřeno, ${pub.hours}`}
                      </Text>{' '}
                      · {pub.beer}
                    </Text>
                  </View>
                  {here ? <CheckIcon size={18} color={Colors.amber} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(Colors.black, 0.6) },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },

  card: {
    maxHeight: '76%',
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: MockLayout.cardRadius + 6,
    borderTopRightRadius: MockLayout.cardRadius + 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingBottom: Spacing.sm },
  title: { ...MockType.titleS, fontSize: 22, color: Colors.foam },
  sub: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },
  close: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: HitArea.min + 14,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.08),
  },
  name: { fontSize: 16, fontWeight: '600', color: Colors.foam },
  nameHere: { color: Colors.amber, fontWeight: '800' },
  meta: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },
});
