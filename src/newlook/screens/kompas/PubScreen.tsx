import React from 'react';
import { ScrollView, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomFade } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { Button, D, Dot, IconButton, Press, ProgressRing, T } from '../../components/ui';
import { beerById, formatDistance, pubById } from '../../mock/data';
import { toast, useMock } from '../../mock/store';
import { C, SCREEN_X, s } from '../../theme';
import { GRAY_MAP } from './NvMap';

function Band() {
  return <View style={{ height: 10, backgroundColor: C.card }} />;
}

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingTop: 20, paddingHorizontal: SCREEN_X, paddingBottom: 12 }}>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 6 }]}>
        <T s={19} w={700}>
          {title}
        </T>
        {meta ? (
          <T s={14} c={C.muted}>
            {meta}
          </T>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Line({ title, sub, value, last, valueColor = C.white }: { title: string; sub?: string; value?: string; last?: boolean; valueColor?: string }) {
  return (
    <View style={[s.row, { minHeight: 64, gap: 12 }, !last && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
      <View style={[s.fill, { gap: 2 }]}>
        <T s={16} w={600}>
          {title}
        </T>
        {sub ? (
          <T s={14} c={C.muted}>
            {sub}
          </T>
        ) : null}
      </View>
      {value ? (
        <T s={15} w={valueColor === C.white ? 700 : 400} c={valueColor}>
          {value}
        </T>
      ) : null}
    </View>
  );
}

function AddLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={[s.row, { height: 52, gap: 8 }]}>
      <Icon name="plus" size={18} color={C.yellow} />
      <T s={16} w={700} c={C.yellow}>
        {label}
      </T>
    </Press>
  );
}

export function PubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pub = pubById(id) ?? pubById('tygr')!;
  const fav = useMock((st) => st.favorites.includes(pub.id));
  const toggleFavorite = useMock((st) => st.toggleFavorite);
  const set = useMock((st) => st.set);
  const dist = formatDistance(pub.distance);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 140 }}>
        <View style={{ paddingHorizontal: SCREEN_X, gap: 18, paddingBottom: 24 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <IconButton icon="chevron-left" size={40} iconSize={18} onPress={() => router.back()} label="Zpět" />
            <View style={[s.row, { gap: 10 }]}>
              <IconButton
                icon="heart"
                size={40}
                iconSize={18}
                color={C.yellow}
                label={fav ? 'Odebrat ze srdcovek' : 'Přidat do srdcovek'}
                onPress={() => {
                  toggleFavorite(pub.id);
                  toast({ kind: 'saved', title: fav ? 'Ze srdcovek pryč.' : 'Mám ji ve srdcovkách.', icon: 'heart' });
                }}
              />
              <IconButton icon="share" size={40} iconSize={18} label="Sdílet" onPress={() => router.push({ pathname: '/nv/sdilet-hospodu', params: { id: pub.id } })} />
              <IconButton icon="ellipsis" size={40} iconSize={18} label="Další" onPress={() => router.push({ pathname: '/nv/nesedi', params: { id: pub.id } })} />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <D s={44} accessibilityRole="header">
              {pub.name}
            </D>
            <View style={[s.row, { gap: 6 }]}>
              <Dot color={C.open} size={7} />
              <T s={15} w={600} c={C.open}>{`Otevřeno do ${pub.openUntil}`}</T>
              <T s={15} c={C.muted}>{`· ${dist.value} ${dist.unit} · ${pub.area}`}</T>
            </View>
          </View>
          <Press
            onPress={() => {
              set({ targetId: pub.id, mapView: 'okoli' });
              router.navigate('/nv/kompas');
            }}
            style={{ height: 112, borderRadius: 20, overflow: 'hidden', backgroundColor: C.card }}
          >
            <MapView
              provider={PROVIDER_GOOGLE}
              style={{ flex: 1 }}
              customMapStyle={GRAY_MAP}
              initialRegion={{ ...pub.coord, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              pointerEvents="none"
              userInterfaceStyle="dark"
            >
              <Marker coordinate={pub.coord} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                <View style={[{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
                  <Icon name="beer" size={18} color={C.black} />
                </View>
              </Marker>
            </MapView>
            <View style={[s.row, { position: 'absolute', right: 10, bottom: 12, height: 34, borderRadius: 17, paddingHorizontal: 12, gap: 6, backgroundColor: '#0A0A0AD9', borderWidth: 1, borderColor: '#FFFFFF1F' }]}>
              <Icon name="map" size={15} color={C.yellow} />
              <T s={13} w={700}>
                Ukázat na mapě
              </T>
            </View>
          </Press>
          <View style={[s.row, { gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, backgroundColor: C.card }]}>
            <View style={{ width: 40, height: 40 }}>
              <ProgressRing size={40} progress={0.08} stroke={4} track={C.hairline} />
            </View>
            <View style={[s.fill, { gap: 2 }]}>
              <T s={16} w={700}>
                Zmapováno na 8 %
              </T>
              <T s={13} c={C.muted}>
                Doplň zahrádku, šipky nebo otevíračku. Uvidí to všichni.
              </T>
            </View>
            <Press haptic onPress={() => router.push({ pathname: '/nv/doplnit-info', params: { id: pub.id } })} style={[{ height: 36, borderRadius: 18, paddingHorizontal: 14, backgroundColor: C.control }, s.center]}>
              <T s={14} w={700} c={C.yellow}>
                Doplnit
              </T>
            </Press>
          </View>
        </View>
        <Band />
        <Section title="Na čepu" meta={pub.taps.length ? pub.verified ?? 'ověřeno minulý týden' : undefined}>
          {pub.taps.length ? (
            pub.taps.map((tap, i) => (
              <Press key={`${tap.beerId}-${tap.size}`} onPress={() => router.push({ pathname: '/nv/pivo/[id]', params: { id: tap.beerId } })}>
                <Line title={beerById(tap.beerId)?.name ?? ''} sub={tap.size} value={`${tap.price} Kč`} last={i === pub.taps.length - 1} />
              </Press>
            ))
          ) : (
            <>
              <T s={16} c={C.text2} style={{ paddingVertical: 10 }}>
                Co tu čepují, zatím nevím.
              </T>
              <AddLink label="Zapiš, co tu čepují" onPress={() => router.push({ pathname: '/nv/doplnit-info', params: { id: pub.id, tab: 'piva' } })} />
            </>
          )}
        </Section>
        <Band />
        <Section title="Akce">
          {pub.event ? <Line title="Pub kvíz" sub="Dnes od 19:00" /> : null}
          <AddLink label="Navrhni akci" onPress={() => router.push({ pathname: '/nv/navrhnout-akci', params: { id: pub.id } })} />
        </Section>
        <Band />
        <Section title="O hospodě">
          {pub.lastWeekBeers ? <Line title={`Minulý týden tu padlo ${pub.lastWeekBeers} piv`} sub="od lidí z Na pivo" /> : null}
          {pub.rating ? <Line title={`${pub.rating.value} z ${pub.rating.count} hodnocení`} sub={pub.rating.source} /> : null}
          <Line title="Navštíveno 2× · naposledy 20. 10." sub="Jen pro tebe" last />
        </Section>
      </ScrollView>
      <BottomFade height={184} />
      <View style={[s.row, { position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: Math.max(insets.bottom, 16) + 4, gap: 10 }]}>
        <Button
          label="Doveď mě tam"
          icon="navigation"
          flex
          onPress={() => {
            toast({ kind: 'info', title: 'Vedu tě do Map', sub: `${pub.name}, ${dist.value} ${dist.unit} pěšky`, icon: 'navigation' });
            setTimeout(() => router.push({ pathname: '/nv/prichod', params: { id: pub.id } }), 1600);
          }}
        />
        <IconButton
          icon="compass"
          size={52}
          iconSize={23}
          color={C.yellow}
          label="Ukázat v kompasu"
          onPress={() => {
            set({ targetId: pub.id });
            router.navigate('/nv/kompas');
          }}
        />
      </View>
    </View>
  );
}
