/**
 * Party recap in the 3.0 visual language.
 *
 * Reachable at `/party-recap?nightKey=night-YYYY-MM-DD` and rebuilt from the
 * local drinking-day record. The active night uses the same record as the hub.
 *
 * What it is trying to be, and how that differs from the Tácek screens:
 *
 *  - **Content first, chrome last.** Every block on this screen is a fact about
 *    the night. There is not a single row whose job is to say "the content is
 *    elsewhere". The one button is at the very bottom, after you have read it.
 *  - **Numbers are the design.** Strava opens an activity with three enormous
 *    numerals and hairlines between them; this opens with piva / večer /
 *    hospody. No card around them, no illustration competing with them.
 *  - **Rows carry data, not labels.** A person row is a name, a tally and a bar
 *    of how they did against the biggest drinker. A stop is a time, a pub and a
 *    tally. Both are readable at a glance without opening anything.
 *  - **Left-aligned, generous, native.** Big left title instead of a centred
 *    18pt chrome title between two chevrons; 28-32pt of air between sections
 *    instead of 12.
 *
 * Palette stays Na pivo — stout ground, amber accent, foam text. The change is
 * structure, density and type, not colour.
 *
 * Type is the SYSTEM font (SF Pro on iOS, Roboto on Android) via bare
 * `fontWeight`, not Baloo 2. Baloo is the rounded pub voice that makes every
 * Tácek screen read as the same playful object; on a screen whose whole job is
 * dense numbers and rows it fights the content and reads as a theme rather than
 * an app. The system face is what "native like Packeta" actually means, and it
 * gets optical sizing, real tabular numerals and Dynamic Type for free.
 *
 * If this direction is adopted, the swap belongs in §3 of the design system for
 * the whole app — not left as one screen quietly using different type.
 *
 * Deliberately absent: price, spend, per-mille.
 */

import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';
import { useLocalSearchParams } from 'expo-router';

import {
  MessageSquareIcon,
  Share2Icon,
  TrophyIcon,
} from '@/components/shared/IconGlyph';
import { Face } from '@/feed/FeedMockScreen';
import { Leaderboard } from '@/mocks/Leaderboard';
import { GlassIconButton } from '@/components/shared/GlassIconButton';
import { MockLayout } from '@/mocks/mockTheme';
import { CheersButton } from '@/feed/CheersButton';
import { NightRoute } from '@/mocks/NightRoute';
import { SectionBreak } from '@/mocks/SectionBreak';
import { MenuChip } from '@/mocks/MenuChip';
import { NightChart, type ChartShape } from '@/mocks/NightChart';
import { StatGrid } from '@/mocks/StatGrid';
import {
  clockAt,
  formatElapsed,
} from '@/mocks/livePartyStore';
import {
  nightBrokenRecords,
  nightByBeer,
  nightHourly,
  nightMinutes,
  nightMvp,
  nightPlayedGames,
  nightStandings,
  nightStops,
  nightTally,
} from '@/party/nightRecord';
import { useNightRecord } from '@/party/useNightRecord';
import { nightBestFrom } from '@/party/nightBuilder';
import { drinkingDayKey, useTallyStore } from '@/stores/tallyStore';
import { loadBeerPhotos } from '@/stores/beerPhotosStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/**
 * What a record is called, and the line under it.
 *
 * Short and loud — "Osobní rekord", not "Gratulujeme, dosáhl jsi…". The detail
 * says what it beat, because a record with no previous number is a compliment
 * rather than a fact.
 */
const RECORD_TITLE: Record<'beers' | 'minutes' | 'stops', string> = {
  beers: 'Nejvíc piv za večer',
  minutes: 'Nejdelší večer',
  stops: 'Nejvíc štací',
};

const RECORD_DETAIL: Record<'beers' | 'minutes' | 'stops', (value: number, previous: number) => string> = {
  beers: (value, previous) =>
    previous > 0 ? `${value} — dosud ${previous}.` : `${value}. Zatím nejvíc.`,
  minutes: (value, previous) =>
    previous > 0
      ? `${formatElapsed(value)} — dosud ${formatElapsed(previous)}.`
      : `${formatElapsed(value)}. Zatím nejdéle.`,
  stops: (value, previous) =>
    previous > 0 ? `${value} — dosud ${previous}.` : `${value}. Zatím nejvíc.`,
};

/** Air between top-level sections. Deliberately far larger than the 12pt the
 *  Tácek surface uses — the density is most of what makes this feel native. */
const SECTION_GAP = 32;

