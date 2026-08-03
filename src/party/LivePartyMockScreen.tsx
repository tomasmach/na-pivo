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
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import {
  BeerIcon,
  CameraIcon,
  ChevronDownIcon,
  MapPinIcon,
  PlayIcon,
  PlusIcon,
  SoccerBallIcon,
  SparklesIcon,
  TrophyIcon,
  UserPlusIcon,
} from '@/components/shared/IconGlyph';
import { GlassPill } from '@/components/shared/GlassIconButton';
import { BeerSheet } from '@/party/BeerSheet';
import { GameCover } from '@/party/GameCover';
import { GAME_CATALOG } from '@/party/gameCatalog';
import { Face } from '@/feed/FeedMockScreen';
import { PulsePanel } from '@/party/PulsePanel';
import { GamesSheet } from '@/party/GamesSheet';
import { InviteSheet } from '@/party/InviteSheet';
import { RowMenu } from '@/mocks/MenuChip';
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
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const STOPS = [{ name: 'U Fleků', lat: 50.0785, lng: 14.42 }];
const TAPS = [
  { name: 'Flekovský ležák 13°', priceCzk: 62 },
  { name: 'Flekovský tmavý 13°', priceCzk: 62 },
  { name: 'Nealko 11°', priceCzk: 45 },
];

/** Resolved once: constant for the process (iOS 26+, false everywhere else). */
const GLASS = isLiquidGlassAvailable();

/** How far the sheet overlaps the map, which is also its corner radius. */
const SHEET_RADIUS = 28;

/** The catalogue entry behind a game on the table — the cover art lives there,
 *  and the live store only keeps the key. */
const gameDef = (key: string) => GAME_CATALOG.find((game) => game.key === key) ?? GAME_CATALOG[0];

/** What "take it back" is called, per kind of thing. */
const REMOVE_LABEL: Partial<Record<LogKind, string>> = {
  photo: 'Smazat fotku',
  game: 'Sundat ze stolu',
  join: 'Odebrat ze stolu',
};

/** What the row menu offers instead of the entry you logged. */
const MENU_BEERS = TAPS.map((tap) => tap.name);

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


