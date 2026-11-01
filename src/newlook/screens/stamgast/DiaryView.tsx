import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';

import { BottomFade, useTabBarSpace } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { D, IconButton, Press, T } from '../../components/ui';
import { TODAY, pubById, type Evening } from '../../mock/data';
import { thousands } from '../../mock/format';
import { useMock, useTonight } from '../../mock/store';
import { C, SCREEN_X, s, shadow } from '../../theme';

const MONTHS = ['Leden', 'Únor', 'Březen', 'Duben', 'Květen', 'Červen', 'Červenec', 'Srpen', 'Září', 'Říjen', 'Listopad', 'Prosinec'];
const MONTHS_IN = ['lednu', 'únoru', 'březnu', 'dubnu', 'květnu', 'červnu', 'červenci', 'srpnu', 'září', 'říjnu', 'listopadu', 'prosinci'];
const YEAR_COUNTS = [8, 6, 11, 9, 12, 14, 10, 7, 9, 22, 0, 0];
const WD = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'];

function pubLine(e: Evening) {
  return e.pubIds.map((id) => pubById(id)?.name).join(' → ');
}

function plural(n: number, one: string, few: string, many: string) {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}

function PeriodSwitch({ value, onChange }: { value: 'tyden' | 'mesic' | 'rok'; onChange: (v: 'tyden' | 'mesic' | 'rok') => void }) {
  const opts = [
    ['tyden', 'Týden'],
    ['mesic', 'Měsíc'],
    ['rok', 'Rok'],
  ] as const;
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={[s.row, { height: 32, borderRadius: 16, padding: 3, backgroundColor: '#FFFFFF12', borderWidth: 1, borderColor: '#FFFFFF1F' }]}>
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
      <D s={88} lh={1} c={C.yellow} style={{ letterSpacing: -2 }}>
        {String(count)}
      </D>
      <T s={17} w={600} c={C.text2}>
        {label}
      </T>
      <T s={14} c={C.dim}>
        {meta}
      </T>
    </View>
  );
}

function CardHead({ title, onPrev, onNext, nextDisabled }: { title: string; onPrev?: () => void; onNext?: () => void; nextDisabled?: boolean }) {
  const router = useRouter();
  return (
    <View style={[s.row, { justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 4 }]}>
      <View style={[s.row, { gap: 6 }]}>
        <IconButton icon="chevron-left" size={32} iconSize={16} onPress={onPrev} label="Předchozí" />
        <T s={15} w={700} style={{ minWidth: 71, textAlign: 'center' }}>
          {title}
        </T>
        <IconButton icon="chevron-right" size={32} iconSize={16} onPress={onNext} label="Další" color={nextDisabled ? C.muted : C.white} />
      </View>
      <Press haptic onPress={() => router.push('/nv/dopsat')} style={[s.row, { height: 32, borderRadius: 16, paddingHorizontal: 12, gap: 5, backgroundColor: C.control }]}>
        <Icon name="plus" size={14} color={C.yellow} />
        <T s={13} w={700}>
          Dopsat
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
      <T s={12} w={500} c={C.muted}>
        {label}
      </T>
    </View>
  );
}

function NightsCard({ evenings, today }: { evenings: Evening[]; today?: { count: number; pub: string } }) {
  const router = useRouter();
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 24, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 8 }}>
      <T s={16} w={700}>
        Večery
      </T>
      {today && today.count ? (
        <View style={[s.row, { height: 60, gap: 12 }]}>
          <View style={[s.fill, { gap: 2 }]}>
            <T s={15} w={600}>
              Dnes
            </T>
            <T s={13} w={700} c={C.muted}>
              {today.pub}
            </T>
          </View>
          <D s={22}>{String(today.count)}</D>
        </View>
      ) : null}
      {evenings.map((e) => (
        <Press key={e.id} onPress={() => router.push({ pathname: '/nv/vecer/[id]', params: { id: e.id } })} style={[s.row, { height: 60, gap: 12 }]}>
          <View style={[s.fill, { gap: 2 }]}>
            <T s={15} w={600}>
              {e.dayLabel}
            </T>
            <T s={13} w={700} c={C.muted}>
              {pubLine(e)}
            </T>
          </View>
          <D s={22}>{String(e.beers)}</D>
        </Press>
      ))}
    </View>
  );
}

