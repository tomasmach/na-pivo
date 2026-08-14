import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { clusterCoordinates } from '@/map/mapModel';
import type { PubPosition, PubPresentation } from '@/pubs/pubPresentation';
import { Colors, withAlpha } from '@/theme/colors';

/** How close two pubs have to be before they collapse into one bubble, and the
 *  zoom at which that finer grid kicks in (about a district across the screen). */
const CLUSTER_COLUMNS = 9;
const CLUSTER_ROWS = 14;
const CLUSTER_FINE_DELTA = 0.06;

/**
 * Named pins per screen, and how far apart two names have to be — as a share of
 * the visible region, so the gap holds at every zoom. The label is 104pt wide
 * and 30pt tall on a ~400 × 870pt screen; these are those numbers plus room to
 * breathe.
 */
const LABEL_MAX = 16;
const LABEL_HALF_WIDTH = 0.14;
const LABEL_HALF_HEIGHT = 0.022;
const BUBBLE_HALF_WIDTH = 0.045;
const BUBBLE_HALF_HEIGHT = 0.02;
/** Roughly a city across the screen. Wider than this and the names are noise. */
const LABEL_MAX_DELTA = 0.09;

/** Dot, gap, one line of text — the anchor keeps the dot on the coordinate. */
const PIN_SIZE = 14;
const PIN_LABEL_LINE = 15;
const PIN_LABEL_GAP = 2;
const PIN_ANCHOR = {
  x: 0.5,
  y: PIN_SIZE / 2 / (PIN_SIZE + PIN_LABEL_GAP + PIN_LABEL_LINE),
};

type ClusterPoint = {
  lat: number;
  lng: number;
  pub: PubPresentation;
};

function initialRegionFor(
  pubs: readonly PubPresentation[],
  position: PubPosition | null,
): Region | null {
  if (position) {
    return {
      latitude: position.lat,
      longitude: position.lng,
      latitudeDelta: 0.025,
      longitudeDelta: 0.025,
    };
  }
  if (pubs.length === 0) return null;
  const latitudes = pubs.map((pub) => pub.pub.lat);
  const longitudes = pubs.map((pub) => pub.pub.lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(0.02, (maxLat - minLat) * 1.35),
    longitudeDelta: Math.max(0.02, (maxLng - minLng) * 1.35),
  };
}

