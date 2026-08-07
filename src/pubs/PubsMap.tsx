import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import { clusterCoordinates } from '@/map/mapModel';
import type { PubPosition, PubPresentation } from '@/pubs/pubPresentation';
import { Colors, withAlpha } from '@/theme/colors';

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
}: {
  pubs: readonly PubPresentation[];
  currentPosition: PubPosition | null;
  recenterSignal?: number;
  onPressPub?: (id: string) => void;
  selectedId?: string | null;
  onPan?: () => void;
}) {
  const mapRef = useRef<MapView>(null);
  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const region = useMemo(
    () => initialRegionFor(pubs, currentPosition),
    [currentPosition, pubs],
  );
  const visibleRegion = mapRegion ?? region;
  const coordinateSignature = pubs
    .map((pub) => `${pub.id}:${pub.pub.lat}:${pub.pub.lng}`)
    .join('|');

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
    return clusterCoordinates(points, visibleRegion);
  }, [pubs, selectedId, visibleRegion]);

  const selectedPub = selectedId ? pubs.find((pub) => pub.id === selectedId) ?? null : null;

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
    mapRef.current?.fitToCoordinates(
      pubs.map((pub) => ({ latitude: pub.pub.lat, longitude: pub.pub.lng })),
      { edgePadding: { top: 100, right: 36, bottom: 300, left: 36 }, animated: false },
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
        return (
          <Marker
            key={`${pub.id}:compact`}
            coordinate={{ latitude: pub.pub.lat, longitude: pub.pub.lng }}
            onPress={() => onPressPub?.(pub.id)}
            tracksViewChanges={false}
            accessibilityLabel={pub.name}
          >
            <View
              style={[styles.pin, pub.openState === 'closed' && styles.pinClosed]}
            />
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
  pin: {
    width: 14,
    height: 14,
    borderRadius: 7,
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