export function DiaryView() {
  const tabSpace = useTabBarSpace();
  const [period, setPeriod] = useState<'tyden' | 'mesic' | 'rok'>('mesic');
  const evenings = useMock((st) => st.evenings);
  const { count: tonight, spent: tonightSpent } = useTonight();
  const pubId = useMock((st) => st.pubId);
  const todayPub = pubById(pubId)?.name ?? '';

  return (
    <View style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SCREEN_X, paddingTop: 18, gap: 18, paddingBottom: tabSpace + 40 }}>
        <PeriodSwitch value={period} onChange={setPeriod} />
        {period === 'mesic' ? (
          <Month evenings={evenings} tonight={tonight} tonightSpent={tonightSpent} todayPub={todayPub} />
        ) : period === 'tyden' ? (
          <Week evenings={evenings} />
        ) : (
          <Year evenings={evenings} tonight={tonight} />
        )}
      </ScrollView>
      <BottomFade height={tabSpace + 60} />
    </View>
  );
}

function Month({ evenings, tonight, tonightSpent, todayPub }: { evenings: Evening[]; tonight: number; tonightSpent: number; todayPub: string }) {
  const router = useRouter();
  const october = evenings.filter((e) => e.date.startsWith('2026-10'));
  const total = october.reduce((a, e) => a + e.beers, 0) + tonight;
  const spent = october.reduce((a, e) => a + e.spent, 0) + tonightSpent;
  const nights = october.length + (tonight ? 1 : 0);
  const pubs = new Set(october.flatMap((e) => e.pubIds)).size;
  const byDay = new Map(october.map((e) => [Number(e.date.slice(8)), e]));
  const first = 3; // 1. 10. 2026 is a Thursday.
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: 31 }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  return (
    <>
      <Hero count={total} label={`piv v ${MONTHS_IN[TODAY.m - 1]}`} meta={`${nights} ${plural(nights, 'večer', 'večery', 'večerů')}  ·  ${pubs} ${plural(pubs, 'hospoda', 'hospody', 'hospod')}  ·  ${thousands(spent)} Kč`} />
      <View style={{ backgroundColor: C.card, borderRadius: 24, paddingTop: 16, paddingHorizontal: 14, paddingBottom: 12, gap: 8 }}>
        <CardHead title="Říjen 2026" />
        <View style={[s.row, { gap: 4 }]}>
          {WD.map((d) => (
            <T key={d} s={11} w={600} c={C.muted} style={{ flex: 1, textAlign: 'center' }}>
              {d}
            </T>
          ))}
        </View>
        {weeks.map((w, wi) => (
          <View key={wi} style={[s.row, { gap: 4 }]}>
            {w.map((day, di) => {
              if (!day) return <View key={di} style={{ flex: 1, height: 42 }} />;
              const e = byDay.get(day);
              const isToday = day === TODAY.d;
              const n = isToday ? tonight : e?.beers;
              const future = day > TODAY.d;
              return (
                <Press
                  key={di}
                  disabled={future}
                  onPress={() =>
                    e
                      ? router.push({ pathname: '/nv/vecer/[id]', params: { id: e.id } })
                      : isToday
                        ? router.navigate('/nv/stamgast')
                        : router.push({ pathname: '/nv/dopsat', params: { day: String(day) } })
                  }
                  style={[{ flex: 1, height: 42 }, s.center]}
                >
                  {n ? (
                    <View style={[{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.yellow }, s.center, isToday && { borderWidth: 2.5, borderColor: C.white }]}>
                      <T s={14} w={700} c={C.black}>
                        {day}
                      </T>
                      <View style={[{ position: 'absolute', right: -6, top: -5, width: 20, height: 20, borderRadius: 10, backgroundColor: C.black, borderWidth: 1.5, borderColor: C.yellow }, s.center]}>
                        <T s={11} w={800} c={C.yellow}>
                          {n}
                        </T>
                      </View>
                    </View>
                  ) : (
                    <T s={13} w={500} c={future ? '#FFFFFF33' : '#FFFFFF73'}>
                      {day}
                    </T>
                  )}
                </Press>
              );
            })}
          </View>
        ))}
        <T s={12} w={500} c={C.muted} style={{ paddingHorizontal: 4 }}>
          Klepni na den a dopiš, co padlo.
        </T>
      </View>
      <View style={[s.row, { gap: 8 }]}>
        <Record value="6 piv" label="nejvíc za večer" />
        <Record value="3×" label="U Pinkasů" />
        <Record value="11×" label="Pilsner Urquell" />
      </View>
      <NightsCard evenings={october.slice(0, 4)} today={{ count: tonight, pub: todayPub }} />
    </>
  );
}

