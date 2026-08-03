/**
 * DESIGN MOCK — the running night, as a hub.
 *
 * The first version was Strava's Record screen: a full-bleed map with a sheet of
 * controls over it. That is the right shape for the moment BEFORE anything has
 * happened, and the wrong one from the first beer onwards — a map of one pin you
 * are sitting inside is the least interesting thing on the screen, and it was
 * taking two thirds of it.
 *
 * So the map collapses to a band the moment the night starts, and the evening
 * takes the space. What you get instead, top to bottom:
 *
 *   stats        two or three big numbers, whichever are true right now
 *   controls     invite, photo, +1 beer, games, move on
 *   log          everything that happened, as one thread
 *
 * There are no charts here. A night in progress is a thing you are IN — you
 * glance at the phone to see what just happened, not to study a bar chart of
 * your own evening. The graphs live in the recap, after you finish and post,
 * where looking back is the whole point.
 *
 * Ending the night sits top right, away from "+1 pivo": those two buttons must
 * never be neighbours, because one of them is undoable and the other is not.
 *
 * Everything is local state on a mock store. Nothing is wired.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import {
  BeerIcon,
  CameraIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MapPinIcon,
  PlusIcon,
  SoccerBallIcon,
  SparklesIcon,
  TrophyIcon,
  UserPlusIcon,
} from '@/components/shared/IconGlyph';
import { BeerSheet } from '@/party/BeerSheet';
import { Face } from '@/feed/FeedMockScreen';
import { PulsePanel } from '@/party/PulsePanel';
import { GamesSheet } from '@/party/GamesSheet';
import { InviteSheet } from '@/party/InviteSheet';
import { hubStats } from '@/party/nightPulse';
import { NightRoute } from '@/mocks/NightRoute';
import {
  beersByType,
  clockAt,
  minutesBetween,
  useLivePartyStore,
  useNightClock,
  type LogKind,
} from '@/mocks/livePartyStore';
import { MockColors, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const STOPS = [{ name: 'U Fleků', lat: 50.0785, lng: 14.42 }];
const TAPS = [
  { name: 'Flekovský ležák 13°', priceCzk: 62 },
  { name: 'Flekovský tmavý 13°', priceCzk: 62 },
  { name: 'Nealko 11°', priceCzk: 45 },
];

/** How far the sheet overlaps the map, which is also its corner radius. */
const SHEET_RADIUS = 28;

/** Full map before the night starts, a band once it has. */
const MAP_IDLE = 460;
/** Below the notch and the floating chrome: at a fixed 128 the sheet's top edge
 *  cut through the back chevron and "Ukončit" on a tall phone. */
const MAP_LIVE_MIN = 128;
const TOP_BAR_H = HitArea.min + Spacing.sm * 2;

/** One glyph per kind of thing that happens in an evening. */
const LOG_GLYPH: Record<LogKind, React.ReactNode> = {
  beer: <BeerIcon size={17} color={Colors.amber} />,
  photo: <CameraIcon size={17} color={Colors.amber} />,
  game: <SparklesIcon size={17} color={Colors.amber} />,
  join: <UserPlusIcon size={17} color={Colors.amber} />,
  pub: <MapPinIcon size={17} color={Colors.amber} />,
};


function CircleButton({
  label,
  children,
  onPress,
  /** Does this put something INTO the evening? Those get a plus, so a row of
   *  nouns ("Foto", "Hry") reads as five things you can add rather than five
   *  places you can go. */
  adds = true,
}: {
  label: string;
  children: React.ReactNode;
  onPress?: () => void;
  adds?: boolean;
}) {
  return (
    <View style={styles.circleWrap}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.circleSecondary, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={adds ? `Přidat: ${label}` : label}
      >
        {children}
        {adds ? (
          <View style={styles.addBadge}>
            <PlusIcon size={9} color={Colors.stout} />
          </View>
        ) : null}
      </Pressable>
      <Text style={styles.circleLabel} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </View>
  );
}

