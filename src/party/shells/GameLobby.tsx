/**
 * Who is playing — the ten seconds before every game.
 *
 * The table is not the party. Somebody is at the bar, somebody is not playing,
 * somebody just sat down. Starting a game with "everyone who happens to be in
 * the evening" is how the first round becomes an argument about whose turn it
 * is, so the roster is an explicit step: names come pre-checked from the night,
 * you untick whoever is out, and anyone missing can be added right here.
 *
 * Pre-checked, not empty: the common case is that everyone plays, and making
 * five people tick themselves in before a pub game is the kind of ceremony that
 * makes a table put the phone down.
 *
 * A game needs two. One player is not a game, it is a random number generator,
 * so the start button says why it is disabled rather than just being grey.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { CheckIcon } from '@/components/shared/IconGlyph';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
import { GameCover } from '@/party/GameCover';
import type { GameDef } from '@/party/gameCatalog';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export interface LobbyPlayer {
  /** Stable account id; display names are not a cross-phone identity. */
  id: string;
  name: string;
  tint: string;
}

export function GameLobby({
  def,
  table,
  onStart,
}: {
  def: GameDef | undefined;
  /** Everyone at the night, you first. */
  table: LobbyPlayer[];
  onStart: (players: LobbyPlayer[]) => void;
}) {
  const [out, setOut] = React.useState<string[]>([]);

  const playing = table.filter((person) => !out.includes(person.id));
  const enough = playing.length >= 2;

  const toggle = (id: string) =>
    setOut((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );

  return (
    <View style={styles.wrap}>
      <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
        {def ? (
          <View style={styles.hero}>
            <GameCover game={def} height={148} glyph={44} />
          </View>
        ) : null}

        <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
          {def?.name ?? 'Hra'}
        </Text>
        {def ? (
          <Text style={styles.rules} maxFontSizeMultiplier={FontScaleCap.body}>
            {def.how}
          </Text>
        ) : null}

        <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.body}>
          Kdo hraje
        </Text>

        {table.map((person) => {
          const isIn = !out.includes(person.id);
          return (
            <Pressable
              key={person.id}
              onPress={() => toggle(person.id)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isIn }}
              accessibilityLabel={person.name}
            >
              <PersonAvatar name={person.name} tint={person.tint} size={38} />
              <Text
                style={[styles.name, !isIn && styles.nameOut]}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {person.name}
              </Text>
              <View style={[styles.tick, isIn && styles.tickOn]}>
                {isIn ? <CheckIcon size={15} color={Colors.stout} /> : null}
              </View>
            </Pressable>
          );
        })}

        {!enough ? (
          <Text style={styles.inviteHint} maxFontSizeMultiplier={FontScaleCap.body}>
            Další hráče přizvi ke stolu z obrazovky večera.
          </Text>
        ) : null}
      </ScrollView>

      <View style={styles.foot}>
        <Pressable
          onPress={() => enough && onStart(playing)}
          disabled={!enough}
          style={({ pressed }) => [styles.start, !enough && styles.startOff, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={enough ? `Začít, hraje ${playing.length}` : 'Potřebuješ aspoň dva hráče'}
        >
          <Text
            style={[styles.startText, !enough && styles.startTextOff]}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {enough ? `Začít — hraje vás ${playing.length}` : 'Aspoň dva, jinak to není hra'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  pressed: { opacity: 0.7 },
  body: { paddingHorizontal: MockLayout.screenPad, paddingBottom: Spacing.xl },

  hero: { marginTop: Spacing.md, borderRadius: 18, overflow: 'hidden' },
  title: { ...MockType.titleXL, fontSize: 27, color: Colors.foam, marginTop: Spacing.lg },
  rules: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500',
    color: withAlpha(Colors.foam, 0.7),
    marginTop: Spacing.xs,
  },
  section: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.mutedText,
    marginTop: Spacing.xl,
    marginBottom: Spacing.xs,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 60,
  },
  name: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.foam },
  nameOut: { color: withAlpha(Colors.foam, 0.35) },
  inviteHint: { marginTop: Spacing.md, fontSize: 14, color: Colors.mutedText },
  tick: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: withAlpha(Colors.foam, 0.2),
  },
  tickOn: { backgroundColor: Colors.amber, borderColor: Colors.amber },

  foot: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.sm },
  start: {
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  startOff: { backgroundColor: withAlpha(Colors.foam, 0.08) },
  startText: { ...MockType.buttonLabel, color: Colors.stout },
  startTextOff: { color: Colors.mutedText },

});
