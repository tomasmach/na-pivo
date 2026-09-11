import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';

const PAPER = Colors.foam;
const STOCK = Colors.foamMuted;
const INK = Colors.stout;
const AMBER = Colors.amber;
const edge = { stroke: INK, strokeWidth: 2.8, strokeLinejoin: 'round' as const };
const cut = { fill: 'none', stroke: INK, strokeWidth: 1.5, strokeLinecap: 'round' as const };

/** Gouges follow the object, rather than putting a noise filter over the plate. */
function Beer({ x = 0, y = 0, scale = 1 }: { x?: number; y?: number; scale?: number }) {
  return <G transform={`translate(${x} ${y}) scale(${scale})`}>
    <Path d="M38 20h12c17 0 17 30 0 32H38v-9h10c6 0 7-14 0-14H38" fill={STOCK} {...edge} />
    <Path d="m5 13 34 1-1 48q-16 7-31 0Z" fill={AMBER} {...edge} />
    <Path d="M3 18C-3 9 3 3 11 5 15-3 26-1 28 5c12-3 19 8 11 16l-9-2-5 5-8-5-8 3Z" fill={PAPER} {...edge} />
    <Path d="m13 29 1 24m8-25 1 29m8-28-1 23M10 61q12 4 25 0" {...cut} />
    <Path d="M10 30v16" stroke={PAPER} strokeWidth={3} />
  </G>;
}

function Globe() {
  return <G>
    <Circle cx={0} cy={0} r={28} fill={AMBER} {...edge} />
    <Path d="M-24-10-14-18-3-15 0-7-9-2-2 7-7 19-14 12-15 1-24-3M8-25 6-15 17-10 13-2 24 6 27-6M7 13l8-3 4 8-9 7Z" fill={INK} />
    <Path d="M-25 11q20 16 40 2M-12-23q-9 15-6 24" stroke={PAPER} strokeWidth={1.8} fill="none" />
  </G>;
}

function Backdrop() {
  return <G>
    <Rect width={300} height={200} fill={Colors.stout2} />
    <Path d="M0 155q62-6 111 0t189-1M0 162q49-5 76-2m107 3 117-4M21 184l67-2m143 2 69-3" stroke={withAlpha(PAPER, 0.055)} strokeWidth={1.4} fill="none" />
    <Path d="M245 112c42-12 82 28 39 52-17 9-35 5-42-2m-5-9c-17-22 3-36 20-37" stroke={withAlpha(AMBER, 0.09)} strokeWidth={2.5} fill="none" />
  </G>;
}

function QuizArtwork() {
  return <G>
    <G rotation={-8} origin="141,100">
      <Path d="M60 22 217 18 219 171 66 181Z" fill={INK} />
      <Path d="M54 14 209 11 211 166 62 174 59 159Z" fill={AMBER} {...edge} />
      <Path d="m53 10 149-3 3 153-145 10-4-87Z" fill={PAPER} {...edge} />
      <Path d="m68 27 116-3m-113 5 111-2M71 145l116-6" {...cut} />
      <Path d="M109 57c-1-22 40-30 49-9 9 20-14 25-16 38l-1 8-14 1c-3-25 19-26 15-39-3-10-17-6-17 1Z" fill={INK} />
      <Path d="M129 103h13v14h-13Z" fill={AMBER} {...edge} />
      <G fill="none" stroke={INK} strokeWidth={1.6}>
        <Circle cx={83} cy={130} r={6} /><Circle cx={111} cy={129} r={6} />
        <Circle cx={139} cy={128} r={6} /><Circle cx={167} cy={126} r={6} />
      </G>
      <Path d="m106 128 4 5 10-14" fill="none" stroke={INK} strokeWidth={2.8} />
      <Path d="m70 39 16-1m-15 5 12-1m98 79 6-1m-6 4 6-1" {...cut} />
    </G>
    <G rotation={29} origin="232,100">
      <Path d="M223 23q8-4 16 0v119l-8 29-8-29Z" fill={AMBER} {...edge} />
      <Path d="m223 142 8 29 8-29Z" fill={STOCK} {...edge} />
      <Path d="m228 161 3 10 3-10Z" fill={INK} />
      <Path d="M228 37v103m7-103v103m-12-110h16m-16 4h16" {...cut} />
      <Path d="M225 23h12v9h-12Z" fill={PAPER} {...edge} />
    </G>
  </G>;
}

