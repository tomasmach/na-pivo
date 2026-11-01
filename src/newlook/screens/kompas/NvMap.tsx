import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type MapStyleElement, type Region } from 'react-native-maps';

import { Icon } from '../../components/Icon';
import { Person, T } from '../../components/ui';
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

type Point = { lat: number; lng: number };
/** `key` is the pub's cell; `id` tells apart pubs that share one cell. */
export type MapPin = Point & { key: string; id: string; label: string | null };
export type MapFriend = Point & { key: string; initial: string };
export type MapCity = Point & { key: string; name: string; count: number };
export type NvMapHandle = { centerOn: (at: Point) => void };

const COUNTRY_REGION = { latitude: 49.85, longitude: 15.2, latitudeDelta: 3.6, longitudeDelta: 3.6 };
const NEAR_DELTA = 0.017;

export function nearRegion(at: Point): Region {
  return { latitude: at.lat, longitude: at.lng, latitudeDelta: NEAR_DELTA, longitudeDelta: NEAR_DELTA };
}

type Props = {
  pins: MapPin[];
  me: Point | null;
  target: (Point & { key: string }) | null;
  friends: MapFriend[];
  cities: MapCity[];
  view: 'okoli' | 'stopy' | 'parta';
  pinMode: 'price' | 'count';
  selectedCity?: string | null;
  onPub?: (id: string) => void;
  onCity?: (key: string) => void;
  onRegion?: (region: Region) => void;
  showRoute?: boolean;
  bottomPadding?: number;
};

export const NvMap = forwardRef<NvMapHandle, Props>(function NvMap(
  { pins, me, target, friends, cities, view, pinMode, selectedCity, onPub, onCity, onRegion, showRoute = true, bottomPadding = 0 },
  handle,
) {
  const ref = useRef<MapView>(null);
  const centered = useRef(false);

  useImperativeHandle(handle, () => ({ centerOn: (at) => ref.current?.animateToRegion(nearRegion(at), 450) }));

  // Switching the layer moves the camera; later position fixes must not fight the user's pan.
  useEffect(() => {
    if (view === 'stopy') ref.current?.animateToRegion(COUNTRY_REGION, 450);
    else if (me) ref.current?.animateToRegion(nearRegion(me), 450);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    if (!me || centered.current || view === 'stopy') return;
    centered.current = true;
    ref.current?.animateToRegion(nearRegion(me), 0);
    onRegion?.(nearRegion(me));
  }, [me, onRegion, view]);

  const shown = useMemo(() => (view === 'stopy' ? [] : pins), [pins, view]);

  return (
    <MapView
      ref={ref}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      customMapStyle={GRAY_MAP}
      initialRegion={me ? nearRegion(me) : COUNTRY_REGION}
      showsUserLocation={false}
      showsCompass={false}
      showsPointsOfInterests={false}
      showsBuildings={false}
      toolbarEnabled={false}
      mapPadding={{ top: 0, left: 0, right: 0, bottom: bottomPadding }}
      userInterfaceStyle="dark"
      onRegionChangeComplete={(region) => onRegion?.(region)}
    >
      {view !== 'stopy' ? (
        <>
          {showRoute && target && me ? (
            <Polyline
              coordinates={[
                { latitude: me.lat, longitude: me.lng },
                { latitude: target.lat, longitude: target.lng },
              ]}
              strokeColor="#FFFFFFB3"
              strokeWidth={3}
              lineDashPattern={[1, 14]}
              lineCap="round"
            />
          ) : null}
          {me ? (
            <Marker coordinate={{ latitude: me.lat, longitude: me.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF1F' }, s.center]}>
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: C.white, borderWidth: 3, borderColor: C.black }} />
              </View>
            </Marker>
          ) : null}
        </>
      ) : null}
      {shown.map((p) => (
        <Marker
          key={`${p.id}-${p.key === target?.key}-${pinMode}-${p.label ?? ''}`}
          coordinate={{ latitude: p.lat, longitude: p.lng }}
          anchor={{ x: 0.5, y: 0.5 }}
          onPress={() => onPub?.(p.id)}
          tracksViewChanges={false}
        >
          <PubPin label={p.label} target={p.key === target?.key} mode={pinMode} />
        </Marker>
      ))}
      {view === 'parta'
        ? friends.map((f) => (
            <Marker key={f.key} coordinate={{ latitude: f.lat + 0.0004, longitude: f.lng }} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
              <Person initial={f.initial} size={34} />
            </Marker>
          ))
        : null}
      {view === 'stopy'
        ? cities.map((c) => (
            <Marker
              key={`${c.key}-${selectedCity === c.key}`}
              coordinate={{ latitude: c.lat, longitude: c.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
              onPress={() => onCity?.(c.key)}
              tracksViewChanges={false}
            >
              <CityPin name={c.name} count={c.count} active={selectedCity === c.key} />
            </Marker>
          ))
        : null}
    </MapView>
  );
});

export function PubPin({ label, target, mode }: { label: string | null; target: boolean; mode: 'price' | 'count' }) {
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
          paddingHorizontal: target ? 14 : 10,
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
