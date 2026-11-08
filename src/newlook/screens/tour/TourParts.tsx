import React, { useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { beerCountLabel, t } from '@/i18n';
import { StaticMapMarker } from '@/map/StaticMapMarker';
import type { TourStop } from '@/tours/model';
import { formatWalkDistance, walkingLeg } from '@/tours/stopFacts';
import { tourRegion } from '@/tours/TourMap';

import { Icon } from '../../components/Icon';
import { D, Dot, Press, T } from '../../components/ui';
import { C, s } from '../../theme';
import { GRAY_MAP } from '../kompas/NvMap';
import type { FactsLine, StopState } from './tourView';

export function StopPin({ n, state, next, size = 26 }: { n: number; state: StopState; next?: boolean; size?: number }) {
  if (state === 'visited') {
    return (
      <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.white, borderWidth: 2, borderColor: C.black }, s.center]}>
        <Icon name="check" size={size * 0.55} color={C.black} />
      </View>
    );
  }
  const big = next ? size * 1.4 : size;
  return (
    <View
      style={[
        { width: big, height: big, borderRadius: big / 2, borderWidth: 2 },
        next || state === 'todo' ? { backgroundColor: next ? C.yellow : '#1A1A1A', borderColor: next ? C.black : C.white } : { backgroundColor: '#1A1A1A', borderColor: C.muted },
        s.center,
      ]}
    >
      <T s={next ? 16 : 12} w={800} c={next ? C.black : C.white}>
        {String(n)}
      </T>
    </View>
  );
}

