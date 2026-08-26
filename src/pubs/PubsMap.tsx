import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  type MapViewProps,
  type Region,
} from 'react-native-maps';

import { BeerIcon } from '@/components/shared/IconGlyph';
import type { PubPosition, PubPresentation } from '@/pubs/pubPresentation';
import { pubCountLabel } from '@/i18n/plural';
import { buildPubsMapClusters, pubsMapGrid } from '@/pubs/pubsMapModel';
import { Colors, withAlpha } from '@/theme/colors';

/**
 * Named pins per screen, and how far apart two names have to be — as a share of
 * the visible region, so the gap holds at every zoom. These are half sizes in
 * points plus breathing room; they are converted using the map's visible area.
 */
const LABEL_HALF_WIDTH_PX = 56;
const LABEL_HALF_HEIGHT_PX = 19;
const BUBBLE_HALF_WIDTH_PX = 18;
const BUBBLE_HALF_HEIGHT_PX = 17;
/** Roughly a city across the screen. Wider than this and the names are noise. */
const LABEL_MAX_DELTA = 0.035;

/** Tappable beer marker, gap, one line of text. */
const PIN_HIT_SIZE = 56;
const PIN_LABEL_LINE = 15;
const PIN_LABEL_GAP = 2;
const PIN_ANCHOR = {
  x: 0.5,
  y: PIN_HIT_SIZE / 2 / (PIN_HIT_SIZE + PIN_LABEL_GAP + PIN_LABEL_LINE),
};

const CENTER_ANCHOR = { x: 0.5, y: 0.5 } as const;

/** How long a custom marker keeps re-rasterising before it freezes. */
const SNAPSHOT_SETTLE_MS = 160;

/**
 * Google's logo sits in the bottom-left of whatever the map padding leaves
 * visible, and the terms say it has to stay readable. Half sizes in points,
 * generous enough to cover the logo plus its margin.
 */
const ATTRIBUTION_HALF_WIDTH_PX = 46;
const ATTRIBUTION_HALF_HEIGHT_PX = 18;
/** Never pad the map so hard that the logo lands under the sheet anyway. */
const MIN_VISIBLE_MAP_PX = 88;

/**
 * Android rasterises a custom marker once and then reuses the bitmap. Given
 * `tracksViewChanges={false}` on the first frame it snapshots before the text
 * inside has laid out, so a cluster arrives as an empty ring with no number.
 * Track for a beat, then freeze — the bitmap is correct and the map stays cheap.
 */
function useSettledSnapshot(signature: string): boolean {
  const [snapshot, setSnapshot] = useState({ signature, tracking: true });
  if (snapshot.signature !== signature) setSnapshot({ signature, tracking: true });
  useEffect(() => {
    const timer = setTimeout(
      () =>
        setSnapshot((current) =>
          current.signature === signature ? { signature, tracking: false } : current,
        ),
      SNAPSHOT_SETTLE_MS,
    );
    return () => clearTimeout(timer);
  }, [signature]);
  return snapshot.signature !== signature || snapshot.tracking;
}

type StablePubMarkerProps = {
  pub: PubPresentation;
  labelled: boolean;
  closed: boolean;
  onPress?: (id: string) => void;
};

class StablePubMarker extends React.PureComponent<
  StablePubMarkerProps,
  { tracksViewChanges: boolean }
> {
  state = { tracksViewChanges: true };
  private stopTrackingTimer: ReturnType<typeof setTimeout> | null = null;

  componentDidMount() {
    this.stopTrackingSoon();
  }

  componentDidUpdate(previous: StablePubMarkerProps) {
    const visualChanged =
      previous.labelled !== this.props.labelled ||
      previous.closed !== this.props.closed ||
      previous.pub.name !== this.props.pub.name;
    if (!visualChanged) return;
    if (this.state.tracksViewChanges) this.stopTrackingSoon();
    else this.setState({ tracksViewChanges: true }, this.stopTrackingSoon);
  }

  componentWillUnmount() {
    if (this.stopTrackingTimer) clearTimeout(this.stopTrackingTimer);
  }

  private stopTrackingSoon = () => {
    if (this.stopTrackingTimer) clearTimeout(this.stopTrackingTimer);
    this.stopTrackingTimer = setTimeout(() => {
      this.stopTrackingTimer = null;
      this.setState({ tracksViewChanges: false });
    }, 160);
  };

  render() {
    const { pub, labelled, closed, onPress } = this.props;
    const marker = (
      <View collapsable={false} testID="pub-map-marker-hit" style={styles.pinHit}>
        <View
          testID="pub-map-marker-visual"
          style={[styles.pubPin, closed && styles.pubPinClosed]}
        >
          <BeerIcon
            size={15}
            color={closed ? withAlpha(Colors.foam, 0.58) : Colors.foam}
          />
        </View>
      </View>
    );
    return (
      <Marker
        coordinate={{ latitude: pub.pub.lat, longitude: pub.pub.lng }}
        onPress={() => onPress?.(pub.id)}
        tracksViewChanges={this.state.tracksViewChanges}
        accessibilityLabel={pub.name}
        anchor={labelled ? PIN_ANCHOR : CENTER_ANCHOR}
      >
        {labelled ? (
          <View collapsable={false} style={styles.namedPin}>
            {marker}
            <Text
              style={[styles.pinLabel, closed && styles.pinLabelClosed]}
              numberOfLines={1}
              allowFontScaling={false}
            >
              {pub.name}
            </Text>
          </View>
        ) : (
          marker
        )}
      </Marker>
    );
  }
}

