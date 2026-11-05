import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';

import { fetchMyStats, type RemoteStats } from '@/data/statsClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { useNowTick } from '@/friends/useNowTick';
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore } from '@/stores/tallyStore';
import { formatPrice } from '@/utils/currency';

import { BottomFade, useTabBarSpace } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { D, T, IconButton, Press } from '../../components/ui';
import { NO_VALUE } from '../../format';
import { useHidePubNames } from '../../hiddenPubNames';
import { C, SCREEN_X, s, shadow } from '../../theme';
import {
  beerTally,
  dateOfDay,
  dayKeyOf,
  dayString,
  distinctPubs,
  nightsBetween,
  nightsOf,
  nightToFix,
  pad2,
  sumBeers,
  sumSpent,
  type Night,
} from './eveningData';
import { VerdictMark } from './PubVerdict';
import { nightDayLabel } from './stamgastFormat';

type Period = 'tyden' | 'mesic' | 'rok';

function PubLineWithMarks({ night }: { night: Night }) {
  const hidden = useHidePubNames();
  const secret = hidden ? new Set(night.pubs.filter((p) => !p.pubKey.startsWith('ctx:')).map((p) => p.pubKey)).size : 0;
  if (secret > 0) {
    return (
      <View style={[s.row, { gap: 5 }]}>
        <Icon name="eye-off" size={13} color={C.yellow} />
        <T s={13} w={700} c={C.muted} numberOfLines={1}>
          {t.nv.common.secretPubs(secret)}
        </T>
      </View>
    );
  }
  return (
    <View style={[s.row, { gap: 4, overflow: 'hidden' }]}>
      {night.pubs.map((pub, i) => (
        <React.Fragment key={`${pub.pubKey}-${i}`}>
          {i > 0 ? (
            <T s={13} w={700} c={C.muted}>
              {t.nv.stamgast.pubSep.trim()}
            </T>
          ) : null}
          <T s={13} w={700} c={C.muted} numberOfLines={1} style={{ flexShrink: i === night.pubs.length - 1 ? 1 : 0 }}>
            {pub.name}
          </T>
          <VerdictMark pubKey={pub.pubKey} />
        </React.Fragment>
      ))}
    </View>
  );
}

function heroMeta(nights: readonly Night[], spentLabel: string) {
  const copy = t.nv.stamgast;
  return [copy.evenings(nights.length), copy.pubs(distinctPubs(nights)), spentLabel].join(copy.metaSep);
}

function topPub(nights: readonly Night[]): { name: string; times: number } | null {
  const counts = new Map<string, { name: string; times: number }>();
  for (const night of nights) {
    for (const pub of night.pubs) {
      if (pub.pubKey.startsWith('ctx:')) continue;
      const entry = counts.get(pub.pubKey) ?? { name: pub.name, times: 0 };
      entry.times += 1;
      counts.set(pub.pubKey, entry);
    }
  }
  return [...counts.values()].sort((a, b) => b.times - a.times)[0] ?? null;
}

function PeriodSwitch({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
  const copy = t.nv.stamgast;
  const opts = [
    ['tyden', copy.week],
    ['mesic', copy.month],
    ['rok', copy.year],
  ] as const;
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={[s.row, { height: 32, borderRadius: 16, padding: 3, backgroundColor: C.tintSoft, borderWidth: 1, borderColor: C.line }]}>
        {opts.map(([k, label]) => {
          const on = value === k;
          return (
            <Press key={k} haptic onPress={() => onChange(k)} style={[{ height: 26, borderRadius: 13, paddingHorizontal: 16 }, s.center, on && { backgroundColor: C.white, ...shadow.soft }]}>
              <T s={13} w={on ? 800 : 600} c={on ? C.black : C.text2}>
                {label}
              </T>
            </Press>
          );
        })}
      </View>
    </View>
  );
}

