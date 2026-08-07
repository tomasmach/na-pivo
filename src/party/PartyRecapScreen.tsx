/** Finished shared evening, derived only from NightRecord. */

import React from 'react';
import { ActivityIndicator, Image, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SymbolView } from 'expo-symbols';

import { GlassIconButton } from '@/components/shared/GlassIconButton';
import { Share2Icon } from '@/components/shared/IconGlyph';
import { PersonAvatar } from '@/components/shared/PersonAvatar';
import { decodeGeohash8 } from '@/data/geohash';
import { fetchMyStats, type RemoteNightRecords } from '@/data/statsClient';
import { NightChart, type ChartShape } from '@/mocks/NightChart';
import { NightRoute } from '@/mocks/NightRoute';
import { SectionBreak } from '@/mocks/SectionBreak';
import { StatGrid } from '@/mocks/StatGrid';
import { MenuChip } from '@/mocks/MenuChip';
import {
  nightBrokenRecords,
  nightByBeer,
  nightHourly,
  nightMe,
  nightMinutes,
  nightMvp,
  nightStandings,
  nightStops,
  nightTally,
} from '@/party/nightRecord';
import { mergeConfirmedNightBest, personalNightRecord } from '@/party/personalNightRecord';
import {
  hasRenderableNightRecord,
  useNightRecord,
  type NightRecordRecoveryState,
} from '@/party/useNightRecord';
import { nightBestFrom } from '@/party/nightBuilder';
import { drinkingDayKey, useTallyStore } from '@/stores/tallyStore';
import { useAccountStore } from '@/stores/accountStore';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const CHARTS = ['V čase', 'Podle piva', 'U stolu'] as const;
const SECTION_GAP = 32;

