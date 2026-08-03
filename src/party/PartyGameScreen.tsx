/**
 * DESIGN MOCK — a game, fullscreen, with the night still on screen.
 *
 * Fullscreen because a game played on a phone in a pub is passed around the
 * table, and a tab bar at the bottom of a passed-around phone is a mis-tap
 * waiting to happen.
 *
 * But the beer counter stays. The whole reason the app is out of your pocket
 * during a game is that you are also drinking, and making someone leave the
 * game to log a beer is how a night's data ends up half-recorded. So the top
 * strip carries your tally and a `+1` that never leaves the screen.
 *
 * This screen is a RUNTIME, not a game. Nine games, three shells:
 *
 *   `score`   a tally — tap a name, they get a point (Pub kvíz)
 *   `prompt`  a deck of cards, one at a time (Nikdy jsem…, Kategorie, Pravidlo)
 *   `draw`    chance, with the suspense left in (Kostky, Flaška, Runda, King's)
 *
 * The tenth game should be a row in `gameCatalog.ts` and a list of prompts, not
 * another screen. That is also what let the shared-game backend stay generic:
 * every shell writes the same two events, so nothing about playing needs a
 * per-game endpoint.
 *
 * What a game leaves behind is the part that has to be right: a scoreboard the
 * recap and the feed can lead with — but only for `points` games. A drinking
 * game keeps no tally, because the only tally it could keep is who drank most,
 * and that is the one scoreboard this product must never print.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BeerIcon, ChevronLeftIcon, PlusIcon } from '@/components/shared/IconGlyph';
import { findGame, type GameDraw } from '@/party/gameCatalog';
import { GAME_PROMPTS } from '@/party/gameContent';
import { DiceDuelShell } from '@/party/shells/DiceDuelShell';
import { DrawShell } from '@/party/shells/DrawShell';
import { GameLobby } from '@/party/shells/GameLobby';
import { PromptShell } from '@/party/shells/PromptShell';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/** The verb IS the game — "roztoč" and "hoď" are different promises. */
const DRAW_ACTION: Record<GameDraw, string> = {
  dice: 'Hoď',
  person: 'Roztoč',
  card: 'Táhni kartu',
};

