import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomFade, TabHeader, useTabBarSpace } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { Card, Chip, D, IconButton, Press, Row, Segmented, T, Tile } from '../../components/ui';
import { Input } from '../../components/forms';
import { BEERS, type Beer } from '../../mock/data';
import { thousands } from '../../mock/format';
import { useMock } from '../../mock/store';
import { C, SCREEN_X, s } from '../../theme';

const SHADES = [C.yellow, '#F7F7F2B3', '#F7F7F273', '#F7F7F242', '#F7F7F229'];

/** Share of 5★ down to 1★ votes, derived from the average for the mock. */
export function distribution(r: number): number[] {
  const t = Math.max(0, Math.min(1, (r - 1) / 4));
  const raw = [Math.pow(t, 2.2), t * (1 - t) * 1.6, (1 - Math.abs(t - 0.45)) * 0.35, (1 - t) * 0.5, Math.pow(1 - t, 2.4)];
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((x) => x / sum);
}

export function DistBar({ rating, width = 230, flip }: { rating: number; width?: number; flip?: boolean }) {
  const d = distribution(rating);
  const parts = flip ? d.map((x, i) => ({ x, c: SHADES[i] })).reverse() : d.map((x, i) => ({ x, c: SHADES[i] }));
  const usable = width - 8;
  return (
    <View style={[s.row, { width, height: 6, gap: 2, borderRadius: 3, overflow: 'hidden' }]}>
      {parts.map((p, i) => (
        <View key={i} style={{ width: Math.max(2, p.x * usable), height: 6, backgroundColor: p.c }} />
      ))}
    </View>
  );
}

function fmt(n: number) {
  return n.toFixed(1).replace('.', ',');
}

