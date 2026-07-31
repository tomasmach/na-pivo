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
 * structure and density, not colour.
 *
 * Deliberately absent: price, spend, per-mille. See `mockParty.ts`.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import {
  BeerIcon,
  ChevronLeftIcon,
  ClockIcon,
  HeartIcon,
  ImagesIcon,
  MapPinIcon,
  TrophyIcon,
} from '@/components/shared/IconGlyph';
import { MOCK_PARTY, type PartyPerson, type PartyRecap } from '@/party/mockParty';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/** Air between top-level sections. Deliberately far larger than the 12pt the
 *  Tácek surface uses — the density is most of what makes this feel native. */
const SECTION_GAP = 32;

// ── The three numerals ──────────────────────────────────────────────────────

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.heroStat}>
      <Text
        style={styles.heroValue}
        allowFontScaling={false}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
      <Text style={styles.heroLabel} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </View>
  );
}

function HeroStats({ party }: { party: PartyRecap }) {
  return (
    <View style={styles.heroRow}>
      <HeroStat value={String(party.beers)} label="piv" />
      <View style={styles.heroDivider} />
      <HeroStat value={party.duration} label="večer" />
      <View style={styles.heroDivider} />
      <HeroStat value={String(party.stops.length)} label="hospody" />
    </View>
  );
}

// ── People ──────────────────────────────────────────────────────────────────