function Die({ x, y, angle, five }: { x: number; y: number; angle: number; five?: boolean }) {
  return <G transform={`translate(${x} ${y}) rotate(${angle})`}>
    <Path d="M3 18 67 0q8-1 12 5l20 21q4 5 3 11l-4 58q0 6-7 8l-62 14q-7 1-11-5L0 91Z" fill={STOCK} {...edge} />
    <Path d="m3 18 64-18q8-1 12 5l20 21-70 19Z" fill={PAPER} {...edge} />
    <Path d="m3 18 26 27-2 70q-5 0-9-5L0 89Z" fill={AMBER} {...edge} />
    <Path d="m29 45 70-19 3 7-4 62q0 6-7 8l-64 14Z" fill={PAPER} {...edge} />
    <Path d="m33 50 62-17-4 62-57 13M8 34l14 14m-15-5 14 14M7 58l14 14m-14-5 14 14m-14-5 14 14m18-70 22-6" {...cut} />
    {(five ? [[51,22]] : [[39,20],[64,24]]).map(([cx,cy]) => <Ellipse key={`top-${cx}`} cx={cx} cy={cy} rx={6} ry={3} fill={INK} transform={`rotate(-15 ${cx} ${cy})`} />)}
    {(five ? [54,74,94] : [74]).map(cy => <Ellipse key={`side-${cy}`} cx={15} cy={cy} rx={3} ry={5} fill={INK} transform={`rotate(-18 15 ${cy})`} />)}
    {(five ? [[44,62],[83,51],[63,76],[43,98],[82,88]] : [[45,62],[81,52],[44,98],[80,88]]).map(([cx,cy]) => <Ellipse key={`${cx}-${cy}`} cx={cx} cy={cy} rx={5.3} ry={6.5} fill={INK} transform={`rotate(9 ${cx} ${cy})`} />)}
    <Path d="m39 54 12-3m35 35-1 7" stroke={STOCK} strokeWidth={2} />
  </G>;
}

function DiceArtwork() {
  return <G>
    <Path d="M43 158q94-15 205-3l-17 19-159 8Z" fill={INK} />
    <Die x={42} y={41} angle={-13} five />
    <Die x={171} y={41} angle={16} />
    <Path d="m29 105-9 3m12 4-15 4m139-88 3-11m5 12 4-9" stroke={AMBER} strokeWidth={2} />
  </G>;
}

function CategoriesArtwork() {
  return <G>
    <G rotation={-20} origin="107,109">
      <Rect x={47} y={33} width={105} height={137} rx={8} fill={AMBER} {...edge} />
      <Rect x={54} y={40} width={91} height={123} rx={4} fill="none" stroke={INK} strokeWidth={1.2} />
      <Beer x={72} y={66} scale={0.86} />
      <Path d="m62 51 12-1m-12 5h7m59 91h-12m12 5h-7" {...cut} />
    </G>
    <G rotation={-2} origin="154,101">
      <Rect x={99} y={17} width={107} height={151} rx={8} fill={PAPER} {...edge} />
      <Rect x={106} y={24} width={93} height={137} rx={4} fill="none" stroke={INK} strokeWidth={1.2} />
      <G transform="translate(152 90)"><Globe /></G>
      <Path d="m138 126 28 0m-20 5h13m-44-95 12-1m-12 5h7" {...cut} />
    </G>
    <G rotation={18} origin="213,114">
      <Rect x={163} y={43} width={99} height={132} rx={8} fill={STOCK} {...edge} />
      <Rect x={170} y={50} width={85} height={118} rx={4} fill="none" stroke={INK} strokeWidth={1.2} />
      <Path d="M204 81 236 73v43h-5V87l-22 6v31h-5Z" fill={INK} />
      <Ellipse cx={198} cy={125} rx={11} ry={8} fill={INK} transform="rotate(-20 198 125)" />
      <Ellipse cx={225} cy={117} rx={11} ry={8} fill={INK} transform="rotate(-20 225 117)" />
      <Path d="m182 61 12 0m-12 5h7m44 85h12m-7 5h7" {...cut} />
    </G>
  </G>;
}

function NeverArtwork() {
  return <G>
    <G rotation={-10} origin="132,111">
      <Path d="M91 161c-6-25-20-38-29-58L44 76c-8-14 7-24 17-13l20 23-6-54c-2-18 17-21 21-3l7 45-1-59c0-17 21-17 22 0l3 58 8-50c3-16 23-12 20 5l-6 49 13-32c6-15 23-8 18 7l-15 47c-1 28-15 41-18 62Z" fill={PAPER} {...edge} />
      <Path d="m86 147 66 1-2 34-65 1Z" fill={AMBER} {...edge} />
      <Path d="M83 91q19 11 21 32m-6-26q21-14 42 3m-31 6q18-4 24 7m-32 23 28 0M82 33l4 17m26-31v18m32-8-3 15m27 11-5 12m-65 88v20m6-20v20m6-20v20" {...cut} />
      <Path d="m91 97-8 19 13 19m46-21-6 18" fill="none" stroke={STOCK} strokeWidth={3} />
    </G>
    <G rotation={12} origin="231,126">
      <Circle cx={231} cy={126} r={39} fill={AMBER} {...edge} />
      <Circle cx={231} cy={126} r={31} fill="none" stroke={INK} strokeWidth={1.5} />
      <Path d="m214 110 34 32m-1-32-33 32" stroke={INK} strokeWidth={8} />
    </G>
  </G>;
}

