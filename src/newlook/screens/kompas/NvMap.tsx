import React, { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useIsFocused } from 'expo-router';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type MapStyleElement, type Region } from 'react-native-maps';

import { bubblesOverlap, clusterCamera, clusterIndex, clusterLevel, NO_CLUSTER_ZOOM, pinNode, targetPin, zoomOf, type PinNode } from '@/map/clusterPins';
import { FlyingMarker } from '@/map/FlyingMarker';
import { movePins, type ShownPin } from '@/map/pinTransitions';
import { StaticMapMarker } from '@/map/StaticMapMarker';
import { steadyPins } from '@/map/steadyPins';
import { visiblePins } from '@/map/visiblePins';
import { trackPinsSeen } from '@/data/pubReachClient';

import { Icon } from '../../components/Icon';
import { Person, T } from '../../components/ui';
import { DURATION } from '../../motion';
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
export type MapPin = Point & { key: string; id: string; label: string | null; beers: number; restaurant?: boolean };
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
  selectedCity?: string | null;
  onPub?: (id: string) => void;
  onCity?: (key: string) => void;
  onRegion?: (region: Region) => void;
  onPan?: () => void;
  showRoute?: boolean;
  bottomPadding?: number;
  /** Height of the controls drawn over the top of the map. */
  coveredTop?: number;
  /** Width of the iPhone Duo's side column the map runs under; the map centres on what is left. */
  coveredRight?: number;
};

type Frame = { south: number; north: number; west: number; east: number };
/** How far past the screen edge pins are kept ready, as a share of the screen. */
const FRAME_MARGIN = 0.35;
/** The pins regroup at most this often, one pin flight apart. */
const REGROUP_GAP_MS = 220;
/** A pin this far past the screen edge still counts as seen, so a flight across the edge is whole. */
const SEEN_MARGIN = 0.08;

/** The part of the map that gets markers: what `region` shows, the map under the controls and a margin around. */
function frameAround(region: Region, underBottom: number, underRight: number): Frame {
  const lat = region.latitudeDelta;
  const lng = region.longitudeDelta;
  return {
    south: region.latitude - lat * (0.5 + FRAME_MARGIN + underBottom),
    north: region.latitude + lat * (0.5 + FRAME_MARGIN),
    west: region.longitude - lng * (0.5 + FRAME_MARGIN),
    east: region.longitude + lng * (0.5 + FRAME_MARGIN + underRight),
  };
}

function frameShows(frame: Frame, region: Region): boolean {
  return (
    region.latitude - region.latitudeDelta / 2 >= frame.south &&
    region.latitude + region.latitudeDelta / 2 <= frame.north &&
    region.longitude - region.longitudeDelta / 2 >= frame.west &&
    region.longitude + region.longitudeDelta / 2 <= frame.east
  );
}

function inFrame(frame: Frame, at: Point): boolean {
  return at.lat >= frame.south && at.lat <= frame.north && at.lng >= frame.west && at.lng <= frame.east;
}