function Week({ evenings }: { evenings: Evening[] }) {
  const days = [19, 20, 21, 22, 23, 24, 25];
  const week = evenings.filter((e) => {
    const d = Number(e.date.slice(8));
    return e.date.startsWith('2026-10') && d >= 19 && d <= 25;
  });
  const counts = days.map((d) => week.find((e) => Number(e.date.slice(8)) === d)?.beers ?? 0);
  const max = Math.max(...counts, 1);
  const total = counts.reduce((a, b) => a + b, 0);
  const pubs = new Set(week.flatMap((e) => e.pubIds)).size + 1;
  return (
    <>
      <Hero count={total} label="piv za týden" meta={`${week.length} ${plural(week.length, 'večer', 'večery', 'večerů')}  ·  ${pubs} hospody  ·  ${week.reduce((a, e) => a + e.spent, 0) - 16} Kč`} />
      <View style={{ backgroundColor: C.card, borderRadius: 24, paddingTop: 16, paddingHorizontal: 14, paddingBottom: 14, gap: 8 }}>
        <CardHead title="19.–25. 10." />
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
            <View key={d} style={{ flex: 1, alignItems: 'center' }}>
              <T s={11} w={600} c={C.muted}>
                {WD[i]}
              </T>
              <T s={14} w={700} c={counts[i] ? C.white : C.muted}>
                {d}
              </T>
            </View>
          ))}
        </View>
      </View>
      <NightsCard evenings={week} />
    </>
  );
}

function Year({ evenings, tonight }: { evenings: Evening[]; tonight: number }) {
  const oct = evenings.filter((e) => e.date.startsWith('2026-10')).reduce((a, e) => a + e.beers, 0) + tonight;
  const counts = YEAR_COUNTS.map((n, i) => (i === 9 ? oct : n));
  const total = counts.reduce((a, b) => a + b, 0);
  return (
    <>
      <Hero count={total} label="piv v roce 2026" meta="41 večerů  ·  17 hospod  ·  6 820 Kč" />
      <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 14, gap: 12 }}>
        <View style={[s.row, { gap: 6 }]}>
          <IconButton icon="chevron-left" size={32} iconSize={16} label="Předchozí rok" />
          <T s={15} w={700}>
            2026
          </T>
          <IconButton icon="chevron-right" size={32} iconSize={16} color={C.muted} label="Další rok" />
        </View>
        {[0, 1, 2].map((row) => (
          <View key={row} style={[s.row, { gap: 8 }]}>
            {MONTHS.slice(row * 4, row * 4 + 4).map((m, i) => {
              const idx = row * 4 + i;
              const n = counts[idx];
              const current = idx === 9;
              const future = idx > 9;
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
                    borderColor: '#FFC40099',
                  }}
                >
                  <T s={12} w={600} c={future ? '#FFFFFF33' : current ? C.yellow : C.white}>
                    {m}
                  </T>
                  <D s={22} c={future ? '#FFFFFF33' : current ? C.yellow : C.white}>
                    {future ? '—' : String(n)}
                  </D>
                </View>
              );
            })}
          </View>
        ))}
      </View>
      <View style={[s.row, { gap: 8 }]}>
        <Record value={`${oct} piv`} label="nejvíc v říjnu" />
        <Record value="9×" label="U Pinkasů" />
        <Record value="17" label="nových hospod" />
      </View>
    </>
  );
}