function Hero({ count, label, meta }: { count: number; label: string; meta: string }) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <D testID="diary-hero-count" s={88} lh={1} c={C.yellow} style={{ letterSpacing: -2 }}>
        {String(count)}
      </D>
      <T s={17} w={600} c={C.text2}>
        {label}
      </T>
      <T testID="diary-hero-meta" s={14} c={C.dim}>
        {meta}
      </T>
    </View>
  );
}

function CardHead({ title, onPrev, onNext, nextDisabled, prevLabel, nextLabel }: { title: string; onPrev?: () => void; onNext?: () => void; nextDisabled?: boolean; prevLabel?: string; nextLabel?: string }) {
  const router = useRouter();
  const copy = t.nv.stamgast;
  return (
    <View style={[s.row, { justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 4 }]}>
      <View style={[s.row, { gap: 6 }]}>
        <IconButton icon="chevron-left" size={32} iconSize={16} onPress={onPrev} label={prevLabel ?? copy.prev} />
        <T s={15} w={700} style={{ minWidth: 71, textAlign: 'center' }}>
          {title}
        </T>
        <IconButton icon="chevron-right" size={32} iconSize={16} onPress={nextDisabled ? undefined : onNext} label={nextLabel ?? copy.next} color={nextDisabled ? C.muted : C.white} />
      </View>
      <Press
        haptic
        onPress={() => {
          trackUiInteraction('diary_historical_open');
          router.push('/nv/dopsat');
        }}
        style={[s.row, { height: 32, borderRadius: 16, paddingHorizontal: 12, gap: 5, backgroundColor: C.control }]}>
        <Icon name="plus" size={14} color={C.yellow} />
        <T s={13} w={700}>
          {copy.quickBackfill}
        </T>
      </Press>
    </View>
  );
}

function Record({ value, label }: { value: string; label: string }) {
  return (
    <View style={{ flex: 1, padding: 14, gap: 3, borderRadius: 18, backgroundColor: C.card }}>
      <D s={22} lh={1.15}>
        {value}
      </D>
      <T s={12} w={500} c={C.muted} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>
        {label}
      </T>
    </View>
  );
}

function NightsCard({ nights, today }: { nights: readonly Night[]; today: string }) {
  const router = useRouter();
  if (!nights.length) return null;
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 24, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 8 }}>
      <T s={16} w={700}>
        {t.nv.stamgast.nights}
      </T>
      {nights.map((night) => (
        <Press
          key={night.day}
          testID="diary-night"
          onPress={() => {
            trackUiInteraction('diary_evening_open');
            router.push({ pathname: '/nv/vecer/[id]', params: { id: night.day } });
          }}
          style={[s.row, { height: 60, gap: 12 }]}>
          <View style={[s.fill, { gap: 2 }]}>
            <T s={15} w={600}>
              {night.day === today ? t.nv.stamgast.today : nightDayLabel(night.day)}
            </T>
            <PubLineWithMarks night={night} />
          </View>
          <D s={22}>{t.nv.stamgast.recordBeers(night.beers)}</D>
        </Press>
      ))}
    </View>
  );
}

/** Drinks the server refused live only on the phone until they are fixed or removed. */
function RejectedNudge({ nights }: { nights: readonly Night[] }) {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const toFix = nightToFix(nights);
  if (!toFix) return null;
  return (
    <Press
      testID="diary-rejected"
      accessibilityRole="button"
      onPress={() => {
        trackUiInteraction('diary_evening_open');
        router.push({ pathname: '/nv/vecer/[id]', params: { id: toFix.night.day } });
      }}
      style={[s.row, { minHeight: 52, borderRadius: 18, paddingHorizontal: 14, gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.hairline }]}
    >
      <Icon name="circle-alert" size={18} color={C.yellow} />
      <T s={15} w={700} style={s.fill}>
        {copy.rejectedCount(toFix.count)}
      </T>
      <T s={14} w={700} c={C.text2}>
        {copy.rejectedShow}
      </T>
      <Icon name="chevron-right" size={16} color={C.muted} />
    </Press>
  );
}