function ClusterMarker({
  latitude,
  longitude,
  count,
  onPress,
}: {
  latitude: number;
  longitude: number;
  count: number;
  onPress: () => void;
}) {
  const tracksViewChanges = useSettledSnapshot(`${latitude}:${longitude}:${count}`);
  return (
    <Marker
      coordinate={{ latitude, longitude }}
      onPress={onPress}
      tracksViewChanges={tracksViewChanges}
      anchor={CENTER_ANCHOR}
      accessibilityLabel={`${pubCountLabel(count)}. Přiblížit`}
    >
      <View collapsable={false} testID="pub-map-cluster" style={styles.clusterPin}>
        <Text style={styles.clusterText} allowFontScaling={false}>
          {count}
        </Text>
      </View>
    </Marker>
  );
}

function SelectedPubMarker({ pub, onPress }: { pub: PubPresentation; onPress?: () => void }) {
  const tracksViewChanges = useSettledSnapshot(`${pub.id}:${pub.name}`);
  return (
    <Marker
      coordinate={{ latitude: pub.pub.lat, longitude: pub.pub.lng }}
      onPress={onPress}
      tracksViewChanges={tracksViewChanges}
      accessibilityLabel={pub.name}
      zIndex={10}
      anchor={CENTER_ANCHOR}
    >
      <View collapsable={false} testID="pub-map-selected" style={styles.pinSelected}>
        <Text style={styles.pinTextSelected} numberOfLines={1} allowFontScaling={false}>
          {pub.name}
        </Text>
      </View>
    </Marker>
  );
}

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
  onRegionChangeComplete,
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
  onRegionChangeComplete?: (region: Region) => void;
}) {
  const mapRef = useRef<MapView>(null);
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [mapRegion, setMapRegion] = useState<Region | null>(null);
  const region = useMemo(
    () => initialRegionFor(pubs, currentPosition),
    [currentPosition, pubs],
  );
  const [renderedRecenterSignal, setRenderedRecenterSignal] = useState(recenterSignal);
  const recenterTarget =
    recenterSignal !== renderedRecenterSignal && currentPosition
      ? {
          latitude: currentPosition.lat,
          longitude: currentPosition.lng,
          latitudeDelta: 0.012,
          longitudeDelta: 0.012,
        }
      : null;
  if (recenterTarget) {
    setRenderedRecenterSignal(recenterSignal);
    setMapRegion(recenterTarget);
  }
  // Render markers for the destination before the native camera animation
  // starts, so returning from a distant browse never exposes a blank frame.
  const visibleRegion = recenterTarget ?? mapRegion ?? region;
  const coordinateSignature = useMemo(
    () => pubs
      .map((pub) => `${pub.id}:${pub.pub.lat}:${pub.pub.lng}`)
      .sort()
      .join('|'),
    [pubs],
  );

  // Padding is also what lifts Google's logo out from under the sheet — the
  // supported way to keep the attribution readable, which the terms require.
  // Clamped only so the map keeps a strip to draw in; clamping it to a share of
  // the screen used to drop the logo behind a raised sheet.
  const mapPadding = useMemo(
    () => ({
      top: 0,
      right: 0,
      bottom: Math.round(
        Math.max(Math.min(bottomInset, screenHeight - MIN_VISIBLE_MAP_PX), 0),
      ),
      left: 0,
    }),
    [bottomInset, screenHeight],
  );
  const visibleMapHeight = Math.max(screenHeight - mapPadding.bottom, 1);
  const grid = useMemo(
    () => pubsMapGrid(screenWidth, visibleMapHeight),
    [screenWidth, visibleMapHeight],
  );

  const clusters = useMemo(() => {
    if (!visibleRegion) return [];
    return buildPubsMapClusters(pubs, visibleRegion, selectedId, grid);
  }, [grid, pubs, selectedId, visibleRegion]);

  const selectedPub = selectedId ? pubs.find((pub) => pub.id === selectedId) ?? null : null;

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
      lat: visibleRegion.latitudeDelta * (LABEL_HALF_HEIGHT_PX / visibleMapHeight),
      lng: visibleRegion.longitudeDelta * (LABEL_HALF_WIDTH_PX / Math.max(screenWidth, 1)),
    };
    const bubble = {
      lat: visibleRegion.latitudeDelta * (BUBBLE_HALF_HEIGHT_PX / visibleMapHeight),
      lng: visibleRegion.longitudeDelta * (BUBBLE_HALF_WIDTH_PX / Math.max(screenWidth, 1)),
    };
    const claimed: { lat: number; lng: number; halfLat: number; halfLng: number }[] = [];
    // Google's logo owns the bottom-left of the visible strip and no pub name
    // gets to sit on it. Same keep-out machinery as the labels, just anchored to
    // the corner of the region instead of to a pub.
    const attribution = {
      lat: visibleRegion.latitudeDelta * (ATTRIBUTION_HALF_HEIGHT_PX / visibleMapHeight),
      lng:
        visibleRegion.longitudeDelta * (ATTRIBUTION_HALF_WIDTH_PX / Math.max(screenWidth, 1)),
    };
    claimed.push({
      lat: visibleRegion.latitude - visibleRegion.latitudeDelta / 2 + attribution.lat,
      lng: visibleRegion.longitude - visibleRegion.longitudeDelta / 2 + attribution.lng,
      halfLat: attribution.lat,
      halfLng: attribution.lng,
    });
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
      if (ids.size >= grid.maxLabels) break;
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
  }, [clusters, grid.maxLabels, screenWidth, selectedPub, visibleMapHeight, visibleRegion]);

  const openCluster = useCallback(
    (latitude: number, longitude: number) => {
      if (!visibleRegion) return;
      const target = {
        latitude,
        longitude,
        latitudeDelta: Math.max(visibleRegion.latitudeDelta / 2.5, 0.0015),
        longitudeDelta: Math.max(visibleRegion.longitudeDelta / 2.5, 0.0015),
      };
      onPan?.();
      setMapRegion(target);
      mapRef.current?.animateToRegion(target, 320);
    },
    [onPan, visibleRegion],
  );

  const startedWithPosition = useRef(currentPosition != null);
  const animatedRecenterSignal = useRef(recenterSignal);
  useEffect(() => {
    if (!currentPosition || startedWithPosition.current) return;
    startedWithPosition.current = true;
    const target = {
      latitude: currentPosition.lat,
      longitude: currentPosition.lng,
      latitudeDelta: 0.025,
      longitudeDelta: 0.025,
    };
    setMapRegion(target);
    mapRef.current?.animateToRegion(target, 320);
  }, [currentPosition]);

  useEffect(() => {
    if (recenterSignal === animatedRecenterSignal.current) return;
    animatedRecenterSignal.current = recenterSignal;
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
  }, [pubs, selectedId]);

  const settleRegion = useCallback<NonNullable<MapViewProps['onRegionChangeComplete']>>(
    (next, details) => {
      setMapRegion(next);
      if (details?.isGesture) onPan?.();
      onRegionChangeComplete?.(next);
    },
    [onPan, onRegionChangeComplete],
  );

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
      onRegionChangeComplete={settleRegion}
    >
      {clusters.map((cluster) => {
        if (cluster.items.length > 1) {
          return (
            <ClusterMarker
              key={`cluster:${cluster.id}:${cluster.items.length}`}
              latitude={cluster.lat}
              longitude={cluster.lng}
              count={cluster.items.length}
              onPress={() => openCluster(cluster.lat, cluster.lng)}
            />
          );
        }
        const pub = cluster.items[0].pub;
        return (
          <StablePubMarker
            key={pub.id}
            pub={pub}
            labelled={labelledIds.has(pub.id)}
            closed={pub.openState === 'closed'}
            onPress={onPressPub}
          />
        );
      })}

      {selectedPub ? (
        <SelectedPubMarker
          key={`${selectedPub.id}:selected`}
          pub={selectedPub}
          onPress={() => onPressPub?.(selectedPub.id)}
        />
      ) : null}
    </MapView>
  );
}

const styles = StyleSheet.create({
  emptyMap: { backgroundColor: Colors.stout },
  // Bounded: the whole named marker takes taps, so a wide one would swallow the
  // markers beside it. Long names truncate instead.
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
  pinHit: {
    width: PIN_HIT_SIZE,
    height: PIN_HIT_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pubPin: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout3, 0.96),
    borderWidth: 2,
    borderColor: Colors.amber,
  },
  pubPinClosed: {
    backgroundColor: withAlpha(Colors.stout3, 0.88),
    borderColor: withAlpha(Colors.foamMuted, 0.58),
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
