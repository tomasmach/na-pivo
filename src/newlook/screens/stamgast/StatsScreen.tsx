import React, { useMemo, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { trackUiInteraction } from '@/data/uxTelemetry';
import { useNowTick } from '@/friends/useNowTick';
import { intlLocale, t } from '@/i18n';
import { useMyStatsState } from '@/stats/useMyStats';
import { useAccountStore } from '@/stores/accountStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { allSessionsNewestFirst, drinkingDayKey, useTallyStore } from '@/stores/tallyStore';
import { formatPrice } from '@/utils/currency';

import { BackHeader, Screen } from '../../components/chrome';
import { PageTitle } from '../../components/forms';
import { Icon, type IconName } from '../../components/Icon';
import { Button, Card, D, Press, Row, SectionTitle, Spinner, T, Tile } from '../../components/ui';
import { C, s } from '../../theme';
import { useHidePubNames } from '../../hiddenPubNames';
import { useCounterSegment } from './counterSegment';
import { dateOfDay } from './eveningData';
import { computeStats, type StatsView } from './statsData';
import { durationLabel, nightDayLabel } from './stamgastFormat';

const L = () => t.nv.stamgast;
const decimal = (n: number) => n.toLocaleString(intlLocale, { maximumFractionDigits: 1 });
const joined = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');
const minutes = (ms: number) => durationLabel(Math.round(ms / 60000));

export function StatsScreen() {
  const router = useRouter();
  const current = useTallyStore((st) => st.current);
  const history = useTallyStore((st) => st.history);
  const { stats: remote, settled } = useMyStatsState();
  const hasAccount = useAccountStore((st) => st.session?.accountId != null);
  const now = useNowTick();
  const stats = useMemo(
    () => computeStats(allSessionsNewestFirst(current, history), remote, new Date(now), drinkingDayKey),
    [current, history, now, remote],
  );

  // A new phone has no beers of its own yet; wait for the server before saying there is nothing to measure.
  if (stats.beers === 0 && hasAccount && (!settled || remote === null)) {
    return (
      <Screen header={<BackHeader />} scroll={false} contentStyle={{ flex: 1 }}>
        <PageTitle title={L().statsTitle} />
        <View style={[s.fill, s.center, { paddingHorizontal: 12, paddingBottom: 160 }]}>
          {settled ? (
            <T s={15} c={C.text2} lh={1.45} style={{ textAlign: 'center' }}>
              {L().statsLoadFailed}
            </T>
          ) : (
            <Spinner />
          )}
        </View>
      </Screen>
    );
  }

  if (stats.beers === 0) {
    return (
      <Screen header={<BackHeader />} scroll={false} contentStyle={{ flex: 1 }}>
        <PageTitle title={L().statsTitle} />
        <View style={[s.fill, s.center, { gap: 14, paddingHorizontal: 12, paddingBottom: 160 }]}>
          <View style={[{ width: 64, height: 64, borderRadius: 32, backgroundColor: C.control }, s.center]}>
            <Icon name="chart-column" size={28} color={C.yellow} />
          </View>
          <D s={32} style={{ textAlign: 'center' }}>
            {t.stats.emptyTitle}
          </D>
          <T s={15} c={C.text2} lh={1.45} style={{ textAlign: 'center' }}>
            {t.stats.emptyBody}
          </T>
          <Button
            label={L().statsStartCounting}
            icon="beer"
            height={48}
            style={{ alignSelf: 'center', paddingHorizontal: 24, marginTop: 6 }}
            onPress={() => {
              trackUiInteraction('beer_counter_segment', 'select');
              useCounterSegment.getState().open();
              router.back();
            }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen header={<BackHeader />} gap={18}>
      <PageTitle
        title={L().statsTitle}
        intro={stats.firstDay ? L().statsSince(dateOfDay(stats.firstDay).toLocaleDateString(intlLocale, { day: 'numeric', month: 'numeric', year: 'numeric' })) : undefined}
      />
      <Hero stats={stats} />
      <SectionTitle title={L().statsRecords} />
      <Records stats={stats} />
      <SectionTitle title={L().statsPace} />
      <Months months={stats.months} />
      {stats.years.length > 0 ? <Years years={stats.years} /> : null}
      <TopPubs stats={stats} />
    </Screen>
  );
}

function Hero({ stats }: { stats: StatsView }) {
  const currency = useSettingsStore((st) => st.priceCurrency);
  const cells = [
    { value: String(stats.beers), label: L().statsBeers(stats.beers) },
    { value: String(stats.nights), label: L().statsNights(stats.nights) },
    { value: String(stats.pubs), label: L().statsPubs(stats.pubs) },
    { value: formatPrice(stats.spentCzk, currency), label: L().statsSpent },
  ];
  return (
    <>
      <View style={[s.row, { gap: 14, alignItems: 'center' }]}>
        <D s={88} lh={1} c={C.yellow} style={{ letterSpacing: -2 }}>
          {decimal(stats.average)}
        </D>
        <View style={{ gap: 2 }}>
          <T s={18} w={700}>
            {L().statsAverageUnit(stats.average)}
          </T>
          <T s={14} c={C.muted}>
            {L().statsAverageSub}
          </T>
        </View>
      </View>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-start' }]}>
        {cells.map((cell) => (
          <View key={cell.label} style={{ gap: 2, flexShrink: 1 }}>
            <D s={26} lh={1.1}>
              {cell.value}
            </D>
            <T s={12} c={C.muted} numberOfLines={2}>
              {cell.label}
            </T>
          </View>
        ))}
      </View>
    </>
  );
}

function RecordRow({ icon, title, sub, value, last }: { icon: IconName; title: string; sub: string; value: string; last?: boolean }) {
  return (
    <Row
      last={last}
      height={72}
      leading={<Tile icon={icon} />}
      title={title}
      sub={sub || undefined}
      trailing={<D s={24}>{value}</D>}
    />
  );
}

function Records({ stats }: { stats: StatsView }) {
  const { mostBeers, fastest, longest } = stats;
  const hideNames = useHidePubNames();
  const rows = [
    mostBeers && {
      icon: 'trophy' as const,
      title: L().statsMostBeers,
      sub: joined(
        mostBeers.pubNames.length === 1 ? (hideNames ? t.nv.common.secretPub : mostBeers.pubNames[0]) : mostBeers.pubNames.length > 1 ? L().statsStops(mostBeers.pubNames.length) : null,
        mostBeers.day ? nightDayLabel(mostBeers.day) : null,
      ),
      value: L().statsBeerCount(mostBeers.value),
    },
    fastest && {
      icon: 'zap' as const,
      title: L().statsFastest,
      sub: joined(fastest.beerName, fastest.day ? nightDayLabel(fastest.day) : null),
      value: minutes(fastest.value),
    },
    longest && {
      icon: 'hourglass' as const,
      title: L().statsLongest,
      sub: joined(longest.day ? nightDayLabel(longest.day) : null, longest.stops > 0 ? L().statsStops(longest.stops) : null),
      value: minutes(longest.value),
    },
  ].filter((row): row is NonNullable<typeof row> => !!row);
  return (
    <Card>
      {rows.map((row, i) => (
        <RecordRow key={row.title} {...row} last={i === rows.length - 1} />
      ))}
    </Card>
  );
}

function Months({ months }: { months: StatsView['months'] }) {
  const [picked, setPicked] = useState(months.length - 1);
  const selected = months[picked] ?? months[months.length - 1];
  const max = Math.max(1, ...months.map((m) => m.beers));
  const total = months.reduce((sum, m) => sum + m.beers, 0);
  const [year, month] = selected.period.split('-').map(Number);
  const average = selected.nights > 0 ? Math.round((selected.beers / selected.nights) * 10) / 10 : 0;
  return (
    <Card pad={16} style={{ paddingVertical: 16, gap: 14 }}>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <T s={15} w={700}>
          {L().statsLast12}
        </T>
        <T s={13} c={C.muted}>
          {L().statsBeerCount(total)}
        </T>
      </View>
      <View style={[s.row, { alignItems: 'flex-end', gap: 6 }]}>
        {months.map((m, i) => {
          const on = i === picked;
          return (
            <Press
              key={m.period}
              onPress={() => setPicked(i)}
              accessibilityRole="button"
              accessibilityLabel={`${L().months[Number(m.period.slice(5)) - 1]} ${m.period.slice(0, 4)}, ${L().statsBeerCount(m.beers)}`}
              style={{ flex: 1, alignItems: 'center', gap: 6 }}
            >
              <View style={{ height: 84, width: '100%', justifyContent: 'flex-end' }}>
                <View style={{ height: m.beers ? Math.max(8, (m.beers / max) * 84) : 4, borderRadius: 6, backgroundColor: on ? C.white : m.beers ? C.lineBright : C.control }} />
              </View>
              <T s={11} w={on ? 800 : 500} c={on ? C.white : C.muted}>
                {L().monthsShort[Number(m.period.slice(5)) - 1]}
              </T>
            </Press>
          );
        })}
      </View>
      <View style={[s.row, { borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 14, gap: 12 }]}>
        <View style={[s.fill, { gap: 3 }]}>
          <T s={16} w={700}>
            {L().monthTitle(L().months[month - 1], year)}
          </T>
          {selected.nights > 0 ? (
            <>
              <T s={13} c={C.muted}>
                {L().statsMonthAverage(average, decimal(average))}
              </T>
              <T s={13} c={C.muted}>
                {L().statsMonthNights(selected.nights)}
              </T>
            </>
          ) : null}
        </View>
        <D s={34} c={C.yellow}>
          {L().statsBeerCount(selected.beers)}
        </D>
      </View>
    </Card>
  );
}

function Years({ years }: { years: StatsView['years'] }) {
  const max = Math.max(1, ...years.map((y) => y.beers));
  return (
    <Card pad={16} style={{ paddingVertical: 16, gap: 14 }}>
      <T s={15} w={700}>
        {L().statsByYear}
      </T>
      {years.map((y, i) => (
        <View key={y.year} style={[s.row, { gap: 14 }]}>
          <T s={15} w={700} style={{ width: 40 }}>
            {y.year}
          </T>
          <View style={[s.fill, { height: 8, borderRadius: 4, backgroundColor: C.control, overflow: 'hidden' }]}>
            <View style={{ width: `${(y.beers / max) * 100}%`, height: 8, borderRadius: 4, backgroundColor: i === 0 ? C.yellow : C.muted }} />
          </View>
          <T s={14} c={C.text2} style={{ minWidth: 56, textAlign: 'right' }}>
            {L().statsBeerCount(y.beers)}
          </T>
        </View>
      ))}
    </Card>
  );
}

const TOP_PUBS_SHOWN = 4;

function PubRows({ pubs }: { pubs: StatsView['topPubs'] }) {
  const hideNames = useHidePubNames();
  const rankWidth = 8 + 14 * String(pubs.length).length;
  return (
    <Card>
      {pubs.map((pub, i) => (
        <Row
          key={pub.key}
          last={i === pubs.length - 1}
          leading={
            <D s={24} c={i === 0 ? C.yellow : C.muted} numberOfLines={1} style={{ width: rankWidth }}>
              {String(i + 1)}
            </D>
          }
          title={hideNames ? t.nv.common.secretPub : pub.name}
          sub={pub.nights != null ? L().evenings(pub.nights) : undefined}
          trailing={
            <T s={15} w={700}>
              {L().statsBeerCount(pub.beers)}
            </T>
          }
        />
      ))}
    </Card>
  );
}

function TopPubs({ stats }: { stats: StatsView }) {
  const router = useRouter();
  if (stats.topPubs.length === 0) return null;
  return (
    <>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 4, paddingTop: 4 }]}>
        <View style={{ gap: 2 }}>
          <T s={19} w={700}>
            {L().statsYourPubs}
          </T>
          <T s={14} c={C.muted}>
            {L().statsYourPubsSub}
          </T>
        </View>
        <Press onPress={() => router.push('/nv/cisla-hospody')} hitSlop={10} accessibilityRole="button">
          <T s={15} w={600} c={C.yellow}>
            {L().statsAllPubs(stats.pubs)}
          </T>
        </Press>
      </View>
      <PubRows pubs={stats.topPubs.slice(0, TOP_PUBS_SHOWN)} />
    </>
  );
}

/** Every pub from "Tvoje hospody", counted the same way as on the numbers screen. */
export function StatsPubsScreen() {
  const current = useTallyStore((st) => st.current);
  const history = useTallyStore((st) => st.history);
  const { stats: remote, settled } = useMyStatsState(true, true);
  const now = useNowTick();
  const stats = useMemo(
    () => computeStats(allSessionsNewestFirst(current, history), remote, new Date(now), drinkingDayKey),
    [current, history, now, remote],
  );
  return (
    <Screen header={<BackHeader />} gap={18}>
      <PageTitle title={L().statsYourPubs} intro={L().statsYourPubsSub} />
      {stats.topPubs.length > 0 ? <PubRows pubs={stats.topPubs} /> : settled ? null : <Spinner style={{ marginTop: 40 }} />}
    </Screen>
  );
}
