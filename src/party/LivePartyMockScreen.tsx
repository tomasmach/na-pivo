/**
 * DESIGN MOCK — the party, as a fullscreen hub.
 *
 * The first pass was Strava's Record screen literally: a full-bleed map with a
 * sheet over it. In a pub that is 60% of the screen spent on a map nobody looks
 * at — you already know which pub you are in, you are sitting in it. So the map
 * shrinks to a strip that says "these are tonight's stops", and the screen
 * belongs to the three things you actually touch at the table:
 *
 *   who is here      the table, with everyone's tally — the live leaderboard
 *   what you drink   a row per drink, each with its own +
 *   one CTA          "Přidej pivo", at the bottom, under your thumb
 *
 * The tracker is deliberately two-level: adding a drink names it once, and
 * every round after that is a + on its row. That is how a tab works at a bar,
 * and it means the common action is one tap and never opens a picker.
 *
 * Fullscreen with no tab bar (`TabBar` steps aside on this route), so the
 * screen owns its own way out: minimise, top right, exactly as the product doc
 * describes ("Celý fullscreen mód. Lze minimalizovat.").
 */

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';

import {
  ChevronDownIcon,
  PlusIcon,
  SoccerBallIcon,
  UserPlusIcon,
} from '@/components/shared/IconGlyph';
import { NightRoute } from '@/mocks/NightRoute';
import { StatGrid } from '@/mocks/StatGrid';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const STOPS = [{ name: 'U Fleků', lat: 50.0785, lng: 14.42 }];

const PEOPLE = [
  { name: 'Honza', beers: 4, tint: '#7DD66B' },
  { name: 'Petr', beers: 2, tint: '#F0BE5C' },
];

/** What the CTA offers next; a real picker replaces this. */
const BEER_CYCLE = ['Flekovský ležák 13°', 'Matuška Raptor', 'Kacíř 11°'];

interface Drink {
  name: string;
  count: number;
}

