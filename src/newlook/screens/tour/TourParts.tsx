import React, { useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

import { Icon } from '../../components/Icon';
import { D, Dot, Press, T } from '../../components/ui';
import { TOUR, type StopState } from '../../mock/tour';
import { C, s } from '../../theme';
import { GRAY_MAP } from '../kompas/NvMap';

const REGION = { latitude: 50.0852, longitude: 14.4504, latitudeDelta: 0.012, longitudeDelta: 0.022 };

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
  height = 112,
  states,
  next,
  planning,
  interactive,
  style,
  onExpand,
}: {
  height?: number | '100%';
  states?: StopState[];
  next?: number;
  planning?: boolean;
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
  onExpand?: () => void;
}) {
  const coords = TOUR.stops.map((x) => x.coord);
  const ref = useRef<MapView>(null);
  const fit = () => {
    const pad = interactive ? { top: 160, right: 60, bottom: 260, left: 60 } : { top: 26, right: 30, bottom: 26, left: 30 };
    ref.current?.fitToCoordinates(coords, { edgePadding: pad, animated: false });
  };
  return (
    <View style={[{ height, borderRadius: interactive ? 0 : 20, overflow: 'hidden', backgroundColor: C.card, borderWidth: interactive ? 0 : 1, borderColor: C.hairline }, style]}>
      <MapView
        ref={ref}
        onMapReady={fit}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        customMapStyle={GRAY_MAP}
        initialRegion={interactive ? { ...REGION, latitudeDelta: 0.02, longitudeDelta: 0.02 } : REGION}
        scrollEnabled={!!interactive}
        zoomEnabled={!!interactive}
        rotateEnabled={false}
        pitchEnabled={false}
        pointerEvents={interactive ? 'auto' : 'none'}
        userInterfaceStyle="dark"
      >
        <Polyline coordinates={coords} strokeColor="#FFFFFFB3" strokeWidth={3} />
        {coords.map((c, i) => (
          <Marker key={`${i}-${states?.[i]}-${next}`} coordinate={c} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            {planning ? (
              <View style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
                <T s={12} w={800} c={C.black}>
                  {String(i + 1)}
                </T>
              </View>
            ) : (
              <StopPin n={i + 1} state={states?.[i] ?? 'todo'} next={i === next} size={interactive ? 30 : 24} />
            )}
          </Marker>
        ))}
      </MapView>
      {onExpand ? (
        <Press onPress={onExpand} hitSlop={10} style={{ position: 'absolute', right: 12, top: 12 }}>
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
      <D s={18} c={next ? C.yellow : C.yellow}>
        {String(i + 1)}
      </D>
    </View>
  );
}

/** Stops on a rail. In a run the next stop is big with its challenge. */
export { Marker2 as StopSquare };

export function StopRail({
  states,
  next,
  beers,
  onStop,
  planning,
  dimFrom,
}: {
  states?: StopState[];
  next?: number;
  beers?: number[];
  onStop?: (i: number) => void;
  planning?: boolean;
  dimFrom?: number;
}) {
  return (
    <View>
      {TOUR.stops.map((st, i) => {
        const state = states?.[i] ?? 'todo';
        const isNext = i === next;
        const last = i === TOUR.stops.length - 1;
        const dim = dimFrom !== undefined && i >= dimFrom;
        const sub =
          state === 'visited'
            ? `${i === (next ?? 0) - 1 ? 'Tady sedíte' : 'Navštíveno'} · ${beers?.[i] ?? 1} ${(beers?.[i] ?? 1) === 1 ? 'pivo' : 'piva'}`
            : state === 'skipped'
              ? 'Přeskočeno'
              : isNext && !planning
                ? `Další zastávka · ${st.address}`
                : i === 0 && planning
                  ? `Místo srazu ${TOUR.time} · ${st.address}`
                  : st.address;
        return (
          <Press key={st.name} onPress={() => onStop?.(i)} style={[s.row, { gap: 16, alignItems: 'flex-start', opacity: dim ? 0.35 : 1 }]}>
            <View style={{ alignItems: 'center', alignSelf: 'stretch' }}>
              <Marker2 i={i} state={state} next={isNext} />
              {!last ? <View style={{ width: 2, flex: 1, backgroundColor: '#FFFFFF26', marginVertical: 2 }} /> : null}
            </View>
            <View style={[s.fill, { gap: 4, paddingBottom: 18, paddingTop: isNext ? 2 : 6 }]}>
              <View style={[s.row, { justifyContent: 'space-between' }]}>
                {isNext ? <D s={26}>{st.name}</D> : <T s={16} w={600} c={state === 'skipped' ? C.muted : C.white}>{st.name}</T>}
                <Icon name="chevron-right" size={16} color={C.muted} />
              </View>
              <T s={12} w={600} c={state === 'visited' || isNext ? C.text2 : C.muted}>
                {sub}
              </T>
              {(isNext || (planning && i === 0) || (!planning && state === 'todo' && i === 0)) && state === 'todo' ? (
                <View style={[s.row, { gap: 6 }]}>
                  <Dot color={C.open} />
                  <T s={12} w={600} c={C.open}>
                    {st.hours}
                  </T>
                  <T s={12} c={C.muted}>{`· ${st.beer}`}</T>
                </View>
              ) : null}
              {st.challenge && state === 'todo' && (isNext || planning) ? (
                <View style={[s.row, { gap: 8, alignItems: 'flex-start', marginTop: 4 }]}>
                  <Icon name="flag" size={15} color={isNext ? C.yellow : C.text2} />
                  <T s={isNext ? 15 : 13} w={500} c={C.text2} style={s.fill}>
                    {st.challenge}
                  </T>
                </View>
              ) : null}
              {!last && !planning ? (
                <View style={[s.row, { gap: 6, marginTop: 4 }]}>
                  <Icon name="footprints" size={12} color={C.muted} />
                  <T s={12} c={C.muted}>
                    {TOUR.stops[i].walk}
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