// ── The three numerals ──────────────────────────────────────────────────────

/** Label ABOVE value, exactly as the feed card does it — the detail should
 *  read as the same object opened, not as a different screen. */
// ── People ──────────────────────────────────────────────────────────────────

function StopRow({
  arrivedAt,
  pubName,
  beers,
  last,
}: {
  arrivedAt: string;
  pubName: string;
  beers: number;
  last: boolean;
}) {
  return (
    <View style={styles.stopRow}>
      <View style={styles.stopRail}>
        <View style={styles.stopDot} />
        {last ? null : <View style={styles.stopLine} />}
      </View>
      <View style={styles.stopBody}>
        <Text style={styles.stopTime} allowFontScaling={false}>
          {arrivedAt}
        </Text>
        <Text style={styles.stopPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pubName}
        </Text>
        <Text style={styles.stopBeers} allowFontScaling={false}>
          {beers} piv
        </Text>
      </View>
    </View>
  );
}

// ── Tempo ───────────────────────────────────────────────────────────────────

/** Strava's splits, in beers. Bars only — a line chart would need axes, and an
 *  axis is chrome explaining content that can just be the right height. */
// ── Screen ──────────────────────────────────────────────────────────────────

/**
 * A heading with the dark band above it, the way the feed separates posts.
 *
 * The recap ran five sections apart on margin alone, so "Kdo tam byl", "Štace"
 * and "Piva po hodinách" read as one long column. The band is what makes the
 * feed scan as separate things, and this screen is the same problem.
 */
function SectionTitle({ children }: { children: string }) {
  return <SectionBreak title={children} inset={20} />;
}

const CHARTS = ['V čase', 'Podle piva', 'U stolu'] as const;

interface PartyRecapView {
  title: string;
  dateLabel: string;
  beers: number;
  duration: string;
  stops: {
    id: string;
    pubName: string;
    arrivedAt: string;
    beers: number;
    lat?: number;
    lng?: number;
  }[];
  people: { id: string; name: string; avatar?: string; beers: number; tint: string }[];
  hourly: { hour: string; beers: number }[];
  byBeer: { beer: string; count: number }[];
  records: { id: string; title: string; detail: string; by: string }[];
  cheers: number;
  comments: number;
  photoUrls: { id: string; uri: string }[];
}