export function PubsMap({
  pubs,
  currentPosition,
  recenterSignal = 0,
  onPressPub,
  onPan,
  selectedId,
  bottomInset = 0,
}: {
  pubs: readonly PubPresentation[];
  currentPosition: PubPosition | null;
  recenterSignal?: number;
  onPressPub?: (id: string) => void;
  selectedId?: string | null;
  onPan?: () => void;
  /**
   * How much of the map the sheet and the floating cards cover, in points.
   *
   * Everything the map centres on — you, the pub you tapped, the locate
   * button — lands in the middle of the WHOLE map without this, which is
   * behind the sheet. The padding moves the map's idea of centre up into the
   * strip you can actually see.
   */
  bottomInset?: number;
}) {
  const mapRef = useRef<MapView>(null);
  const { height: screenHeight } = useWindowDimensions();
  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const region = useMemo(
    () => initialRegionFor(pubs, currentPosition),
    [currentPosition, pubs],
  );
  const visibleRegion = mapRegion ?? region;
  const coordinateSignature = useMemo(
    () => pubs.map((pub) => `${pub.id}:${pub.pub.lat}:${pub.pub.lng}`).join('|'),
    [pubs],
  );

  const clusters = useMemo(() => {
    if (!visibleRegion) return [];
    const latMargin = visibleRegion.latitudeDelta * 0.65;
    const lngMargin = visibleRegion.longitudeDelta * 0.65;
    const points: ClusterPoint[] = pubs
      .filter((pub) => pub.id !== selectedId)
      .map((pub) => ({ lat: pub.pub.lat, lng: pub.pub.lng, pub }))
      .filter(
        (point) =>
          Math.abs(point.lat - visibleRegion.latitude) <= latMargin &&
          Math.abs(point.lng - visibleRegion.longitude) <= lngMargin,
      );
    // Finer than the default grid once you are close: at street level a bubble
    // reading "2" is worse than two dots, because a dot can carry a name and a
    // bubble cannot. Zoomed out to a whole region the same grid turns into a
    // field of bubbles, so the coarse one stays there.
    const close = visibleRegion.latitudeDelta <= CLUSTER_FINE_DELTA;
    return close
      ? clusterCoordinates(points, visibleRegion, CLUSTER_COLUMNS, CLUSTER_ROWS)
      : clusterCoordinates(points, visibleRegion);
  }, [pubs, selectedId, visibleRegion]);

  const selectedPub = selectedId ? pubs.find((pub) => pub.id === selectedId) ?? null : null;

  // Capped: past two thirds of the screen there is no strip left to centre in,
  // and a padding taller than the map makes Google Maps place things off view.
  const mapPadding = useMemo(
    () => ({
      top: 0,
      right: 0,
      bottom: Math.round(Math.min(bottomInset, screenHeight * 0.62)),
      left: 0,
    }),
    [bottomInset, screenHeight],
  );

  /**
   * Which pins say their name out loud.
   *
   * A field of identical dots answers "there is a pub there" and nothing else —
   * you had to tap each one to learn which. Every pin carrying its name would
   * be a wall of overlapping text, so the names are rationed two ways: a coarse
   * screen grid (one name per cell, so two labels never share a line) and the
   * list's own order, which puts the nearest pubs first. Zoomed out past a city
   * the names go away entirely; at that scale nothing is legible anyway.
   */
  const labelledIds = useMemo(() => {
    const ids = new Set<string>();
    if (!visibleRegion || visibleRegion.latitudeDelta > LABEL_MAX_DELTA) return ids;
    // Keep-out box around anything already wearing text, in degrees, sized from
    // the label itself. A grid was the first attempt and it dropped names whose
    // neighbour was two cells away while still letting two names touch across a
    // cell boundary — the thing that matters is the gap, so measure the gap.
    // Every occupied thing claims a box its own size — a cluster bubble is 32pt
    // across and a name is 104pt, so treating them alike either let names touch
    // or blanked out a dense city block for one bubble.
    const label = {
      lat: visibleRegion.latitudeDelta * LABEL_HALF_HEIGHT,
      lng: visibleRegion.longitudeDelta * LABEL_HALF_WIDTH,
    };
    const bubble = {
      lat: visibleRegion.latitudeDelta * BUBBLE_HALF_HEIGHT,
      lng: visibleRegion.longitudeDelta * BUBBLE_HALF_WIDTH,
    };
    const claimed: { lat: number; lng: number; halfLat: number; halfLng: number }[] = [];
    const free = (lat: number, lng: number) =>
      claimed.every(
        (spot) =>
          Math.abs(spot.lat - lat) >= spot.halfLat + label.lat ||
          Math.abs(spot.lng - lng) >= spot.halfLng + label.lng,
      );
    // The selected pin already wears its name, and cluster bubbles carry a
    // count — both claim their space before anything else can label into it.
    if (selectedPub) {
      claimed.push({
        lat: selectedPub.pub.lat,
        lng: selectedPub.pub.lng,
        halfLat: label.lat,
        halfLng: label.lng * 1.35,
      });
    }
    for (const cluster of clusters) {
      if (cluster.items.length > 1) {
        claimed.push({
          lat: cluster.lat,
          lng: cluster.lng,
          halfLat: bubble.lat,
          halfLng: bubble.lng,
        });
      }
    }
    for (const cluster of clusters) {
      if (ids.size >= LABEL_MAX) break;
      if (cluster.items.length > 1) continue;
      const pub = cluster.items[0].pub;
      if (!free(pub.pub.lat, pub.pub.lng)) continue;
      claimed.push({
        lat: pub.pub.lat,
        lng: pub.pub.lng,
        halfLat: label.lat,
        halfLng: label.lng,
      });
      ids.add(pub.id);
    }
    return ids;
  }, [clusters, selectedPub, visibleRegion]);

  const openCluster = useCallback(
    (latitude: number, longitude: number) => {
      if (!visibleRegion) return;
      mapRef.current?.animateToRegion(
        {
          latitude,
          longitude,
          latitudeDelta: Math.max(visibleRegion.latitudeDelta / 2.5, 0.0015),
          longitudeDelta: Math.max(visibleRegion.longitudeDelta / 2.5, 0.0015),
        },
        320,
      );
    },
    [visibleRegion],
  );

  const seenRecenter = useRef(recenterSignal);
  useEffect(() => {
    if (recenterSignal === seenRecenter.current) return;
    seenRecenter.current = recenterSignal;
    if (!currentPosition) return;
    mapRef.current?.animateToRegion(
      {
        latitude: currentPosition.lat,
        longitude: currentPosition.lng,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      },
      450,
    );
  }, [currentPosition, recenterSignal]);

  const fittedSignature = useRef('');
  useEffect(() => {
    if (coordinateSignature === fittedSignature.current) return;
    fittedSignature.current = coordinateSignature;
    // Nearby discovery stays centred on the user. Fitting the complete backend
    // result set can zoom the map out across a whole city and stack every pin
    // into one unreadable cloud. Only fit the catalogue when location is not
    // available and it is our sole source of map context.
    if (currentPosition || pubs.length <= 1) return;
    // Even padding: what the sheet covers is already handled by `mapPadding`,
    // and adding 300pt of bottom edge on top of it pushed the fitted catalogue
    // up into the notch.
    mapRef.current?.fitToCoordinates(
      pubs.map((pub) => ({ latitude: pub.pub.lat, longitude: pub.pub.lng })),
      { edgePadding: { top: 72, right: 36, bottom: 72, left: 36 }, animated: false },
    );
  }, [coordinateSignature, currentPosition, pubs]);

  const animatedSelection = useRef('');
  useEffect(() => {
    if (!selectedId) return;
    const selected = pubs.find((pub) => pub.id === selectedId);
    if (!selected) return;
    const signature = `${selected.id}:${selected.pub.lat}:${selected.pub.lng}`;
    if (signature === animatedSelection.current) return;
    animatedSelection.current = signature;
    mapRef.current?.animateCamera(
      { center: { latitude: selected.pub.lat, longitude: selected.pub.lng } },
      { duration: 300 },
    );
  });

  if (!region) return <View style={[StyleSheet.absoluteFill, styles.emptyMap]} />;

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      initialRegion={region}
      userInterfaceStyle="dark"
      showsUserLocation={currentPosition != null}
      showsMyLocationButton={false}
      showsCompass={false}
      showsPointsOfInterests={false}
      toolbarEnabled={false}
      loadingBackgroundColor={Colors.stout}
      loadingIndicatorColor={Colors.amber}
      onPanDrag={onPan}
      mapPadding={mapPadding}
      onRegionChangeComplete={setMapRegion}
    >
      {clusters.map((cluster) => {
        if (cluster.items.length > 1) {
          return (
            <Marker
              key={`cluster:${cluster.id}:${cluster.items.length}`}
              coordinate={{ latitude: cluster.lat, longitude: cluster.lng }}
              onPress={() => openCluster(cluster.lat, cluster.lng)}
              tracksViewChanges={false}
              accessibilityLabel={`${cluster.items.length} hospod. Přiblížit`}
            >
              <View style={styles.clusterPin}>
                <Text style={styles.clusterText} allowFontScaling={false}>
                  {cluster.items.length}
                </Text>
              </View>
            </Marker>
          );
        }
        const pub = cluster.items[0].pub;
        const closed = pub.openState === 'closed';
        const labelled = labelledIds.has(pub.id);
        return (
          <Marker
            key={`${pub.id}:${labelled ? 'named' : 'compact'}`}
            coordinate={{ latitude: pub.pub.lat, longitude: pub.pub.lng }}
            onPress={() => onPressPub?.(pub.id)}
            tracksViewChanges={false}
            accessibilityLabel={pub.name}
            {...(labelled ? { anchor: PIN_ANCHOR } : null)}
          >
            {labelled ? (
              <View style={styles.namedPin}>
                <View style={[styles.pin, closed && styles.pinClosed]} />
                <Text
                  style={[styles.pinLabel, closed && styles.pinLabelClosed]}
                  numberOfLines={1}
                  allowFontScaling={false}
                >
                  {pub.name}
                </Text>
              </View>
            ) : (
              <View style={[styles.pin, closed && styles.pinClosed]} />
            )}
          </Marker>
        );
      })}

      {selectedPub ? (
        <Marker
          key={`${selectedPub.id}:selected`}
          coordinate={{ latitude: selectedPub.pub.lat, longitude: selectedPub.pub.lng }}
          onPress={() => onPressPub?.(selectedPub.id)}
          tracksViewChanges={false}
          accessibilityLabel={selectedPub.name}
          zIndex={10}
        >
          <View style={styles.pinSelected}>
            <Text style={styles.pinTextSelected} numberOfLines={1} allowFontScaling={false}>
              {selectedPub.name}
            </Text>
          </View>
        </Marker>
      ) : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  emptyMap: { backgroundColor: Colors.stout },
  // Bounded: the whole marker view takes taps, so a wide one would swallow the
  // dots beside it. Long names truncate instead.
  namedPin: { alignItems: 'center', gap: PIN_LABEL_GAP, width: 104 },
  // Shadow rather than a plate: a name over a dark map reads fine, and twelve
  // filled chips would be a second map on top of the first one.
  pinLabel: {
    fontSize: 11,
    lineHeight: PIN_LABEL_LINE,
    fontWeight: '700',
    color: Colors.foam,
    textAlign: 'center',
    textShadowColor: withAlpha('#000000', 0.9),
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 4,
  },
  pinLabelClosed: { color: withAlpha(Colors.foam, 0.62) },
  pin: {
    width: PIN_SIZE,
    height: PIN_SIZE,
    borderRadius: PIN_SIZE / 2,
    backgroundColor: Colors.amber,
    borderWidth: 2,
    borderColor: withAlpha('#000000', 0.78),
  },
  pinClosed: {
    backgroundColor: withAlpha(Colors.foam, 0.48),
    borderColor: withAlpha('#000000', 0.72),
  },
  pinSelected: {
    paddingHorizontal: 9,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    maxWidth: 140,
    backgroundColor: Colors.amber,
    borderWidth: 1.5,
    borderColor: Colors.amber,
  },
  pinTextSelected: { fontSize: 12, fontWeight: '700', color: Colors.stout },
  clusterPin: {
    minWidth: 32,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha('#000000', 0.82),
    borderWidth: 2,
    borderColor: Colors.amber,
  },
  clusterText: { fontSize: 12, fontWeight: '800', color: Colors.amber },
});
