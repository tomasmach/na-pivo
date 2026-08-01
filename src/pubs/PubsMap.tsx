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

import { MOCK_PUBS } from '@/pubs/mockPubs';
import { Colors, withAlpha } from '@/theme/colors';

/** Prague, roughly where the mocked pubs are — real coordinates per pub would
 *  come from `Pub.lat/lng`; the mock list carries names and distances only, so
 *  they are laid out around the city centre here. */
const CENTRE = { lat: 50.079, lng: 14.432 };
const SPREAD = 0.012;

export function PubsMap({
  recenterSignal = 0,
  onPressPub,
  onPan,
  selectedId,
}: {
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

  // Recentring is a MAP action, so it moves the map — it used to push a whole
  // separate screen, which is a strange answer to "put me back where I am".
  const seenRecenter = useRef(recenterSignal);
  useEffect(() => {
    if (recenterSignal === seenRecenter.current) return;
    seenRecenter.current = recenterSignal;
    mapRef.current?.animateToRegion(
      {
        latitude: CENTRE.lat,
        longitude: CENTRE.lng,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      },
      450,
    );
  }, [recenterSignal]);

  const pins = useMemo(
    () =>
      MOCK_PUBS.map((pub, index) => {
        const angle = (index / MOCK_PUBS.length) * Math.PI * 2;
        return {
          id: pub.id,
          name: pub.name,
          open: pub.open,
          lat: CENTRE.lat + Math.sin(angle) * SPREAD * (0.5 + index / MOCK_PUBS.length),
          lng: CENTRE.lng + Math.cos(angle) * SPREAD * (0.5 + index / MOCK_PUBS.length),
        };
      }),
    [],
  );

  const region: Region = {
    latitude: CENTRE.lat,
    longitude: CENTRE.lng,
    latitudeDelta: SPREAD * 3.4,
    longitudeDelta: SPREAD * 3.4,
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
              !pin.open && styles.pinClosed,
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
