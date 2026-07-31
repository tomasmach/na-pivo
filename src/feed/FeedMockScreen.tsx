/**
 * DESIGN MOCK — Feed home, Strava's activity feed shape.
 *
 * One card per NIGHT, never per beer. The card is readable without opening it:
 * who, where, and the three numbers. That is the whole Strava trick — the feed
 * is not a list of links to activities, it IS the activities.
 *
 * Card order, top to bottom:
 *   author + when          who is talking, and how fresh it is
 *   title                  the night, named
 *   pub chain              the route, in amber, like a Strava map
 *   three numbers          piva / čas / hospody, hairline-separated
 *   people                 overlapping initials, the table
 *   cheers · comments      the social floor
 *
 * A live night gets a pill instead of a timestamp and skips the numbers that
 * are not final yet.
 *
 * System font throughout (see PartyRecapScreen's header for why).
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import {
  HeartIcon,
  ImagesIcon,
  MessageSquareIcon,
} from '@/components/shared/IconGlyph';
import { MOCK_FEED, MOCK_NUDGE, type FeedEntry } from '@/feed/mockFeed';
import { PartyHighlight } from '@/feed/PartyHighlight';
import { StatGrid } from '@/mocks/StatGrid';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/** "Honza, Petr a ty" — the table, named the way you would say it out loud. */
function namesLine(people: { name: string }[]): string {
  const names = people.map((p) => p.name);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} a ${names[names.length - 1]}`;
}

function Initials({ name, tint, size = 28 }: { name: string; tint: string; size?: number }) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: tint,
          borderColor: MockColors.surface,
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]} allowFontScaling={false}>
        {name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

function FeedCard({ entry }: { entry: FeedEntry }) {
  const router = useRouter();

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push('/party-recap' as Href)}
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}, detail večera`}
    >
      {/* The party owns the post, not one author. A night is the same object on
          everybody's wall, so the header is the table: every face, then who they
          are. "Honza přidal" would make four other people spectators at their
          own evening. */}
      <View style={styles.cardHead}>
        <View style={styles.headAvatars}>
          {entry.people.slice(0, 4).map((person, index) => (
            <View key={person.name} style={index === 0 ? undefined : styles.peopleOverlap}>
              <Initials name={person.name} tint={person.tint} size={30} />
            </View>
          ))}
        </View>
        <View style={styles.grow}>
          <Text style={styles.author} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {namesLine(entry.people)}
          </Text>
          <Text style={styles.when} maxFontSizeMultiplier={FontScaleCap.body}>
            {entry.when}
          </Text>
        </View>
        {entry.live ? (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText} allowFontScaling={false}>
              TEĎ
            </Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
        {entry.title}
      </Text>

      {/* Strava's stat block: muted label ABOVE a heavy value, no dividers —
          the grid spacing separates them (docs/references/IMG_2125.PNG). */}
      <View style={styles.statsRow}>
        <StatGrid
          columns={3}
          stats={[
            { label: 'Piva', value: String(entry.beers) },
            { label: entry.live ? 'Zatím' : 'Večer', value: entry.duration },
            { label: 'Hospody', value: String(entry.stops.length) },
          ]}
        />
      </View>

      {/* The hero is whatever this night actually produced — photos, a game
          scoreboard, the tempo, a record, or a roast built from the numbers.
          The map is the fallback, not the default: it is the one output that
          says nothing about what the evening was like. */}
      <View style={styles.hero}>
        <PartyHighlight entry={entry} />
      </View>

      <View style={styles.cardFoot}>
        <Pressable
          style={({ pressed }) => [styles.footAction, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Cheers"
        >
          <HeartIcon size={16} color={entry.cheered ? Colors.amber : Colors.mutedText} />
          <Text style={[styles.footText, entry.cheered && styles.footTextOn]} allowFontScaling={false}>
            {entry.cheers}
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.footAction, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Komentáře"
        >
          <MessageSquareIcon size={16} color={Colors.mutedText} />
          <Text style={styles.footText} allowFontScaling={false}>
            {entry.comments}
          </Text>
        </Pressable>
        {entry.photos > 0 ? (
          <View style={styles.footAction}>
            <ImagesIcon size={16} color={Colors.mutedText} />
            <Text style={styles.footText} allowFontScaling={false}>
              {entry.photos}
            </Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function FeedMockScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + 40 },
        ]}
        // Lets the large title own the top inset and collapse on scroll.
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* No hand-rolled header: the native stack owns the large title, its
            collapse onto the blurred bar and the floating glass search button. */}
        {/* The facilitator: a reason to go out, above everyone else's nights. */}
        <View style={styles.nudge}>
          <View style={styles.grow}>
            <Text style={styles.nudgeTitle} maxFontSizeMultiplier={FontScaleCap.body}>
              {MOCK_NUDGE.title}
            </Text>
            <Text style={styles.nudgeBody} maxFontSizeMultiplier={FontScaleCap.body}>
              {MOCK_NUDGE.body}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.nudgeCta, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={MOCK_NUDGE.cta}
          >
            <Text style={styles.nudgeCtaText} allowFontScaling={false}>
              {MOCK_NUDGE.cta}
            </Text>
          </Pressable>
        </View>

        {MOCK_FEED.map((entry) => (
          <FeedCard key={entry.id} entry={entry} />
        ))}

        <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
          Design mock — data jsou napevno.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: 16 },
  grow: { flex: 1 },
  pressed: { opacity: 0.6 },

  header: { flexDirection: 'row', alignItems: 'center', marginBottom: Spacing.md },
  screenTitle: { ...MockType.titleXL, color: Colors.foam },
  searchButton: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // — Nudge —
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.card,
    backgroundColor: withAlpha(Colors.amber, 0.09),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.22),
    marginBottom: Spacing.lg,
  },
  nudgeTitle: { fontWeight: '700', fontSize: 15, color: Colors.foam },
  nudgeBody: { fontWeight: '400', fontSize: 13, color: Colors.mutedText, marginTop: 2 },
  nudgeCta: {
    paddingHorizontal: Spacing.md,
    height: 34,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  nudgeCtaText: { fontWeight: '700', fontSize: 13, color: Colors.stout },

  // — Card —
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: MockLayout.cardRadius,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  cardPressed: { opacity: 0.92 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  headAvatars: { flexDirection: 'row', alignItems: 'center' },

  // — Hero —
  hero: {
    marginTop: Spacing.md,
    marginHorizontal: -Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  photoStrip: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    top: 12,
    flexDirection: 'row',
    gap: 6,
  },
  photo: {
    width: 42,
    height: 42,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  photoMore: { backgroundColor: MockColors.surfaceHigh },
  photoMoreText: { fontSize: 12, fontWeight: '700', color: Colors.foam },
  author: { fontWeight: '700', fontSize: 15, color: Colors.foam },
  when: { fontWeight: '400', fontSize: 12, color: Colors.mutedText, marginTop: 1 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    height: 24,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.amber },
  liveText: { fontWeight: '800', fontSize: 10, letterSpacing: 0.8, color: Colors.amber },

  title: { fontWeight: '800', fontSize: 21, color: Colors.foam, marginTop: Spacing.md, letterSpacing: -0.3 },
  route: { fontWeight: '500', fontSize: 13, color: withAlpha(Colors.amber, 0.85), marginTop: 3 },

  // — Numbers —
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  stat: { flex: 1 },
  statValue: {
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontWeight: '500',
    fontSize: 11,
    color: Colors.mutedText,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    backgroundColor: withAlpha(Colors.foam, 0.12),
    marginHorizontal: Spacing.sm,
  },

  // — People —
  peopleRow: { flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md },
  peopleOverlap: { marginLeft: -9 },
  // A 2pt ring in the card colour punches each face out of the one behind it.
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  avatarText: { fontWeight: '700', color: Colors.stout },
  peopleLabel: {
    flex: 1,
    fontWeight: '400',
    fontSize: 12,
    color: Colors.mutedText,
    marginLeft: Spacing.sm,
  },

  // — Floor —
  cardFoot: {
    flexDirection: 'row',
    gap: Spacing.lg,
    marginTop: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  footAction: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 28 },
  footText: { fontWeight: '500', fontSize: 13, color: Colors.mutedText },
  footTextOn: { color: Colors.amber },

  mockNote: {
    fontWeight: '400',
    fontSize: 12,
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: Spacing.md,
  },
});
