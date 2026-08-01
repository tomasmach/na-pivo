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
import { PulsePanel } from '@/party/PulsePanel';
import { GamesSheet } from '@/party/GamesSheet';
import { InviteSheet } from '@/party/InviteSheet';
import { buildPulse, fourthStat } from '@/party/nightPulse';
import { NightChart, type ChartShape } from '@/mocks/NightChart';
import { NightRoute } from '@/mocks/NightRoute';
import { Segmented } from '@/mocks/Segmented';
import {
  beersByType,
  clockAt,
  formatElapsed,
  hourlyFrom,
  useLivePartyStore,
} from '@/mocks/livePartyStore';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const STOPS = [{ name: 'U Fleků', lat: 50.0785, lng: 14.42 }];
const HOUSE_BEER = 'Flekovský ležák 13°';
const TAPS = [
  { name: 'Flekovský ležák 13°', priceCzk: 62 },
  { name: 'Flekovský tmavý 13°', priceCzk: 62 },
  { name: 'Nealko 11°', priceCzk: 45 },
];

/** Full map before the night starts, a band once it has. */
const MAP_IDLE = 460;
const MAP_LIVE = 156;

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

/** One chart, three readings. Bars because every one of these is a comparison
 *  of counts, and three different chart types would be three things to learn. */