export const NvMap = forwardRef<NvMapHandle, Props>(function NvMap(
  { pins: loadedPins, me, target, friends, cities, view, selectedCity, onPub, onCity, onRegion, onPan, showRoute = true, bottomPadding = 0, coveredTop = 0, coveredRight = 0 },
  handle,
) {
  const ref = useRef<MapView>(null);
  const centered = useRef(false);
  const [steady, setSteady] = useState(() => ({ loaded: loadedPins, pins: steadyPins([], loadedPins) }));
  let { pins } = steady;
  if (steady.loaded !== loadedPins) {
    pins = steadyPins(pins, loadedPins);
    setSteady({ loaded: loadedPins, pins });
  }
  const [initialRegion] = useState(() => (me ? nearRegion(me) : COUNTRY_REGION));
  const [viewport, setViewport] = useState<Region>(initialRegion);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const width = size.width || 390;
  const [level, setLevel] = useState(() => clusterLevel(zoomOf(initialRegion, width)));
  const shownLevel = useRef(level);
  // The map under the bottom card and the Duo's side column lies outside the region Google reports.
  const underBottom = size.height > bottomPadding ? bottomPadding / (size.height - bottomPadding) : 0;
  const underRight = width > coveredRight ? coveredRight / (width - coveredRight) : 0;
  const [frame, setFrame] = useState(() => frameAround(initialRegion, underBottom, underRight));
  const shownFrame = useRef(frame);
  const lastRegion = useRef<Region>(initialRegion);
  const regroupedAt = useRef(0);
  const regroupLater = useRef<ReturnType<typeof setTimeout> | null>(null);
  const regroupNow = useCallback(
    (region: Region) => {
      const next = clusterLevel(zoomOf(region, width), shownLevel.current);
      if (next === shownLevel.current && frameShows(shownFrame.current, region)) return;
      regroupedAt.current = Date.now();
      shownLevel.current = next;
      shownFrame.current = frameAround(region, underBottom, underRight);
      setLevel(next);
      setFrame(shownFrame.current);
    },
    [underBottom, underRight, width],
  );
  // A fast zoom would mount the pins of every step it passes and drop them a moment later, and a
  // regroup that cuts into a running flight makes the pins jump. The last region still gets its turn.
  const regroup = useCallback(
    (region: Region) => {
      lastRegion.current = region;
      const wait = regroupedAt.current + REGROUP_GAP_MS - Date.now();
      if (wait <= 0) regroupNow(region);
      else
        regroupLater.current ??= setTimeout(() => {
          regroupLater.current = null;
          regroupNow(lastRegion.current);
        }, wait);
    },
    [regroupNow],
  );
  useEffect(
    () => () => {
      if (regroupLater.current) clearTimeout(regroupLater.current);
    },
    [],
  );
  useEffect(() => {
    shownFrame.current = frameAround(lastRegion.current, underBottom, underRight);
    setFrame(shownFrame.current);
  }, [underBottom, underRight]);
  const under = useRef({ underBottom, underRight });
  useEffect(() => {
    under.current = { underBottom, underRight };
  });
  const seen = useCallback((at: Point) => {
    const region = lastRegion.current;
    const lat = region.latitudeDelta;
    const lng = region.longitudeDelta;
    return (
      at.lat >= region.latitude - lat * (0.5 + SEEN_MARGIN + under.current.underBottom) &&
      at.lat <= region.latitude + lat * (0.5 + SEEN_MARGIN) &&
      at.lng >= region.longitude - lng * (0.5 + SEEN_MARGIN) &&
      at.lng <= region.longitude + lng * (0.5 + SEEN_MARGIN + under.current.underRight)
    );
  }, []);
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
  const pressCluster = useCallback((cluster: PinNode<MapPin>) => {
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
    regroup(nearRegion(me));
  }, [me, onRegion, ready, regroup, view]);

  const targetKey = target?.key ?? null;
  const targetLat = target?.lat;
  const targetLng = target?.lng;
  // The pub the compass points at stays its own pin, never inside a cluster.
  const own = useMemo(
    () => (targetKey && targetLat != null && targetLng != null ? targetPin(pins, { key: targetKey, lat: targetLat, lng: targetLng }) : undefined),
    [pins, targetKey, targetLat, targetLng],
  );
  const ownNode = useMemo(() => (own ? pinNode(own) : null), [own]);
  const groupsAt = useMemo(() => clusterIndex(own ? pins.filter((p) => p !== own) : pins), [own, pins]);
  const { nodes, clusterUnderTarget } = useMemo(() => {
    if (view === 'stopy') return { nodes: [], clusterUnderTarget: null };
    const grouped = groupsAt(level).filter((node) => inFrame(frame, node));
    if (!ownNode) return { nodes: grouped, clusterUnderTarget: null };
    // A cluster peeking out from under the target pin would lend it the cluster's beers.
    const under = grouped.find((c) => c.members.length > 1 && bubblesOverlap(c, ownNode, level));
    return { nodes: [...grouped, ownNode], clusterUnderTarget: under?.key ?? null };
  }, [frame, groupsAt, level, ownNode, view]);

  // Counts a pub as seen once the map stops on it as its own pin; a pub inside a cluster bubble is not shown.
  // The pins of a stop can regroup a moment later, so a regroup after the stop counts too.
  const focused = useIsFocused();
  const moving = useRef(false);
  useEffect(() => {
    if (moving.current || !ready || !focused || view === 'stopy' || !size.height) return;
    const alone = groupsAt(level).filter((n) => n.members.length === 1).map((n) => n.lead);
    trackPinsSeen(visiblePins(own ? [...alone, own] : alone, viewport, size.height - bottomPadding, coveredTop).map((p) => p.key));
  }, [bottomPadding, coveredTop, focused, groupsAt, level, own, ready, size.height, view, viewport]);

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
      onRegionChange={(region) => {
        moving.current = true;
        regroup(region);
      }}
      onRegionChangeComplete={(region, details) => {
        moving.current = false;
        regroup(region);
        setViewport(region);
        onRegion?.(region);
        if (details?.isGesture) onPan?.();
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
            <StaticMapMarker coordinate={{ latitude: me.lat, longitude: me.lng }} anchor={{ x: 0.5, y: 0.5 }} zIndex={2}>
              <View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.line }, s.center]}>
                <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: C.white, borderWidth: 3, borderColor: C.black }} />
              </View>
            </StaticMapMarker>
          ) : null}
        </>
      ) : null}
      <PinMarkers nodes={nodes} frame={frame} seen={seen} targetKey={targetKey} quietKey={clusterUnderTarget} onPub={pressPub} onCluster={pressCluster} />
      {view === 'parta' ? <FriendMarkers friends={friends} /> : null}
      {view === 'stopy' ? <CityMarkers cities={cities} selected={selectedCity ?? null} onPress={pressCity} /> : null}
    </MapView>
  );
});