/**
 * A round action in the bottom row.
 *
 * No caption under it. The captions made the discs taller than the amber button
 * beside them, so nothing in the row lined up — and "Foto" under a camera is a
 * label reading out the picture above it.
 */
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
        {/* Real glass where the OS has it (§15.1), a filled disc below iOS 26.
            The discs sit over a fading thread, which is exactly the situation
            the material is for — a flat plate here read as five holes cut in
            the screen. */}
        {GLASS ? (
          <GlassView
            style={styles.circleGlass}
            glassEffectStyle="regular"
            tintColor={withAlpha(Colors.foam, 0.06)}
            colorScheme="dark"
            pointerEvents="none"
          />
        ) : (
          <View style={[styles.circleGlass, styles.circleSolid]} pointerEvents="none" />
        )}
        {children}
        {adds ? (
          <View style={styles.addBadge}>
            <PlusIcon size={9} color={Colors.stout} />
          </View>
        ) : null}
      </Pressable>
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
  const addPhoto = useLivePartyStore((s) => s.addPhoto);
  const editBeer = useLivePartyStore((s) => s.editBeer);
  const dropBeer = useLivePartyStore((s) => s.dropBeer);
  const dropEvent = useLivePartyStore((s) => s.dropEvent);
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

  // "Your third beer" — counted per person over the thread in the order things
  // happened, so Honza's rows count Honza's beers and not the table's.
  const ordinals = new Map<string, number>();
  const tally = new Map<string, number>();
  for (const event of log) {
    if (event.kind !== 'beer') continue;
    const next = (tally.get(event.by) ?? 0) + 1;
    tally.set(event.by, next);
    ordinals.set(event.id, next);
  }

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

        {/* The header does not scroll. Where you are, who is with you and the
            night's numbers are the answer to "what is going on" — scrolling the
            log to see what just happened must not push them off the screen. */}
        <View style={styles.sheetHead}>
          {/* Strava's band: the STATE over the numbers, and a way to blow the
              numbers up for a phone lying on the table. */}
          {/* What the hub IS: a place and the people in it. The pub used to be a
              pill floating on the map and the table was buried three sections
              down, so the top of a screen about an evening with friends said
              nothing about either. */}
          <View style={styles.hub}>
            <View style={styles.hubTop}>
            <Pressable
              // The Hospody screen, over the hub. It already has the map, the
              // filters, the sort and the detail, so a second pub list in here
              // would be a worse copy of it — but reaching it by dropping the
              // night and jumping to another tab made choosing a pub feel like
              // abandoning the evening. Same screen, presented as a modal.
              onPress={() => {
                beginPickingPub();
                router.push('/pick-pub' as Href);
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

            {/* Inviting lives up here, opposite the pub — the header is the
                "who and where" row, and that is what asking someone to join
                changes. Down in the control row it sat among the things you do
                over and over all evening; you invite people once. */}
            {live ? (
              // With a word on it. A bare glyph in a corner is a guess — and
              // this is the one control on the screen whose job ("get someone
              // else in here") no icon says on its own.
              <GlassPill
                accessibilityLabel="Přizvat ke stolu"
                onPress={() => setInviteOpen(true)}
              >
                <UserPlusIcon size={17} color={Colors.amber} />
                <Text style={styles.invitePill} allowFontScaling={false}>
                  Pozvat
                </Text>
              </GlassPill>
            ) : null}
            </View>

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
        </View>

        {/* Only the thread scrolls. No gap between the rows either: the rail is
            drawn INSIDE each row, so spacing between them cuts the thread into
            dashes. The rows carry their own vertical padding. */}
        <ScrollView
          style={styles.grow}
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
        >
          {log.length > 0 ? (
            <View>
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
                    {/* A beer wears the same amber mug-and-plus as the button
                        that pours one, so the thread's most common row is the
                        one you can find without reading. Everything else stays a
                        quiet disc — if every kind were amber, none would be. */}
                    {event.kind === 'beer' ? (
                      // The mug carries WHICH beer this is — third of the night
                      // for whoever poured it. A plus said the row added
                      // something, which the row already said by existing; the
                      // number is the fact you cannot get any other way.
                      <View style={[styles.logIcon, styles.logIconBeer]}>
                        <BeerIcon size={15} color={Colors.stout} />
                        <Text style={styles.logIconCount} allowFontScaling={false}>
                          {ordinals.get(event.id) ?? 1}
                        </Text>
                      </View>
                    ) : (
                      <View style={styles.logIcon}>{LOG_GLYPH[event.kind]}</View>
                    )}

                    <View style={styles.grow}>
                      {game ? (
                        <View style={styles.gameBlock}>
                          {/* Who put it on the table goes ABOVE the cover: the
                              cover is the thing, and a caption under it read as
                              a footnote to a picture. */}
                          <View style={styles.logWho}>
                            <Text
                              style={styles.logWhoName}
                              maxFontSizeMultiplier={FontScaleCap.body}
                            >
                              {event.by === 'Ty'
                                ? `Hodil jsi na stůl ${game.name}`
                                : `${event.by} hodil na stůl ${game.name}`}{' '}
                              · {clockAt(event.at)}
                            </Text>
                          </View>

                          <Pressable
                            onPress={() => router.push(`/party-game?key=${game.key}` as Href)}
                            style={({ pressed }) => [styles.gameCover, pressed && styles.pressed]}
                            accessibilityRole="button"
                            accessibilityLabel={
                              game.result ? `${game.name}, výsledek` : `Spustit ${game.name}`
                            }
                          >
                            <GameCover game={gameDef(game.key)} height={132} glyph={38} />
                            {/* A play disc, so there is no question what the
                                card does. A chevron on a picture is a link; a
                                play button is a game waiting to be started. */}
                            <View style={styles.playDisc} pointerEvents="none">
                              {game.result ? (
                                <TrophyIcon size={22} color={Colors.stout} />
                              ) : (
                                <PlayIcon size={22} color={Colors.stout} />
                              )}
                            </View>
                            <View style={styles.gameCaption} pointerEvents="none">
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
                          </Pressable>

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
                        </View>
                      ) : event.photo ? (
                        // The picture, not a line saying a picture exists.
                        <Image source={{ uri: event.photo }} style={styles.logPhoto} />
                      ) : (
                        <Text
                          style={styles.logText}
                          numberOfLines={2}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {event.text}
                        </Text>
                      )}

                      {/* Who put it there. Just the name — a 16pt avatar beside
                          every row made a column of confetti down the thread,
                          and the glyph on the rail is already the row's
                          picture. The game block prints its own, above its
                          cover. */}
                      {game ? null : (
                        <Text style={styles.logWhoName} maxFontSizeMultiplier={FontScaleCap.body}>
                          {event.by} · {clockAt(event.at)}
                        </Text>
                      )}
                    </View>

                    {/* Mis-taps happen in pubs, and the log is the only place
                        you can see WHICH beer was wrong — so correcting it
                        belongs here. Spendee's row menu: the taps as a checked
                        list, "Smazat" destructive underneath.

                        The slot is always there, empty or not. Rendered only on
                        rows that have a menu, it shoved their timestamps left
                        and the column of times zig-zagged down the thread. */}
                    <View style={styles.logMenuSlot}>
                      {event.beerId ? (
                        <RowMenu
                          title="Co to bylo?"
                          value={event.text}
                          options={MENU_BEERS}
                          onChange={(next) => editBeer(event.beerId as string, next)}
                          // The thing you most often want from a beer you
                          // already had is another one of it — and this row is
                          // the only place that knows WHICH one you mean.
                          repeat={{ label: 'Ještě jedno', onPress: () => addBeer(event.text) }}
                          destructive={{
                            label: 'Smazat pivo',
                            onPress: () => dropBeer(event.beerId as string),
                          }}
                        />
                      ) : event.by === 'Ty' && event.kind !== 'pub' ? (
                        // Everything YOU put in the thread can come back out —
                        // a photo you did not mean to post, a game nobody
                        // played. Not somebody else's row, and not the pub: the
                        // place you are in is changed by moving, not by
                        // deleting the line that says you arrived.
                        <RowMenu
                          title={REMOVE_LABEL[event.kind] ?? 'Smazat'}
                          destructive={{
                            label: REMOVE_LABEL[event.kind] ?? 'Smazat',
                            onPress: () => dropEvent(event.id),
                          }}
                        />
                      ) : null}
                    </View>
                  </Animated.View>
                );
              })}
            </View>
          ) : null}
        </ScrollView>

        {/* The controls float ON the thread, not on a plate under a rule. The
            hairline said "this is a different panel" and pushed the buttons up
            off the bottom of the phone; a gradient that is solid under the row
            and fades to nothing above it lets the log run out of sight instead
            of stopping at a border.

            The room under the row exists only for the beer chip, which hangs
            below the disc while a night runs. Before one starts there is no
            chip, and fixed padding left the buttons floating in a hole. */}
        <View style={[styles.controls, live && styles.controlsLive]}>
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <LinearGradient id="controlsFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={MockColors.bg} stopOpacity="0" />
                <Stop offset="0.45" stopColor={MockColors.bg} stopOpacity="0.92" />
                <Stop offset="1" stopColor={MockColors.bg} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#controlsFade)" />
          </Svg>
          <CircleButton label={photos > 0 ? `Foto, ${photos}` : 'Foto'} onPress={addPhoto}>
            <CameraIcon size={20} color={Colors.foam} />
          </CircleButton>

          {/* One long button instead of a disc with a caption hanging under it.
              The name of what you are drinking belongs INSIDE the thing that
              pours it — floating below, it had nowhere to break, so a long tap
              name either clipped or wrapped into the labels beside it.

              Two targets in one shape: the body logs a beer, the chevron at the
              end changes which. Same split as before, just no longer stacked. */}
          {/* The button and its picker are ONE thing with a seam, not two
              controls sharing a row: 4pt apart against 12 to the discs, so the
              chevron reads as belonging to the amber beside it. */}
          <View style={styles.primaryGroup}>
          <View style={styles.primaryWrap}>
            <Pressable
              onPress={() => (live ? addBeer(houseBeer) : setBeersOpen(true))}
              style={({ pressed }) => [styles.primaryBody, pressed && styles.primaryPressed]}
              accessibilityRole="button"
              accessibilityLabel={live ? `Přidat ${houseBeer}` : 'Začít večer prvním pivem'}
            >
              <PlusIcon size={17} color={Colors.stout} />
              <BeerIcon size={21} color={Colors.stout} />
              <Text
                style={styles.primaryLabel}
                numberOfLines={2}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {live ? (byType.length > 1 ? `${byType.length} druhy` : houseBeer) : 'Začni večer'}
              </Text>
            </Pressable>
          </View>

          {/* Changing the beer is its OWN button, outside the amber. Inside it,
              a chevron behind a hairline was a second action hiding in the
              middle of the one thing on this screen you press all night — and a
              button you press by accident when you meant to log a beer. */}
          {live ? (
            <Pressable
              onPress={() => setBeersOpen(true)}
              style={({ pressed }) => [styles.primaryPick, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`Piješ ${houseBeer}. Změnit.`}
            >
              <ChevronDownIcon size={18} color={Colors.amber} />
            </Pressable>
          ) : null}
          </View>

          <CircleButton label="Hry" onPress={() => setGamesOpen(true)}>
            <SoccerBallIcon size={20} color={Colors.foam} />
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
            ? 'Ťukni a je to v logu.'
            : 'První pivo nastaví, co bude nalévat „+1 pivo“.'
        }
        onClose={() => setBeersOpen(false)}
        // One tap, sheet closed, beer in the log. Staying open to let you add
        // three in a row was designing for a case that does not happen: you
        // order a beer, you log a beer.
        onAdd={(beer) => {
          if (live) addBeer(beer);
          else startParty(pubName, beer);
          setBeersOpen(false);
        }}
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
  hubTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  invitePill: { fontSize: 14, fontWeight: '700', color: Colors.amber },
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
    // The app's one width (§18.3b), not a private 16 because it is a sheet.
    paddingHorizontal: MockLayout.screenPad,
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
  sheetHead: { paddingBottom: Spacing.xs },
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
    // The glyph centres against the WHOLE block, both lines of it. Top-aligned,
    // the icon lined up with the first line and the author's name hung below
    // it, so every row looked a few points too low.
    alignItems: 'center',
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
    // The badge hangs off the disc.
    overflow: 'visible',
  },
  gameBlock: { gap: Spacing.sm },
  gameCover: { borderRadius: 18, overflow: 'hidden' },
  playDisc: {
    position: 'absolute',
    top: 42,
    left: '50%',
    marginLeft: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  gameCaption: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    bottom: Spacing.sm,
    // The cover art runs under the words, so they need their own ground.
    textShadowColor: Colors.stout,
  },
  logPhoto: {
    width: 140,
    height: 140,
    borderRadius: 16,
    backgroundColor: Colors.stout3,
  },
  logMenuSlot: { width: 30, alignItems: 'flex-end' },
  logWho: { marginTop: 2 },
  // Who and when, on one quiet line under the thing itself. The time used to be
  // right-aligned in its own column, which put the least interesting fact on the
  // row at the end of a long empty gap.
  logWhoName: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.mutedText,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  logIconBeer: {
    flexDirection: 'row',
    gap: 1,
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  logIconCount: { fontFamily: Fonts.numeral, fontSize: 14, color: Colors.stout },
  logText: { fontSize: 16, fontWeight: '600', color: Colors.foam },

  // — Controls —
  // Five equal columns. The primary is bigger but occupies the same slot, so
  // the gaps between all five read as one rhythm instead of the middle pair
  // being pushed apart by the disc.
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
    // Overlaps the thread it fades out — the scroll runs under it.
    marginTop: -Spacing.xl,
  },
  controlsLive: { paddingBottom: Spacing.sm },
  circleWrap: { alignItems: 'center' },
  primaryGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 },
  primaryWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    overflow: 'hidden',
  },
  primaryBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: '100%',
    paddingHorizontal: Spacing.md,
  },
  primaryPick: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.16),
  },
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
  },
  circleGlass: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 24,
    overflow: 'hidden',
  },
  circleSolid: { backgroundColor: MockColors.surfaceHigh },
  primaryPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  primaryLabel: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 15,
    lineHeight: 18,
    color: Colors.stout,
  },
  /**
   * Full width of the control row, not the width of the disc above it. Clipped
   * to the disc, "Flekovský ležák 13°" came out as "Flekovsk…" — and the whole
   * point of the chip is telling you what "+1" will pour.
   */
});