function KingsArtwork() {
  return <G>
    <G rotation={-8} origin="136,100">
      <Rect x={67} y={13} width={142} height={173} rx={9} fill={AMBER} {...edge} />
      <Rect x={59} y={7} width={142} height={173} rx={9} fill={PAPER} {...edge} />
      <Rect x={67} y={15} width={126} height={157} rx={4} fill="none" stroke={INK} strokeWidth={1.2} />
      <Path d="M84 151q4-25 30-29h31q29 2 34 29Z" fill={INK} />
      <Path d="m101 82 8 39 19 22 24-22 7-39Z" fill={STOCK} {...edge} />
      <Path d="M104 104q11 2 21 12l6-1q13-12 23-10l-5 22-20 21-20-21Z" fill={INK} />
      <Path d="m114 90 9-1m14 0 9 1m-17 3-3 14h8m-17 18 11 10 13-11" fill="none" stroke={PAPER} strokeWidth={2} />
      <Path d="M99 81 91 47l22 12 15-26 17 26 24-14-10 36Z" fill={AMBER} {...edge} />
      <Path d="m103 71 52-1m-49 5 46-1m-32 78-18-15m38 16 21-17" {...cut} />
      <Path d="m129 49 5 10-5 10-5-10Z" fill={PAPER} {...edge} />
      <Path d="m78 28 6 9-6 9-6-9m110 102 6 9-6 9-6-9" fill={INK} />
    </G>
    <Beer x={219} y={113} scale={0.86} />
  </G>;
}

function RoundArtwork() {
  return <G>
    <G rotation={-8} origin="132,98">
      <Path d="m65 12 124 1 8 170-12-5-10 5-11-5-12 5-11-6-12 5-11-5-11 5-11-5-11 5Z" fill={AMBER} {...edge} />
      <Path d="m57 7 123 1 8 168-12-5-10 5-11-5-12 5-11-6-12 5-11-5-11 5-11-5-11 5Z" fill={PAPER} {...edge} />
      <Beer x={101} y={21} scale={0.45} />
      <Path d="m71 63 99-1m-98 4 99-1m-96 17 40-1m-40 13 53-1m-53 13 32-1m-31 13 49-1m-48 15 94-1m-92 5 93-1m-41 14 42-1" {...cut} />
      <Path d="m151 78 12 6m-6-6-5 7m2 6 13 6m-6-7-5 8m2 6 13 6m-6-7-5 8m1 6 13 6m-6-6-5 7" {...cut} />
      <Path d="m86 143 8 15m-3-16 8 15m-3-16 8 15m-24-3 27-7" stroke={INK} strokeWidth={2} />
    </G>
    <G rotation={14} origin="223,139">
      <Ellipse cx={223} cy={146} rx={34} ry={31} fill={INK} />
      <Circle cx={223} cy={139} r={33} fill={AMBER} {...edge} />
      <Circle cx={223} cy={139} r={27} fill="none" stroke={INK} strokeWidth={1.5} strokeDasharray="2 3" />
      <Path d="m223 121 10 18-10 18-10-18Z" fill={INK} />
      <Path d="m223 128 5 11-5 11-5-11Z" fill={PAPER} />
    </G>
  </G>;
}

function BottleArtwork() {
  return <G>
    <G rotation={58} origin="149,99">
      <Path d="M139 9h23l-1 46c0 12 26 20 27 37l3 68q1 24-39 24t-38-24l3-68c1-17 24-25 24-37Z" fill={INK} />
      <Path d="M133 7h23l-1 44c0 15 25 21 27 37l3 67q1 24-38 24t-37-24l3-67c1-16 24-22 24-37Z" fill={AMBER} {...edge} />
      <Path d="m148 14-1 42c0 17 23 24 24 37l3 61q2 14-20 16" fill="none" stroke={INK} strokeWidth={7} />
      <Path d="m140 25-1 26c0 16-18 22-19 38l-2 60" fill="none" stroke={PAPER} strokeWidth={3} />
      <Path d="M111 99q35 8 72-1l1 47q-35 9-74 1Z" fill={PAPER} {...edge} />
      <Path d="M116 105q29 6 62-1m-60 37q30 5 60-1" {...cut} />
      <Path d="m147 108 13 7-1 15-13 8-13-8v-15Z" fill={AMBER} {...edge} />
      <Path d="m146 114-5 7 5 10 6-10Z" fill={INK} />
      <Path d="m133 7 25 0 2 10-29 0Z" fill={STOCK} {...edge} />
      <Path d="M137 8v7m5-7v7m5-7v7m5-7v7m-32 142q3 11 21 12m-17-9 9 4" {...cut} />
    </G>
    <G fill="none" stroke={AMBER} strokeWidth={2}>
      <Path d="M45 115c-13-35 8-67 34-79m-11 0 13-2-5 12M254 83c12 36-9 67-34 80m12-1-14 3 5-13" />
    </G>
  </G>;
}

