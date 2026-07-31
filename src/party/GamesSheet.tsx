/**
 * DESIGN MOCK — the games door of the party mode.
 *
 * Games are the cheapest thing in the whole product: no server, no storage, and
 * they are the only reason the rest of the table installs the app. They are
 * also what gives a night something to SAY afterwards — a scoreboard is the
 * richest thing a feed card can lead with, and it only exists if the party mode
 * produces one.
 *
 * A GRID, not a list: picking a game is browsing, and browsing wants shapes you
 * can scan at a glance, not rows of prose you have to read left to right in a
 * loud pub.
 *
 * Tapping a tile does NOT play it. It puts the game on the table — it appears in
 * the hub under Aktivity and is launched from there. That separation is the
 * point: the table agrees to play something, then plays it, and the hub stays
 * the one place the evening is run from.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  CheckIcon,
  SparklesIcon,
  TrophyIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export const GAMES = [
  { key: 'quiz', name: 'Pub kvíz', blurb: 'Deset otázek, kdo víc.' },
  { key: 'dice', name: 'Kostky', blurb: 'Klasika. Nejvyšší bere.' },
  { key: 'never', name: 'Nikdy jsem…', blurb: 'Kdo to udělal, pije.' },
  { key: 'kings', name: 'King’s Cup', blurb: 'Karty a pravidla, co si vymyslíte.' },
  { key: 'categories', name: 'Kategorie', blurb: 'Kdo se zasekne, pije.' },
  { key: 'bottle', name: 'Flaška', blurb: 'Točí se, ukáže, ptá se.' },
] as const;

export function GamesSheet({
  visible,
  onTable,
  onClose,
  onPick,
}: {
  visible: boolean;
  /** Keys already on the table — they get a tick, not a second copy. */
  onTable: string[];
  onClose: () => void;
  onPick: (key: string, name: string) => void;
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
                Hry
              </Text>
              <Text style={styles.sub} maxFontSizeMultiplier={FontScaleCap.body}>
                Vyber hru, objeví se ve večeru a odtud se spouští.
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
            contentContainerStyle={[
              styles.grid,
              { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
            ]}
            showsVerticalScrollIndicator={false}
          >
            {GAMES.map((game) => {
              const added = onTable.includes(game.key);
              return (
                <Pressable
                  key={game.key}
                  onPress={() => onPick(game.key, game.name)}
                  style={({ pressed }) => [
                    styles.tile,
                    added && styles.tileAdded,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: added }}
                  accessibilityLabel={game.name}
                >
                  <View style={[styles.medallion, added && styles.medallionAdded]}>
                    {added ? (
                      <CheckIcon size={17} color={Colors.stout} />
                    ) : game.key === 'quiz' ? (
                      <TrophyIcon size={17} color={Colors.amber} />
                    ) : (
                      <SparklesIcon size={17} color={Colors.amber} />
                    )}
                  </View>
                  <Text
                    style={styles.tileTitle}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {game.name}
                  </Text>
                  <Text
                    style={styles.tileBlurb}
                    numberOfLines={2}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {game.blurb}
                  </Text>
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
    maxHeight: '80%',
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: MockLayout.cardRadius + 6,
    borderTopRightRadius: MockLayout.cardRadius + 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
    paddingTop: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    paddingBottom: Spacing.md,
  },
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

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
  },
  tile: {
    width: '48%',
    minHeight: 124,
    padding: Spacing.md,
    gap: 5,
    borderRadius: 22,
    backgroundColor: Colors.stout3,
  },
  tileAdded: { backgroundColor: withAlpha(Colors.amber, 0.14) },
  medallion: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.14),
    marginBottom: 2,
  },
  medallionAdded: { backgroundColor: Colors.amber },
  tileTitle: { ...MockType.bodySemibold, color: Colors.foam },
  tileBlurb: { fontSize: 12, fontWeight: '400', color: Colors.mutedText, lineHeight: 16 },
});