/** Route map with numbered stops. `planning` paints all stops yellow, as in the editor. */
export function TourMap({
  stops,
  height = 112,
  states,
  next,
  planning,
  interactive,
  style,
  onExpand,
}: {
  stops: readonly TourStop[];
  height?: number | '100%';
  states?: StopState[];
  next?: number;
  planning?: boolean;
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  onExpand?: () => void;
}) {
  const coords = stops.map((stop) => ({ latitude: stop.lat, longitude: stop.lon }));
  const ref = useRef<MapView>(null);
  const fit = () => {
    if (!coords.length) return;
    const pad = interactive ? { top: 160, right: 60, bottom: 260, left: 60 } : { top: 26, right: 30, bottom: 26, left: 30 };
    ref.current?.fitToCoordinates(coords, { edgePadding: pad, animated: false });
  };
  return (
    <View style={[{ height, borderRadius: interactive ? 0 : 20, overflow: 'hidden', backgroundColor: C.card, borderWidth: interactive ? 0 : 1, borderColor: C.hairline }, style]}>
      <MapView
        ref={ref}
        // A changed route refits the map; the same route keeps where the walker panned.
        key={stops.map((stop) => stop.id).join()}
        onMapReady={fit}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        customMapStyle={GRAY_MAP}
        initialRegion={tourRegion(stops)}
        scrollEnabled={!!interactive}
        zoomEnabled={!!interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        pointerEvents={interactive ? 'auto' : 'none'}
        userInterfaceStyle="dark"
        showsUserLocation={!!interactive}
      >
        {coords.length > 1 ? <Polyline coordinates={coords} strokeColor="#FFFFFFB3" strokeWidth={3} /> : null}
        {coords.map((c, i) => (
          <StaticMapMarker key={`${stops[i].id}-${states?.[i]}-${next}`} coordinate={c} anchor={{ x: 0.5, y: 0.5 }}>
            {planning ? (
              <View style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
                <T s={12} w={800} c={C.black}>
                  {String(i + 1)}
                </T>
              </View>
            ) : (
              <StopPin n={i + 1} state={states?.[i] ?? 'todo'} next={i === next} size={interactive ? 30 : 24} />
            )}
          </StaticMapMarker>
        ))}
      </MapView>
      {onExpand ? (
        <Press onPress={onExpand} hitSlop={10} accessibilityLabel={t.tours.expandMap} style={{ position: 'absolute', right: 12, top: 12 }}>
          <Icon name="maximize-2" size={16} />
        </Press>
      ) : null}
    </View>
  );
}

function Marker2({ i, state, next }: { i: number; state: StopState; next: boolean }) {
  const size = 36;
  if (state === 'visited') {
    return (
      <View style={[{ width: size, height: size, borderRadius: 10, backgroundColor: C.white }, s.center]}>
        <Icon name="check" size={18} color={C.black} />
      </View>
    );
  }
  if (state === 'skipped') {
    return (
      <View style={[{ width: size, height: size, borderRadius: 10, borderWidth: 1.5, borderColor: C.muted }, s.center]}>
        <Icon name="minus" size={18} color={C.muted} />
      </View>
    );
  }
  return (
    <View style={[{ width: size, height: size, borderRadius: 10, backgroundColor: next ? 'transparent' : C.control, borderWidth: next ? 2 : 0, borderColor: C.yellow }, s.center]}>
      <D s={18} c={C.yellow}>
        {String(i + 1)}
      </D>
    </View>
  );
}

/** Stops on a rail. In a run the next stop is big with its challenge. */
export { Marker2 as StopSquare };

export function StopHours({ facts }: { facts?: FactsLine }) {
  if (!facts?.hours && !facts?.beers) return null;
  return (
    <View style={[s.row, { gap: 6 }]}>
      {facts.hours ? (
        <>
          <Dot color={facts.closed ? C.muted : C.open} />
          <T s={12} w={600} c={facts.closed ? C.muted : C.open}>
            {facts.hours}
          </T>
        </>
      ) : null}
      {facts.beers ? <T s={12} c={C.muted} style={s.fill} numberOfLines={1}>{facts.hours ? `· ${facts.beers}` : facts.beers}</T> : null}
    </View>
  );
}

export function StopRail({
  stops,
  states,
  next,
  beers,
  facts,
  onStop,
  planning,
  meetTime,
}: {
  stops: readonly TourStop[];
  states?: StopState[];
  next?: number;
  beers?: Record<string, number>;
  facts?: Record<string, FactsLine>;
  onStop?: (stop: TourStop, i: number) => void;
  planning?: boolean;
  meetTime?: string | null;
}) {
  const tx = t.nv.tour;
  const nextAt = next !== undefined && next >= 0 ? next : stops.length;
  // Skipped stops do not move the group; the last visited one before the next stop does.
  const here = (states ?? []).slice(0, nextAt).lastIndexOf('visited');
  return (
    <View>
      {stops.map((st, i) => {
        const state = states?.[i] ?? 'todo';
        const isNext = i === next;
        const last = i === stops.length - 1;
        const count = beers?.[st.id] ?? 0;
        const sub =
          state === 'visited'
            ? [i === here ? t.tours.youAreHere : t.tours.visited, count ? beerCountLabel(count) : null].filter(Boolean).join(' · ')
            : state === 'skipped'
              ? t.tours.skipped
              : isNext && !planning
                ? [t.tours.nextStop, st.address].filter(Boolean).join(' · ')
                : i === 0 && planning
                  ? tx.meetAt(meetTime ?? null, st.address)
                  : st.address;
        const leg = !last ? walkingLeg(st, stops[i + 1]) : null;
        return (
          <Press key={st.id} onPress={() => onStop?.(st, i)} style={[s.row, { gap: 16, alignItems: 'flex-start' }]}>
            <View style={{ alignItems: 'center', alignSelf: 'stretch' }}>
              <Marker2 i={i} state={state} next={isNext} />
              {!last ? <View style={{ width: 2, flex: 1, backgroundColor: C.lineStrong, marginVertical: 2 }} /> : null}
            </View>
            <View style={[s.fill, { gap: 4, paddingBottom: 18, paddingTop: isNext ? 2 : 6 }]}>
              <View style={[s.row, { justifyContent: 'space-between', gap: 8 }]}>
                {isNext ? (
                  <D s={26} style={s.fill}>
                    {st.name}
                  </D>
                ) : (
                  <T s={16} w={600} c={state === 'skipped' ? C.muted : C.white} style={s.fill}>
                    {st.name}
                  </T>
                )}
                <Icon name="chevron-right" size={16} color={C.muted} />
              </View>
              {sub ? (
                <T s={12} w={600} c={state === 'visited' || isNext ? C.text2 : C.muted}>
                  {sub}
                </T>
              ) : null}
              {(isNext || (planning && i === 0) || (!planning && i === 0)) && state === 'todo' ? <StopHours facts={facts?.[st.id]} /> : null}
              {st.challenge && state === 'todo' && (isNext || planning) ? (
                <View style={[s.row, { gap: 8, alignItems: 'flex-start', marginTop: 4 }]}>
                  <Icon name="flag" size={15} color={isNext ? C.yellow : C.text2} />
                  <T s={isNext ? 15 : 13} w={500} c={C.text2} style={s.fill}>
                    {st.challenge}
                  </T>
                </View>
              ) : null}
              {leg && !planning ? (
                <View style={[s.row, { gap: 6, marginTop: 4 }]}>
                  <Icon name="footprints" size={12} color={C.muted} />
                  <T s={12} c={C.muted}>
                    {t.tours.walkLeg(formatWalkDistance(leg.meters), leg.minutes)}
                  </T>
                </View>
              ) : null}
            </View>
          </Press>
        );
      })}
    </View>
  );
}