export default function LivePartyMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const live = useLivePartyStore((s) => s.live);
  const beers = useLivePartyStore((s) => s.beers);
  const startedAt = useLivePartyStore((s) => s.startedAt);
  // The stopwatch. Ticks on its own; every reading below is derived from it.
  const minutes = useNightClock(startedAt);
  const people = useLivePartyStore((s) => s.people);
  const photos = useLivePartyStore((s) => s.photos);
  const games = useLivePartyStore((s) => s.games);
  const log = useLivePartyStore((s) => s.log);
  const houseBeer = useLivePartyStore((s) => s.houseBeer);
  const beginPickingPub = useLivePartyStore((s) => s.beginPickingPub);
  const pubName = useLivePartyStore((s) => s.pubName);
  const startParty = useLivePartyStore((s) => s.start);
  const addBeer = useLivePartyStore((s) => s.addBeer);
  const removeBeer = useLivePartyStore((s) => s.removeBeer);
  const addPhoto = useLivePartyStore((s) => s.addPhoto);
  const addGame = useLivePartyStore((s) => s.addGame);
  const invite = useLivePartyStore((s) => s.invite);

  // Rows already on screen at first paint must NOT animate — the log would deal
  // itself out like a hand of cards every time you open the hub. Stamping the
  // mount (in the state initialiser, so render stays pure) lets each row decide
  // for itself: anything logged after you got here is genuinely new.
  const [mountedAt] = React.useState(() => Date.now());
  const reduceMotion = useReducedMotion();

  const [gamesOpen, setGamesOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [beersOpen, setBeersOpen] = React.useState(false);

  const mapHeight = live
    ? Math.max(MAP_LIVE_MIN, insets.top + TOP_BAR_H + SHEET_RADIUS)
    : MAP_IDLE;

  // Faces in the thread must match the faces in the header — same person, same
  // colour, wherever they show up.
  const tintOf = (name: string) =>
    name === 'Ty' ? Colors.amber : (people.find((p) => p.name === name)?.tint ?? Colors.mutedText);

  const mine = beers.length;
  const table = mine + people.reduce((sum, person) => sum + person.beers, 0);
  const byType = beersByType(beers);

  // The pulse rules work in minutes from the start; the stamps are epoch.
  const beerTimes = startedAt === null ? [] : beers.map((e) => minutesBetween(startedAt, e.at));
  // Derived from the ticking clock, not `Date.now()` — calling that in render is
  // impure and the lint rule is right to stop it.
  const nowStamp = startedAt === null ? 0 : startedAt + minutes * 60_000;
  const stats = live
    ? hubStats({ beerTimes, now: minutes, mine, table, others: people.length })
    : [{ label: 'piva', value: '0' }];

  return (
    <View style={styles.screen}>
      {/* The map shrinks to a band once the night is running: at that point it
          is orientation, not the subject. */}
      <View style={styles.map}>
        <NightRoute
          stops={STOPS}
          live={live}
          height={mapHeight}
          caption={false}
        />
      </View>

      {/* Absolute: it is chrome floating ON the map. In the column it was also
          CONSUMING height, so the sheet's map offset stacked on top of it and
          left a band of nothing between the two. */}
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.topIcon, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Minimalizovat večer"
        >
          <ChevronDownIcon size={20} color={Colors.foam} />
        </Pressable>

        <View style={styles.grow} />

        {/* Top right, as far from "+1 pivo" as the screen allows. */}
        {live ? (
          <Pressable
            // Ending goes THROUGH the finish screen, never straight to nothing:
            // the last thing an evening does is become a post, and dropping the
            // state on the floor is how a good night ends up unrecorded.
            onPress={() => router.push('/party-finish' as Href)}
            style={({ pressed }) => [styles.endPill, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Ukončit večer"
          >
            <Text style={styles.endText} allowFontScaling={false}>
              Ukončit
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* The sheet starts BELOW the map band rather than at `marginTop: 'auto'`:
          with `flex: 1` the auto margin collapsed to nothing and the sheet
          covered the map it was supposed to sit under. */}
      <View
        style={[
          styles.sheet,
          {
            // Pulled UP over the map by the radius, or the rounded corners have
            // nothing behind them to reveal and the edge reads as square.
            marginTop: mapHeight - SHEET_RADIUS,
            paddingBottom: insets.bottom + Spacing.md,
          },
        ]}
      >
        <View style={styles.grabber} />

        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          {/* Strava's band: the STATE over the numbers, and a way to blow the
              numbers up for a phone lying on the table. */}
          {/* What the hub IS: a place and the people in it. The pub used to be a
              pill floating on the map and the table was buried three sections
              down, so the top of a screen about an evening with friends said
              nothing about either. */}
          <View style={styles.hub}>
            <Pressable
              // Straight to Hospody. That screen already has the map, the
              // filters, the sort and the detail; a second pub list inside the
              // hub was a worse copy of it that only existed to avoid leaving.
              onPress={() => {
                beginPickingPub();
                router.back();
                router.navigate('/' as Href);
              }}
              style={({ pressed }) => [styles.hubPub, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${pubName}. Změnit hospodu.`}
            >
              {live ? <View style={styles.pubDot} /> : null}
              <Text
                style={styles.hubPubName}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {pubName}
              </Text>
              <ChevronDownIcon size={15} color={Colors.amber} />
            </Pressable>

            {/* The table, once there is one. Before the night the pill is the
                whole header — distance and opening hours belong to choosing a
                pub, which is what the picker behind the pill is for.

                Not a button, and no "+" face: inviting lives in the control row
                with the other things that ADD to the evening. Two ways to do it
                made the header read as a control panel. */}
            {live ? (
              <View
                style={styles.hubPeople}
                accessibilityLabel={`U stolu: ty a ${people.map((p) => p.name).join(', ')}`}
              >
                <View style={styles.faces}>
                  {/* The same component the feed card uses, so a person looks
                      the same wherever they appear. */}
                  <Face name="Ty" tint={Colors.amber} size={30} />
                  {people.map((person) => (
                    <View key={person.id} style={styles.faceOverlap}>
                      <Face name={person.name} tint={person.tint} size={30} />
                    </View>
                  ))}
                </View>
                <Text
                  style={styles.hubNames}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {['Ty', ...people.map((p) => p.name)].join(', ')}
                </Text>
              </View>
            ) : null}
          </View>

          {/* Shown even before the first beer, as zeroes. An empty stopwatch is
              still a stopwatch — the shape tells you what the night will collect,
              which a paragraph explaining it never did. */}
          {/* Which numbers these are is a product rule with tests, not a fixed
              row: alone the table is your own count twice over. */}
          <PulsePanel
            startedAt={startedAt}
            stats={stats.map((stat) => ({ value: stat.value, unit: stat.label }))}
          />

          {/* The thread. Every kind of thing the row of buttons can add lands
              here, in order, with the name of whoever added it — at a table of
              four "Fotka" with no name is the app talking to itself. A game is
              not a line ABOUT a game: the row IS the game and starts it. */}
          {log.length > 0 ? (
            <View style={styles.sectionBody}>
              {[...log].reverse().map((event, index, all) => {
                const game = event.gameKey
                  ? games.find((entry) => entry.key === event.gameKey)
                  : undefined;
                return (
                  <Animated.View
                    key={event.id}
                    style={styles.logRow}
                    entering={
                      event.at > mountedAt && !reduceMotion ? FadeInDown.duration(260) : undefined
                    }
                    // The rows under it slide down to make room instead of
                    // teleporting, so you can see WHERE the new one landed.
                    layout={reduceMotion ? undefined : LinearTransition.duration(220)}
                  >
                    {/* The rail. A timeline is a chronology, not a list —
                        hairlines BETWEEN rows separate them, a line THROUGH them
                        says they are one thread. It stops at the first and last
                        node so the thread has ends. */}
                    <View style={styles.logRail} pointerEvents="none">
                      <View style={[styles.railLine, index === 0 && styles.railHidden]} />
                      <View
                        style={[styles.railLine, index === all.length - 1 && styles.railHidden]}
                      />
                    </View>
                    <View style={styles.logIcon}>{LOG_GLYPH[event.kind]}</View>

                    <View style={styles.grow}>
                      {game ? (
                        <Pressable
                          onPress={() => router.push(`/party-game?key=${game.key}` as Href)}
                          style={({ pressed }) => [styles.game, pressed && styles.pressed]}
                          accessibilityRole="button"
                          accessibilityLabel={
                            game.result ? `${game.name}, výsledek` : `Spustit ${game.name}`
                          }
                        >
                          <View style={styles.gameHead}>
                            <View style={styles.grow}>
                              <Text
                                style={styles.gameTitle}
                                numberOfLines={1}
                                maxFontSizeMultiplier={FontScaleCap.body}
                              >
                                {game.name}
                              </Text>
                              <Text
                                style={styles.gameMeta}
                                maxFontSizeMultiplier={FontScaleCap.body}
                              >
                                {game.result
                                  ? game.result.winner
                                    ? `Vyhrál ${game.result.winner}`
                                    : 'Odehráno'
                                  : 'Ťukni a hraj'}
                              </Text>
                            </View>
                            {game.result ? (
                              <TrophyIcon size={16} color={Colors.amber} />
                            ) : (
                              <ChevronRightIcon size={16} color={Colors.mutedText} />
                            )}
                          </View>

                          {/* A finished game IS a leaderboard — that is the
                              whole thing the recap and the feed lead with. */}
                          {game.result ? (
                            <View style={styles.board}>
                              {game.result.scores.slice(0, 4).map((row, rank) => (
                                <View key={row.name} style={styles.boardRow}>
                                  <Text style={styles.boardRank} allowFontScaling={false}>
                                    {rank + 1}
                                  </Text>
                                  <Text
                                    style={styles.boardName}
                                    numberOfLines={1}
                                    maxFontSizeMultiplier={FontScaleCap.body}
                                  >
                                    {row.name}
                                  </Text>
                                  <Text style={styles.boardScore} allowFontScaling={false}>
                                    {row.score}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </Pressable>
                      ) : (
                        <Text
                          style={styles.logText}
                          numberOfLines={2}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {/* "+1" in the same language as the button that made
                              it: two identical rows are two beers, not one beer
                              mentioned twice. */}
                          {event.kind === 'beer' ? (
                            <Text style={styles.logPlus} allowFontScaling={false}>
                              +1{'  '}
                            </Text>
                          ) : null}
                          {event.text}
                        </Text>
                      )}

                      {/* Who put it there. A face because a name alone in 12pt
                          grey is not something you notice at a loud table. */}
                      <View style={styles.logWho}>
                        <Face name={event.by} tint={tintOf(event.by)} size={16} />
                        <Text style={styles.logWhoName} maxFontSizeMultiplier={FontScaleCap.body}>
                          {event.by}
                        </Text>
                      </View>
                    </View>

                    {/* When is the least interesting part, so it goes last and
                        quiet — you scan WHAT happened, then look. */}
                    <Text style={styles.logTime} allowFontScaling={false}>
                      {clockAt(event.at)}
                    </Text>
                  </Animated.View>
                );
              })}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.controls}>
          <CircleButton label="Pozvat" onPress={() => setInviteOpen(true)}>
            <UserPlusIcon size={20} color={Colors.foam} />
          </CircleButton>

          <CircleButton label={photos > 0 ? `Foto ${photos}` : 'Foto'} onPress={addPhoto}>
            <CameraIcon size={20} color={Colors.foam} />
          </CircleButton>

          <View style={styles.primaryWrap}>
            <Pressable
              onPress={() => (live ? addBeer(houseBeer) : setBeersOpen(true))}
              style={({ pressed }) => [styles.circlePrimary, pressed && styles.primaryPressed]}
              accessibilityRole="button"
              accessibilityLabel={live ? 'Přidat pivo' : 'Začít večer prvním pivem'}
            >
              <BeerIcon size={34} color={Colors.stout} />
            </Pressable>
            {/* Tap the disc to pour the house tap, tap the chip to change what
                that is. One tap to log stays the whole ritual; picking a beer
                is the rarer thing, so it is the smaller target. */}
            {live ? (
              <Pressable
                onPress={() => setBeersOpen(true)}
                style={({ pressed }) => [styles.beerChip, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`Piješ ${houseBeer}. Změnit.`}
                hitSlop={6}
              >
                <Text
                  style={styles.primaryLabel}
                  numberOfLines={2}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {byType.length > 1 ? `${byType.length} druhy` : houseBeer}
                </Text>
                <ChevronDownIcon size={13} color={Colors.amber} />
              </Pressable>
            ) : (
              <Text style={styles.primaryLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                Začni
              </Text>
            )}
          </View>

          <CircleButton label="Hry" onPress={() => setGamesOpen(true)}>
            <SoccerBallIcon size={20} color={Colors.foam} />
          </CircleButton>

          <CircleButton label="Přesun" adds={false}>
            <MapPinIcon size={20} color={Colors.foam} />
          </CircleButton>
        </View>
      </View>

      <GamesSheet
        visible={gamesOpen}
        onTable={games.map((game) => game.key)}
        onClose={() => setGamesOpen(false)}
        onPick={(key, name) => {
          addGame(key, name);
          setGamesOpen(false);
        }}
      />

      <BeerSheet
        visible={beersOpen}
        rows={byType}
        onTaps={TAPS}
        title={live ? 'Co piješ' : 'Čím začínáš?'}
        subtitle={
          live
            ? 'Uprav počty nebo si dej něco jiného.'
            : 'První pivo nastaví, co bude nalévat „+1 pivo“.'
        }
        onClose={() => setBeersOpen(false)}
        onAdd={(beer) => {
          if (live) {
            addBeer(beer);
            return;
          }
          startParty(pubName, beer);
          setBeersOpen(false);
        }}
        onRemove={removeBeer}
      />

      <InviteSheet
        visible={inviteOpen}
        present={people.map((person) => person.name)}
        onClose={() => setInviteOpen(false)}
        onInvite={invite}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MockColors.bg },
  pressed: { opacity: 0.65 },
  grow: { flex: 1 },

  map: { position: 'absolute', top: 0, left: 0, right: 0 },

  // — Floating top bar —
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  pubPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.stout, 0.92),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  pubDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: MockColors.live },

  // — Hub header —
  hub: { gap: Spacing.sm, marginBottom: Spacing.lg },
  // A pill, not a heading with a chevron bolted on: it is a control, and it
  // should look like one before you tap it.
  hubPub: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.sm,
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  hubPubName: { fontSize: 18, fontWeight: '800', color: Colors.foam, letterSpacing: -0.2 },
  hubPeople: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  faces: { flexDirection: 'row', alignItems: 'center' },
  faceOverlap: { marginLeft: -9 },
  faceText: { fontSize: 12, fontWeight: '800', color: Colors.stout },
  hubNames: { flex: 1, fontSize: 13, fontWeight: '500', color: Colors.mutedText },
  topIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.92),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  endPill: {
    height: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.92),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.2),
  },
  endText: { fontSize: 14, fontWeight: '700', color: Colors.foam },

  // — Sheet —
  sheet: {
    flex: 1,
    backgroundColor: MockColors.bg,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.22),
    marginBottom: Spacing.md,
  },
  sheetContent: { paddingBottom: Spacing.md },

  section: {
    ...MockType.titleS,
    fontSize: 15,
    color: Colors.mutedText,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },


  output: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: HitArea.min,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: MockColors.surfaceHigh,
    marginTop: Spacing.lg,
  },
  outputText: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foam },

  // — Sections —
  sectionBody: { gap: Spacing.md },
  empty: { fontSize: 14, fontWeight: '400', color: Colors.mutedText, lineHeight: 20 },

  // — Games on the table —
  game: { padding: Spacing.md, borderRadius: 22, backgroundColor: MockColors.surfaceHigh },
  gameHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  gameTitle: { ...MockType.bodySemibold, color: Colors.foam },
  gameMeta: { fontSize: 12, fontWeight: '500', color: Colors.mutedText, marginTop: 1 },
  board: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  boardRank: {
    width: 14,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  boardName: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foam },
  boardScore: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  // — Log —
  logRow: {
    flexDirection: 'row',
    // Top-aligned: a row is now a block (what happened, then who), and a game
    // row is a whole card. Centring hung the glyph in the middle of it.
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 64,
  },
  /** Behind the icon column: two half-height segments, so either end can be
   *  hidden and the thread stops at the first and last node. */
  logRail: {
    position: 'absolute',
    left: 19,
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
  },
  railLine: { flex: 1, backgroundColor: withAlpha(Colors.foam, 0.12) },
  railHidden: { backgroundColor: 'transparent' },
  logIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    // Opaque, so the rail passes BEHIND the node rather than through it.
    backgroundColor: Colors.stout3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.1),
  },
  logWho: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  logWhoName: { fontSize: 12, fontWeight: '600', color: Colors.mutedText },
  logPlus: { fontFamily: Fonts.numeral, color: Colors.amber },
  logText: { fontSize: 16, fontWeight: '600', color: Colors.foam, paddingTop: 8 },
  logTime: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '500',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },

  // — Controls —
  // Five equal columns. The primary is bigger but occupies the same slot, so
  // the gaps between all five read as one rhythm instead of the middle pair
  // being pushed apart by the disc.
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  circleWrap: { alignItems: 'center', gap: 5, flex: 1 },
  primaryWrap: { alignItems: 'center', gap: 5, flex: 1, zIndex: 1 },
  addBadge: {
    position: 'absolute',
    right: -1,
    top: -1,
    width: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    borderWidth: 2,
    borderColor: MockColors.bg,
  },
  circleSecondary: {
    overflow: 'visible',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: MockColors.surfaceHigh,
  },
  circleLabel: { fontWeight: '500', fontSize: 12, color: Colors.mutedText },
  circlePrimary: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    marginTop: -12,
  },
  primaryPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  primaryLabel: {
    flexShrink: 1,
    fontWeight: '700',
    fontSize: 13,
    lineHeight: 16,
    color: Colors.amber,
    textAlign: 'center',
  },
  /**
   * Full width of the control row, not the width of the disc above it. Clipped
   * to the disc, "Flekovský ležák 13°" came out as "Flekovsk…" — and the whole
   * point of the chip is telling you what "+1" will pour.
   */
  beerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    // Only as wide as the disc it belongs to, so a long tap name breaks onto a
    // second line instead of running under "Foto" and "Hry".
    position: 'absolute',
    left: -18,
    right: -18,
    bottom: -40,
  },
});
