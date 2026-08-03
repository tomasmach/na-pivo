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
 *   stats        yours, the table's, the clock, and time since the last one
 *   timeline     the beers as clips, so the night has a shape
 *   what you're  the running order, per kind, with counters you can correct
 *   drinking
 *   sections     Statistiky / Aktivity / Log
 *
 * Ending the night sits top right, away from "+1 pivo": those two buttons must
 * never be neighbours, because one of them is undoable and the other is not.
 *
 * Everything is local state on a mock store. Nothing is wired.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import {
  BeerIcon,
  CameraIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MapPinIcon,
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
import { buildPulse, fourthStat } from '@/party/nightPulse';
import { MenuChip } from '@/mocks/MenuChip';
import { NightChart, type ChartShape } from '@/mocks/NightChart';
import { NightRoute } from '@/mocks/NightRoute';
import {
  beersByType,
  clockAt,
  hourlyFrom,
  minutesBetween,
  useLivePartyStore,
  useNightClock,
} from '@/mocks/livePartyStore';
import { MockColors, MockType } from '@/mocks/mockTheme';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
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
const MAP_LIVE = 128;

/**
 * Two sections, because there are two questions: how is it going, and what
 * happened. The beer list used to be a third tab, but it is not a section of
 * the night — it is the thing the "+1 pivo" control writes into, so it moved
 * behind the chip under that control where you are already looking.
 */
const SECTIONS = ['Statistiky', 'Log'] as const;
const CHARTS = ['V čase', 'Podle piva', 'U stolu'] as const;

function CircleButton({
  label,
  children,
  onPress,
}: {
  label: string;
  children: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <View style={styles.circleWrap}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.circleSecondary, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {children}
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

  const [gamesOpen, setGamesOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [section, setSection] = React.useState<(typeof SECTIONS)[number]>('Statistiky');
  const [chart, setChart] = React.useState<(typeof CHARTS)[number]>('V čase');
  const [shape, setShape] = React.useState<ChartShape>('bar');
  const [beersOpen, setBeersOpen] = React.useState(false);

  const mine = beers.length;
  const table = mine + people.reduce((sum, person) => sum + person.beers, 0);
  const byType = beersByType(beers);

  // The pulse rules work in minutes from the start; the stamps are epoch.
  const beerTimes = startedAt === null ? [] : beers.map((e) => minutesBetween(startedAt, e.at));
  // Derived from the ticking clock, not `Date.now()` — calling that in render is
  // impure and the lint rule is right to stop it.
  const nowStamp = startedAt === null ? 0 : startedAt + minutes * 60_000;
  const pulse = buildPulse({ beerTimes, now: minutes });
  const fourth = fourthStat({ beerTimes, now: minutes });

  const chartRows =
    chart === 'V čase'
      ? hourlyFrom(beers, nowStamp).map((slot) => ({ label: `${slot.hour}:00`, value: slot.beers }))
      : chart === 'Podle piva'
        ? byType.map((row) => ({ label: row.beer, value: row.count }))
        : [{ label: 'Ty', value: mine }, ...people.map((p) => ({ label: p.name, value: p.beers }))]
            .sort((a, b) => b.value - a.value);

  return (
    <View style={styles.screen}>
      {/* The map shrinks to a band once the night is running: at that point it
          is orientation, not the subject. */}
      <View style={styles.map}>
        <NightRoute
          stops={STOPS}
          live={live}
          height={live ? MAP_LIVE : MAP_IDLE}
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
            marginTop: (live ? MAP_LIVE : MAP_IDLE) - SHEET_RADIUS,
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
                pub, which is what the picker behind the pill is for. */}
            {live ? (
              <Pressable
                onPress={() => setInviteOpen(true)}
                style={({ pressed }) => [styles.hubPeople, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={`U stolu: ty a ${people.map((p) => p.name).join(', ')}. Přizvat dalšího.`}
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
                  <View style={[styles.face, styles.faceOverlap, styles.faceAdd]}>
                    <UserPlusIcon size={14} color={Colors.mutedText} />
                  </View>
                </View>
                <Text
                  style={styles.hubNames}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {['Ty', ...people.map((p) => p.name)].join(', ')}
                </Text>
              </Pressable>
            ) : null}
          </View>

          {/* Shown even before the first beer, as zeroes. An empty stopwatch is
              still a stopwatch — the shape tells you what the night will collect,
              which a paragraph explaining it never did. */}
          <PulsePanel
            pulse={pulse}
            startedAt={startedAt}
            stats={[
              { value: String(mine), unit: 'piv' },
              { value: String(live ? table : 0), unit: 'u stolu' },
              { value: live ? fourth.value : '—', unit: live ? fourth.label.toLowerCase() : 'tempo' },
            ]}
          />

          <>
              <UnderlineTabs
                options={SECTIONS}
                value={section}
                onChange={setSection}
                inset={Spacing.md}
              />

              {section === 'Statistiky' ? (
                <View style={styles.sectionBody}>
                  {/* A segment, not three more tabs: one chart, three questions
                      you can ask of it. */}
                  {/* One row: a chip says WHAT is measured, the icons say how it
                      is drawn. A full-width segment above a right-aligned pair
                      of icons was two controls on two lines for one chart. */}
                  <NightChart
                    rows={chartRows}
                    shape={shape}
                    onShape={setShape}
                    control={
                      <MenuChip
                        value={chart}
                        options={CHARTS}
                        title="Podle čeho"
                        onChange={(next) => setChart(next as (typeof CHARTS)[number])}
                      />
                    }
                  />
                </View>
              ) : null}

              {/* Games sit ABOVE the chronology: an unplayed game is the one
                  thing in this list you can still act on, and burying it among
                  timestamps makes it read as something that already happened. */}
              {section === 'Log' && games.length > 0 ? (
                <View style={styles.sectionBody}>
                  {games.map((game) => (
                      <Pressable
                        key={game.key}
                        onPress={() => router.push(`/party-game?key=${game.key}` as Href)}
                        style={({ pressed }) => [styles.game, pressed && styles.pressed]}
                        accessibilityRole="button"
                        accessibilityLabel={
                          game.result ? `${game.name}, výsledek` : `Spustit ${game.name}`
                        }
                      >
                        <View style={styles.gameHead}>
                          <View style={styles.medallion}>
                            {game.result ? (
                              <TrophyIcon size={16} color={Colors.amber} />
                            ) : (
                              <SparklesIcon size={16} color={Colors.amber} />
                            )}
                          </View>
                          <View style={styles.grow}>
                            <Text
                              style={styles.gameTitle}
                              numberOfLines={1}
                              maxFontSizeMultiplier={FontScaleCap.body}
                            >
                              {game.name}
                            </Text>
                            <Text style={styles.gameMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                              {game.result
                                ? game.result.winner
                                  ? `Vyhrál ${game.result.winner}`
                                  : 'Odehráno'
                                : `Na stole od ${clockAt(game.at)} · ťukni a hraj`}
                            </Text>
                          </View>
                          <ChevronRightIcon size={16} color={Colors.mutedText} />
                        </View>

                        {/* A finished game IS a leaderboard — that is the whole
                            thing the recap and the feed then lead with. */}
                        {game.result ? (
                          <View style={styles.board}>
                            {game.result.scores.slice(0, 4).map((row, index) => (
                              <View key={row.name} style={styles.boardRow}>
                                <Text style={styles.boardRank} allowFontScaling={false}>
                                  {index + 1}
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
                  ))}
                </View>
              ) : null}

              {section === 'Log' ? (
                <View style={styles.sectionBody}>
                  {[...log].reverse().map((event) => (
                    <View key={event.id} style={styles.logRow}>
                      <Text style={styles.logTime} allowFontScaling={false}>
                        {clockAt(event.at)}
                      </Text>
                      <View style={styles.logDot} />
                      <Text
                        style={styles.logText}
                        numberOfLines={2}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {event.text}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
            </>
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
                <Text style={styles.primaryLabel} numberOfLines={1} allowFontScaling={false}>
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

          <CircleButton label="Přesun">
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
          setSection('Log');
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
  face: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: MockColors.bg,
  },
  faceOverlap: { marginLeft: -9 },
  faceAdd: { backgroundColor: withAlpha(Colors.foam, 0.12) },
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
  medallion: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
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
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 60,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.foam, 0.07),
  },
  logTime: {
    width: 52,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  logDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: withAlpha(Colors.amber, 0.7) },
  logText: { flex: 1, fontSize: 16, fontWeight: '500', color: Colors.foam },

  // — Controls —
  // Five equal columns. The primary is bigger but occupies the same slot, so
  // the gaps between all five read as one rhythm instead of the middle pair
  // being pushed apart by the disc.
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  circleWrap: { alignItems: 'center', gap: 5, flex: 1 },
  primaryWrap: { alignItems: 'center', gap: 5, flex: 1, zIndex: 1 },
  circleSecondary: {
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
  primaryLabel: { fontWeight: '700', fontSize: 13, color: Colors.amber },
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
    position: 'absolute',
    left: -80,
    right: -80,
    bottom: -20,
  },
});