function Initials({ person, size = 34 }: { person: PartyPerson; size?: number }) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: withAlpha(person.tint, 0.22),
          borderColor: withAlpha(person.tint, 0.5),
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]} allowFontScaling={false}>
        {person.name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/** One person: who, how many, and how that reads against the night's best.
 *  The bar is the row's content — it is why you do not need to open anything. */
function PersonRow({ person, max }: { person: PartyPerson; max: number }) {
  const share = max > 0 ? person.beers / max : 0;

  return (
    <View style={styles.personRow}>
      <Initials person={person} />
      <View style={styles.personBody}>
        <View style={styles.personTop}>
          <Text style={styles.personName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {person.name}
          </Text>
          {person.mvp ? (
            <View style={styles.mvpTag}>
              <TrophyIcon size={11} color={Colors.amber} />
              <Text style={styles.mvpText} allowFontScaling={false}>
                MVP
              </Text>
            </View>
          ) : null}
          <View style={styles.grow} />
          <Text style={styles.personCount} allowFontScaling={false}>
            {person.beers}
          </Text>
        </View>
        <View style={styles.barTrack}>
          <View
            style={[
              styles.barFill,
              {
                width: `${Math.max(6, Math.round(share * 100))}%`,
                backgroundColor: person.mvp ? Colors.amber : withAlpha(Colors.amber, 0.38),
              },
            ]}
          />
        </View>
      </View>
    </View>
  );
}

// ── Štace ───────────────────────────────────────────────────────────────────

/** The night's route, read top to bottom. The connector is what makes three
 *  rows read as one journey instead of three unrelated pubs. */
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
function Tempo({ party }: { party: PartyRecap }) {
  const peak = party.hourly.reduce((m, h) => Math.max(m, h.beers), 0);

  return (
    <View style={styles.tempoRow}>
      {party.hourly.map((slot) => (
        <View key={slot.hour} style={styles.tempoCol}>
          <Text style={styles.tempoValue} allowFontScaling={false}>
            {slot.beers}
          </Text>
          <View style={styles.tempoTrack}>
            <View
              style={[
                styles.tempoBar,
                { height: `${peak > 0 ? Math.max(8, (slot.beers / peak) * 100) : 8}%` },
              ]}
            />
          </View>
          <Text style={styles.tempoHour} allowFontScaling={false}>
            {slot.hour}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ── Screen ──────────────────────────────────────────────────────────────────

function SectionTitle({ children }: { children: string }) {
  return (
    <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
      {children}
    </Text>
  );
}

export default function PartyRecapScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const party = MOCK_PARTY;
  const maxBeers = party.people.reduce((m, p) => Math.max(m, p.beers), 0);
  const route = party.stops.map((s) => s.pubName).join('  →  ');

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom + SECTION_GAP },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Zpátky"
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <ChevronLeftIcon size={26} color={Colors.foam} />
        </Pressable>

        {/* Title block — the night, named, dated and routed. */}
        <Text style={styles.date} maxFontSizeMultiplier={FontScaleCap.body}>
          {party.dateLabel}
        </Text>
        <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
          {party.title}
        </Text>
        <Text style={styles.route} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {route}
        </Text>

        <HeroStats party={party} />

        <View style={styles.section}>
          <SectionTitle>Kdo tam byl</SectionTitle>
          <View style={styles.people}>
            {party.people.map((person) => (
              <PersonRow key={person.id} person={person} max={maxBeers} />
            ))}
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
          <SectionTitle>Tempo</SectionTitle>
          <Tempo party={party} />
        </View>

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

        {/* Footer facts, not buttons: what the night collected. */}
        <View style={styles.footerRow}>
          <View style={styles.footerFact}>
            <HeartIcon size={16} color={Colors.mutedText} />
            <Text style={styles.footerText} allowFontScaling={false}>
              {party.cheers} cheers
            </Text>
          </View>
          <View style={styles.footerFact}>
            <ImagesIcon size={16} color={Colors.mutedText} />
            <Text style={styles.footerText} allowFontScaling={false}>
              {party.photos} fotek
            </Text>
          </View>
          <View style={styles.footerFact}>
            <MapPinIcon size={16} color={Colors.mutedText} />
            <Text style={styles.footerText} allowFontScaling={false}>
              {party.stops.length} štace
            </Text>
          </View>
        </View>

        <Pressable
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          accessibilityLabel="Sdílet večer"
        >
          <BeerIcon size={18} color={Colors.stout} />
          <Text style={styles.ctaText} maxFontSizeMultiplier={FontScaleCap.heading}>
            Sdílet večer
          </Text>
        </Pressable>

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

  // — Title block —
  date: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    letterSpacing: 0.3,
    marginTop: Spacing.xs,
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 34,
    lineHeight: 40,
    color: Colors.foam,
    marginTop: 2,
  },
  route: {
    fontFamily: Fonts.ui.medium,
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
  heroStat: { flex: 1, alignItems: 'flex-start' },
  heroValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 38,
    lineHeight: 46,
    color: Colors.foam,
    includeFontPadding: false,
  },
  heroLabel: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    color: Colors.mutedText,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginTop: -2,
  },
  heroDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: withAlpha(Colors.foam, 0.14),
    marginHorizontal: Spacing.md,
  },

  // — Sections —
  section: { marginTop: SECTION_GAP },
  sectionTitle: {
    fontFamily: Fonts.display.bold,
    fontSize: 13,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: Colors.mutedText,
    marginBottom: Spacing.md,
  },

  // — People —
  people: { gap: Spacing.md },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  avatarText: { fontFamily: Fonts.display.bold, color: Colors.foam },
  personBody: { flex: 1, gap: 6 },
  personTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  personName: { fontFamily: Fonts.display.bold, fontSize: 16, color: Colors.foam },
  personCount: {
    fontFamily: Fonts.display.extrabold,
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
    fontFamily: Fonts.display.bold,
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
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.mutedText,
    width: 46,
    fontVariant: ['tabular-nums'],
  },
  stopPub: { flex: 1, fontFamily: Fonts.display.bold, fontSize: 17, color: Colors.foam },
  stopBeers: { fontFamily: Fonts.ui.medium, fontSize: 13, color: Colors.mutedText },

  // — Tempo —
  tempoRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm, height: 132 },
  tempoCol: { flex: 1, alignItems: 'center', gap: 6 },
  tempoValue: { fontFamily: Fonts.display.bold, fontSize: 12, color: Colors.mutedText },
  tempoTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  tempoBar: {
    width: '100%',
    borderRadius: 6,
    backgroundColor: withAlpha(Colors.amber, 0.55),
    minHeight: 8,
  },
  tempoHour: { fontFamily: Fonts.ui.medium, fontSize: 11, color: Colors.mutedText },

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
  recordTitle: { fontFamily: Fonts.display.bold, fontSize: 15, color: Colors.foam },
  recordDetail: { fontFamily: Fonts.ui.regular, fontSize: 13, color: Colors.mutedText, marginTop: 1 },

  // — Footer —
  footerRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginTop: SECTION_GAP,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.14),
  },
  footerFact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  footerText: { fontFamily: Fonts.ui.medium, fontSize: 13, color: Colors.mutedText },

  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: 54,
    borderRadius: Radius.card,
    backgroundColor: Colors.amber,
    marginTop: SECTION_GAP,
  },
  ctaPressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  ctaText: { fontFamily: Fonts.display.extrabold, fontSize: 17, color: Colors.stout },

  mockNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: Spacing.md,
  },
  mockText: { fontFamily: Fonts.ui.regular, fontSize: 12, color: Colors.mutedText },
});