function Bars({ rows, highlightFirst }: { rows: { label: string; value: number }[]; highlightFirst?: boolean }) {
  const peak = rows.reduce((max, row) => Math.max(max, row.value), 0);
  if (rows.length === 0) return null;

  return (
    <View style={styles.chart}>
      {rows.map((row, index) => (
        <View key={row.label} style={styles.chartRow}>
          <Text
            style={styles.chartLabel}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {row.label}
          </Text>
          <View style={styles.chartTrack}>
            <View
              style={[
                styles.chartFill,
                {
                  width: `${peak > 0 ? Math.max(6, (row.value / peak) * 100) : 6}%`,
                  backgroundColor:
                    highlightFirst && index === 0 ? Colors.amber : withAlpha(Colors.amber, 0.4),
                },
              ]}
            />
          </View>
          <View style={styles.chartValueRow}>
            <BeerIcon size={12} color={withAlpha(Colors.amber, 0.9)} />
            <Text style={styles.chartValue} allowFontScaling={false}>
              {row.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export default function LivePartyMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const live = useLivePartyStore((s) => s.live);
  const beers = useLivePartyStore((s) => s.beers);
  const minutes = useLivePartyStore((s) => s.minutes);
  const people = useLivePartyStore((s) => s.people);
  const photos = useLivePartyStore((s) => s.photos);
  const games = useLivePartyStore((s) => s.games);
  const log = useLivePartyStore((s) => s.log);
  const houseBeer = useLivePartyStore((s) => s.houseBeer);
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

  // The night says what it is doing, instead of four labels that never change.
  const beerTimes = beers.map((entry) => entry.at);
  const pulse = buildPulse({ beerTimes, now: minutes });
  const fourth = fourthStat({ beerTimes, now: minutes });

  const chartRows =
    chart === 'V čase'
      ? hourlyFrom(beers).map((slot) => ({ label: `${slot.hour}:00`, value: slot.beers }))
      : chart === 'Podle piva'
        ? byType.map((row) => ({ label: row.beer, value: row.count }))
        : [{ label: 'Ty', value: mine }, ...people.map((p) => ({ label: p.name, value: p.beers }))]
            .sort((a, b) => b.value - a.value);

  return (
    <View style={styles.screen}>
      {/* The map shrinks to a band once the night is running: at that point it
          is orientation, not the subject. */}
      <View style={styles.map}>
        <NightRoute stops={STOPS} live={live} height={live ? MAP_LIVE : MAP_IDLE} />
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

        <Pressable
          style={({ pressed }) => [styles.pubPicker, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Změnit hospodu"
        >
          <View style={styles.pubDot} />
          <Text style={styles.pubName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            U Fleků
          </Text>
          <ChevronDownIcon size={15} color={Colors.foam} />
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
          { marginTop: live ? MAP_LIVE : MAP_IDLE, paddingBottom: insets.bottom + Spacing.md },
        ]}
      >
        <View style={styles.grabber} />

        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          {/* Strava's band: the STATE over the numbers, and a way to blow the
              numbers up for a phone lying on the table. */}
          <PulsePanel
            pulse={pulse}
            stats={[
              { value: String(mine), unit: 'piv' },
              { value: String(live ? table : 0), unit: 'u stolu' },
              { value: live ? formatElapsed(minutes) : '0m' },
              { value: live ? fourth.value : '—', unit: fourth.label.toLowerCase() },
            ]}
          />

          {live ? (
            <>
              <View style={styles.tabs}>
                {SECTIONS.map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setSection(option)}
                    style={styles.tab}
                    accessibilityRole="button"
                    accessibilityState={{ selected: option === section }}
                    accessibilityLabel={option}
                  >
                    <Text
                      style={[styles.tabText, option === section && styles.tabTextOn]}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {option}
                    </Text>
                    <View style={[styles.tabRule, option === section && styles.tabRuleOn]} />
                  </Pressable>
                ))}
              </View>

              {section === 'Statistiky' ? (
                <View style={styles.sectionBody}>
                  {/* A segment, not three more tabs: one chart, three questions
                      you can ask of it. */}
                  <Segmented options={CHARTS} value={chart} onChange={setChart} />
                  <NightChart rows={chartRows} shape={shape} onShape={setShape} />
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
                                ? `Vyhrál ${game.result.winner}`
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
          ) : (
            <View style={styles.idle}>
              <Text style={styles.idleTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                Zatím nic se nestalo
              </Text>
              <Text style={styles.idleHint} maxFontSizeMultiplier={FontScaleCap.body}>
                Večer začne prvním pivem. Pak se sem načte časová osa, grafy i log
                — a kamarády přizveš kdykoliv potom.
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.controls}>
          <CircleButton label="Pozvat" onPress={() => setInviteOpen(true)}>
            <UserPlusIcon size={20} color={Colors.foam} />
          </CircleButton>

          <CircleButton label={photos > 0 ? `Foto ${photos}` : 'Foto'} onPress={addPhoto}>
            <CameraIcon size={20} color={Colors.foam} />
          </CircleButton>

          <View style={styles.circleWrap}>
            <Pressable
              onPress={() => (live ? addBeer(houseBeer) : startParty('U Fleků', HOUSE_BEER))}
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
        onClose={() => setBeersOpen(false)}
        onAdd={addBeer}
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
  pubName: { fontWeight: '700', fontSize: 15, color: Colors.foam, maxWidth: 150 },
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
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
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

  idle: { paddingTop: Spacing.xl, gap: 6 },
  idleTitle: { ...MockType.titleS, fontSize: 20, color: Colors.foam },
  idleHint: { fontWeight: '400', fontSize: 15, lineHeight: 22, color: Colors.mutedText },

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
  tabs: { flexDirection: 'row', marginTop: Spacing.lg },
  tab: { flex: 1, alignItems: 'center', gap: 6 },
  tabText: { fontSize: 15, fontWeight: '600', color: Colors.mutedText },
  tabTextOn: { color: Colors.foam, fontWeight: '700' },
  tabRule: { height: 2, alignSelf: 'stretch', backgroundColor: 'transparent', borderRadius: 1 },
  tabRuleOn: { backgroundColor: Colors.amber },
  sectionBody: { marginTop: Spacing.lg, gap: Spacing.md },
  empty: { fontSize: 14, fontWeight: '400', color: Colors.mutedText, lineHeight: 20 },

  // — Chart —
  chart: { gap: Spacing.sm },
  chartRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  chartLabel: { width: 92, fontSize: 13, fontWeight: '600', color: Colors.foam },
  chartTrack: {
    flex: 1,
    height: 12,
    borderRadius: 6,
    backgroundColor: withAlpha(Colors.foam, 0.07),
    overflow: 'hidden',
  },
  chartFill: { height: '100%', borderRadius: 6 },
  chartValueRow: { flexDirection: 'row', alignItems: 'center', gap: 3, width: 40 },
  chartValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

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
  logRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 34 },
  logTime: {
    width: 46,
    fontSize: 13,
    fontWeight: '600',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  logDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: withAlpha(Colors.amber, 0.6) },
  logText: { flex: 1, fontSize: 14, fontWeight: '500', color: Colors.foam },

  // — Controls —
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  circleWrap: { alignItems: 'center', gap: 5, flex: 1 },
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
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    marginTop: -14,
  },
  primaryPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  primaryLabel: { fontWeight: '700', fontSize: 13, color: Colors.amber, maxWidth: 120 },
  beerChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
});
