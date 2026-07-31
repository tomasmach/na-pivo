/**
 * DESIGN MOCK — the pub, in detail.
 *
 * Strava's activity detail (`docs/references/IMG_2130.PNG`) is the model: a
 * full-bleed map at the top, a sheet-like body over it carrying the title, a
 * meta line, a row of circular actions, then stats in a two-column grid and
 * sections below. This is the same object with a pub in it.
 *
 * The section that only this app can have is "Co se tu dělo": your own history
 * with the place and the parties that happened here. It is the answer to the
 * question the list row deliberately does NOT answer — the row shows a heart to
 * say "you have been here", and the count and the nights live down here.
 *
 * Deliberately absent: how much you have spent here. The product does not do
 * accounting (`docs/decisions/no-bac-or-driving-estimates.md` is the same
 * instinct). The reference price of a beer is a property of the PUB and stays.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import {
  BeerIcon,
  MapPinIcon,
  StarIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import { StatGrid } from '@/mocks/StatGrid';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { NightRoute } from '@/mocks/NightRoute';
import { MOCK_PUBS } from '@/pubs/mockPubs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

/** What happened here. Real data comes from PartyEvening + PubVisit. */
const MOCK_NIGHTS = [
  { id: 'n1', title: 'Čtvrteční jízda', when: 've čtvrtek', people: 5, beers: 9 },
  { id: 'n2', title: 'Rychlovka po práci', when: '18. 7.', people: 2, beers: 4 },
  { id: 'n3', title: 'Po zápase', when: '2. 7.', people: 4, beers: 11 },
];

const MOCK_TAPS = [
  { name: 'Matuška Raptor', priceCzk: 69 },
  { name: 'Únětická 12°', priceCzk: 52 },
  { name: 'Pilsner Urquell', priceCzk: 59 },
];

function CircleAction({
  label,
  children,
  onPress,
}: {
  label: string;
  children: React.ReactNode;
  onPress?: () => void;
}) {
  return (
    <View style={styles.actionWrap}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.actionCircle, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        {children}
      </Pressable>
      <Text style={styles.actionLabel} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </View>
  );
}

export default function PubDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const pub = MOCK_PUBS.find((p) => p.id === id) ?? MOCK_PUBS[0];

  const visited = pub.lastParty !== null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Full-bleed map, the way the reference opens on a route. */}
        <NightRoute
          stops={[{ name: pub.name, lat: pub.lat, lng: pub.lng }]}
          height={260}
        />

        {/* No hand-rolled back button: the native header draws it on iOS 26's
            own glass capsule and morphs it. Ours would be a flat copy. */}
        <View style={styles.body}>
          <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
            {pub.name}
          </Text>

          <View style={styles.metaRow}>
            <StarIcon size={13} color={Colors.amber} />
            <Text style={styles.meta} allowFontScaling={false}>
              {pub.rating.toFixed(1)}
            </Text>
            <Text style={styles.metaDot} allowFontScaling={false}>
              ·
            </Text>
            <Text
              style={[styles.meta, { color: pub.open ? Colors.open : Colors.mutedText }]}
              allowFontScaling={false}
            >
              {pub.open ? `Otevřeno ${pub.hours}` : `Zavřeno, ${pub.hours}`}
            </Text>
            <Text style={styles.metaDot} allowFontScaling={false}>
              ·
            </Text>
            <Text style={styles.meta} allowFontScaling={false}>
              {pub.distance}
            </Text>
          </View>

          <Text style={styles.address} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {pub.address}
          </Text>

          {/* The two things you do from here, as circles beside each other. */}
          <View style={styles.actions}>
            <CircleAction label="Navigovat">
              <MapPinIcon size={20} color={Colors.foam} />
            </CircleAction>
            <CircleAction label="Začít tu večer">
              <BeerIcon size={20} color={Colors.stout} />
            </CircleAction>
          </View>

          {visited ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                Co se tu dělo
              </Text>
              <StatGrid
                columns={3}
                compact
                stats={[
                  { label: 'Byli jste tu', value: '3×' },
                  { label: 'Vypito', value: '24' },
                  { label: 'Naposled', value: 'čt' },
                ]}
              />
              {MOCK_NIGHTS.map((night) => (
                <Pressable
                  key={night.id}
                  style={({ pressed }) => [styles.nightRow, pressed && styles.pressed]}
                  accessibilityRole="button"
                  accessibilityLabel={night.title}
                >
                  <View style={styles.grow}>
                    <Text
                      style={styles.nightTitle}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {night.title}
                    </Text>
                    <Text style={styles.nightMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                      {night.when} · {night.beers} piv
                    </Text>
                  </View>
                  <View style={styles.nightPeople}>
                    <UsersIcon size={13} color={Colors.mutedText} />
                    <Text style={styles.nightMeta} allowFontScaling={false}>
                      {night.people}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              Na čepu
            </Text>
            {MOCK_TAPS.map((tap, index) => (
              <View key={tap.name} style={[styles.tapRow, index === 0 && styles.tapFirst]}>
                <Text
                  style={styles.tapName}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {tap.name}
                </Text>
                <Text style={styles.tapPrice} allowFontScaling={false}>
                  {tap.priceCzk} Kč
                </Text>
              </View>
            ))}
          </View>

          <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
            Design mock — data jsou napevno.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },
  body: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.md },

  back: { position: 'absolute', left: MockLayout.screenPad },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha('#000000', 0.6),
  },

  title: { fontSize: 30, fontWeight: '800', color: Colors.foam, letterSpacing: -0.6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  meta: { fontSize: 14, fontWeight: '600', color: Colors.foam },
  metaDot: { fontSize: 14, color: Colors.mutedText },
  address: { fontSize: 14, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },

  actions: { flexDirection: 'row', gap: Spacing.lg, marginTop: Spacing.lg },
  actionWrap: { alignItems: 'center', gap: 6 },
  actionCircle: {
    width: 52,
    height: 52,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
  },
  actionLabel: { fontSize: 13, fontWeight: '500', color: Colors.mutedText },

  section: { marginTop: MockLayout.sectionGap, gap: Spacing.sm },
  sectionTitle: { ...MockType.titleS, color: Colors.foam },

  nightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  nightTitle: { ...MockType.bodySemibold, color: Colors.foam },
  nightMeta: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },
  nightPeople: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  tapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  tapFirst: { borderTopWidth: 0 },
  tapName: { flex: 1, ...MockType.body, color: Colors.foam },
  tapPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  mockNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: MockLayout.sectionGap,
  },
});
