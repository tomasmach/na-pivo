/**
 * DESIGN MOCK — the games door of the party mode.
 *
 * Games are the cheapest thing in the whole product: no server, no storage, and
 * they are the only reason the rest of the table installs the app. They are
 * also what gives a night something to SAY afterwards — a scoreboard is the
 * richest thing a feed card can lead with, and it only exists if the party mode
 * produces one.
 *
 * Picking a game here fakes a round and writes its result into the live party,
 * which is what the recap and the feed then read. The real thing plays the game;
 * the shape of what it leaves behind is the same.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { XIcon } from '@/components/shared/IconGlyph';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import type { GameResult } from '@/mocks/livePartyStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const GAMES = [
  { key: 'quiz', name: 'Pub kvíz', blurb: 'Deset otázek, kdo víc.' },
  { key: 'dice', name: 'Kostky', blurb: 'Klasika. Nejvyšší bere.' },
  { key: 'never', name: 'Nikdy jsem…', blurb: 'Kdo to udělal, pije.' },
  { key: 'kings', name: 'King’s Cup', blurb: 'Karty a pravidla, co si vymyslíte.' },
  { key: 'categories', name: 'Kategorie', blurb: 'Kdo se zasekne, pije.' },
] as const;

/** A plausible scoreboard so the recap and the feed have something real to
 *  render. The real game supplies its own. */
function fakeResult(game: string, people: string[]): GameResult {
  const scores = people
    .map((name, index) => ({ name, score: 18 - index * 3 - (index % 2) }))
    .sort((a, b) => b.score - a.score);
  return { game, winner: scores[0]?.name ?? 'Ty', scores };
}

export function GamesSheet({
  visible,
  people,
  onClose,
  onPlayed,
}: {
  visible: boolean;
  people: string[];
  onClose: () => void;
  onPlayed: (result: GameResult) => void;
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

        <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          <View style={styles.card}>
            <View style={styles.header}>
              <View style={styles.grow}>
                <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                  Hry
                </Text>
                <Text style={styles.sub} maxFontSizeMultiplier={FontScaleCap.body}>
                  Hraje se u stolu. Výsledek zůstane ve večeru.
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
              style={styles.list}
              contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, Spacing.lg) }}
              showsVerticalScrollIndicator={false}
            >
              {GAMES.map((game, index) => (
                <Pressable
                  key={game.key}
                  onPress={() => onPlayed(fakeResult(game.name, people))}
                  style={({ pressed }) => [
                    styles.row,
                    index === 0 && styles.rowFirst,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={game.name}
                >
                  <View style={styles.grow}>
                    <Text style={styles.rowTitle} maxFontSizeMultiplier={FontScaleCap.body}>
                      {game.name}
                    </Text>
                    <Text style={styles.rowBlurb} maxFontSizeMultiplier={FontScaleCap.body}>
                      {game.blurb}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: withAlpha(Colors.black, 0.6) },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },

  cardWrap: { maxHeight: '72%' },
  card: {
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: MockLayout.cardRadius + 4,
    borderTopRightRadius: MockLayout.cardRadius + 4,
    borderTopWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.12),
    paddingTop: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    paddingBottom: Spacing.sm,
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

  list: { flexGrow: 0, paddingHorizontal: MockLayout.screenPad },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HitArea.min + 12,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.border, 0.4),
  },
  rowFirst: { borderTopWidth: 0 },
  rowTitle: { ...MockType.bodySemibold, color: Colors.foam },
  rowBlurb: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },
});