function Initials({ name, tint }: { name: string; tint: string }) {
  return (
    <View
      style={[
        styles.avatar,
        { backgroundColor: withAlpha(tint, 0.22), borderColor: withAlpha(tint, 0.55) },
      ]}
    >
      <Text style={styles.avatarText} allowFontScaling={false}>
        {name.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  );
}

export default function LivePartyMockScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [drinks, setDrinks] = useState<Drink[]>([]);

  const mine = drinks.reduce((sum, d) => sum + d.count, 0);
  const table = mine + PEOPLE.reduce((sum, p) => sum + p.beers, 0);
  const live = mine > 0;

  const addDrink = () => {
    setDrinks((current) => {
      const next = BEER_CYCLE[current.length % BEER_CYCLE.length];
      return [...current, { name: next, count: 1 }];
    });
  };

  const bump = (index: number) => {
    setDrinks((current) =>
      current.map((drink, i) => (i === index ? { ...drink, count: drink.count + 1 } : drink)),
    );
  };

  // The whole table, me included, ordered — the leaderboard is just this list.
  const roster = [{ name: 'Ty', beers: mine, tint: MockColors.accent }, ...PEOPLE].sort(
    (a, b) => b.beers - a.beers,
  );

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: Spacing.xl }}
        showsVerticalScrollIndicator={false}
      >
        {/* Tonight's stops, minimised. It is context, not the screen. */}
        <View>
          <NightRoute stops={STOPS} live={live} height={148} />
          <View style={[styles.topBar, { paddingTop: insets.top + Spacing.xs }]}>
            <Pressable
              style={({ pressed }) => [styles.pubPicker, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Změnit hospodu"
            >
              <View style={[styles.pubDot, live && { backgroundColor: MockColors.live }]} />
              <Text style={styles.pubName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {STOPS[STOPS.length - 1].name}
              </Text>
              <ChevronDownIcon size={16} color={Colors.foam} />
            </Pressable>
            <View style={styles.grow} />
            <Pressable
              onPress={() => router.replace('/friends' as Href)}
              style={({ pressed }) => [styles.minimise, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Minimalizovat večer"
            >
              <ChevronDownIcon size={20} color={Colors.foam} />
            </Pressable>
          </View>
        </View>

        <View style={styles.body}>
          <StatGrid
            columns={3}
            stats={[
              { label: 'Tvoje piva', value: String(mine) },
              { label: 'U stolu', value: String(table) },
              { label: 'Večer', value: live ? '1h 12m' : '0m' },
            ]}
          />

          {/* Two doors you reach for during a night; everything else waits. */}
          <View style={styles.doors}>
            <Pressable style={({ pressed }) => [styles.door, pressed && styles.pressed]}>
              <UserPlusIcon size={17} color={Colors.foam} />
              <Text style={styles.doorText} maxFontSizeMultiplier={FontScaleCap.body}>
                Pozvat
              </Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.door, pressed && styles.pressed]}>
              <SoccerBallIcon size={17} color={Colors.foam} />
              <Text style={styles.doorText} maxFontSizeMultiplier={FontScaleCap.body}>
                Hry
              </Text>
            </Pressable>
          </View>

          <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.heading}>
            U stolu
          </Text>
          {roster.map((person) => (
            <View key={person.name} style={styles.personRow}>
              <Initials name={person.name} tint={person.tint} />
              <Text
                style={styles.personName}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {person.name}
              </Text>
              <Text style={styles.personCount} allowFontScaling={false}>
                {person.beers}
              </Text>
            </View>
          ))}

          <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.heading}>
            Co piješ
          </Text>
          {drinks.length === 0 ? (
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
              Zatím nic. Večer začíná prvním pivem.
            </Text>
          ) : (
            drinks.map((drink, index) => (
              <View key={`${drink.name}-${index}`} style={styles.drinkRow}>
                <View style={styles.grow}>
                  <Text
                    style={styles.drinkName}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {drink.name}
                  </Text>
                  <Text style={styles.drinkCount} maxFontSizeMultiplier={FontScaleCap.body}>
                    {drink.count}×
                  </Text>
                </View>
                <Pressable
                  onPress={() => bump(index)}
                  style={({ pressed }) => [styles.plus, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={`Ještě jedno ${drink.name}`}
                >
                  <PlusIcon size={20} color={Colors.stout} />
                </Pressable>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* One CTA, under the thumb. Naming a drink happens here, once. */}
      <View style={[styles.ctaBar, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>
        <Pressable
          onPress={addDrink}
          style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
          accessibilityRole="button"
          accessibilityLabel="Přidat pivo"
        >
          <PlusIcon size={20} color={Colors.stout} />
          <Text style={styles.ctaText} maxFontSizeMultiplier={FontScaleCap.heading}>
            Přidej pivo
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MockColors.bg },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },
  body: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.lg },

  // — Floating chrome over the map strip —
  topBar: {
    position: 'absolute',
    top: 0,
    left: MockLayout.screenPad,
    right: MockLayout.screenPad,
    flexDirection: 'row',
    alignItems: 'center',
  },
  pubPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha('#000000', 0.6),
  },
  pubDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.amber },
  pubName: { ...MockType.bodySemibold, color: Colors.foam, maxWidth: 190 },
  minimise: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha('#000000', 0.6),
  },

  // — Doors —
  doors: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.lg },
  door: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    height: MockLayout.pillHeight,
    borderRadius: Radius.pill,
    backgroundColor: MockColors.surfaceHigh,
  },
  doorText: { ...MockType.bodySmall, fontWeight: '600', color: Colors.foam },

  section: {
    ...MockType.titleS,
    color: Colors.foam,
    marginTop: MockLayout.sectionGap,
    marginBottom: Spacing.sm,
  },

  // — Roster —
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 13, fontWeight: '700', color: Colors.foam },
  personName: { flex: 1, ...MockType.bodySemibold, color: Colors.foam },
  personCount: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  // — Drinks —
  empty: { ...MockType.bodySmall, color: Colors.mutedText },
  drinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  drinkName: { ...MockType.bodySemibold, color: Colors.foam },
  drinkCount: { ...MockType.bodySmall, color: Colors.mutedText, marginTop: 1 },
  plus: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },

  // — CTA —
  ctaBar: {
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
    backgroundColor: MockColors.bg,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  ctaPressed: { opacity: 0.9, transform: [{ scale: 0.985 }] },
  ctaText: { ...MockType.buttonLabel, color: Colors.stout },
});
