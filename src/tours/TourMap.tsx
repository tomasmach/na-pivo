import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MapView, { Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { StaticMapMarker } from '@/map/StaticMapMarker';
import { MapIcon, PlusIcon, MapPinIcon } from '@/components/shared/IconGlyph';
import { MoreSheet } from '@/components/shared/MoreSheet';
import type { Pub } from '@/data/pubs';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import type { TourStop } from './model';

export const DEFAULT_TOUR_REGION: Region = {
  latitude: 49.82, longitude: 15.47, latitudeDelta: 4.7, longitudeDelta: 4.2,
};

export function tourRegion(stops: readonly TourStop[], height = 300): Region {
  if (!stops.length) return DEFAULT_TOUR_REGION;
  const lats = stops.map((stop) => stop.lat);
  const lons = stops.map((stop) => stop.lon);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const padding = Math.max(1.55, height / Math.max(28, height - 88));
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(0.012, (maxLat - minLat) * padding),
    longitudeDelta: Math.max(0.012, (maxLon - minLon) * 1.55),
  };
}

export interface TourMapProps {
  stops: readonly TourStop[];
  selectedId?: string | null;
  onSelect: (id: string) => void;
  height: number;
  region?: Region;
  onRegionChange?: (region: Region) => void;
  onExpand?: () => void;
  candidates?: readonly Pub[];
  selectedCandidateId?: string | null;
  onCandidate?: (pub: Pub) => void;
}