export function DiaryView({ onToday }: { onToday?: () => void }) {
  const tabSpace = useTabBarSpace();
  const [period, setPeriod] = useState<Period>('mesic');
  const current = useTallyStore((st) => st.current);
  const history = useTallyStore((st) => st.history);
  const nights = useMemo(() => nightsOf(current ? [current, ...history] : history), [current, history]);
  const now = useNowTick();
  const today = dayKeyOf(new Date(now));

  return (
    <View style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SCREEN_X, paddingTop: 18, gap: 18, paddingBottom: tabSpace + 40 }}>
        <RejectedNudge nights={nights} />
        <PeriodSwitch value={period} onChange={setPeriod} />
        {period === 'mesic' ? (
          <Month nights={nights} today={today} onToday={onToday} />
        ) : period === 'tyden' ? (
          <Week nights={nights} today={today} />
        ) : (
          <Year nights={nights} today={today} />
        )}
      </ScrollView>
      <BottomFade height={tabSpace + 60} tabBar />
    </View>
  );
}

function useMoney() {
  const currency = useSettingsStore((st) => st.priceCurrency);
  return (czk: number) => formatPrice(czk, currency);
}

function Month({ nights, today, onToday }: { nights: Night[]; today: string; onToday?: () => void }) {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const money = useMoney();
  const [offset, setOffset] = useState(0);
  const base = dateOfDay(today);
  const anchor = new Date(base.getFullYear(), base.getMonth() + offset, 1, 12);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prefix = `${year}-${pad2(month + 1)}`;
  const inMonth = nightsBetween(nights, `${prefix}-01`, `${prefix}-31`);
  const byDay = new Map(inMonth.map((n) => [n.day, n]));
  const first = (anchor.getDay() + 6) % 7;
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const best = [...inMonth].sort((a, b) => b.beers - a.beers)[0];
  const pubTop = topPub(inMonth);
  const hidePubNames = useHidePubNames();
  const beerTop = beerTally(inMonth.flatMap((n) => n.sessions))[0];

  return (
    <>
      <Hero count={sumBeers(inMonth)} label={copy.heroMonth(sumBeers(inMonth), copy.monthsIn[month])} meta={heroMeta(inMonth, money(sumSpent(inMonth)))} />
      <Press
        haptic
        onPress={() => {
          trackUiInteraction('beer_stats_open');
          router.push('/nv/cisla');
        }}
        accessibilityRole="button"
        style={[s.row, { alignSelf: 'center', height: 40, borderRadius: 20, paddingHorizontal: 16, gap: 8, marginTop: -6, backgroundColor: C.control }]}
      >
        <Icon name="chart-column" size={16} color={C.yellow} />
        <T s={15} w={700}>
          {copy.statsEntry}
        </T>
        <Icon name="chevron-right" size={16} color={C.muted} />
      </Press>
      <View style={{ backgroundColor: C.card, borderRadius: 24, paddingTop: 16, paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
        <CardHead title={copy.monthTitle(copy.months[month], year)} onPrev={() => setOffset(offset - 1)} onNext={() => setOffset(offset + 1)} nextDisabled={offset >= 0} />
        <View style={[s.row, { gap: 4 }]}>
          {copy.weekdaysShort.map((d) => (
            <T key={d} s={11} w={600} c={C.muted} style={{ flex: 1, textAlign: 'center' }}>
              {d}
            </T>
          ))}
        </View>
        {weeks.map((w, wi) => (
          <View key={wi} style={[s.row, { gap: 4 }]}>
            {w.map((day, di) => {
              if (!day) return <View key={di} style={{ flex: 1, height: 42 }} />;
              const key = `${prefix}-${pad2(day)}`;
              const night = byDay.get(key);
              const isToday = key === today;
              const future = key > today;
              const n = night?.beers;
              return (
                <Press
                  key={di}
                  disabled={future}
                  onPress={() => {
                    if (night) {
                      trackUiInteraction('diary_evening_open');
                      router.push({ pathname: '/nv/vecer/[id]', params: { id: key } });
                    } else if (isToday) {
                      onToday?.();
                    } else {
                      trackUiInteraction('diary_historical_open');
                      router.push({ pathname: '/nv/dopsat', params: { day: key } });
                    }
                  }}
                  style={[{ flex: 1, height: 42 }, s.center]}
                >
                  {n ? (
                    <View style={[{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.yellow }, s.center, isToday && { borderWidth: 2.5, borderColor: C.white }]}>
                      <T s={14} w={700} c={C.black}>
                        {day}
                      </T>
                      <View style={[{ position: 'absolute', right: -6, top: -5, minWidth: 20, height: 20, paddingHorizontal: 3, borderRadius: 10, backgroundColor: C.black, borderWidth: 1.5, borderColor: C.yellow }, s.center]}>
                        <T s={11} w={800} c={C.yellow}>
                          {n}
                        </T>
                      </View>
                    </View>
                  ) : (
                    <T s={13} w={500} c={future ? C.lineBright : '#FFFFFF73'}>
                      {day}
                    </T>
                  )}
                </Press>
              );
            })}
          </View>
        ))}
        <T s={12} w={500} c={C.muted} style={{ paddingHorizontal: 4 }}>
          {copy.tapDay}
        </T>
      </View>
      {best ? (
        <View style={[s.row, { gap: 8 }]}>
          <Record value={copy.recordBeers(best.beers)} label={copy.recordMostNight} />
          {pubTop ? <Record value={copy.recordTimes(pubTop.times)} label={hidePubNames ? t.nv.common.secretPub : pubTop.name} /> : null}
          {beerTop ? <Record value={copy.recordTimes(beerTop.count)} label={beerTop.name} /> : null}
        </View>
      ) : null}
      <NightsCard nights={inMonth.slice(0, 4)} today={today} />
    </>
  );
}

function Week({ nights, today }: { nights: Night[]; today: string }) {
  const copy = t.nv.stamgast;
  const money = useMoney();
  const [offset, setOffset] = useState(0);
  const base = dateOfDay(today);
  const monday = new Date(base.getFullYear(), base.getMonth(), base.getDate() - ((base.getDay() + 6) % 7) + offset * 7, 12);
  const days = Array.from({ length: 7 }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i, 12));
  const week = nightsBetween(nights, dayString(days[0]), dayString(days[6]));
  const counts = days.map((d) => week.find((n) => n.day === dayString(d))?.beers ?? 0);
  const max = Math.max(...counts, 1);
  return (
    <>
      <Hero count={sumBeers(week)} label={copy.heroWeek(sumBeers(week))} meta={heroMeta(week, money(sumSpent(week)))} />
      <View style={{ backgroundColor: C.card, borderRadius: 24, paddingTop: 16, paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
        <CardHead title={copy.weekTitle(days[0], days[6])} onPrev={() => setOffset(offset - 1)} onNext={() => setOffset(offset + 1)} nextDisabled={offset >= 0} />
        <View style={[s.row, { height: 160, alignItems: 'flex-end', gap: 14, paddingHorizontal: 6 }]}>
          {counts.map((n, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
              {n ? <D s={20}>{String(n)}</D> : null}
              <View style={{ width: '100%', height: n ? (n / max) * 116 : 6, borderRadius: n ? 8 : 3, backgroundColor: n ? C.yellow : C.control }} />
            </View>
          ))}
        </View>
        <View style={[s.row, { gap: 14, paddingHorizontal: 6 }]}>
          {days.map((d, i) => (
            <View key={i} style={{ flex: 1, alignItems: 'center' }}>
              <T s={11} w={600} c={C.muted}>
                {copy.weekdaysShort[i]}
              </T>
              <T s={14} w={700} c={counts[i] ? C.white : C.muted}>
                {d.getDate()}
              </T>
            </View>
          ))}
        </View>
      </View>
      <NightsCard nights={week} today={today} />
    </>
  );
}

function Year({ nights, today }: { nights: Night[]; today: string }) {
  const copy = t.nv.stamgast;
  const money = useMoney();
  const [offset, setOffset] = useState(0);
  const [remote, setRemote] = useState<RemoteStats | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetchMyStats(controller.signal).then((stats) => {
      if (!controller.signal.aborted && stats) setRemote(stats);
    });
    return () => controller.abort();
  }, []);

  const base = dateOfDay(today);
  const year = base.getFullYear() + offset;
  const currentMonth = offset === 0 ? base.getMonth() : offset < 0 ? 12 : -1;
  const inYear = nightsBetween(nights, `${year}-01-01`, `${year}-12-31`);
  // The phone keeps the last 50 evenings; the server's monthly totals fill in older ones.
  const counts = Array.from({ length: 12 }, (_, i) => {
    const local = sumBeers(nightsBetween(inYear, `${year}-${pad2(i + 1)}-01`, `${year}-${pad2(i + 1)}-31`));
    const server = remote?.periods.months.find((m) => m.period === `${year}-${pad2(i + 1)}`)?.beers ?? 0;
    return Math.max(local, server);
  });
  const total = counts.reduce((a, b) => a + b, 0);
  const serverYear = remote?.periods.years.find((y) => y.period === String(year));
  const evenings = Math.max(inYear.length, serverYear?.evenings ?? 0);
  const spent = Math.max(sumSpent(inYear), serverYear?.spentCzk ?? 0);
  const best = counts.reduce((bi, n, i) => (n > counts[bi] ? i : bi), 0);
  const pubTop = topPub(inYear);
  const hidePubNames = useHidePubNames();
  const earlier = new Set(nights.filter((n) => n.day < `${year}-01-01`).flatMap((n) => n.pubs.map((p) => p.pubKey)));
  const newPubs = new Set(inYear.flatMap((n) => n.pubs.filter((p) => !p.pubKey.startsWith('ctx:') && !earlier.has(p.pubKey)).map((p) => p.pubKey))).size;

  return (
    <>
      <Hero count={total} label={copy.heroYear(total, year)} meta={[copy.evenings(evenings), copy.pubs(distinctPubs(inYear)), money(spent)].join(copy.metaSep)} />
      <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 14, gap: 12 }}>
        <CardHead title={String(year)} onPrev={() => setOffset(offset - 1)} onNext={() => setOffset(offset + 1)} nextDisabled={offset >= 0} prevLabel={copy.prevYear} nextLabel={copy.nextYear} />
        {[0, 1, 2].map((row) => (
          <View key={row} style={[s.row, { gap: 8 }]}>
            {copy.months.slice(row * 4, row * 4 + 4).map((m, i) => {
              const idx = row * 4 + i;
              const n = counts[idx];
              const current = idx === currentMonth;
              const future = idx > currentMonth;
              return (
                <View
                  key={m}
                  style={{
                    flex: 1,
                    height: 64,
                    borderRadius: 16,
                    padding: 12,
                    justifyContent: 'space-between',
                    backgroundColor: future ? '#FFFFFF08' : C.control,
                    borderWidth: current ? 1.5 : 0,
                    borderColor: C.yellowStrong,
                  }}
                >
                  <T s={12} w={600} c={future ? C.lineBright : current ? C.yellow : C.white} numberOfLines={1}>
                    {m}
                  </T>
                  <D s={22} c={future ? C.lineBright : current ? C.yellow : C.white}>
                    {future ? NO_VALUE : String(n)}
                  </D>
                </View>
              );
            })}
          </View>
        ))}
      </View>
      {total ? (
        <View style={[s.row, { gap: 8 }]}>
          <Record value={copy.recordBeers(counts[best])} label={copy.recordMostIn(copy.monthsIn[best])} />
          {pubTop ? <Record value={copy.recordTimes(pubTop.times)} label={hidePubNames ? t.nv.common.secretPub : pubTop.name} /> : null}
          <Record value={String(newPubs)} label={copy.recordNewPubs} />
        </View>
      ) : null}
    </>
  );
}
