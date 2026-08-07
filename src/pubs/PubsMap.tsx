/**
 * DESIGN MOCK — the map behind the places sheet.
 *
 * Every mocked pub, pinned, framed to fit them all. It is the backdrop of the
 * Hospody screen rather than a destination: the sheet sits over it and the map
 * answers "where is all this" without being asked.
 *
 * Interaction stays on — unlike the feed card's map, this one you can pan and
 * pinch, because the sheet leaves it half the screen and a map you cannot move
 * in that space is a picture pretending to be a map.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';

import type { PubListItem } from '@/pubs/pubPresentation';
import { Colors, withAlpha } from '@/theme/colors';

export function PubsMap({
  pubs,
  position,
  recenterSignal = 0,
  onPressPub,
  onPan,
  selectedId,
}: {
  pubs: PubListItem[];
  position: { lat: number; lng: number } | null;
  /** Bump to fly the map back to where you are. */
  recenterSignal?: number;
  onPressPub?: (id: string) => void;
  /** The pub the floating card is currently on — its pin leads. */
  selectedId?: string | null;
  /** Fires while the user drags the map — the screen uses it to get the sheet
   *  out of the way (Apple Maps behaviour). */
  onPan?: () => void;
}) {
  const mapRef = useRef<MapView>(null);
  const framedRealPosition = useRef(false);

  useEffect(() => {
    if (!position || framedRealPosition.current) return;
    framedRealPosition.current = true;
    mapRef.current?.animateToRegion(
      {
        latitude: position.lat,
        longitude: position.lng,
        latitudeDelta: 0.04,
        longitudeDelta: 0.04,
      },
      350,
    );
  }, [position]);

  // Recentring is a MAP action, so it moves the map — it used to push a whole
  // separate screen, which is a strange answer to "put me back where I am".
  const seenRecenter = useRef(recenterSignal);
  useEffect(() => {
    if (recenterSignal === seenRecenter.current) return;
    seenRecenter.current = recenterSignal;
    mapRef.current?.animateToRegion(
      {
        latitude: position?.lat ?? pubs[0]?.lat ?? 50.0755,
        longitude: position?.lng ?? pubs[0]?.lng ?? 14.4378,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      },
      450,
    );
  }, [position?.lat, position?.lng, pubs, recenterSignal]);

  const pins = useMemo(
    () =>
      pubs.map((pub) => ({
          id: pub.id,
          name: pub.name,
          open: pub.open,
          lat: pub.lat,
          lng: pub.lng,
        })),
    [pubs],
  );

  const region: Region = {
    latitude: position?.lat ?? pubs[0]?.lat ?? 50.0755,
    longitude: position?.lng ?? pubs[0]?.lng ?? 14.4378,
    latitudeDelta: 0.04,
    longitudeDelta: 0.04,
  };

  return (
    <MapView
      ref={mapRef}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      initialRegion={region}
      userInterfaceStyle="dark"
      showsUserLocation
      showsMyLocationButton={false}
      showsCompass={false}
      showsPointsOfInterests={false}
      toolbarEnabled={false}
      loadingBackgroundColor={Colors.stout}
      loadingIndicatorColor={Colors.amber}
      onPanDrag={onPan}
    >
      {pins.map((pin) => (
        <Marker
          key={pin.id}
          coordinate={{ latitude: pin.lat, longitude: pin.lng }}
          onPress={() => onPressPub?.(pin.id)}
          tracksViewChanges={false}
        >
          <View
            style={[
              styles.pin,
              pin.open === false && styles.pinClosed,
              pin.id === selectedId && styles.pinSelected,
            ]}
          >
            <Text
              style={[styles.pinText, pin.id === selectedId && styles.pinTextSelected]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {pin.name}
            </Text>
          </View>
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
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
  /** The card you are on. Filled rather than merely outlined, so it reads as
   *  the subject of the screen and not just another marker. */
  pinSelected: { backgroundColor: Colors.amber, borderColor: Colors.amber },
  pinTextSelected: { color: Colors.stout },
  pinText: { fontSize: 12, fontWeight: '700', color: Colors.foam },
});