export default function PartyGameScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { key } = useLocalSearchParams<{ key: string }>();

  const beers = useLivePartyStore((s) => s.beers);
  const houseBeer = useLivePartyStore((s) => s.houseBeer);
  const people = useLivePartyStore((s) => s.people);
  const addBeer = useLivePartyStore((s) => s.addBeer);
  const finishGame = useLivePartyStore((s) => s.finishGame);
  const invite = useLivePartyStore((s) => s.invite);
  const games = useLivePartyStore((s) => s.games);

  const def = key ? findGame(key) : undefined;
  const name = def?.name ?? games.find((entry) => entry.key === key)?.name ?? 'Hra';
  // Points games crown someone; sip games do not. See `gameCatalog`.
  const onPoints = def?.scoring !== 'drinks';
  const shell = def?.shell ?? 'score';
  const prompts = key ? (GAME_PROMPTS[key] ?? []) : [];
  // Varies the deal per game without calling `Math.random()` in render, which
  // is impure and the lint rule is right to stop.
  const [seed] = React.useState(() => Date.now() & 0xffff);

  // Who is at the night, you first. The lobby turns this into who is PLAYING —
  // the two are not the same, and starting a game with everyone in the evening
  // is how the first round becomes an argument about whose turn it is.
  const table = React.useMemo(
    () => [
      { name: 'Ty', tint: Colors.amber },
      ...people.map((person) => ({ name: person.name, tint: person.tint })),
    ],
    [people],
  );
  const [roster, setRoster] = React.useState<{ name: string; tint: string }[] | null>(null);

  const players = React.useMemo(
    () => (roster ?? table).map((person) => person.name),
    [roster, table],
  );
  const [scores, setScores] = React.useState<Record<string, number>>({});

  const bump = (player: string) =>
    setScores((current) => ({ ...current, [player]: (current[player] ?? 0) + 1 }));

  const ranked = players
    .map((player) => ({ name: player, score: scores[player] ?? 0 }))
    .sort((a, b) => b.score - a.score);
  const leader = ranked[0];
  const played = ranked.some((row) => row.score > 0);

  const finish = () => {
    if (key) {
      finishGame(key, {
        game: name,
        // A drinking game names nobody, and keeps no tally: the only tally it
        // could keep is who drank most.
        winner: onPoints && played ? leader.name : null,
        scores: onPoints ? ranked : [],
      });
    }
    router.back();
  };

  return (
    <View style={styles.screen}>
      {/* The night, pinned. Back on the left, tally and +1 on the right — the
          two things you reach for without looking away from the table. */}
      <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Zpátky do večera"
          hitSlop={6}
        >
          <ChevronLeftIcon size={20} color={Colors.foam} />
        </Pressable>

        <Text style={styles.topTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {name}
        </Text>

        {/* Ending is up here, as far from everything you tap during a game as
            the screen allows — and it is text, not a full-width amber bar
            competing with the button you actually press. */}
        {roster ? (
          <Pressable
            onPress={finish}
            style={({ pressed }) => [styles.end, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Ukončit hru"
            hitSlop={8}
          >
            <Text style={styles.endText} allowFontScaling={false}>
              Konec
            </Text>
          </Pressable>
        ) : null}
      </View>

      {roster === null ? (
        <GameLobby
          def={def}
          table={table}
          onStart={setRoster}
          onInvite={(name) => invite(name)}
        />
      ) : null}

      {roster && shell === 'turns' ? (
        <DiceDuelShell
          players={roster}
          onFinished={(result) => {
            if (!key) return;
            finishGame(key, {
              game: name,
              // The board is round wins. "Who paid" is the story, and it is the
              // line the recap and the feed lead with.
              winner: result.standings[0]?.name ?? null,
              scores: result.standings,
              paying: result.paying,
            });
          }}
        />
      ) : null}

      {roster && shell === 'prompt' ? (
        <PromptShell prompts={prompts} intro={def?.intro} seed={seed} />
      ) : null}

      {roster && shell === 'draw' ? (
        <DrawShell
          kind={def?.draw ?? 'dice'}
          players={players}
          intro={def?.intro}
          action={DRAW_ACTION[def?.draw ?? 'dice']}
        />
      ) : null}

      {roster && shell === 'score' ? (
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* The rules, on the screen. Nobody remembers how King's Cup goes and
            looking it up mid-round is how a game dies. */}
        {def ? (
          <Text style={styles.rules} maxFontSizeMultiplier={FontScaleCap.body}>
            {def.how}
          </Text>
        ) : null}
        <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
          {onPoints ? 'Ťukni na toho, kdo bodoval.' : 'Ťukni na toho, kdo pije.'}
        </Text>

        {ranked.map((row, index) => (
          <Pressable
            key={row.name}
            onPress={() => bump(row.name)}
            style={({ pressed }) => [
              styles.player,
              onPoints && index === 0 && played && styles.playerLeader,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Bod pro ${row.name}`}
          >
            <Text
              style={styles.playerName}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {row.name}
            </Text>
            <Text style={styles.playerScore} allowFontScaling={false}>
              {row.score}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      ) : null}

      {/* The counter floats bottom-right rather than sitting in the header: the
          one thing you do mid-game besides play is log a beer, and that belongs
          under your thumb, not up by the exit. */}
      {roster ? (
        <Pressable
          onPress={() => addBeer(houseBeer)}
          style={({ pressed }) => [
            styles.counter,
            { bottom: insets.bottom + Spacing.md },
            pressed && styles.counterPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`Máš ${beers.length} piv. Přidat další.`}
        >
          <BeerIcon size={17} color={Colors.stout} />
          <Text style={styles.counterText} allowFontScaling={false}>
            {beers.length}
          </Text>
          <PlusIcon size={14} color={Colors.stout} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MockColors.bg },
  pressed: { opacity: 0.7 },

  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.foam, 0.1),
  },
  back: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.08),
  },
  topTitle: { flex: 1, fontSize: 17, fontWeight: '700', color: Colors.foam },
  end: { paddingHorizontal: Spacing.sm, paddingVertical: 6 },
  endText: { fontSize: 16, fontWeight: '700', color: Colors.amber },
  counter: {
    position: 'absolute',
    right: MockLayout.screenPad,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  counterPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  counterText: {
    fontSize: 16,
    fontWeight: '800',
    color: Colors.stout,
    fontVariant: ['tabular-nums'],
  },

  body: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.lg, gap: Spacing.sm },
  rules: {
    fontSize: 15,
    fontWeight: '500',
    color: Colors.foam,
    lineHeight: 21,
  },
  hint: {
    fontSize: 14,
    fontWeight: '400',
    color: Colors.mutedText,
    marginBottom: Spacing.sm,
  },

  player: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: HitArea.min + 22,
    paddingHorizontal: Spacing.lg,
    borderRadius: 22,
    backgroundColor: MockColors.surfaceHigh,
  },
  playerLeader: { backgroundColor: withAlpha(Colors.amber, 0.16) },
  playerName: { flex: 1, fontSize: 20, fontWeight: '700', color: Colors.foam },
  playerScore: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  foot: {
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  finish: {
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  finishText: { ...MockType.buttonLabel, color: Colors.stout },
});
