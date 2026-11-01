import React, { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { Chip, ChipWrap, D, IconButton, Kicker, Press, Stack, T } from '../../components/ui';
import { beerById, photo, pubById } from '../../mock/data';
import { thousands } from '../../mock/format';
import { dialog, toast, useMock } from '../../mock/store';
import { C, SCREEN_X, s } from '../../theme';
import { RundaButton } from '../vycep/VycepScreen';
import { Stars } from './PivaScreen';

const REVIEWS = [
  { who: 'Klára na čepu', initial: 'K', parta: true, stars: 5, where: 'U Pinkasů · včera', text: 'Tankový, pěna jak smetana a hořkost akorát. U Pinkasů ho čepujou nejlíp v Praze.', photo: 16, rounds: 12 },
  { who: '@PivniVlk', initial: 'P', stars: 3, where: 'Lokál Dlouhááá · před 3 dny', text: 'V lahvi nic moc, na čepu úplně jiný pivo. Dneska trochu zvětralý.', rounds: 4 },
  { who: '@Hospodsky', initial: 'H', stars: 4, where: 'U Zlatého tygra · minulý týden', text: 'Klasika, která nezklame. Jen 59 Kč za půllitr už bolí.', rounds: 2 },
];

function Review({ r }: { r: (typeof REVIEWS)[number] }) {
  const [given, setGiven] = useState(false);
  return (
    <View style={{ gap: 12, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.hairline }}>
      <View style={[s.row, { gap: 12 }]}>
        <View style={[{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.control }, s.center]}>
          <T s={14} w={800} c={C.yellow}>
            {r.initial}
          </T>
        </View>
        <View style={[s.fill, { gap: 2 }]}>
          <View style={[s.row, { gap: 6 }]}>
            <T s={15} w={700}>
              {r.who}
            </T>
            {r.parta ? (
              <T s={12} w={600} c={C.yellow}>
                v partě
              </T>
            ) : null}
          </View>
          <View style={[s.row, { gap: 6 }]}>
            <Stars n={r.stars} size={12} />
            <T s={12} c={C.muted}>
              {r.where}
            </T>
          </View>
        </View>
        <Press
          hitSlop={10}
          accessibilityLabel="Nahlásit recenzi"
          onPress={() =>
            dialog({
              title: 'Nahlásit recenzi?',
              body: 'Mrknu na ni. Když nesedí s pravidly, zmizí.',
              actions: [{ label: 'Zpátky' }, { label: 'Nahlásit', kind: 'danger', onPress: () => toast({ kind: 'saved', title: 'Nahlášeno.', sub: 'Mrknu na to.', icon: 'flag' }) }],
            })
          }
        >
          <Icon name="flag" size={16} color={C.muted} />
        </Press>
      </View>
      <T s={15} c={C.text2} lh={1.45}>
        {r.text}
      </T>
      {r.photo ? (
        <View>
          <Image source={photo(r.photo)} style={{ width: '100%', height: 180, borderRadius: 16 }} />
          <View style={[s.row, { position: 'absolute', left: 10, top: 10, height: 28, borderRadius: 14, paddingHorizontal: 10, gap: 6, backgroundColor: '#0A0A0AB3' }]}>
            <Icon name="trophy" size={13} color={C.yellow} />
            <T s={12} w={700}>
              Ve FotoPivaři
            </T>
          </View>
        </View>
      ) : null}
      <RundaButton count={r.rounds + (given ? 1 : 0)} given={given} onPress={() => setGiven(!given)} />
    </View>
  );
}

export function BeerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const beer = beerById(id) ?? beerById('pilsner')!;
  const st = useMock();
  const mine = st.ratings[beer.id] ?? 0;
  const watched = st.watched.includes(beer.id);
  const nearest = pubById(beer.nearestPubId) ?? pubById('tygr')!;
  const [filter, setFilter] = useState('Nejnovější');
  const rating = beer.rating.toFixed(1).replace('.', ',');

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 22, paddingBottom: insets.bottom + 40 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <IconButton icon="chevron-left" size={40} iconSize={18} onPress={() => router.back()} label="Zpět" />
          <View style={[s.row, { gap: 10 }]}>
            <IconButton
              icon={watched ? 'bell-ring' : 'bell'}
              size={40}
              iconSize={18}
              color={C.yellow}
              label={watched ? 'Přestat hlídat' : 'Hlídat pivo'}
              onPress={() => {
                st.toggleWatch(beer.id);
                toast(watched ? { kind: 'info', title: 'Už ho nehlídám.', icon: 'bell-off' } : { kind: 'saved', title: 'Hlídám ho.', sub: 'Dám vědět, až ho začnou čepovat poblíž.', icon: 'bell-ring' });
              }}
            />
            <IconButton icon="share" size={40} iconSize={18} label="Sdílet" onPress={() => router.push('/nv/nalepky')} />
          </View>
        </View>
        <View style={{ gap: 6 }}>
          <D s={44}>{beer.name}</D>
          <T s={15} c={C.muted}>{`${beer.brewery === 'Prazdroj' ? 'Plzeňský Prazdroj' : beer.brewery} · ${beer.style === 'ležák' ? 'světlý ležák' : beer.style} · ${beer.abv}`}</T>
        </View>
        <View style={[s.row, { gap: 14 }]}>
          <D s={96} lh={0.9} c={C.yellow}>
            {rating}
          </D>
          <View style={{ gap: 6 }}>
            <Stars n={Math.round(beer.rating)} size={20} />
            <T s={14} c={C.text2}>{`${thousands(beer.ratings)} hodnocení`}</T>
            <Press onPress={() => router.navigate('/nv/piva')} style={[s.row, { gap: 4 }]}>
              <T s={14} w={700}>
                3. v Česku
              </T>
              <Icon name="chevron-right" size={14} color={C.text2} />
            </Press>
          </View>
        </View>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          {[
            ['18 420', 'vypito v Na pivo'],
            ['3 105', 'lidí ho pilo'],
            ['214', 'tento týden'],
          ].map(([v, l]) => (
            <View key={l} style={{ gap: 2 }}>
              <D s={26} lh={1}>
                {v}
              </D>
              <T s={12} c={C.muted}>
                {l}
              </T>
            </View>
          ))}
        </View>
        <View style={[s.row, { gap: 12, padding: 16, borderRadius: 22, backgroundColor: C.card }]}>
          <View style={[{ width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFC40026' }, s.center]}>
            <Icon name="map-pin" size={20} color={C.yellow} />
          </View>
          <View style={[s.fill, { gap: 3 }]}>
            <Kicker>Nejblíž čepujou</Kicker>
            <T s={16} w={700}>{`${nearest.name} · ${beer.nearestDistance ?? '260 m'}`}</T>
            <T s={12} c={C.muted}>{`${nearest.taps.find((t) => t.beerId === beer.id)?.price ?? nearest.price ?? 59} Kč · a dalších 13 hospod`}</T>
          </View>
          <Press
            haptic
            onPress={() => {
              st.set({ beerFilter: beer.id, targetId: nearest.id, mapView: 'okoli' });
              router.navigate('/nv/kompas');
            }}
            style={[s.row, { height: 42, borderRadius: 21, paddingHorizontal: 16, gap: 6, backgroundColor: C.yellow }]}
          >
            <Icon name="map" size={16} color={C.black} />
            <T s={15} w={700} c={C.black}>
              Mapa
            </T>
          </Press>
        </View>
        <View style={{ backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 16 }}>
          <View style={[s.row, { height: 58, justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
            <T s={16} w={500}>
              Tvoje známka
            </T>
            <View style={[s.row, { gap: 4 }]}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Press
                  key={n}
                  haptic
                  hitSlop={4}
                  onPress={() => {
                    st.rate(beer.id, n);
                    if (!mine) toast({ kind: 'xp', title: 'Známka uložená', icon: 'star', xp: 10 });
                  }}
                >
                  <Icon name="star" size={26} color={n <= mine ? C.yellow : C.muted} fill={n <= mine ? C.yellow : 'none'} />
                </Press>
              ))}
            </View>
          </View>
          <Press onPress={() => router.push({ pathname: '/nv/hodnoceni', params: { id: beer.id } })} style={[s.row, { height: 50, gap: 8, borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
            <Icon name="camera" size={16} color={C.yellow} />
            <T s={15} w={600} c={C.yellow}>
              Přidat fotku a pár slov
            </T>
          </Press>
          <View style={[s.row, { height: 56, gap: 12 }]}>
            <Stack initials={['K', 'M', 'J']} />
            <T s={15} w={600} style={s.fill}>
              Parta
            </T>
            <T s={12} c={C.muted}>
              3 hodnocení
            </T>
            <D s={24}>4,7</D>
          </View>
        </View>
        <View style={{ gap: 12 }}>
          <T s={17} w={700}>
            Co o něm lidi říkají
          </T>
          <ChipWrap>
            {[
              ['Má říz', '64 %'],
              ['Pěna jak smetana', '41 %'],
              ['Jde samo', '38 %'],
              ['Předražený', '22 %'],
            ].map(([l, p]) => (
              <View key={l} style={[s.row, { height: 32, borderRadius: 16, paddingHorizontal: 12, gap: 6, backgroundColor: C.card, borderWidth: 1, borderColor: C.hairline }]}>
                <T s={13} w={600}>
                  {l}
                </T>
                <T s={13} c={C.muted}>
                  {p}
                </T>
              </View>
            ))}
          </ChipWrap>
        </View>
        <View style={{ gap: 12 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={17} w={700}>
              Fotky
            </T>
            <Press onPress={() => router.push('/nv/pivni-fotky')} style={[s.row, { gap: 4 }]}>
              <T s={14} c={C.muted}>
                128
              </T>
              <Icon name="chevron-right" size={14} color={C.muted} />
            </Press>
          </View>
          <View style={[s.row, { gap: 8 }]}>
            {[13, 15, 14].map((n, i) => (
              <Press key={n} style={s.fill} onPress={() => router.push({ pathname: '/nv/fotka/[n]', params: { n: String(n) } })}>
                <Image source={photo(n)} style={{ width: '100%', height: 110, borderRadius: 14 }} />
                {i === 2 ? (
                  <View style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 14, backgroundColor: '#0A0A0A99' }, s.center]}>
                    <D s={26}>+125</D>
                  </View>
                ) : null}
              </Press>
            ))}
          </View>
        </View>
        <View style={{ gap: 12 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={17} w={700}>
              Co lidi píšou
            </T>
            <View style={[s.row, { gap: 4 }]}>
              <T s={14} c={C.muted}>
                312
              </T>
              <Icon name="chevron-right" size={14} color={C.muted} />
            </View>
          </View>
          <View style={[s.row, { gap: 8 }]}>
            {['Nejnovější', 'Od party', 'S fotkou'].map((f) => (
              <Chip key={f} label={f} active={filter === f} plain height={34} onPress={() => setFilter(f)} />
            ))}
          </View>
          <View style={{ backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 16 }}>
            {REVIEWS.filter((r) => (filter === 'Od party' ? r.parta : filter === 'S fotkou' ? r.photo : true)).map((r) => (
              <Review key={r.who} r={r} />
            ))}
            <View style={[s.row, { height: 52, justifyContent: 'center', gap: 4 }]}>
              <T s={14} w={700}>
                Všech 312 recenzí
              </T>
              <Icon name="chevron-right" size={14} />
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
