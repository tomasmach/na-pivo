/**
 * DESIGN MOCK — party recap, in the 3.0 language.
 *
 * Reachable at `/party-recap` (or `napivo://party-recap`) and wired to nothing:
 * it renders `MOCK_PARTY` so the shape can be judged before any of it is built.
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
 * Deliberately absent: price, spend, per-mille. See `mockParty.ts`.
 */

import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ClockIcon,
  HeartIcon,
  ImagesIcon,
  Share2Icon,
  MapPinIcon,
  TrophyIcon,
} from '@/components/shared/IconGlyph';
import { Face } from '@/feed/FeedMockScreen';
import { Leaderboard } from '@/mocks/Leaderboard';
import { GlassIconButton } from '@/mocks/GlassIconButton';
import { SectionBreak } from '@/mocks/SectionBreak';
import { TempoChart } from '@/mocks/TempoChart';
import { StatGrid } from '@/mocks/StatGrid';
import { formatElapsed, hourlyFrom, useLivePartyStore } from '@/mocks/livePartyStore';
import { MOCK_PARTY, type PartyRecap } from '@/party/mockParty';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

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

export default function PartyRecapScreen() {
  const insets = useSafeAreaInsets();
  // The recap reads what the party mode actually produced, and only falls back
  // to the canned night for the parts a mock evening has not made yet. Before
  // this, playing a game and taking photos changed nothing here — the loop was
  // drawn but not connected.
  const liveBeers = useLivePartyStore((s) => s.beers);
  const livePhotos = useLivePartyStore((s) => s.photos);
  const liveGames = useLivePartyStore((s) => s.games);
  const liveMinutes = useLivePartyStore((s) => s.minutes);
  const livePub = useLivePartyStore((s) => s.pubName);
  const hasLive = useLivePartyStore((s) => s.live);

  // Derived from the beer list rather than stored: one source of truth for the
  // night, read three different ways.
  const liveHourly = hourlyFrom(liveBeers);
  // A game on the table is not a result. Only played ones have a scoreboard,
  // and a scoreboard is the whole reason this section exists.
  const playedGames = liveGames.flatMap((game) => (game.result ? [game.result] : []));

  const party: PartyRecap = hasLive
    ? {
        ...MOCK_PARTY,
        title: MOCK_PARTY.title,
        beers: liveBeers.length,
        duration: formatElapsed(liveMinutes),
        photos: livePhotos,
        hourly: liveHourly.length > 0 ? liveHourly : MOCK_PARTY.hourly,
        stops: livePub
          ? [{ id: 'live', pubName: livePub, arrivedAt: '20:00', beers: liveBeers.length }]
          : MOCK_PARTY.stops,
        people: MOCK_PARTY.people.map((person) =>
          person.name === 'Honza' ? { ...person, beers: liveBeers.length } : person,
        ),
      }
    : MOCK_PARTY;
  const route = party.stops.map((s) => s.pubName).join('  →  ');

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
          <Share2Icon size={18} color={Colors.foam} />
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

        {/* What the post collected, right under the route — it is a summary of
            the night, so it reads before the detail rather than after it. At the
            bottom it was a footer nobody scrolled to. */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryFact}>
            <HeartIcon size={15} color={Colors.mutedText} />
            <Text style={styles.summaryText} allowFontScaling={false}>
              {party.cheers} cheers
            </Text>
          </View>
          <View style={styles.summaryFact}>
            <ImagesIcon size={15} color={Colors.mutedText} />
            <Text style={styles.summaryText} allowFontScaling={false}>
              {party.photos} fotek
            </Text>
          </View>
          <View style={styles.summaryFact}>
            <MapPinIcon size={15} color={Colors.mutedText} />
            <Text style={styles.summaryText} allowFontScaling={false}>
              {party.stops.length} štace
            </Text>
          </View>
        </View>

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
              topBadge="MVP"
            />
          </View>
        </View>

        <View style={styles.section}>
          <SectionTitle>Štace</SectionTitle>
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

        <View style={styles.section}>
          <SectionTitle>Piva po hodinách</SectionTitle>
          <TempoChart hourly={party.hourly} height={140} />
        </View>

        {/* The richest thing a night makes. Only rendered when one was played —
            an empty scoreboard would be a section explaining its own absence. */}
        {playedGames.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Hry</SectionTitle>
            {playedGames.map((game, index) => (
              <View key={`${game.game}-${index}`} style={styles.gameBlock}>
                <Text style={styles.gameTitle} maxFontSizeMultiplier={FontScaleCap.body}>
                  {game.game} · vyhrál{game.winner === 'Klára' ? 'a' : ''} {game.winner}
                </Text>
                {game.scores.map((row, rank) => (
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
              </View>
            </View>
          ))}
        </View>

        <View style={styles.mockNote}>
          <ClockIcon size={13} color={Colors.mutedText} />
          <Text style={styles.mockText} maxFontSizeMultiplier={FontScaleCap.body}>
            Design mock — data jsou napevno.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  shareFloat: { position: 'absolute', right: 20, zIndex: 2 },
  summaryRow: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.md },
  summaryFact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryText: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: 20 },
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
  recordDetail: { fontWeight: '400', fontSize: 13, color: Colors.mutedText, marginTop: 1 },

  // — Footer —


  mockNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.md,
  },
  mockText: { fontWeight: '400', fontSize: 12, color: Colors.mutedText },
});
