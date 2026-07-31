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

import {
  HeartIcon,
  ImagesIcon,
  MessageSquareIcon,
  SearchIcon,
} from '@/components/shared/IconGlyph';
import { MOCK_FEED, MOCK_NUDGE, type FeedEntry } from '@/feed/mockFeed';
import { StatGrid } from '@/mocks/StatGrid';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

function Initials({ name, tint, size = 28 }: { name: string; tint: string; size?: number }) {
  return (
    <View
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: withAlpha(tint, 0.22),
          borderColor: withAlpha(tint, 0.55),
        },
      ]}
    >
      <Text style={[styles.avatarText, { fontSize: size * 0.42 }]} allowFontScaling={false}>
        {name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

/** The table, as one object: initials overlapping like a Strava kudos row. */
function PeopleStack({ people }: { people: FeedEntry['people'] }) {
  const shown = people.slice(0, 4);
  const rest = people.length - shown.length;

  return (
    <View style={styles.peopleRow}>
      {shown.map((person, index) => (
        <View key={person.name} style={index === 0 ? undefined : styles.peopleOverlap}>
          <Initials name={person.name} tint={person.tint} size={26} />
        </View>
      ))}
      <Text style={styles.peopleLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {rest > 0 ? `${shown.map((p) => p.name).join(', ')} +${rest}` : shown.map((p) => p.name).join(', ')}
      </Text>
    </View>
  );
}

function FeedCard({ entry }: { entry: FeedEntry }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <Initials name={entry.author} tint={entry.authorTint} />
        <View style={styles.grow}>
          <Text style={styles.author} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {entry.author}
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
      <Text style={styles.route} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {entry.stops.join('  →  ')}
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

      <PeopleStack people={entry.people} />

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
    </View>
  );
}

export default function FeedMockScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom + 40 },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.screenTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            Feed
          </Text>
          <View style={styles.grow} />
          <Pressable
            style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Hledat"
          >
            <SearchIcon size={20} color={Colors.foam} />
          </Pressable>
        </View>

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
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
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
  avatar: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  avatarText: { fontWeight: '700', color: Colors.foam },
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
