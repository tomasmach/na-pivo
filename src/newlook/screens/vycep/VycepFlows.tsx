import React, { useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polygon } from 'react-native-svg';

import { BottomFade } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { Button, D, IconButton, Press, T } from '../../components/ui';
import { pubById } from '../../mock/data';
import { useMock } from '../../mock/store';
import { C, SCREEN_X, s } from '../../theme';

const PAPER = '#F4F1E8';
const INK = '#141414';

function Zigzag({ width }: { width: number }) {
  const n = Math.round(width / 12);
  const step = width / n;
  const pts = [`0,0`, ...Array.from({ length: n }, (_, i) => `${i * step + step / 2},9 ${(i + 1) * step},0`)].join(' ');
  return (
    <Svg width={width} height={9}>
      <Polygon points={`${pts} ${width},0 0,0`} fill={PAPER} />
    </Svg>
  );
}

function Dashed() {
  return <View style={{ height: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#14141440', marginVertical: 10 }} />;
}

export function UctenkaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const last = useMock((st) => st.lastEvening);
  const shareMode = useMock((st) => st.shareMode);
  const lines = last
    ? [{ pub: pubById(last.pubIds[0])?.name ?? '', time: `${last.from} až ${last.to}`, n: last.beers }]
    : [
        { pub: 'Lokál Dlouhááá', time: '19:10 až 21:40', n: 2 },
        { pub: 'U Pinkasů', time: '22:15 až 23:30', n: 3 },
      ];
  const beers = lines.reduce((a, l) => a + l.n, 0);
  const spent = last ? last.spent : 274;
  const [rated, setRated] = useState<string[]>([]);
  const paperW = width - SCREEN_X * 2;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 20, paddingBottom: 200 }} showsVerticalScrollIndicator={false}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <IconButton icon="x" onPress={() => router.navigate('/nv/stamgast')} label="Zavřít" />
          <T s={15} w={700} c={C.muted}>
            Dopito
          </T>
        </View>
        <View>
          <View style={{ backgroundColor: PAPER, borderTopLeftRadius: 6, borderTopRightRadius: 6, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18 }}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <D s={22} c={INK}>
                NA PIVO
              </D>
              <T s={13} w={600} c="#14141499">
                noc č. 61
              </T>
            </View>
            <T s={13} c="#14141499" style={{ marginTop: 6 }}>
              {last ? 'Středa 28. 10. 2026' : 'Sobota 24. 10. 2026'}
            </T>
            <View style={{ position: 'absolute', right: 40, top: 46, transform: [{ rotate: '-8deg' }], backgroundColor: C.yellow, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
              <T s={10} w={900} c={INK} style={{ letterSpacing: 1, textAlign: 'center' }}>
                {'O 3 PIVA VÍC\nNEŽ MINULE'}
              </T>
            </View>
            <Dashed />
            {lines.map((l) => (
              <View key={l.pub} style={[s.row, { justifyContent: 'space-between', paddingVertical: 6 }]}>
                <View>
                  <T s={16} w={700} c={INK}>
                    {l.pub}
                  </T>
                  <T s={12} c="#14141499">
                    {l.time}
                  </T>
                </View>
                <D s={26} c={INK}>{`${l.n}×`}</D>
              </View>
            ))}
            <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 20 }]}>
              <T s={12} w={900} c={INK} style={{ letterSpacing: 2 }}>
                CELKEM
              </T>
              <D s={52} lh={1} c={INK}>{`${beers} piv`}</D>
            </View>
            <View style={[s.row, { justifyContent: 'space-between', marginTop: 10 }]}>
              <T s={13} c="#141414B3">
                U stolu
              </T>
              <T s={13} w={800} c={INK}>
                4 h 10 min
              </T>
            </View>
            <View style={[s.row, { justifyContent: 'space-between', marginTop: 6 }]}>
              <T s={13} c="#141414B3">
                Útrata, vidíš jen ty
              </T>
              <T s={13} w={800} c={INK}>{`${spent} Kč`}</T>
            </View>
            <T s={12} c="#14141499" style={{ marginTop: 14 }}>
              Na zdraví a zas příště.
            </T>
          </View>
          <Zigzag width={paperW} />
        </View>
        <View style={{ backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 16, paddingBottom: 6 }}>
          <View style={[s.row, { height: 52, justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
            <T s={17} w={700}>
              Jak chutnalo?
            </T>
            <T s={13} c={C.muted}>
              uvidí všichni
            </T>
          </View>
          {[
            ['pilsner', 'Pilsner Urquell 12°', '3× · U Pinkasů'],
            ['kozel', 'Kozel 11°', '2× · Lokál Dlouhááá'],
          ].map(([id, name, sub], i) => (
            <View key={id} style={[s.row, { height: 58, gap: 10 }, i === 0 && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
              <View style={[s.fill, { gap: 2 }]}>
                <T s={16} w={600}>
                  {name}
                </T>
                <T s={12} c={C.muted}>
                  {sub}
                </T>
              </View>
              {rated.includes(id) ? (
                <View style={[s.row, { gap: 2 }]}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Icon key={n} name="star" size={14} color={C.yellow} fill={n <= 4 ? C.yellow : 'none'} />
                  ))}
                </View>
              ) : (
                <Press
                  haptic
                  onPress={() => {
                    setRated([...rated, id]);
                    router.push({ pathname: '/nv/hodnoceni', params: { id } });
                  }}
                  style={[s.row, { height: 38, borderRadius: 19, paddingHorizontal: 12, gap: 6, backgroundColor: C.control }]}
                >
                  <Icon name="star" size={16} color={C.yellow} />
                  <T s={15} w={700}>
                    Ohodnotit
                  </T>
                  <Icon name="chevron-right" size={14} color={C.text2} />
                </Press>
              )}
            </View>
          ))}
        </View>
        <View style={[s.row, { gap: 8 }]}>
          <View style={[s.row, { height: 34, borderRadius: 17, paddingHorizontal: 12, gap: 6, borderWidth: 1, borderColor: C.hairline }]}>
            <Icon name="zap" size={14} color={C.yellow} />
            <T s={13} w={700} c={C.text2}>
              +40 XP
            </T>
          </View>
          <View style={[s.row, { height: 34, borderRadius: 17, paddingHorizontal: 12, gap: 6, borderWidth: 1, borderColor: C.hairline }]}>
            <Icon name="signpost" size={14} color={C.yellow} />
            <T s={13} w={700} c={C.text2}>
              Poutník II: ještě 1 hospoda
            </T>
          </View>
        </View>
      </ScrollView>
      <BottomFade height={210} />
      <View style={{ position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: Math.max(insets.bottom, 16) + 4, gap: 10 }}>
        <View style={[s.row, { gap: 10 }]}>
          <Button label="Nálepka na story" icon="sticker" kind="raised" flex onPress={() => router.push('/nv/nalepky')} />
          <Button label="Upravit" icon="pencil" kind="raised" style={{ paddingHorizontal: 20 }} onPress={() => router.push('/nv/dopsat?day=28')} />
        </View>
        <Button label="Vyvěsit na Výčep" icon="megaphone" height={56} onPress={() => router.push(shareMode ? '/nv/vyvesit' : '/nv/prvni-vyveseni')} />
      </View>
    </View>
  );
}