function RankRow({ b, i, bottom, onPress, early }: { b: Beer; i: number; bottom?: boolean; onPress: () => void; early?: boolean }) {
  const rating = bottom ? b.rating - 0.8 : b.rating;
  return (
    <Press onPress={onPress} style={[s.row, { paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
      <View style={{ width: 34, alignItems: 'center', gap: 2 }}>
        <D s={34} c={i === 0 && !bottom ? C.yellow : C.muted}>
          {String(i + 1)}
        </D>
        {early ? (
          <T s={11} w={700} c={C.muted}>
            nové
          </T>
        ) : b.move ? (
          <View style={[s.row, { gap: 1 }]}>
            <Icon name={b.move > 0 ? 'arrow-up' : 'arrow-down'} size={11} color={b.move > 0 ? C.yellow : C.muted} />
            <T s={11} w={700} c={b.move > 0 ? C.yellow : C.muted}>
              {Math.abs(b.move)}
            </T>
          </View>
        ) : (
          <T s={11} w={700} c={C.muted}>
            –
          </T>
        )}
      </View>
      <View style={[s.fill, { gap: 6 }]}>
        <View style={[s.row, { gap: 6 }]}>
          <T s={16} w={700} numberOfLines={1}>
            {b.name}
          </T>
          {b.verified ? <Icon name="circle-check" size={14} color={C.yellow} /> : null}
        </View>
        <T s={12} w={500} c={C.muted}>
          {bottom ? `nejčastěji „${b.verdict ?? 'Vodový'}“` : `${b.brewery} · ${b.style} · ${b.nearestPubId ? 'na čepu ' : ''}${b.nearestDistance}`}
        </T>
        <DistBar rating={rating} flip={bottom} />
      </View>
      <View style={{ alignItems: 'flex-end', gap: 1 }}>
        <D s={30}>{fmt(rating)}</D>
        <View style={[s.row, { gap: 3 }]}>
          <Icon name="users" size={11} color={C.muted} />
          <T s={11} w={600} c={C.muted}>
            {early ? String(Math.max(3, Math.round(b.ratings / 300))) : thousands(b.ratings)}
          </T>
        </View>
      </View>
    </Press>
  );
}

const FILTERS = ['Všechna', 'Ležáky', 'Desítky', 'Craft', 'Tmavá'];

export function PivaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const [tab, setTab] = useState<'best' | 'bottom' | 'mine'>('best');
  const [filter, setFilter] = useState('Všechna');
  const early = useMock((st) => st.pivaEarly);
  const ratings = useMock((st) => st.ratings);
  const watched = useMock((st) => st.watched);
  const open = (b: Beer) => router.push({ pathname: '/nv/pivo/[id]', params: { id: b.id } });

  const filtered = BEERS.filter((b) =>
    filter === 'Všechna' ? true : filter === 'Ležáky' ? b.style === 'ležák' : filter === 'Desítky' ? b.name.includes('10') : filter === 'Craft' ? ['IPA', 'APA'].includes(b.style) : b.style === 'tmavé',
  );
  const best = [...filtered].filter((b) => !b.bottomRank).sort((a, b) => b.rating - a.rating);
  const bottom = [...filtered].filter((b) => b.bottomRank).sort((a, b) => a.rating - b.rating);
  const earlyList = [BEERS[1], BEERS[2], BEERS[7]];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 16, paddingBottom: tabSpace + 30 }}>
        <TabHeader title="Piva">
          <IconButton icon="search" iconSize={20} onPress={() => router.push('/nv/hledat-pivo')} label="Hledat pivo" />
        </TabHeader>
        <Segmented
          height={38}
          options={[
            { key: 'best', label: 'Nejlepší' },
            { key: 'bottom', label: 'Dno sudu' },
            { key: 'mine', label: 'Sbírka' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {tab !== 'mine' ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SCREEN_X }} contentContainerStyle={{ paddingHorizontal: SCREEN_X, gap: 8 }}>
              <Chip label="Celé Česko" trailing="chevron-down" />
              {FILTERS.map((f) => (
                <Chip key={f} label={f} active={filter === f} plain onPress={() => setFilter(f)} />
              ))}
            </ScrollView>
            <View style={[s.row, { gap: 6, marginTop: -4 }]}>
              <T s={12} w={500} c={C.muted}>
                Pruh: kolik lidí dalo
              </T>
              <T s={12} w={700} c={C.text2}>
                5★
              </T>
              <View style={[s.row, { gap: 2 }]}>
                {SHADES.map((c) => (
                  <View key={c} style={{ width: 12, height: 6, borderRadius: 1, backgroundColor: c }} />
                ))}
              </View>
              <T s={12} w={700} c={C.text2}>
                až 1★
              </T>
            </View>
            <View>
              {(tab === 'best' ? (early ? earlyList : best) : bottom).map((b, i) => (
                <RankRow key={b.id} b={b} i={i} bottom={tab === 'bottom'} early={early && tab === 'best'} onPress={() => open(b)} />
              ))}
            </View>
            {tab === 'best' && early ? (
              <>
                <View style={[s.row, { justifyContent: 'space-between' }]}>
                  <T s={17} w={700}>
                    Pil jsi, ještě jsi nehodnotil
                  </T>
                  <T s={13} c={C.muted}>
                    pomůžeš žebříčku
                  </T>
                </View>
                {[
                  ['gambrinus', 'Gambrinus Originál 10°', 'pil jsi ho 3×'],
                  ['svijany', 'Svijanský Rytíř 12°', 'pil jsi ho 2×'],
                  ['kozel', 'Kozel Černý', 'pil jsi ho 1×'],
                ].map(([id, name, sub]) => (
                  <Row
                    key={id}
                    leading={<Icon name="beer" size={18} color={C.muted} />}
                    title={name}
                    titleWeight={700}
                    sub={sub}
                    trailing={
                      <Press haptic onPress={() => router.push({ pathname: '/nv/hodnoceni', params: { id } })} style={[s.row, { height: 38, borderRadius: 19, paddingHorizontal: 12, gap: 6, backgroundColor: C.control }]}>
                        <Icon name="star" size={15} color={C.yellow} />
                        <T s={14} w={700}>
                          Ohodnotit
                        </T>
                      </Press>
                    }
                  />
                ))}
              </>
            ) : null}
          </>
        ) : (
          <Collection ratings={ratings} watchedCount={watched.length} />
        )}
      </ScrollView>
      <BottomFade height={tabSpace + 40} />
    </View>
  );
}

