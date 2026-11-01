import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type MapStyleElement } from 'react-native-maps';

import { Icon } from '../../components/Icon';
import { Person, T } from '../../components/ui';
import { FRIENDS, ME_COORD, PUBS, pubById, type LatLng, type Pub } from '../../mock/data';
import { C, s } from '../../theme';

// Gray Google style without museums, shops and transit (the redesign decision "Mapa").
export const GRAY_MAP: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#1b1b1b' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8a86' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#121212' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#3a3a3a' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels.text.fill', stylers: [{ color: '#6d6d69' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: '#1f221f' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2c2c2c' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#202020' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a3a3a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#7a7a76' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e0e0e' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4a4a48' }] },
];

export const CITIES: { name: string; coord: LatLng; evenings: number; pubs: number }[] = [
  { name: 'Praha', coord: { latitude: 50.0755, longitude: 14.4378 }, evenings: 24, pubs: 12 },
  { name: 'Liberec', coord: { latitude: 50.7663, longitude: 15.0543 }, evenings: 2, pubs: 2 },
  { name: 'Hradec Králové', coord: { latitude: 50.2092, longitude: 15.8328 }, evenings: 1, pubs: 1 },
  { name: 'Plzeň', coord: { latitude: 49.7384, longitude: 13.3736 }, evenings: 3, pubs: 3 },
  { name: 'Brno', coord: { latitude: 49.1951, longitude: 16.6068 }, evenings: 6, pubs: 5 },
  { name: 'České Budějovice', coord: { latitude: 48.9745, longitude: 14.4743 }, evenings: 1, pubs: 1 },
];

const CITY_REGION = { latitude: 49.85, longitude: 15.2, latitudeDelta: 3.6, longitudeDelta: 3.6 };
const NEAR_REGION = { latitude: 50.0868, longitude: 14.4232, latitudeDelta: 0.017, longitudeDelta: 0.017 };

function dots(from: LatLng, to: LatLng): LatLng[] {
  return [from, to];
}

export function NvMap({
  pubs,
  targetId,
  view,
  pinMode,
  selectedCity,
  onPub,
  onCity,
  showRoute = true,
  bottomPadding = 0,
}: {
  pubs: Pub[];
  targetId: string | null;
  view: 'okoli' | 'stopy' | 'parta';
  pinMode: 'price' | 'count';
  selectedCity?: string;
  onPub?: (id: string) => void;
  onCity?: (name: string) => void;
  showRoute?: boolean;
  bottomPadding?: number;
}) {
  const ref = useRef<MapView>(null);
  const target = pubById(targetId);

  useEffect(() => {
    const region = view === 'stopy' ? CITY_REGION : NEAR_REGION;
    ref.current?.animateToRegion(region, 450);
  }, [view]);

  const pins = useMemo(() => (view === 'stopy' ? [] : pubs), [pubs, view]);

  return (
    <MapView
      ref={ref}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      customMapStyle={GRAY_MAP}
      initialRegion={NEAR_REGION}
      showsUserLocation={false}
      showsCompass={false}
      showsPointsOfInterests={false}
      showsBuildings={false}
      toolbarEnabled={false}
      mapPadding={{ top: 0, left: 0, right: 0, bottom: bottomPadding }}
      userInterfaceStyle="dark"
    >
      {view !== 'stopy' ? (
        <>
          {showRoute && target ? (
            <Polyline coordinates={dots(ME_COORD, target.coord)} strokeColor="#FFFFFFB3" strokeWidth={3} lineDashPattern={[1, 14]} lineCap="round" />
          ) : null}
          <Marker coordinate={ME_COORD} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF1F' }, s.center]}>
              <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: C.white, borderWidth: 3, borderColor: C.black }} />
            </View>
          </Marker>
        </>
      ) : null}
      {pins.map((p) => (
        <Marker
          key={`${p.id}-${p.id === targetId}-${pinMode}`}
          coordinate={p.coord}
          anchor={{ x: 0.5, y: 0.5 }}
          onPress={() => onPub?.(p.id)}
          tracksViewChanges={false}
        >
          <PubPin pub={p} target={p.id === targetId} mode={pinMode} />
        </Marker>
      ))}
      {view === 'parta'
        ? FRIENDS.filter((f) => f.live).map((f) => {
            const pub = pubById(f.live?.pubId);
            if (!pub) return null;
            return (
              <Marker key={f.id} coordinate={{ latitude: pub.coord.latitude + 0.0004, longitude: pub.coord.longitude }} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
                <Person initial={f.initial} size={34} />
              </Marker>
            );
          })
        : null}
      {view === 'stopy'
        ? CITIES.map((c) => (
            <Marker key={`${c.name}-${selectedCity === c.name}`} coordinate={c.coord} anchor={{ x: 0.5, y: 0.5 }} onPress={() => onCity?.(c.name)} tracksViewChanges={false}>
              <CityPin name={c.name} count={c.evenings} active={selectedCity === c.name} />
            </Marker>
          ))
        : null}
    </MapView>
  );
}

export function PubPin({ pub, target, mode }: { pub: Pub; target: boolean; mode: 'price' | 'count' }) {
  const label = mode === 'count' ? (pub.lastWeekBeers ? String(Math.round(pub.lastWeekBeers / 4)) : null) : pub.price ? `${pub.price} Kč` : null;
  const showIcon = mode === 'count' || !label || target;
  if (target && !label) {
    return (
      <View style={[{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
        <Icon name="beer" size={17} color={C.black} />
      </View>
    );
  }
  return (
    <View
      style={[
        s.row,
        {
          height: target ? 38 : 30,
          borderRadius: target ? 19 : 15,
          paddingHorizontal: target ? 14 : label ? 10 : 10,
          gap: target ? 6 : 4,
          backgroundColor: target ? C.yellow : C.white,
          borderWidth: target ? 2 : 0,
          borderColor: C.black,
        },
      ]}
    >
      {showIcon ? <Icon name="beer" size={target ? 16 : 14} color={C.black} /> : null}
      {label ? (
        <T s={target ? 15 : 13} w={target ? 800 : mode === 'count' ? 800 : 700} c={C.black}>
          {label}
        </T>
      ) : null}
    </View>
  );
}

function CityPin({ name, count, active }: { name: string; count: number; active: boolean }) {
  return (
    <View style={[s.row, { height: 34, borderRadius: 17, paddingLeft: 12, paddingRight: 5, gap: 8, backgroundColor: active ? C.yellow : C.white }]}>
      <T s={13} w={700} c={C.black}>
        {name}
      </T>
      <View style={[{ minWidth: 22, height: 22, borderRadius: 11, backgroundColor: C.black, paddingHorizontal: 5 }, s.center]}>
        <T s={12} w={800} c={active ? C.yellow : C.white}>
          {count}
        </T>
      </View>
    </View>
  );
}

export function nearestPub(): Pub {
  return [...PUBS].sort((a, b) => a.distance - b.distance)[0];
}