/** A pin fades in this many steps, the last one as its flight lands; DESIGN.md keeps the fade with Reduce Motion on. */
const FADE_STEPS = 4;

const PinMarkers = memo(function PinMarkers({
  nodes,
  frame,
  seen,
  targetKey,
  quietKey,
  onPub,
  onCluster,
}: {
  nodes: PinNode<MapPin>[];
  /** A marker that leaves outside of it goes at once; nobody would see it fade. */
  frame: Frame;
  seen: (at: Point) => boolean;
  targetKey: string | null;
  /** The cluster whose beers stay unshown. */
  quietKey: string | null;
  onPub: (id: string) => void;
  onCluster: (cluster: PinNode<MapPin>) => void;
}) {
  const still = useReducedMotion();
  const [state, setState] = useState(() => ({
    nodes,
    shown: movePins([], nodes),
    fresh: new Set(nodes.map((node) => node.key)),
    growing: new Map<string, PinNode<MapPin>>(),
    step: 1,
  }));
  let now = state;
  if (state.nodes !== nodes) {
    const before = state.shown.filter((pin) => !pin.leaving);
    const known = new Map(before.map((pin) => [pin.node.key, pin.node]));
    const shown = movePins(before, nodes).filter((pin) => !pin.leaving || inFrame(frame, pin.node));
    const fresh = new Set<string>();
    // A bubble that takes in more pubs keeps its old count until they land, so the map never counts a pub twice.
    const growing = new Map<string, PinNode<MapPin>>();
    for (const { node, leaving } of shown) {
      const was = known.get(node.key);
      if (!was) fresh.add(node.key);
      else if (!leaving && node.members.length > was.members.length) growing.set(node.key, was);
    }
    now = { nodes, shown, fresh, growing, step: 1 };
    setState(now);
  }
  // One clock fades every pin of a change, so a fade costs a few renders however many pins it moves.
  useEffect(() => {
    if (state.step >= FADE_STEPS) return;
    const timer = setTimeout(
      () =>
        setState((last) => {
          if (last !== state) return last;
          const step = last.step + 1;
          return step < FADE_STEPS ? { ...last, step } : { ...last, step, shown: last.shown.filter((pin) => !pin.leaving) };
        }),
      DURATION.base / (FADE_STEPS - 1),
    );
    return () => clearTimeout(timer);
  }, [state]);
  const landed = now.step >= FADE_STEPS;
  // A leaving pin is gone a step before it lands, so it never lies half faded over the bubble's number.
  const leaving = Math.max(0, 1 - now.step / (FADE_STEPS - 1));
  return now.shown.map((pin) => (
    <PinMarker
      key={pin.node.key}
      pin={pin}
      drawn={landed ? pin.node : (now.growing.get(pin.node.key) ?? pin.node)}
      opacity={pin.leaving ? leaving : now.fresh.has(pin.node.key) ? now.step / FADE_STEPS : 1}
      seen={seen}
      still={still}
      target={pin.node.lead.key === targetKey}
      quiet={pin.node.key === quietKey}
      onPub={onPub}
      onCluster={onCluster}
    />
  ));
});

