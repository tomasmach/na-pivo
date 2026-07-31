/**
 * DESIGN MOCK — starting and running a party. Strava's Record screen, in a pub.
 *
 * The reference (`docs/references/IMG_2127.PNG`) is: a full-bleed map, a sheet
 * over it carrying three stats, and one big circular primary flanked by two
 * secondary circles. This is the same object with the pub map as the bleed, the
 * beer tally as the stats, and "+1 pivo" as the circle.
 *
 * Two states in one screen:
 *   idle     no party yet — the circle says "Začni" and the stats are zeroes
 *   live     running — the circle is "+1 pivo", the tally is real, people show
 *
 * The state flips locally so the shape of both can be judged; nothing is wired.
 *
 * The pub picker is at the TOP, as asked: you are somewhere before you drink
 * anything, and changing pub mid-night is one tap on the same control.
 *
 * Inviting friends and the games door sit on the secondary circles either side
 * of the primary — they are the two things you reach for during a night, and
 * everything else can live behind "…".
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import {
  BeerIcon,
  CameraIcon,
  ChevronDownIcon,
  SoccerBallIcon,
  TrophyIcon,
  UserPlusIcon,
} from '@/components/shared/IconGlyph';
import { GamesSheet } from '@/party/GamesSheet';
import { NightRoute } from '@/mocks/NightRoute';
import { StatGrid } from '@/mocks/StatGrid';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { MockColors } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const PEOPLE = [
  { name: 'Ty', beers: 3, tint: '#E8A317' },
  { name: 'Honza', beers: 4, tint: '#7DD66B' },
  { name: 'Petr', beers: 2, tint: '#F0BE5C' },
];

const STOPS = [{ name: 'U Fleků', lat: 50.0785, lng: 14.42 }];

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
  const photos = useLivePartyStore((s) => s.photos);
  const games = useLivePartyStore((s) => s.games);
  const startParty = useLivePartyStore((s) => s.start);
  const addBeer = useLivePartyStore((s) => s.addBeer);
  const addPhoto = useLivePartyStore((s) => s.addPhoto);
  const playGame = useLivePartyStore((s) => s.playGame);
  const endParty = useLivePartyStore((s) => s.end);
  const [gamesOpen, setGamesOpen] = React.useState(false);

  const total = live ? beers + PEOPLE.reduce((s, p) => s + p.beers, 0) - PEOPLE[0].beers : 0;

  return (
    <View style={styles.screen}>
      {/* The real map, full bleed — Strava's Record screen with the pub in it. */}
      <View style={styles.map}>
        <NightRoute stops={STOPS} live={live} height={520} />
      </View>

      {/* The pub picker rides on top of the map, like Strava's floating pills. */}
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          style={({ pressed }) => [styles.pubPicker, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Změnit hospodu"
        >
          <View style={styles.pubDot} />
          <Text style={styles.pubName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            U Fleků
          </Text>
          <ChevronDownIcon size={16} color={Colors.foam} />
        </Pressable>
        <View style={styles.grow} />
        {/* Dismisses the modal the way it arrived: down. "Ukončit večer" is a
            named action and belongs in the sheet — this only puts the night
            away, it does not end it. */}
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.topIcon, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Minimalizovat večer"
        >
          <ChevronDownIcon size={20} color={Colors.foam} />
        </Pressable>
      </View>

      {/* The sheet. Everything you touch during a night lives here. */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + Spacing.md }]}>
        <View style={styles.grabber} />

        <ScrollView
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
        >
          <StatGrid
            stats={[
              { label: 'Tvoje piva', value: String(live ? beers : 0) },
              { label: 'U stolu', value: String(live ? total : 0) },
              { label: 'Večer', value: live ? '1h 12m' : '0m' },
            ]}
            columns={3}
          />

          {live ? (
            <View style={styles.people}>
              {PEOPLE.map((person) => (
                <View key={person.name} style={styles.personRow}>
                  <View
                    style={[
                      styles.avatar,
                      { backgroundColor: person.tint },
                    ]}
                  >
                    <Text style={styles.avatarText} allowFontScaling={false}>
                      {person.name.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                  <Text
                    style={styles.personName}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {person.name}
                  </Text>
                  <Text style={styles.personCount} allowFontScaling={false}>
                    {person.name === 'Ty' ? beers : person.beers}
                  </Text>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.idleHint} maxFontSizeMultiplier={FontScaleCap.body}>
              Večer začíná prvním pivem. Kamarády můžeš přizvat kdykoliv potom.
            </Text>
          )}

          {/* What the night has produced so far. This is the whole reason the
              party mode exists beyond a counter: the recap and the feed can
              only lead with a scoreboard or a photo strip if something here
              made one. */}
          {live ? (
            <View style={styles.outputs}>
              <Pressable
                onPress={addPhoto}
                style={({ pressed }) => [styles.output, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Vyfotit moment"
              >
                <CameraIcon size={17} color={Colors.amber} />
                <Text style={styles.outputText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {photos > 0 ? `${photos} fotek` : 'Vyfoť moment'}
                </Text>
              </Pressable>

              {games.length > 0 ? (
                <View style={styles.output}>
                  <TrophyIcon size={17} color={Colors.amber} />
                  <Text
                    style={styles.outputText}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {games[games.length - 1].game} — {games[games.length - 1].winner}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
          {/* Ending the night is a named action, spelled out, and it lives at
              the bottom of what you scroll — never next to "+1 pivo", where a
              mis-tap would close the evening you are still having. */}
          {live ? (
            <Pressable
              onPress={endParty}
              style={({ pressed }) => [styles.end, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Ukončit večer"
            >
              <Text style={styles.endText} maxFontSizeMultiplier={FontScaleCap.body}>
                Ukončit večer
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>

        {/* Primary in the middle, the two night-time doors either side. */}
        <View style={styles.controls}>
          <CircleButton label="Pozvat">
            <UserPlusIcon size={22} color={Colors.foam} />
          </CircleButton>

          <View style={styles.circleWrap}>
            <Pressable
              onPress={() => (live ? addBeer() : startParty('U Fleků'))}
              style={({ pressed }) => [styles.circlePrimary, pressed && styles.primaryPressed]}
              accessibilityRole="button"
              accessibilityLabel={live ? 'Přidat pivo' : 'Začít večer prvním pivem'}
            >
              <BeerIcon size={34} color={Colors.stout} />
            </Pressable>
            <Text style={styles.primaryLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {live ? '+1 pivo' : 'Začni'}
            </Text>
          </View>

          <CircleButton label="Hry" onPress={() => setGamesOpen(true)}>
            <SoccerBallIcon size={22} color={Colors.foam} />
          </CircleButton>
        </View>
      </View>

      <GamesSheet
        visible={gamesOpen}
        people={PEOPLE.map((p) => p.name)}
        onClose={() => setGamesOpen(false)}
        onPlayed={(result) => {
          playGame(result);
          setGamesOpen(false);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MockColors.bg },
  pressed: { opacity: 0.65 },
  grow: { flex: 1 },

  // — Map bleed —
  map: { position: 'absolute', top: 0, left: 0, right: 0 },
  mapGrid: { flex: 1, justifyContent: 'space-around', paddingTop: 80 },
  mapGridRow: { height: StyleSheet.hairlineWidth, backgroundColor: withAlpha(Colors.foam, 0.06) },
  mapPinWrap: { position: 'absolute', top: '26%', left: '46%', alignItems: 'center' },
  mapPin: { width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.amber },
  mapPulse: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    top: -15,
    borderWidth: 2,
    borderColor: withAlpha(Colors.amber, 0.35),
  },
  mapNote: {
    position: 'absolute',
    top: '34%',
    alignSelf: 'center',
    fontWeight: '400',
    fontSize: 12,
    color: withAlpha(Colors.foam, 0.28),
  },

  // — Floating top bar —
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  pubPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.stout, 0.92),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.12),
  },
  pubDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.amber },
  pubName: { fontWeight: '700', fontSize: 16, color: Colors.foam, maxWidth: 200 },
  topIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.92),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.12),
  },

  // — Sheet —
  sheet: {
    marginTop: 'auto',
    backgroundColor: MockColors.bg,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
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

  idleHint: {
    fontWeight: '400',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
    marginTop: Spacing.md,
  },

  end: {
    alignSelf: 'center',
    marginTop: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    height: 44,
    justifyContent: 'center',
  },
  endText: { fontSize: 15, fontWeight: '600', color: Colors.mutedText },

  // — Outputs —
  outputs: { marginTop: Spacing.lg, gap: Spacing.sm },
  output: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  outputText: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foam },

  // — People —
  people: { marginTop: Spacing.lg, gap: Spacing.sm },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  avatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontWeight: '700', fontSize: 13, color: Colors.stout },
  personName: { flex: 1, fontWeight: '500', fontSize: 15, color: Colors.foam },
  personCount: {
    fontWeight: '700',
    fontSize: 16,
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  // — Controls —
  controls: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  circleWrap: { alignItems: 'center', gap: 6, minWidth: 84 },
  circleSecondary: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
  },
  circleLabel: { fontWeight: '500', fontSize: 13, color: Colors.mutedText },
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
  primaryLabel: { fontWeight: '700', fontSize: 14, color: Colors.amber },

  // keep the sheet clear of the tab bar's own hit area
  spacer: { height: HitArea.min },
});
