import React from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, G, Line, Path, Text as SvgText } from 'react-native-svg';

import { Icon, type IconName } from '../../components/Icon';
import { D, T } from '../../components/ui';
import { C, DISPLAY_FONT, s } from '../../theme';
import { formatDistance } from './format';

const SIZE = 320;
const CX = SIZE / 2;
const RANGE_M = 300;
const FACE_R = 96;

export type LatLng = { latitude: number; longitude: number };
/** Anything the dial can place: a pub, a tour stop or a friend's table. */
export type DialPoint = { id: string; coord: LatLng; distance: number };

// Illustrations that pass no position (the profile's decorative dial) keep the old centre.
const ILLUSTRATION_ORIGIN: LatLng = { latitude: 50.0843, longitude: 14.4199 };

export function bearing(from: LatLng, to: LatLng): number {
  const dLon = (to.longitude - from.longitude) * Math.cos((from.latitude * Math.PI) / 180);
  const dLat = to.latitude - from.latitude;
  return ((Math.atan2(dLon, dLat) * 180) / Math.PI + 360) % 360;
}

function polar(r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: CX + r * Math.cos(rad), y: CX + r * Math.sin(rad) };
}

function arc(r: number, from: number, to: number) {
  const a = polar(r, from);
  const b = polar(r, to);
  return `M ${a.x} ${a.y} A ${r} ${r} 0 0 1 ${b.x} ${b.y}`;
}

const TICKS = Array.from({ length: 72 }, (_, i) => i * 5);

export function Dial({
  target,
  others,
  from,
  heading,
  dim,
  centerIcon,
}: {
  target?: DialPoint;
  others?: DialPoint[];
  /** Where the phone is; the dial measures every bearing from here. */
  from?: LatLng | null;
  /** Where the phone points, degrees from north; the face turns so north stays north. */
  heading?: SharedValue<number | null>;
  dim?: boolean;
  centerIcon?: IconName;
}) {
  const origin = from ?? ILLUSTRATION_ORIGIN;
  const tb = target ? bearing(origin, target.coord) : 0;
  const tr = target ? Math.min(target.distance / RANGE_M, 1.05) * (FACE_R - 13) : 0;
  const tp = polar(tr, tb);
  const tail = polar(28, tb + 180);
  const dist = target ? formatDistance(target.distance) : null;
  const faceStyle = useAnimatedStyle(() => {
    const deg = heading?.value;
    return { transform: [{ rotate: `${typeof deg === 'number' ? -deg : 0}deg` }] };
  });
  return (
    <View style={{ width: SIZE, height: SIZE, alignSelf: 'center' }}>
      <Animated.View style={[{ opacity: dim ? 0.35 : 1, width: SIZE, height: SIZE }, faceStyle]}>
        <Svg width={SIZE} height={SIZE}>
          <Circle cx={CX} cy={CX} r={150} fill="#111111" stroke="#FFFFFF1F" strokeWidth={1} />
          {TICKS.map((deg) => {
            const major = deg % 90 === 0;
            const mid = deg % 30 === 0;
            const a = polar(major ? 130 : mid ? 134 : 140, deg);
            const b = polar(147, deg);
            return (
              <Line
                key={deg}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={major ? '#FFFFFFD9' : mid ? '#FFFFFF73' : '#FFFFFF52'}
                strokeWidth={major ? 2 : mid ? 1.5 : 1}
                strokeLinecap="round"
              />
            );
          })}
          {target && !dim ? <Path d={arc(142.5, tb - 7, tb + 7)} stroke={C.yellow} strokeWidth={15} fill="none" /> : null}
          <Circle cx={CX} cy={CX} r={FACE_R} fill="#0B0B0B" stroke="#FFFFFF14" strokeWidth={1} />
          <Circle cx={CX} cy={CX} r={32} fill="none" stroke="#FFFFFF12" strokeWidth={1} />
          <Circle cx={CX} cy={CX} r={64} fill="none" stroke="#FFFFFF12" strokeWidth={1} />
          {(
            [
              ['S', 0, C.white],
              ['V', 90, '#FFFFFF8C'],
              ['J', 180, '#FFFFFF8C'],
              ['Z', 270, '#FFFFFF8C'],
            ] as const
          ).map(([l, deg, color]) => {
            const p = polar(113, deg);
            return (
              <SvgText key={l} x={p.x} y={p.y + 6} fill={color} fontSize={17} fontFamily="SofiaSans-ExtraBold" textAnchor="middle">
                {l}
              </SvgText>
            );
          })}
          <SvgText x={227} y={238} fill="#FFFFFF38" fontSize={8} fontFamily="SofiaSans-Bold" textAnchor="middle">
            {`${RANGE_M} m`}
          </SvgText>
          {target && !dim ? (
            <G>
              <Line x1={tail.x} y1={tail.y} x2={tp.x} y2={tp.y} stroke={C.yellow} strokeWidth={3} strokeLinecap="round" />
              <Circle cx={tp.x} cy={tp.y} r={11} fill="#FFC40033" />
              <Circle cx={tp.x} cy={tp.y} r={6} fill={C.yellow} stroke={C.black} strokeWidth={2} />
            </G>
          ) : null}
          {!centerIcon ? <Circle cx={CX} cy={CX} r={7} fill={C.black} stroke={C.yellow} strokeWidth={3} /> : null}
        </Svg>
        {!dim
          ? (others ?? []).map((p) => {
              const r = Math.min(p.distance / RANGE_M, 1) * (FACE_R - 10);
              const pt = polar(r, bearing(origin, p.coord));
              return (
                <View key={p.id} style={{ position: 'absolute', left: pt.x - 6.5, top: pt.y - 6.5 }}>
                  <Icon name="beer" size={13} color="#FFFFFF73" />
                </View>
              );
            })
          : null}
      </Animated.View>
      <Svg width={SIZE} height={12} style={{ position: 'absolute', top: 0, left: 0, opacity: dim ? 0.35 : 1 }} pointerEvents="none">
        <Path d={`M ${CX - 8} -4 L ${CX + 8} -4 L ${CX} 8 Z`} fill={C.white} />
      </Svg>
      {centerIcon ? (
        <View style={[{ position: 'absolute', left: CX - 36, top: CX - 36, width: 72, height: 72, borderRadius: 36, backgroundColor: C.control }, s.center]}>
          <Icon name={centerIcon} size={30} color={C.yellow} />
        </View>
      ) : null}
      {dist && !dim ? (
        <View style={[s.row, { position: 'absolute', top: 182, left: 0, right: 0, justifyContent: 'center', alignItems: 'flex-end', gap: 3 }]} pointerEvents="none">
          <D s={44} lh={1} style={{ fontFamily: DISPLAY_FONT }}>
            {dist.value}
          </D>
          <T s={15} w={700} c={C.muted} style={{ marginBottom: 4 }}>
            {dist.unit}
          </T>
        </View>
      ) : null}
    </View>
  );
}