const PinMarker = memo(function PinMarker({
  pin,
  drawn,
  opacity,
  seen,
  still,
  target,
  quiet,
  onPub,
  onCluster,
}: {
  pin: ShownPin<PinNode<MapPin>>;
  /** The group whose count and beers the marker shows. */
  drawn: PinNode<MapPin>;
  opacity: number;
  seen: (at: Point) => boolean;
  /** With Reduce Motion on a pin fades where it stands and does not fly. */
  still: boolean;
  target: boolean;
  quiet: boolean;
  onPub: (id: string) => void;
  onCluster: (cluster: PinNode<MapPin>) => void;
}) {
  const { node } = pin;
  const { lead } = node;
  const count = drawn.members.length;
  const alone = count === 1;
  const beers = alone ? lead.beers : quiet ? 0 : drawn.members.reduce((sum, member) => sum + member.beers, 0);
  const { label, restaurant } = lead;
  const content = useMemo(
    () => <WithBeers beers={beers}>{alone ? <PubPin label={label} target={target} restaurant={restaurant} /> : <ClusterPin count={count} />}</WithBeers>,
    [alone, beers, count, label, restaurant, target],
  );
  return (
    <FlyingMarker
      at={still && pin.leaving ? node : pin.at}
      from={still ? null : pin.from}
      seen={seen}
      still={still}
      opacity={opacity}
      snapshot={alone ? `${target}-${label ?? ''}-${beers}-${restaurant === true}` : `${count}-${beers}`}
      anchor={{ x: 0.5, y: 0.5 }}
      onPress={() => {
        if (pin.leaving) return;
        if (alone) onPub(lead.id);
        else onCluster(node);
      }}
      zIndex={!alone ? 1 : target ? 3 : 0}
    >
      {content}
    </FlyingMarker>
  );
});

const FriendMarkers = memo(function FriendMarkers({ friends }: { friends: MapFriend[] }) {
  return friends.map((f) => (
    <Marker key={f.key} coordinate={{ latitude: f.lat + 0.0004, longitude: f.lng }} anchor={{ x: 0.5, y: 1 }} zIndex={2} tracksViewChanges={false}>
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

export function PubPin({ label, target, restaurant }: { label: string | null; target: boolean; restaurant?: boolean }) {
  const showIcon = !label || target || restaurant;
  const icon = restaurant ? 'utensils' : 'beer';
  if (target && !label) {
    return (
      <View style={[{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
        <Icon name={icon} size={17} color={C.black} />
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
      {showIcon ? <Icon name={icon} size={target ? 16 : 14} color={C.black} /> : null}
      {label ? (
        <T s={target ? 15 : 13} w={target ? 800 : 700} c={C.black}>
          {label}
        </T>
      ) : null}
    </View>
  );
}

const BADGE_ROOM = 14;

/** Last week's beers in the pin's top right corner, as the 2.x map had them. */
function WithBeers({ beers, children }: { beers: number; children: React.ReactNode }) {
  if (!beers) return <>{children}</>;
  // Even padding keeps the pin itself in the middle, where the marker is anchored.
  return (
    <View style={{ padding: BADGE_ROOM }}>
      {children}
      <View
        style={[
          s.row,
          { position: 'absolute', top: 0, right: 0, height: 20, borderRadius: 10, paddingHorizontal: 5, gap: 2, backgroundColor: C.yellow, borderWidth: 1.5, borderColor: C.black },
        ]}
      >
        <Icon name="beer" size={11} color={C.black} />
        <T s={11} w={800} c={C.black}>
          {beers > 99 ? '99+' : beers}
        </T>
      </View>
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