function ThumbArtwork() {
  return <G>
    <Path d="m38 155 226-2 5 14-225 5Z" fill={AMBER} {...edge} />
    <Path d="m45 161 75-2m71 2 66-3M55 170l2 14m191-19 2 15" {...cut} />
    <Path d="M68 68 110 57q19-26 42-21l48 12q13 4 10 17 15 7 10 22 8 11-1 21 3 15-14 19l-40 3-1 13q-1 15-14 15-14 0-14-15l-1-35-31 9-31-4Z" fill={PAPER} {...edge} />
    <Path d="m53 69 38-8 16 60-40 11Z" fill={AMBER} {...edge} />
    <Path d="m111 62 25-10q8-3 16 0l43 13m-51 8 66 12m-62 8 63 13m-60 6 43 4m-76-44q15 5 15 22l1 29m9 20h10m-78-69 11 40m-6-39 10 34" {...cut} />
    <Path d="m173 145 9-8m-6 15 12-1m-63-5-9-6" stroke={AMBER} strokeWidth={2.5} fill="none" />
    <Path d="m163 41 31 8m-34-4 23 6" {...cut} />
  </G>;
}

function RulesArtwork() {
  return <G>
    <G rotation={-7} origin="128,96">
      <Path d="M59 17 183 9l15 169-128 8Z" fill={AMBER} {...edge} />
      <Path d="m50 9 127-4 12 168-129 6Z" fill={PAPER} {...edge} />
      <Path d="m66 24 96-3m-96 5 97-3m-90 129 97-4" {...cut} />
      {[48, 78, 108].map((y, i) => <G key={y}>
        <Rect x={69+i} y={y} width={11} height={11} rx={1} fill="none" stroke={INK} strokeWidth={1.4} />
        <Path d={`m${71+i} ${y+4} 4 5 9-15m6 12 57-2m-56 7 40-1`} {...cut} />
      </G>)}
    </G>
    <G rotation={12} origin="211,119">
      <Path d="m191 142-5 43 19-10 14 13 7-46Z" fill={AMBER} {...edge} />
      <Path d="m211 78 10 5 12 0 7 9 10 6 1 12 5 10-6 10-1 12-11 5-7 9-12-1-10 4-9-7-11-2-5-11-8-8 3-12-2-11 9-8 5-10 12-1Z" fill={AMBER} {...edge} />
      <Circle cx={211} cy={118} r={28} fill={PAPER} {...edge} />
      <Circle cx={211} cy={118} r={23} fill="none" stroke={INK} strokeWidth={1} strokeDasharray="1 3" />
      <Path d="m198 117 10 11 18-24" stroke={INK} strokeWidth={5} fill="none" />
      <Path d="m195 154-2 16m8-14-2 9m18-11-2 17" {...cut} />
    </G>
  </G>;
}

function Subject({ gameKey }: { gameKey: string }) {
  switch (gameKey) {
    case 'quiz': return <QuizArtwork />;
    case 'dice': return <DiceArtwork />;
    case 'categories': return <CategoriesArtwork />;
    case 'never': return <NeverArtwork />;
    case 'kings': return <KingsArtwork />;
    case 'round': return <RoundArtwork />;
    case 'bottle': return <BottleArtwork />;
    case 'thumb': return <ThumbArtwork />;
    case 'rules': return <RulesArtwork />;
    default: return <CategoriesArtwork />;
  }
}

/** Native text stays outside the plate. This illustration is purely decorative. */
export const GameArtwork = React.memo(function GameArtwork({ gameKey, size = 180, mode = 'mark' }: {
  gameKey: string;
  size?: number;
  mode?: 'cover' | 'mark';
}) {
  const cover = mode === 'cover';
  return <View style={{ width: cover ? '100%' : size, height: cover ? '100%' : size }} pointerEvents="none" accessible={false}>
    {cover ? <Svg style={StyleSheet.absoluteFill} width="100%" height="100%" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid slice" accessible={false}><Backdrop /></Svg> : null}
    <Svg width="100%" height="100%" viewBox="0 0 300 200" preserveAspectRatio="xMidYMid meet" accessible={false}>
      <Subject gameKey={gameKey} />
    </Svg>
  </View>;
});