function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function clockAt(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const RECORD_TITLE = {
  beers: 'Nejvíc piv za večer',
  minutes: 'Nejdelší večer',
  stops: 'Nejvíc štací',
} as const;

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
  const history = useTallyStore((state) => state.history);
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const [chart, setChart] = React.useState<(typeof CHARTS)[number]>('V čase');
  const [shape, setShape] = React.useState<ChartShape>('bar');
  const [openedAt] = React.useState(() => Date.now());

  const now = night.endedAt ? new Date(night.endedAt).getTime() : openedAt;
  const minutes = nightMinutes(night, now);
  const tally = nightTally(night);
  const standings = nightStandings(night);
  const mvp = nightMvp(standings);
  const stops = nightStops(night, now);
  const hourly = nightHourly(night);
  const byBeer = nightByBeer(night);
  const games = night.games.filter((game) => game.result);
  const personalNight = personalNightRecord(night, nightMe(night)?.id);
  const personalDay = personalNight ? drinkingDayKey(new Date(personalNight.startedAt)) : undefined;
  const localBest = nightBestFrom(history, personalDay);
  const [remoteBest, setRemoteBest] = React.useState<{
    accountId: string;
    day: string;
    value: RemoteNightRecords;
  } | null>(null);
  React.useEffect(() => {
    if (!accountId || !personalDay) return undefined;
    const controller = new AbortController();
    void fetchMyStats(controller.signal, personalDay).then((stats) => {
      if (controller.signal.aborted || !stats?.nightRecords) return;
      setRemoteBest({ accountId, day: personalDay, value: stats.nightRecords });
    });
    return () => controller.abort();
  }, [accountId, personalDay]);
  const confirmedBest =
    remoteBest?.accountId === accountId && remoteBest.day === personalDay
      ? mergeConfirmedNightBest(localBest, remoteBest.value)
      : null;
  // A device keeps only a bounded local history and an account may have older
  // nights from another phone. Stay silent until the server has excluded this
  // drinking day and confirmed what there really was to beat.
  const records =
    personalNight && confirmedBest
      ? nightBrokenRecords(
          personalNight,
          confirmedBest,
          personalNight.endedAt ? new Date(personalNight.endedAt).getTime() : openedAt,
        )
      : [];
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
            <Text style={styles.recoveryText}>Tahám poslední večer…</Text>
          </>
        ) : (
          <Text style={styles.recoveryText}>
            {recoveryState === 'empty'
              ? 'Žádný dokončený večer.'
              : 'Rekapitulaci teď nenačtu.'}
          </Text>
        )}
      </View>
    );
  }

  const chartRows =
    chart === 'V čase'
      ? hourly.map((slot) => ({ label: `${slot.hour}:00`, value: slot.beers }))
      : chart === 'Podle piva'
        ? byBeer.map((row) => ({ label: row.beer, value: row.count }))
        : standings.map((person) => ({
            label: person.name,
            value: person.beers,
          }));

  const share = () => {
    const pubs = stops.map((stop) => stop.pubName).join(' → ');
    void Share.share({
      message: `${title}: ${tally.beers} piv, ${formatElapsed(minutes)}${pubs ? `, ${pubs}` : ''}.`,
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
            <Text style={styles.peopleNames} numberOfLines={1}>
              {night.people.map((person) => person.name).join(', ')}
            </Text>
          </View>
        ) : null}

        <Text style={styles.date}>{dateLabel}</Text>
        <Text style={styles.title}>{title}</Text>
        {route ? <Text style={styles.route}>{route}</Text> : null}

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

        {standings.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Kdo tam byl</SectionTitle>
            <View style={styles.peopleList}>
              {standings.map((person, index) => (
                <View key={person.id} style={styles.personRow}>
                  <Text style={styles.rank} allowFontScaling={false}>
                    {index + 1}
                  </Text>
                  <PersonAvatar
                    name={person.name}
                    tint={person.tint}
                    avatarUrl={person.avatarUrl}
                    size={38}
                  />
                  <Text style={styles.personName} numberOfLines={1}>
                    {person.name}
                  </Text>
                  {mvp?.id === person.id ? <Text style={styles.mvp}>MVP</Text> : null}
                  <Text style={styles.personScore}>{person.beers} piv</Text>
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
                <Text style={styles.stopTime}>{clockAt(stop.arrivedAt)}</Text>
                <Text style={styles.stopName} numberOfLines={1}>
                  {stop.pubName}
                </Text>
                <Text style={styles.stopBeers}>{stop.beers} piv</Text>
              </View>
            ))}
          </View>
        ) : null}

        {chartRows.length > 0 ? (
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
                  onChange={(value) => setChart(value as (typeof CHARTS)[number])}
                />
              }
            />
          </View>
        ) : null}

        {games.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Hry</SectionTitle>
            {games.map((game) => (
              <View key={`${game.key}:${game.startedAt}`} style={styles.game}>
                <Text style={styles.gameName}>{game.name}</Text>
                <Text style={styles.gameResult}>
                  {game.result?.paying
                    ? `Platí ${game.result.paying}`
                    : game.result?.winner
                      ? `Vyhrál ${game.result.winner}`
                      : 'Odehráno'}
                </Text>
                {game.result?.scores.map((score, index) => (
                  <View key={`${score.name}:${index}`} style={styles.scoreRow}>
                    <Text style={styles.scoreName}>{score.name}</Text>
                    <Text style={styles.scoreValue}>{score.score}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        ) : null}

        {records.length > 0 ? (
          <View style={styles.section}>
            <SectionTitle>Osobní rekordy</SectionTitle>
            {records.map((record) => (
              <View key={record.kind} style={styles.record}>
                <Text style={styles.recordTitle}>{RECORD_TITLE[record.kind]}</Text>
                <Text style={styles.recordValue}>
                  {record.kind === 'minutes' ? formatElapsed(record.value) : record.value}
                </Text>
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
  rank: {
    width: 18,
    fontFamily: Fonts.numeral,
    fontSize: 15,
    color: Colors.mutedText,
  },
  personName: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.foam },
  mvp: { fontSize: 11, fontWeight: '800', color: Colors.amber },
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
  record: { flexDirection: 'row', alignItems: 'center', minHeight: 48 },
  recordTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.foam },
  recordValue: { fontFamily: Fonts.numeral, fontSize: 18, color: Colors.amber },
});
