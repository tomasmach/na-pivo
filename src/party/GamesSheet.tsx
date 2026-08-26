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
import { CheckIcon, LockKeyholeIcon } from '@/components/shared/IconGlyph';
import { GameCover } from '@/party/GameCover';
import { GAMES_COMING_SOON, GAME_CATALOG } from '@/party/gameCatalog';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

const COVER_H = 118;

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
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <View style={styles.grow}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {t.party.gamesTitle}
              </Text>
            </View>
            <CloseButton onPress={onClose} />
          </View>
          {GAMES_COMING_SOON ? (
            <Text style={styles.soon} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.party.gamesComingSoon}
            </Text>
          ) : null}

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.grid}
            showsVerticalScrollIndicator={false}
          >
            {GAME_CATALOG.map((game) => {
              const added = onTable.includes(game.key);
              const locked = GAMES_COMING_SOON;
              return (
                <Pressable
                  key={game.key}
                  onPress={added || locked ? undefined : () => onPick(game.key, game.name)}
                  disabled={added || locked}
                  style={({ pressed }) => [styles.tile, locked && styles.locked, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: added, disabled: added || locked }}
                  accessibilityLabel={
                    locked
                      ? `${game.name}. ${t.party.gamesComingSoon}`
                      : `${game.name}. ${game.how}`
                  }
                >
                  <View>
                    <GameCover game={game} height={COVER_H} />
                    {locked ? (
                      <View style={styles.lock}>
                        <LockKeyholeIcon size={16} color={Colors.foam} />
                        <Text style={styles.lockText} allowFontScaling={false}>
                          {t.party.gamesSoonBadge}
                        </Text>
                      </View>
                    ) : (
                      <View style={[styles.badge, game.scoring === 'points' && styles.badgePoints]}>
                        <Text style={styles.badgeText} allowFontScaling={false}>
                          {game.scoring === 'points'
                            ? t.party.scoringPoints
                            : t.party.scoringNoPoints}
                        </Text>
                      </View>
                    )}
                    {added && !locked ? (
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
  grow: { flex: 1 },
  soon: {
    ...MockType.body,
    color: Colors.foamMuted,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  lock: {
    position: 'absolute',
    top: Spacing.sm,
    left: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.stout, 0.72),
  },
  lockText: { ...MockType.label, color: Colors.foam },
  pressed: { opacity: 0.7 },
  locked: { opacity: 0.82 },

  cardWrap: { width: '100%', maxHeight: '92%' },
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
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  title: { ...MockType.titleS, fontSize: 24, color: Colors.foam },
  list: { flexGrow: 0, flexShrink: 1, marginTop: Spacing.sm },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  tile: { width: '47%', gap: 6 },
  name: { ...MockType.bodySemibold, fontSize: 17, color: Colors.foam },

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
