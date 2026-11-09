import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useIsFocused } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type MapStyleElement, type Region } from 'react-native-maps';

import { clusterCamera, clusterPins, NO_CLUSTER_ZOOM, targetPin, type PinCluster } from '@/map/clusterPins';
import { StaticMapMarker } from '@/map/StaticMapMarker';
import { visiblePins } from '@/map/visiblePins';
import { trackPinsSeen } from '@/data/pubReachClient';

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
/** Keeps a zoomed-in cluster clear of the search bar on top and the pub card below. */
const CLUSTER_EDGE_PADDING = { top: 210, right: 60, bottom: 60, left: 60 };
/** The Google zoom that shows about NEAR_DELTA across a phone screen. */
const NEAR_ZOOM = 15;

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
  /** Height of the controls drawn over the top of the map. */
  coveredTop?: number;
  /** Width of the iPhone Duo's side column the map runs under; the map centres on what is left. */
  coveredRight?: number;
};

export const NvMap = forwardRef<NvMapHandle, Props>(function NvMap(
  { pins, me, target, friends, cities, view, pinMode, selectedCity, onPub, onCity, onRegion, showRoute = true, bottomPadding = 0, coveredTop = 0, coveredRight = 0 },
  handle,
) {
  const ref = useRef<MapView>(null);
  const centered = useRef(false);
  const [initialRegion] = useState(() => (me ? nearRegion(me) : COUNTRY_REGION));
  const [viewport, setViewport] = useState<Region>(initialRegion);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const padding = useMemo(() => ({ top: 0, left: 0, right: coveredRight, bottom: bottomPadding }), [bottomPadding, coveredRight]);
  // Position fixes re-render the map; stable handlers let the marker lists skip them.
  const handlers = useRef({ onPub, onCity });
  useEffect(() => {
    handlers.current = { onPub, onCity };
  });
  const pressPub = useCallback((id: string) => handlers.current.onPub?.(id), []);
  const pressCity = useCallback((key: string) => handlers.current.onCity?.(key), []);
  const layout = useRef({ size, bottomPadding });
  useEffect(() => {
    layout.current = { size, bottomPadding };
  });
  const pressCluster = useCallback((cluster: PinCluster) => {
    const { size: map, bottomPadding: bottom } = layout.current;
    const pad = CLUSTER_EDGE_PADDING;
    const camera = clusterCamera(cluster.members, {
      width: map.width - pad.left - pad.right,
      height: map.height - bottom - pad.top - pad.bottom,
    });
    if (camera.zoom >= NO_CLUSTER_ZOOM) ref.current?.animateCamera(camera, { duration: 450 });
    else ref.current?.fitToCoordinates(cluster.members.map((m) => ({ latitude: m.lat, longitude: m.lng })), { edgePadding: pad, animated: true });
  }, []);

  useImperativeHandle(handle, () => ({ centerOn: (at) => ref.current?.animateToRegion(nearRegion(at), 450) }));

  // Switching the layer moves the camera; later position fixes must not fight the user's pan.
  useEffect(() => {
    if (view === 'stopy') ref.current?.animateToRegion(COUNTRY_REGION, 450);
    else if (me) ref.current?.animateToRegion(nearRegion(me), 450);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // react-native-maps on iOS drops an instant region move made before the map's first layout or
  // while its camera still moves, and the map would stay on the whole country. Setting
  // the camera directly once the map is ready has neither limit.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!ready || !me || centered.current || view === 'stopy') return;
    centered.current = true;
    ref.current?.setCamera({ center: { latitude: me.lat, longitude: me.lng }, zoom: NEAR_ZOOM });
    onRegion?.(nearRegion(me));
    setViewport(nearRegion(me));
  }, [me, onRegion, ready, view]);

  const targetKey = target?.key ?? null;
  const targetLat = target?.lat;
  const targetLng = target?.lng;
  const { singles, clusters } = useMemo(() => {
    if (view === 'stopy') return { singles: [], clusters: [] };
    // The pub the compass points at stays its own pin, never inside a cluster.
    const own = targetKey && targetLat != null && targetLng != null ? targetPin(pins, { key: targetKey, lat: targetLat, lng: targetLng }) : undefined;
    const grouped = clusterPins(own ? pins.filter((p) => p !== own) : pins, viewport, size.width || 390);
    return { singles: own ? [...grouped.singles, own] : grouped.singles, clusters: grouped.clusters };
  }, [pins, targetKey, targetLat, targetLng, view, viewport, size.width]);

  // Counts a pub as seen once the map stops on it as its own pin; a pub inside a cluster bubble is not shown.
  const focused = useIsFocused();
  useEffect(() => {
    if (!ready || !focused || view === 'stopy' || !size.height) return;
    trackPinsSeen(visiblePins(singles, viewport, size.height - bottomPadding, coveredTop).map((p) => p.key));
  }, [bottomPadding, coveredTop, focused, ready, singles, size.height, view, viewport]);

  return (
    <MapView
      ref={ref}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      customMapStyle={GRAY_MAP}
      initialRegion={initialRegion}
      showsUserLocation={false}
      showsCompass={false}
      showsPointsOfInterests={false}
      showsBuildings={false}
      toolbarEnabled={false}
      mapPadding={padding}
      userInterfaceStyle="dark"
      onLayout={(e) => setSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
      onMapReady={() => setReady(true)}
      onRegionChangeComplete={(region) => {
        setViewport(region);
        onRegion?.(region);
      }}
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
            <StaticMapMarker coordinate={{ latitude: me.lat, longitude: me.lng }} anchor={{ x: 0.5, y: 0.5 }} zIndex={1}>
              <View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.line }, s.center]}>
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: C.white, borderWidth: 3, borderColor: C.black }} />
              </View>
            </StaticMapMarker>
          ) : null}
        </>
      ) : null}
      <PubMarkers pins={singles} targetKey={targetKey} pinMode={pinMode} onPress={pressPub} />
      <ClusterMarkers clusters={clusters} onPress={pressCluster} />
      {view === 'parta' ? <FriendMarkers friends={friends} /> : null}
      {view === 'stopy' ? <CityMarkers cities={cities} selected={selectedCity ?? null} onPress={pressCity} /> : null}
    </MapView>
  );
});

