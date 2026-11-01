import React, { useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '../../components/Icon';
import { Card, Person, Press, Row, T, Tile } from '../../components/ui';
import { BEERS, PUBS, beerById, formatDistance, type Pub } from '../../mock/data';
import { useMock } from '../../mock/store';
import { C, SCREEN_X, font, s } from '../../theme';

const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function dist(p: Pub) {
  const d = formatDistance(p.distance);
  return (
    <T s={15} w={600}>
      {`${d.value} ${d.unit}`}
    </T>
  );
}

export function HledaniScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  const favorites = useMock((st) => st.favorites);
  const set = useMock((st) => st.set);
  const open = (p: Pub) => router.push({ pathname: '/nv/hospoda/[id]', params: { id: p.id } });

  const nq = norm(q.trim());
  const beer = nq ? BEERS.find((b) => norm(b.name).includes(nq) || norm(b.brewery).includes(nq)) : undefined;
  const byName = nq ? PUBS.filter((p) => norm(p.name).includes(nq)) : [];
  const pouring = beer ? PUBS.filter((p) => p.taps.some((t) => t.beerId === beer.id)) : [];
  const favs = PUBS.filter((p) => favorites.includes(p.id) || p.id === 'pinkas' || p.id === 'dlouha').slice(0, 2);
  const inView = [...PUBS].sort((a, b) => a.distance - b.distance).slice(0, 3);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8 }}>
      <View style={[s.row, { paddingHorizontal: SCREEN_X, gap: 12, height: 48 }]}>
        <View style={[s.fill, s.row, { height: 48, borderRadius: 24, paddingHorizontal: 16, gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: '#FFC40099' }]}>
          <Icon name="search" size={18} color={C.text2} />
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder="Kam na pivo?"
            placeholderTextColor={C.muted}
            selectionColor={C.yellow}
            cursorColor={C.yellow}
            keyboardAppearance="dark"
            returnKeyType="search"
            style={[font(16, 600), { flex: 1, padding: 0 }]}
          />
        </View>
        <Press onPress={() => router.back()} hitSlop={10}>
          <T s={15} w={700} c={C.yellow}>
            Zrušit
          </T>
        </Press>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: SCREEN_X, gap: 16, paddingBottom: insets.bottom + 40 }}>
        {!nq ? (
          <>
            <T s={19} w={700}>
              Parta teď
            </T>
            <Card>
              <Row
                last
                leading={<Person initial="J" />}
                title="Vinohradský pivovar"
                sub="Jana a ještě jeden jsou tady"
                trailing={<T s={15} w={600}>2,4 km</T>}
                onPress={() => router.push({ pathname: '/nv/kamos/[id]', params: { id: 'jirka' } })}
              />
            </Card>
          </>
        ) : null}
        {favs.length && (!nq || byName.length === 0) ? (
          <>
            <T s={19} w={700}>
              Srdcovky
            </T>
            <Card>
              {favs.map((p, i) => (
                <Row
                  key={p.id}
                  last={i === favs.length - 1}
                  leading={<Tile icon="heart" />}
                  title={p.name}
                  sub={`${p.area} · otevřeno do ${p.openUntil}`}
                  trailing={dist(p)}
                  onPress={() => open(p)}
                />
              ))}
            </Card>
          </>
        ) : null}
        {byName.length ? (
          <>
            <T s={19} w={700}>
              Hospody
            </T>
            <Card>
              {byName.map((p, i) => (
                <Row key={p.id} last={i === byName.length - 1} leading={<Tile icon="beer" />} title={p.name} sub={`${p.area} · otevřeno do ${p.openUntil}`} trailing={dist(p)} onPress={() => open(p)} />
              ))}
            </Card>
          </>
        ) : null}
        {beer && pouring.length ? (
          <>
            <T s={19} w={700}>{`Čepují ${beer.name.replace(/ \d+°$/, '')} v okolí`}</T>
            <Card>
              {pouring.map((p, i) => {
                const tap = p.taps.find((t) => t.beerId === beer.id);
                return (
                  <Row
                    key={p.id}
                    last={i === pouring.length - 1}
                    leading={<Tile icon="beer" />}
                    title={p.name}
                    sub={`${beer.name} · ${tap?.price} Kč`}
                    trailing={dist(p)}
                    onPress={() => {
                      set({ beerFilter: beer.id, targetId: p.id });
                      open(p);
                    }}
                  />
                );
              })}
            </Card>
          </>
        ) : null}
        {!nq ? (
          <>
            <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
              <T s={19} w={700}>
                Ve výřezu mapy
              </T>
              <T s={13} c={C.muted}>
                243 hospod
              </T>
            </View>
            <Card>
              {inView.map((p, i) => (
                <Row
                  key={p.id}
                  last={i === inView.length - 1}
                  leading={<Tile icon="beer" />}
                  title={p.name}
                  sub={`${beerById(p.mainBeerId)?.name ?? 'Nabídku neznám'} · ${p.price ?? '?'} Kč`}
                  trailing={dist(p)}
                  onPress={() => open(p)}
                />
              ))}
            </Card>
          </>
        ) : null}
        {nq && !byName.length && !pouring.length ? (
          <T s={15} c={C.muted} style={{ paddingVertical: 8 }}>{`Na „${q.trim()}“ jsem nic nenašel.`}</T>
        ) : null}
        <Press
          onPress={() => router.push('/nv/pridat-hospodu')}
          style={[s.row, { gap: 12, padding: 16, borderRadius: 24, borderWidth: 1, borderColor: C.hairline }]}
        >
          <Tile icon="map-pin-plus" />
          <View style={[s.fill, { gap: 2 }]}>
            <T s={16} w={700}>
              Nenašel jsi ji?
            </T>
            <T s={13} c={C.muted}>
              Přidej hospodu, uvidí ji všichni
            </T>
          </View>
          <Icon name="chevron-right" size={16} color={C.muted} />
        </Press>
      </ScrollView>
    </View>
  );
}