export function Stars({ n, size = 16 }: { n: number; size?: number }) {
  return (
    <View style={[s.row, { gap: 1 }]}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Icon key={i} name="star" size={size} color={i <= n ? C.yellow : C.muted} fill={i <= n ? C.yellow : 'none'} />
      ))}
    </View>
  );
}


function Collection({ ratings, watchedCount }: { ratings: Record<string, number>; watchedCount: number }) {
  const router = useRouter();
  return (
    <>
      <View style={[s.row, { gap: 14 }]}>
        <D s={88} lh={0.9} c={C.yellow}>
          37
        </D>
        <View style={{ gap: 2 }}>
          <T s={19} w={700}>
            různých piv
          </T>
          <T s={13} c={C.muted}>
            ze 142 vypitých · 12 pivovarů
          </T>
        </View>
      </View>
      <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 14 }}>
        <View style={[s.row, { gap: 12 }]}>
          <View style={{ width: 44, height: 44 }}>
            <View style={[{ width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.yellow, backgroundColor: '#FFC4001A' }, s.center]}>
              <Icon name="medal" size={20} color={C.yellow} />
            </View>
          </View>
          <View style={[s.fill, { gap: 2 }]}>
            <T s={16} w={700}>
              Ochutnávač II
            </T>
            <T s={12} c={C.muted}>
              ochutnej top 50 z Česka
            </T>
          </View>
          <D s={26}>14/50</D>
        </View>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: C.control }}>
          <View style={{ width: '28%', height: 8, borderRadius: 4, backgroundColor: C.yellow }} />
        </View>
        <Row
          last
          title="Únětické 12°"
          sub="chybí ti · čepujou ho 1,8 km od tebe"
          chevron
          onPress={() => router.push({ pathname: '/nv/pivo/[id]', params: { id: 'unetice' } })}
        />
      </View>
      <T s={17} w={700}>
        Proti proudu
      </T>
      <Card>
        {[
          ['gambrinus', 'Gambrinus Originál 10°', 'Česko 2,9', ratings.gambrinus ?? 4],
          ['raptor', 'Matuška Raptor 15°', 'Česko 4,7', ratings.raptor ?? 2],
        ].map(([id, name, sub, n], i) => (
          <Row
            key={String(id)}
            last={i === 1}
            title={String(name)}
            sub={String(sub)}
            onPress={() => router.push({ pathname: '/nv/pivo/[id]', params: { id: String(id) } })}
            trailing={
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Stars n={Number(n)} />
                <T s={11} c={C.muted}>
                  tvoje
                </T>
              </View>
            }
          />
        ))}
      </Card>
      <Card>
        <Row
          last
          leading={<Tile icon="bell" />}
          title="Hlídaná piva"
          trailing={
            <T s={15} w={600}>
              {watchedCount}
            </T>
          }
          chevron
          onPress={() => router.push('/nv/hlidana-piva')}
        />
      </Card>
    </>
  );
}

export function HledatPivoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const list = BEERS.filter((b) => !q || b.name.toLowerCase().includes(q.toLowerCase()) || b.brewery.toLowerCase().includes(q.toLowerCase()));
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8 }}>
      <View style={[s.row, { paddingHorizontal: SCREEN_X, gap: 12 }]}>
        <View style={s.fill}>
          <Input icon="search" value={q} onChangeText={setQ} placeholder="Hledat pivo nebo pivovar" autoFocus height={48} />
        </View>
        <Press onPress={() => router.back()} hitSlop={10}>
          <T s={15} w={700} c={C.yellow}>
            Zrušit
          </T>
        </Press>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: SCREEN_X, paddingBottom: insets.bottom + 30 }}>
        <Card>
          {list.map((b, i) => (
            <Row
              key={b.id}
              last={i === list.length - 1}
              leading={<Tile icon="beer" />}
              title={b.name}
              sub={`${b.brewery} · ${b.style}`}
              trailing={<D s={22}>{fmt(b.rating)}</D>}
              onPress={() => router.replace({ pathname: '/nv/pivo/[id]', params: { id: b.id } })}
            />
          ))}
        </Card>
      </ScrollView>
    </View>
  );
}