export default function PartyRecapScreen() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ nightKey?: string; id?: string }>();
  const nightKey =
    typeof params.nightKey === 'string'
      ? params.nightKey
      : typeof params.id === 'string'
        ? params.id
        : undefined;
  const [chart, setChart] = React.useState<(typeof CHARTS)[number]>('V čase');
  const [shape, setShape] = React.useState<ChartShape>('bar');
  const [openedAt] = React.useState(() => Date.now());
  // A route always identifies the drinking day. With no explicit key (legacy
  // callers), useNightRecord chooses the active/latest local night — never a
  // canned example.
  const night = useNightRecord(nightKey);
  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);

  React.useEffect(() => {
    const controller = new AbortController();
    void loadBeerPhotos(controller.signal);
    return () => controller.abort();
  }, []);

  const standings = nightStandings(night);
  const mvp = nightMvp(standings);
  const people = standings.map((person) => ({
    id: person.id,
    name: person.name,
    beers: person.beers,
    tint: person.tint,
    ...(person.avatarUrl ? { avatar: person.avatarUrl } : {}),
  }));

  const nowMs = night.endedAt ? new Date(night.endedAt).getTime() : openedAt;
  const durationMinutes = nightMinutes(night, nowMs);

  // What tonight beat, measured against YOUR own history and nobody else's.
  const best = nightBestFrom(
    [...(current ? [current] : []), ...history],
    drinkingDayKey(new Date(night.startedAt)),
  );
  const records = nightBrokenRecords(night, best, nowMs).map((broken) => ({
    id: broken.kind,
    title: RECORD_TITLE[broken.kind],
    detail: RECORD_DETAIL[broken.kind](broken.value, broken.previous),
    by: 'Ty',
  }));

  const stops = nightStops(night, nowMs).map((stop) => ({
    id: stop.id,
    pubName: stop.pubName,
    arrivedAt: clockAt(new Date(stop.arrivedAt).getTime()),
    beers: stop.beers,
    ...(stop.lat !== undefined && stop.lng !== undefined
      ? { lat: stop.lat, lng: stop.lng }
      : {}),
  }));

  const hourly = nightHourly(night).map((bucket) => ({
    hour: bucket.hour,
    beers: bucket.beers,
  }));
  const playedGames = nightPlayedGames(night);
  const dateLabel = new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(night.startedAt));
  const title =
    stops.length > 1
      ? 'Pivní jízda'
      : stops[0]
        ? `Večer v ${stops[0].pubName}`
        : 'Pivní večer';
  const party: PartyRecapView = {
    title,
    dateLabel,
    beers: nightTally(night).beers,
    duration: formatElapsed(durationMinutes),
    stops,
    people,
    hourly,
    byBeer: nightByBeer(night),
    records,
    cheers: 0,
    comments: 0,
    photoUrls: night.photos.map((photo) => ({ id: photo.id, uri: photo.url })),
  };
  const route = party.stops.length > 0
    ? party.stops.map((stop) => stop.pubName).join('  →  ')
    : 'Bez hospody';

  // Same person, same face, wherever they appear on this screen.
  const personOf = (name: string) => party.people.find((person) => person.name === name);
  const personTint = (name: string) => personOf(name)?.tint ?? Colors.amber;
  const personAvatar = (name: string) => personOf(name)?.avatar;

  const chartRows =
    chart === 'V čase'
      ? party.hourly.map((slot) => ({ label: `${slot.hour}:00`, value: slot.beers }))
      : chart === 'Podle piva'
        ? party.byBeer.map((row) => ({ label: row.beer, value: row.count }))
        : party.people
            .map((person) => ({ label: person.name, value: person.beers }))
            .sort((a, b) => b.value - a.value);

  /** Does any of tonight's records mention this? Cheap, and it keeps the badge
   *  honest — no record in the list, no PR on the number. */
  const brokeRecord = (needle: string) =>
    party.records.some((record) => record.title.toLocaleLowerCase('cs').includes(needle));

  return (
    <View style={styles.screen}>
      {/* Share floats top right, opposite the native back capsule. As a
          full-width amber bar at the very bottom it was the loudest thing on the
          screen and sat below everything worth sharing. */}
      <View style={[styles.shareFloat, { top: insets.top + Spacing.sm }]}>
        <GlassIconButton size={40} accessibilityLabel="Sdílet večer">
          {/* The system's own share mark, not a generic node graph. On iOS this
              is the glyph every share sheet in the OS is behind, so it needs no
              learning; the fallback keeps the old icon everywhere else. */}
          <SymbolView
            name="square.and.arrow.up"
            size={20}
            tintColor={Colors.foam}
            fallback={<Share2Icon size={18} color={Colors.foam} />}
          />
        </GlassIconButton>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            // Clears the transparent native header so the title never sits
            // under the back control.
            paddingTop: insets.top + 52,
            paddingBottom: insets.bottom + SECTION_GAP,
          },
        ]}
      >
        {/* No hand-rolled back button: the native header draws it on iOS 26's
            own glass capsule and morphs it. Ours would be a flat copy. */}
        {/* Title block — the night, named, dated and routed. */}
        {/* The same header the card in the feed carries — the detail is that
            post opened, so it should still say whose night this is. */}
        <View style={styles.byline}>
          {party.people.slice(0, 5).map((person, index) => (
            <View key={person.id} style={index === 0 ? undefined : styles.peopleOverlap}>
              <Face name={person.name} tint={person.tint} avatar={person.avatar} size={30} />
            </View>
          ))}
          <Text
            style={styles.peopleNames}
            numberOfLines={1}
            maxFontSizeMultiplier={FontScaleCap.body}
          >
            {party.people.map((p) => p.name).join(', ')}
          </Text>
        </View>

        <Text style={styles.date} maxFontSizeMultiplier={FontScaleCap.body}>
          {party.dateLabel}
        </Text>
        <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
          {party.title}
        </Text>
        <Text style={styles.route} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {route}
        </Text>

        {/* The night's own pictures, right under its name — they are the best
            thing the evening made, and as a count in a meta row ("18 fotek")
            they were a number standing in for the content. */}
        {party.photoUrls.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.photoStrip}
            style={styles.photoStripWrap}
          >
            {party.photoUrls.map((photo) => (
              <Image key={photo.id} source={{ uri: photo.uri }} style={styles.photoThumb} />
            ))}
          </ScrollView>
        ) : (
          <View style={styles.photoEmpty}>
            <Text style={styles.photoEmptyText} maxFontSizeMultiplier={FontScaleCap.body}>
              Bez fotek. Příště něco cvakni.
            </Text>
          </View>
        )}

        {/* The shared block: one column width per stat, so a long duration
            cannot walk into the next number. */}
        <View style={styles.heroRow}>
          <StatGrid
            columns={3}
            hero
            stats={[
              // Derived from the night's own records, not hard-coded: the recap
              // already lists what this evening beat, so the stat and the record
              // list cannot disagree.
              { label: 'Piva', value: String(party.beers), record: brokeRecord('piv') },
              { label: 'Večer', value: party.duration, record: brokeRecord('večer') },
              {
                label: 'Hospody',
                value: String(party.stops.length),
                record: brokeRecord('štac'),
              },
            ]}
          />
        </View>

        {/* Reactions sit UNDER the numbers, where they do on the feed card:
            you read what the night was, then you clink it. Above the stats they
            were a toolbar on top of the content. */}
        <View style={styles.reactions}>
          <CheersButton count={party.cheers} cheered={false} label={`${party.cheers} cheers`} />
          <View style={styles.reaction}>
            <MessageSquareIcon size={19} color={Colors.foam} />
            <Text style={styles.reactionText} allowFontScaling={false}>
              {party.comments}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>Kdo tam byl</SectionTitle>
          {/* Komunita's board, not a second design of the same object. A list
              where first place looks like fifth is a table, not a ranking. */}
          <View style={styles.people}>
            <Leaderboard
              rows={party.people.map((person) => ({
                id: person.id,
                name: person.name,
                score: person.beers,
                avatar: person.avatar,
                tint: person.tint,
              }))}
              unit="piv"
              topBadge={mvp ? 'MVP' : undefined}
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>Štace</SectionTitle>
          {/* The walk, drawn. The list says where and when; the map says how far
              it actually was, which is the part nobody remembers by morning. */}
          {party.stops.filter((stop) => stop.lat !== undefined && stop.lng !== undefined).length > 1 ? (
            <View style={styles.stopsMap}>
              <NightRoute
                stops={party.stops.flatMap((stop) =>
                  stop.lat !== undefined && stop.lng !== undefined
                    ? [{ name: stop.pubName, lat: stop.lat, lng: stop.lng }]
                    : [],
                )}
                height={168}
                caption={false}
              />
            </View>
          ) : null}
          <View style={styles.stops}>
            {party.stops.map((stop, index) => (
              <StopRow
                key={stop.id}
                arrivedAt={stop.arrivedAt}
                pubName={stop.pubName}
                beers={stop.beers}
                last={index === party.stops.length - 1}
              />
            ))}
          </View>
        </View>

        {/* The night's numbers, drawn. This is where the charts moved to from
            the running hub: while the evening is happening you glance at the
            phone to see what just happened, and only afterwards do you want to
            look at its shape. One chart, three questions you can ask of it. */}
        <View style={styles.section}>
          <SectionTitle>Jak to šlo</SectionTitle>
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

        {/* The richest thing a night makes. Only rendered when one was played —
            an empty scoreboard would be a section explaining its own absence. */}
        {playedGames.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Hry</SectionTitle>
            {playedGames.map((game, index) => (
              <View key={`${game.key}-${index}`} style={styles.gameBlock}>
                <Text style={styles.gameTitle} maxFontSizeMultiplier={FontScaleCap.body}>
                  {game.result?.paying
                    ? `${game.name} · platí ${game.result.paying}`
                    : game.result?.winner
                      ? `${game.name} · vyhrál ${game.result.winner}`
                      : `${game.name} · odehráno`}
                </Text>
                {(game.result?.scores ?? []).map((row, rank) => (
                  <View key={row.name} style={styles.gameRow}>
                    <Text style={styles.gameRank} allowFontScaling={false}>
                      {rank + 1}
                    </Text>
                    <Text
                      style={styles.gameName}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {row.name}
                    </Text>
                    <Text style={styles.gameScore} allowFontScaling={false}>
                      {row.score}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {party.records.length === 0 ? null : (
        <View style={styles.section}>
          <SectionTitle>Padlo tenhle večer</SectionTitle>
          {party.records.map((record) => (
            <View key={record.id} style={styles.record}>
              <View style={styles.recordMedallion}>
                <TrophyIcon size={16} color={Colors.amber} />
              </View>
              <View style={styles.grow}>
                <Text style={styles.recordTitle} maxFontSizeMultiplier={FontScaleCap.body}>
                  {record.title}
                </Text>
                <Text style={styles.recordDetail} maxFontSizeMultiplier={FontScaleCap.body}>
                  {record.detail}
                </Text>
                {/* Whose it is. On a post shared by five people, "tvůj nový
                    rekord" is ambiguous for four of them — a record needs a
                    face on it. */}
                <View style={styles.recordBy}>
                  <Face
                    name={record.by}
                    tint={personTint(record.by)}
                    avatar={personAvatar(record.by)}
                    size={16}
                  />
                  <Text style={styles.recordByName} maxFontSizeMultiplier={FontScaleCap.body}>
                    {record.by}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
        )}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shareFloat: { position: 'absolute', right: 20, zIndex: 2 },
  photoStripWrap: { marginTop: Spacing.md, marginHorizontal: -MockLayout.screenPad },
  photoStrip: { gap: Spacing.xs, paddingHorizontal: MockLayout.screenPad },
  photoThumb: { width: 76, height: 76, borderRadius: 14, backgroundColor: Colors.stout3 },
  photoMore: { alignItems: 'center', justifyContent: 'center' },
  photoMoreText: { fontSize: 17, fontWeight: '800', color: Colors.foam },
  photoEmpty: {
    marginTop: Spacing.md,
    paddingVertical: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.1),
  },
  photoEmptyText: { fontSize: 14, fontWeight: '500', color: Colors.mutedText },
  reactions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, marginTop: Spacing.md },
  reaction: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  reactionText: { fontSize: 15, fontWeight: '700', color: Colors.foam },
  stopsMap: { marginBottom: Spacing.md, borderRadius: 18, overflow: 'hidden' },
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: MockLayout.screenPad },
  grow: { flex: 1 },
  pressed: { opacity: 0.6 },

  back: {
    width: HitArea.min,
    height: HitArea.min,
    marginLeft: -10,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },

  byline: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.sm },
  peopleOverlap: { marginLeft: -9 },
  peopleNames: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: Colors.mutedText,
    marginLeft: Spacing.sm,
  },

  // — Title block —
  date: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    letterSpacing: 0.3,
    marginTop: Spacing.xs,
  },
  title: {
    fontWeight: '800',
    fontSize: 34,
    lineHeight: 40,
    color: Colors.foam,
    marginTop: 2,
    letterSpacing: -0.6,
  },
  route: {
    fontWeight: '500',
    fontSize: 14,
    lineHeight: 20,
    color: withAlpha(Colors.amber, 0.85),
    marginTop: Spacing.xs,
  },

  // — Hero numerals —
  heroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: SECTION_GAP - 6,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.14),
  },

  // — Sections —
  section: {},
  // Sentence case, foam — the same voice as the feed card's sections. The
  // uppercase muted kicker made the detail read as a different app from the
  // preview it opens out of.

  // — People —
  people: { gap: Spacing.md },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  avatarText: { fontWeight: '700', color: Colors.foam },
  personBody: { flex: 1, gap: 6 },
  personTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  personName: { fontWeight: '700', fontSize: 16, color: Colors.foam },
  personCount: {
    fontWeight: '800',
    fontSize: 17,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
  mvpTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  mvpText: {
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 0.5,
    color: Colors.amber,
  },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: withAlpha(Colors.foam, 0.07),
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },

  // — Štace —
  stops: {},
  stopRow: { flexDirection: 'row', gap: Spacing.sm },
  stopRail: { width: 12, alignItems: 'center' },
  stopDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    backgroundColor: Colors.amber,
  },
  stopLine: { flex: 1, width: 2, backgroundColor: withAlpha(Colors.amber, 0.25), marginTop: 2 },
  stopBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  stopTime: {
    fontWeight: '700',
    fontSize: 14,
    color: Colors.mutedText,
    width: 46,
    fontVariant: ['tabular-nums'],
  },
  stopPub: { flex: 1, fontWeight: '700', fontSize: 17, color: Colors.foam },
  stopBeers: { fontWeight: '500', fontSize: 13, color: Colors.mutedText },

  // — Tempo —

  // — Games —
  gameBlock: { marginBottom: Spacing.lg, gap: 4 },
  gameTitle: { fontWeight: '700', fontSize: 15, color: Colors.foam, marginBottom: 4 },
  gameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  gameRank: {
    width: 16,
    fontWeight: '700',
    fontSize: 13,
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  gameName: { flex: 1, fontWeight: '500', fontSize: 15, color: Colors.foam },
  gameScore: {
    fontWeight: '700',
    fontSize: 15,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  // — Records —
  record: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  recordMedallion: {
    width: 34,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  recordTitle: { fontWeight: '700', fontSize: 15, color: Colors.foam },
  recordBy: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  recordByName: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  recordDetail: { fontWeight: '400', fontSize: 13, color: Colors.mutedText, marginTop: 1 },

});