const PubMarkers = memo(function PubMarkers({
  pins,
  targetKey,
  pinMode,
  onPress,
}: {
  pins: MapPin[];
  targetKey: string | null;
  pinMode: 'price' | 'count';
  onPress: (id: string) => void;
}) {
  return pins.map((p) => (
    <StaticMapMarker
      key={`${p.id}-${p.key === targetKey}-${pinMode}-${p.label ?? ''}`}
      coordinate={{ latitude: p.lat, longitude: p.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={() => onPress(p.id)}
      zIndex={p.key === targetKey ? 2 : 0}
    >
      <PubPin label={p.label} target={p.key === targetKey} mode={pinMode} />
    </StaticMapMarker>
  ));
});

const ClusterMarkers = memo(function ClusterMarkers({ clusters, onPress }: { clusters: PinCluster[]; onPress: (cluster: PinCluster) => void }) {
  return clusters.map((c) => (
    <StaticMapMarker
      key={`${c.key}-${c.count}`}
      coordinate={{ latitude: c.lat, longitude: c.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={() => onPress(c)}
    >
      <ClusterPin count={c.count} />
    </StaticMapMarker>
  ));
});

const FriendMarkers = memo(function FriendMarkers({ friends }: { friends: MapFriend[] }) {
  return friends.map((f) => (
    <Marker key={f.key} coordinate={{ latitude: f.lat + 0.0004, longitude: f.lng }} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false}>
      <Person initial={f.initial} size={34} />
    </Marker>
  ));
});

const CityMarkers = memo(function CityMarkers({ cities, selected, onPress }: { cities: MapCity[]; selected: string | null; onPress: (key: string) => void }) {
  return cities.map((c) => (
    <Marker
      key={`${c.key}-${selected === c.key}`}
      coordinate={{ latitude: c.lat, longitude: c.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={() => onPress(c.key)}
      tracksViewChanges={false}
    >
      <CityPin name={c.name} count={c.count} active={selected === c.key} />
    </Marker>
  ));
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

// Black with a white number, like the count badge of CityPin, so it never reads as a white pub pin.
function ClusterPin({ count }: { count: number }) {
  const size = count < 100 ? 32 : 38;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.black, borderWidth: 2, borderColor: C.white }, s.center]}>
      <T s={13} w={800} c={C.white}>
        {count}
      </T>
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
