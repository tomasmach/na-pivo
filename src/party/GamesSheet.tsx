/**
 * DESIGN MOCK — the games door of the party mode.
 *
 * A grid of covers, because picking a game is browsing and browsing wants
 * pictures you scan, not rows of prose you read left to right in a loud pub. The
 * first pass was a grid of small amber discs, which is a list of icons wearing a
 * grid's clothes.
 *
 * Tapping a tile does NOT play it. It puts the game on the table — it appears in
 * the hub's Log and is launched from there. The table agrees to play something,
 * then plays it, and the hub stays the one place the evening is run from.
 *
 * The badge on each cover says how it ends: a scoreboard, or sips. That is the
 * one thing worth knowing before you commit the table to it.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { CheckIcon } from '@/components/shared/IconGlyph';
import { GameCover } from '@/party/GameCover';
import { GAME_CATALOG } from '@/party/gameCatalog';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

const COVER_H = 96;

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
    <BottomSheetModal visible={visible} onClose={onClose}>
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
          <CloseButton onPress={onClose} />
        </View>

        <ScrollView
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: Math.max(insets.bottom, Spacing.lg) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {GAME_CATALOG.map((game) => {
            const added = onTable.includes(game.key);
            return (
              <Pressable
                key={game.key}
                onPress={() => onPick(game.key, game.name)}
                style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityState={{ selected: added }}
                accessibilityLabel={`${game.name}. ${game.how}`}
              >
                <View>
                  <GameCover game={game} height={COVER_H} />
                  <View
                    style={[styles.badge, game.scoring === 'points' && styles.badgePoints]}
                  >
                    <Text style={styles.badgeText} allowFontScaling={false}>
                      {game.scoring === 'points' ? 'Na body' : 'Na pití'}
                    </Text>
                  </View>
                  {added ? (
                    <View style={styles.added}>
                      <CheckIcon size={15} color={Colors.stout} />
                    </View>
                  ) : null}
                </View>

                <Text
                  style={styles.name}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {game.name}
                </Text>
                <Text
                  style={styles.how}
                  numberOfLines={2}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {game.how}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  grow: { flex: 1 },
  pressed: { opacity: 0.7 },

  card: {
    maxHeight: '86%',
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: MockLayout.cardRadius + 6,
    borderTopRightRadius: MockLayout.cardRadius + 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
    paddingTop: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    paddingBottom: Spacing.lg,
  },
  title: { ...MockType.titleS, fontSize: 24, color: Colors.foam },
  sub: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    paddingHorizontal: MockLayout.screenPad,
  },
  tile: { width: '47%', gap: 6 },
  name: { ...MockType.bodySemibold, fontSize: 17, color: Colors.foam },
  how: { fontSize: 12, fontWeight: '400', color: Colors.mutedText, lineHeight: 16 },

  /** How it ends, on the cover — the one thing worth knowing before you pick. */
  badge: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    backgroundColor: withAlpha(Colors.black, 0.5),
  },
  badgePoints: { backgroundColor: withAlpha(Colors.amber, 0.85) },
  badgeText: { fontSize: 10, fontWeight: '800', color: Colors.foam },

  added: {
    position: 'absolute',
    right: 8,
    top: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
});
