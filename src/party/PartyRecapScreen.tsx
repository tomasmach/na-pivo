/** Finished shared evening, derived only from NightRecord. */

import React from 'react';
import { ActivityIndicator, Image, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { GlassIconButton } from '@/components/shared/GlassIconButton';
import { beerCountLabel } from '@/i18n/plural';
import { Share2Icon } from '@/components/shared/IconGlyph';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
import { decodeGeohash8 } from '@/data/geohash';
import { NightChart, type ChartShape } from '@/mocks/NightChart';
import { NightRoute } from '@/mocks/NightRoute';
import { SectionBreak } from '@/mocks/SectionBreak';
import { StatGrid } from '@/mocks/StatGrid';
import {
  nightByBeer,
  nightMinutes,
  nightStandings,
  nightStops,
  nightTally,
} from '@/party/nightRecord';
import {
  hasRenderableNightRecord,
  useNightRecord,
  type NightRecordRecoveryState,
} from '@/party/useNightRecord';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const SECTION_GAP = 32;

function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  // Same cutoff as the hub's shared formatter: past ten hours the minutes are
  // noise, and the numeral still has to fit a quarter of the screen.
  if (hours >= 10) return `${hours}h`;
  return `${hours}h ${minutes % 60}m`;
}

function clockAt(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function SectionTitle({ children }: { children: string }) {
  return <SectionBreak title={children} inset={20} />;
}

export default function PartyRecapScreen() {
  const insets = useSafeAreaInsets();
  const [recoveryState, setRecoveryState] = React.useState<NightRecordRecoveryState>('loading');
  const night = useNightRecord({
    recoverLatestEnded: true,
    onRecoveryStateChange: setRecoveryState,
  });
  const [shape, setShape] = React.useState<ChartShape>('bar');
  const [openedAt] = React.useState(() => Date.now());

  const now = night.endedAt ? new Date(night.endedAt).getTime() : openedAt;
  const minutes = nightMinutes(night, now);
  const tally = nightTally(night);
  const standingsById = new Map(nightStandings(night).map((person) => [person.id, person]));
  const people = night.people.flatMap((person) => {
    const standing = standingsById.get(person.id);
    return standing ? [standing] : [];
  });
  const stops = nightStops(night, now);
  const byBeer = nightByBeer(night);
  const games = night.games.filter((game) => game.result);
  const route = stops.map((stop) => stop.pubName).join('  →  ');
  const title = stops[0]?.pubName ? `Večer v ${stops[0].pubName}` : 'Pivní večer';
  const dateLabel = new Intl.DateTimeFormat('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(night.startedAt));
  const routeStops = night.stops.flatMap((stop) => {
    if (stop.lat !== undefined && stop.lng !== undefined) {
      return [{ name: stop.pubName, lat: stop.lat, lng: stop.lng }];
    }
    if (stop.cacheKey && /^[0-9bcdefghjkmnpqrstuvwxyz]{8}$/i.test(stop.cacheKey)) {
      return [{ name: stop.pubName, ...decodeGeohash8(stop.cacheKey) }];
    }
    return [];
  });

  if (!hasRenderableNightRecord(night)) {
    return (
      <View
        style={[
          styles.screen,
          styles.recovery,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
        ]}
      >
        {recoveryState === 'loading' ? (
          <>
            <ActivityIndicator color={Colors.amber} />
            <Text style={styles.recoveryText} maxFontSizeMultiplier={FontScaleCap.body}>
              Tahám poslední večer…
            </Text>
          </>
        ) : (
          <Text style={styles.recoveryText} maxFontSizeMultiplier={FontScaleCap.body}>
            {recoveryState === 'empty'
              ? 'Žádný dokončený večer.'
              : 'Rekapitulaci teď nenačtu.'}
          </Text>
        )}
      </View>
    );
  }

  const share = () => {
    const pubs = stops.map((stop) => stop.pubName).join(' → ');
    void Share.share({
      message: `${title}: ${beerCountLabel(tally.beers)}, ${formatElapsed(minutes)}${pubs ? `, ${pubs}` : ''}.`,
    });
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.shareFloat, { top: insets.top + Spacing.sm }]}>
        <GlassIconButton size={40} accessibilityLabel="Sdílet večer" onPress={share}>
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
            paddingTop: insets.top + 52,
            paddingBottom: insets.bottom + SECTION_GAP,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {night.people.length > 0 ? (
          <View style={styles.byline}>
            <View style={styles.faces}>
              {night.people.slice(0, 5).map((person, index) => (
                <View key={person.id} style={index === 0 ? undefined : styles.faceOverlap}>
                  <PersonAvatar
                    name={person.name}
                    tint={person.tint}
                    avatarUrl={person.avatarUrl}
                    size={30}
                  />
                </View>
              ))}
            </View>
            <Text
              style={styles.peopleNames}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.body}
            >
              {night.people.map((person) => person.name).join(', ')}
            </Text>
          </View>
        ) : null}

        <Text style={styles.date} maxFontSizeMultiplier={FontScaleCap.body}>
          {dateLabel}
        </Text>
        <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
          {title}
        </Text>
        {route ? (
          <Text style={styles.route} maxFontSizeMultiplier={FontScaleCap.body}>
            {route}
          </Text>
        ) : null}

        {night.photos.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.photoStrip}
          >
            {night.photos.map((photo) => (
              <Image key={photo.id} source={{ uri: photo.url }} style={styles.photo} />
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.hero}>
          <StatGrid
            columns={3}
            hero
            stats={[
              { label: 'Piva', value: String(tally.beers) },
              { label: 'Večer', value: formatElapsed(minutes) },
              { label: 'Hospody', value: String(stops.length) },
            ]}
          />
        </View>

        {people.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Kdo tam byl</SectionTitle>
            <View style={styles.peopleList}>
              {people.map((person) => (
                <View key={person.id} style={styles.personRow}>
                  <PersonAvatar
                    name={person.name}
                    tint={person.tint}
                    avatarUrl={person.avatarUrl}
                    size={38}
                  />
                  <Text
                    style={styles.personName}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {person.name}
                  </Text>
                  <Text style={styles.personScore} maxFontSizeMultiplier={FontScaleCap.body}>
                    {beerCountLabel(person.beers)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        {stops.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Štace</SectionTitle>
            {routeStops.length > 0 ? (
              <View style={styles.map}>
                <NightRoute stops={routeStops} height={168} caption={false} />
              </View>
            ) : null}
            {stops.map((stop, index) => (
              <View key={stop.id} style={styles.stopRow}>
                <View style={styles.stopRail}>
                  <View style={styles.stopDot} />
                  {index < stops.length - 1 ? <View style={styles.stopLine} /> : null}
                </View>
                <Text style={styles.stopTime} maxFontSizeMultiplier={FontScaleCap.body}>
                  {clockAt(stop.arrivedAt)}
                </Text>
                <Text
                  style={styles.stopName}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {stop.pubName}
                </Text>
                <Text style={styles.stopBeers} maxFontSizeMultiplier={FontScaleCap.body}>
                  {beerCountLabel(stop.beers)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {byBeer.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Jak to šlo</SectionTitle>
            <NightChart
              rows={byBeer.map((row) => ({ label: row.beer, value: row.count }))}
              shape={shape}
              onShape={setShape}
            />
          </View>
        ) : null}

        {games.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Hry</SectionTitle>
            {games.map((game) => (
              <View key={`${game.key}:${game.startedAt}`} style={styles.game}>
                <Text style={styles.gameName} maxFontSizeMultiplier={FontScaleCap.body}>
                  {game.name}
                </Text>
                <Text style={styles.gameResult} maxFontSizeMultiplier={FontScaleCap.body}>
                  {game.result?.paying
                    ? `Platí ${game.result.paying}`
                    : game.result?.winner
                      ? `Vyhrál ${game.result.winner}`
                      : 'Odehráno'}
                </Text>
                {game.result?.scores.map((score, index) => (
                  <View key={`${score.name}:${index}`} style={styles.scoreRow}>
                    <Text style={styles.scoreName} maxFontSizeMultiplier={FontScaleCap.body}>
                      {score.name}
                    </Text>
                    <Text style={styles.scoreValue} allowFontScaling={false}>
                      {score.score}
                    </Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MockColors.bg },
  recovery: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
  },
  recoveryText: { fontSize: 16, fontWeight: '700', color: Colors.foam },
  content: { paddingHorizontal: MockLayout.screenPad },
  shareFloat: { position: 'absolute', right: Spacing.md, zIndex: 3 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  faces: { flexDirection: 'row' },
  faceOverlap: { marginLeft: -8 },
  peopleNames: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.mutedText,
  },
  date: { marginTop: Spacing.lg, fontSize: 14, color: Colors.mutedText },
  title: {
    marginTop: 4,
    fontSize: 32,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -0.7,
  },
  route: {
    marginTop: Spacing.xs,
    fontSize: 15,
    fontWeight: '600',
    color: Colors.amber,
  },
  photoStrip: { gap: Spacing.sm, paddingTop: Spacing.lg },
  photo: {
    width: 122,
    height: 122,
    borderRadius: 18,
    backgroundColor: Colors.stout3,
  },
  hero: { marginTop: Spacing.xl },
  section: { marginTop: SECTION_GAP },
  peopleList: { gap: 2 },
  personRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 56,
  },
  personName: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.foam },
  personScore: { fontFamily: Fonts.numeral, fontSize: 16, color: Colors.foam },
  map: {
    overflow: 'hidden',
    borderRadius: Radius.card,
    marginBottom: Spacing.md,
  },
  stopRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  stopRail: { width: 12, alignItems: 'center', alignSelf: 'stretch' },
  stopDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 7,
    backgroundColor: Colors.amber,
  },
  stopLine: {
    width: 1,
    flex: 1,
    backgroundColor: withAlpha(Colors.foam, 0.15),
  },
  stopTime: { width: 40, fontSize: 12, color: Colors.mutedText },
  stopName: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.foam },
  stopBeers: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  game: {
    padding: Spacing.md,
    borderRadius: Radius.card,
    backgroundColor: MockColors.surfaceHigh,
    marginBottom: Spacing.sm,
  },
  gameName: { ...MockType.bodySemibold, color: Colors.foam },
  gameResult: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: '700',
    color: Colors.amber,
  },
  scoreRow: { flexDirection: 'row', marginTop: Spacing.sm },
  scoreName: { flex: 1, fontSize: 14, color: Colors.foam },
  scoreValue: { fontFamily: Fonts.numeral, fontSize: 14, color: Colors.foam },
});
