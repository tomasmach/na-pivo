import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import type { PubPosition, PubPresentation } from '@/pubs/pubPresentation';
import { Colors, withAlpha } from '@/theme/colors';

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
  const region = useMemo(
    () => initialRegionFor(pubs, currentPosition),
    [currentPosition, pubs],
  );
  const coordinateSignature = pubs
    .map((pub) => `${pub.id}:${pub.pub.lat}:${pub.pub.lng}`)
    .join('|');

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
    if (pubs.length <= 1) return;
    mapRef.current?.fitToCoordinates(
      pubs.map((pub) => ({ latitude: pub.pub.lat, longitude: pub.pub.lng })),
      { edgePadding: { top: 100, right: 36, bottom: 300, left: 36 }, animated: false },
    );
  });

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
    >
      {pubs.map((pub) => (
        <Marker
          key={pub.id}
          coordinate={{ latitude: pub.pub.lat, longitude: pub.pub.lng }}
          onPress={() => onPressPub?.(pub.id)}
          tracksViewChanges={false}
        >
          <View
            style={[
              styles.pin,
              pub.openState === 'closed' && styles.pinClosed,
              pub.id === selectedId && styles.pinSelected,
            ]}
          >
            <Text
              style={[styles.pinText, pub.id === selectedId && styles.pinTextSelected]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {pub.name}
            </Text>
          </View>
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  emptyMap: { backgroundColor: Colors.stout },
  pin: {
    paddingHorizontal: 9,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
    maxWidth: 140,
    backgroundColor: withAlpha('#000000', 0.78),
    borderWidth: 1.5,
    borderColor: Colors.amber,
  },
  pinClosed: { borderColor: withAlpha(Colors.foam, 0.3) },
  pinSelected: { backgroundColor: Colors.amber, borderColor: Colors.amber },
  pinTextSelected: { color: Colors.stout },
  pinText: { fontSize: 12, fontWeight: '700', color: Colors.foam },
});