/** The line is the itinerary's order, never a walking route. GPS is not needed. */
export function TourMap({ stops, selectedId, onSelect, height, region, onRegionChange, onExpand, candidates = [], selectedCandidateId, onCandidate }: TourMapProps) {
  const { fontScale } = useWindowDimensions();
  const captionHeight = stops.length > 1 ? Spacing.xs + Math.ceil(16 * Math.min(fontScale, 1.3)) : 0;
  const mapHeight = Math.max(0, height - captionHeight);
  const [initialRegion] = useState(() => region ?? (stops.length ? tourRegion(stops, mapHeight) : DEFAULT_TOUR_REGION)); // preserve the viewport while editing / selecting
  const [viewport, setViewport] = useState(initialRegion);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const timeout = setTimeout(() => setUnavailable(true), 8000);
    return () => clearTimeout(timeout);
  }, [loaded, attempt]);
  const [width, setWidth] = useState(375);
  const [overlapIds, setOverlapIds] = useState<string[]>([]);
  const overlaps = stops.filter((stop) => overlapIds.includes(stop.id));
  function select(stop: TourStop) {
    const near = stops.filter((other) =>
      Math.abs(other.lat - stop.lat) / viewport.latitudeDelta * mapHeight < 40 &&
      Math.abs(other.lon - stop.lon) / viewport.longitudeDelta * width < 40,
    );
    if (near.length > 1) setOverlapIds(near.map((item) => item.id));
    else onSelect(stop.id);
  }
  return (
    <View style={{ height }}>
    <View style={[styles.frame, { height: mapHeight }]} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      {!unavailable && <MapView
        key={attempt}
        onMapLoaded={() => setLoaded(true)}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        userInterfaceStyle="dark"
        initialRegion={initialRegion}
        region={region}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        rotateEnabled={false}
        pitchEnabled={false}
        onPress={(event) => { if (event.nativeEvent.action !== 'marker-press') onSelect(''); }}
        onRegionChangeComplete={(next, details) => {
          setViewport(next);
          // Maps with different aspect ratios expand native bounds while fitting them.
          // Only user gestures should feed those bounds back into the shared viewport.
          if (details.isGesture) onRegionChange?.(next);
        }}
        accessibilityLabel={t.tours.map}
      >
        {stops.length > 1 && <Polyline coordinates={stops.map((stop) => ({ latitude: stop.lat, longitude: stop.lon }))} strokeColor={Colors.foamMuted} strokeWidth={2} lineDashPattern={[6, 6]} />}
        {candidates.map((pub) => (
          <StaticMapMarker key={`candidate:${pub.id}:${pub.id === selectedCandidateId}`} identifier={`candidate:${pub.id}`} anchor={{ x: 0.5, y: 0.5 }} coordinate={{ latitude: pub.lat, longitude: pub.lng }} zIndex={pub.id === selectedCandidateId ? 4 : 1} onPress={(event) => { event.stopPropagation(); onCandidate?.(pub); }} accessibilityLabel={pub.name}>
            <View collapsable={false} style={styles.markerTarget}><View style={[styles.candidate, pub.id === selectedCandidateId && styles.selectedCandidate]}><PlusIcon size={pub.id === selectedCandidateId ? 15 : 13} color={pub.id === selectedCandidateId ? Colors.amber : Colors.foam} /></View></View>
          </StaticMapMarker>
        ))}
        {stops.map((stop, index) => (
          <StaticMapMarker anchor={{ x: 0.5, y: 0.5 }} key={`${stop.id}:${index}:${stop.id === selectedId}`} identifier={stop.id} coordinate={{ latitude: stop.lat, longitude: stop.lon }} onPress={(event) => { event.stopPropagation(); select(stop); }} zIndex={stop.id === selectedId ? 3 : 2} accessibilityLabel={`${index + 1}. ${stop.name}`}>
            <View collapsable={false} style={styles.markerTarget}><View style={[styles.marker, stop.id === selectedId && styles.selected]}><Text allowFontScaling={false} style={styles.number}>{index + 1}</Text></View></View>
          </StaticMapMarker>
        ))}
      </MapView>}
      {unavailable && <View style={styles.fallback}><Text maxFontSizeMultiplier={1.3} style={styles.fallbackText}>{t.tours.mapUnavailable}</Text><Pressable style={styles.retry} accessibilityRole="button" accessibilityLabel={t.tours.retry} onPress={() => { setUnavailable(false); setLoaded(false); setAttempt((value) => value + 1); }}><Text maxFontSizeMultiplier={1.3} style={styles.fallbackText}>{t.tours.retry}</Text></Pressable></View>}
      {onExpand && !unavailable && <Pressable accessibilityRole="button" accessibilityLabel={t.tours.expandMap} style={styles.expand} onPress={onExpand}><MapIcon size={22} color={Colors.foam} /></Pressable>}
      <MoreSheet visible={overlaps.length > 1} title={t.tours.overlappingStops} onClose={() => setOverlapIds([])}
        rows={overlaps.map((stop) => ({ key: stop.id, icon: MapPinIcon, label: `${stops.findIndex((item) => item.id === stop.id) + 1}. ${stop.name}`, onPress: () => { setOverlapIds([]); onSelect(stop.id); } }))} />
    </View>
      {stops.length > 1 && <Text maxFontSizeMultiplier={1.3} numberOfLines={1} style={[styles.captionText, { height: captionHeight }]}>{t.tours.routeOrder}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { flex: 1, justifyContent: 'center', paddingHorizontal: Spacing.md },
  fallbackText: { color: Colors.foamMuted, fontFamily: Fonts.ui.medium, fontSize: 13, lineHeight: 19 },
  retry: { minHeight: 44, justifyContent: 'center' },
  frame: { backgroundColor: Colors.stout2, overflow: 'hidden' },
  markerTarget: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  marker: { width: 24, height: 24, borderRadius: Radius.pill, backgroundColor: Colors.foam, borderWidth: 1.5, borderColor: Colors.stout, alignItems: 'center', justifyContent: 'center' },
  selected: { borderColor: Colors.amber },
  number: { color: Colors.stout, fontFamily: Fonts.display.bold, fontSize: 14, lineHeight: 20, includeFontPadding: false, textAlign: 'center' },
  candidate: { width: 20, height: 20, borderRadius: Radius.pill, backgroundColor: Colors.stout2, borderWidth: 1, borderColor: Colors.foamMuted, justifyContent: 'center', alignItems: 'center' },
  selectedCandidate: { width: 24, height: 24, borderWidth: 2, borderColor: Colors.amber },
  expand: { position: 'absolute', top: Spacing.md, right: Spacing.md, width: 44, height: 44, borderRadius: Radius.pill, backgroundColor: Colors.stout, alignItems: 'center', justifyContent: 'center' },
  captionText: { fontFamily: Fonts.ui.medium, fontSize: 11, color: Colors.foamMuted, paddingTop: Spacing.xs, lineHeight: 16 },
});
