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
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { CheckIcon, UserPlusIcon } from '@/components/shared/IconGlyph';
import { Face } from '@/feed/FeedMockScreen';
import { GameCover } from '@/party/GameCover';
import type { GameDef } from '@/party/gameCatalog';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export interface LobbyPlayer {
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
  /** Adds somebody to the NIGHT, not just to the game — they are here. */
  onInvite: (name: string) => void;
}) {
  const [out, setOut] = React.useState<string[]>([]);
  const [adding, setAdding] = React.useState(false);
  const [draft, setDraft] = React.useState('');

  const playing = table.filter((person) => !out.includes(person.name));
  const enough = playing.length >= 2;

  const toggle = (name: string) =>
    setOut((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );

  const commit = () => {
    const name = draft.trim();
    if (name) onInvite(name);
    setDraft('');
    setAdding(false);
  };

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
          const isIn = !out.includes(person.name);
          return (
            <Pressable
              key={person.name}
              onPress={() => toggle(person.name)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isIn }}
              accessibilityLabel={person.name}
            >
              <Face name={person.name} tint={person.tint} size={38} />
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

        <Pressable
          onPress={() => setAdding(true)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Přizvat dalšího"
        >
          <View style={styles.addFace}>
            <UserPlusIcon size={17} color={Colors.mutedText} />
          </View>
          <Text style={[styles.name, styles.nameAdd]} maxFontSizeMultiplier={FontScaleCap.body}>
            Přizvat dalšího
          </Text>
        </Pressable>
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

      <BottomSheetModal visible={adding} onClose={() => setAdding(false)}>
        <View style={styles.dialog}>
          <View style={styles.dialogHead}>
            <Text style={styles.dialogTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              Kdo se přidal?
            </Text>
            <CloseButton onPress={() => setAdding(false)} />
          </View>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Jméno nebo přezdívka"
            placeholderTextColor={MockColors.fieldHint}
            style={styles.input}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={commit}
            maxFontSizeMultiplier={FontScaleCap.body}
          />
          <Pressable
            onPress={commit}
            style={({ pressed }) => [styles.save, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Přidat ke stolu"
          >
            <Text style={styles.saveText} maxFontSizeMultiplier={FontScaleCap.heading}>
              Přidat ke stolu
            </Text>
          </Pressable>
        </View>
      </BottomSheetModal>
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
  nameAdd: { fontWeight: '600', color: Colors.mutedText },
  addFace: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.08),
  },
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

  dialog: {
    backgroundColor: MockColors.surface,
    borderTopLeftRadius: MockLayout.cardRadius + 6,
    borderTopRightRadius: MockLayout.cardRadius + 6,
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    gap: Spacing.md,
  },
  dialogHead: { flexDirection: 'row', alignItems: 'center' },
  dialogTitle: { ...MockType.titleS, fontSize: 22, color: Colors.foam, flex: 1 },
  input: {
    height: MockLayout.buttonHeight,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: MockColors.field,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MockColors.fieldBorder,
    color: Colors.foam,
    fontSize: 16,
    fontWeight: '600',
  },
  save: {
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  saveText: { ...MockType.buttonLabel, color: Colors.stout },
});
