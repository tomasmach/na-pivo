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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CheckIcon } from '@/components/shared/IconGlyph';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
import { GameCover } from '@/party/GameCover';
import type { GameDef } from '@/party/gameCatalog';
import {
  GameStage,
  STAGE_FILL,
  StagePill,
  useStageHeight,
} from '@/party/shells/GameStage';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

/** The cover is the hero, but the roster has to fit under it without scrolling. */
const COVER_FRACTION = 0.3;

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
  onInvite,
}: {
  def: GameDef | undefined;
  /** Everyone at the night, you first. */
  table: LobbyPlayer[];
  onStart: (players: LobbyPlayer[]) => void;
  onInvite?: () => void;
}) {
  const insets = useSafeAreaInsets();
  const coverHeight = useStageHeight(COVER_FRACTION);
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
          <GameStage fraction={COVER_FRACTION} style={styles.hero}>
            <View style={STAGE_FILL}>
              <GameCover
                game={def}
                height={coverHeight}
                glyph={72}
                radius={Radius.cardLarge}
              />
            </View>
          </GameStage>
        ) : null}

        <Text
          style={styles.title}
          maxFontSizeMultiplier={FontScaleCap.heading}
          accessibilityRole="header"
        >
          {def?.name ?? 'Hra'}
        </Text>
        {def ? (
          <Text style={styles.rules} maxFontSizeMultiplier={FontScaleCap.body}>
            {def.how}
          </Text>
        ) : null}

        <Text
          style={styles.section}
          maxFontSizeMultiplier={FontScaleCap.body}
          accessibilityRole="header"
        >
          Kdo hraje
        </Text>

        {/* Chips, not rows: the roster is one glance, and a ticked chip reads
            as "in" from across the table faster than a list with checkboxes
            down the right edge. */}
        <View style={styles.roster}>
          {table.map((person) => {
            const isIn = !out.includes(person.id);
            return (
              <Pressable
                key={person.id}
                onPress={() => toggle(person.id)}
                style={({ pressed }) => [
                  styles.chip,
                  isIn && styles.chipOn,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isIn }}
                accessibilityLabel={person.name}
              >
                <PersonAvatar name={person.name} tint={person.tint} size={26} />
                <Text
                  style={[styles.name, !isIn && styles.nameOut]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {person.name}
                </Text>
                {isIn ? <CheckIcon size={15} color={Colors.amber} /> : null}
              </Pressable>
            );
          })}
        </View>

        {onInvite ? (
          <Pressable
            onPress={onInvite}
            style={({ pressed }) => [styles.invite, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Přizvat ke stolu"
          >
            <Text style={styles.inviteText} maxFontSizeMultiplier={FontScaleCap.body}>
              Přizvat ke stolu
            </Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <View style={[styles.foot, { paddingBottom: insets.bottom + Spacing.sm }]}>
        <StagePill
          label={
            enough
              ? `Začít — hraje vás ${playing.length}`
              : 'Aspoň dva, jinak to není hra'
          }
          onPress={() => enough && onStart(playing)}
          disabled={!enough}
          tone={enough ? 'primary' : 'quiet'}
          accessibilityLabel={
            enough ? `Začít, hraje ${playing.length}` : 'Potřebuješ aspoň dva hráče'
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  pressed: { opacity: 0.7 },
  body: { paddingHorizontal: MockLayout.screenPad, paddingBottom: Spacing.xl },

  hero: { marginTop: Spacing.md },
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

  roster: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    paddingLeft: 6,
    paddingRight: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  chipOn: { backgroundColor: withAlpha(Colors.amber, 0.16) },
  name: { maxWidth: 160, fontSize: 16, fontWeight: '700', color: Colors.foam },
  nameOut: { color: withAlpha(Colors.foam, 0.35) },
  invite: { minHeight: 44, alignSelf: 'flex-start', justifyContent: 'center', marginTop: Spacing.md },
  inviteText: { fontSize: 15, fontWeight: '700', color: Colors.amber },

  foot: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.sm },
});
