import React from 'react';
import Svg, {
  Circle,
  Ellipse,
  G,
  Line,
  Path,
  Polygon,
  Rect,
} from 'react-native-svg';

import { Colors, withAlpha } from '@/theme/colors';

type ArtworkMode = 'cover' | 'mark';

const PAPER = Colors.foam;
const PAPER_MUTED = Colors.foamMuted;
const INK = Colors.stout;
const SURFACE = Colors.stout2;
const DEEP = Colors.stout3;
const AMBER = Colors.amber;

const outline = {
  stroke: INK,
  strokeWidth: 4,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'square' as const,
};

const fine = {
  fill: 'none',
  stroke: INK,
  strokeWidth: 2.4,
  strokeLinecap: 'square' as const,
};

function Pips({ points, radius = 7 }: { points: readonly [number, number][]; radius?: number }) {
  return points.map(([cx, cy]) => (
    <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={radius} fill={INK} />
  ));
}

function Backdrop({ gameKey }: { gameKey: string }) {
  const tone = gameKey === 'kings' || gameKey === 'never' ? PAPER : AMBER;
  return (
    <G>
      <Rect width="300" height="200" fill={SURFACE} />
      <Path d="M-30 177 92-24 192-24 67 214Z" fill={withAlpha(tone, 0.12)} />
      <Circle cx="268" cy="22" r="88" fill={withAlpha(AMBER, 0.09)} />
      <Path d="M218 0h82v78l-42 22-40-20Z" fill={withAlpha(PAPER, 0.035)} />
      <Line x1="18" y1="181" x2="282" y2="181" stroke={withAlpha(PAPER, 0.08)} strokeWidth="2" />
    </G>
  );
}

function QuizArtwork() {
  return (
    <G>
      <Ellipse cx="163" cy="170" rx="102" ry="17" fill={withAlpha(Colors.black, 0.42)} />
      <G rotation={-7} origin="143,101">
        <Path d="M66 25 221 17 232 165 82 181 68 169 56 171 62 157Z" fill={AMBER} />
        <Path d="M57 16 211 10 220 157 68 170 72 158 59 150 64 137Z" fill={PAPER} {...outline} />
        <Path d="m78 35 96-6m-93 114 59-5m-57 13 42-4" {...fine} />
        <Path d="M105 65c-2-22 35-31 46-13 12 20-18 28-14 46l-18 2c-8-24 20-30 13-40-6-8-15-2-14 6Z" fill={INK} />
        <Path d="m121 112 18-2 2 18-18 2Z" fill={AMBER} />
        <G fill="none" stroke={INK} strokeWidth="3">
          <Circle cx="91" cy="143" r="7" />
          <Circle cx="112" cy="141" r="7" />
          <Circle cx="133" cy="139" r="7" />
          <Circle cx="154" cy="137" r="7" />
        </G>
      </G>
      <G rotation={23} origin="233,103">
        <Path d="M218 23h22l2 128-11 31-13-30Z" fill={AMBER} {...outline} />
        <Path d="m218 151 24-1-11 32Z" fill={PAPER} {...outline} />
        <Path d="m226 171 5 11 5-11Z" fill={INK} />
        <Path d="M222 37h17m-12 8v94m8-94v94" {...fine} />
      </G>
      <Path d="m37 46-15-7m20 23-20 1m229 101 17 6" stroke={AMBER} strokeWidth="4" strokeLinecap="square" />
    </G>
  );
}

function DiceArtwork() {
  return (
    <G>
      <Ellipse cx="154" cy="170" rx="117" ry="19" fill={withAlpha(Colors.black, 0.46)} />
      <G rotation={-12} origin="104,98">
        <Polygon points="39,42 134,34 157,55 153,139 57,151 33,128" fill={AMBER} {...outline} />
        <Polygon points="39,42 134,34 132,122 33,128" fill={PAPER} {...outline} />
        <Polygon points="132,122 157,139 157,55 134,34" fill={PAPER_MUTED} {...outline} />
        <Path d="m132 122 25 17m-24-12 15 10m-15-20 15 10" {...fine} />
        <Pips points={[[59,62],[111,58],[85,84],[57,108],[109,104]]} radius={7.5} />
      </G>
      <G rotation={17} origin="201,120">
        <Polygon points="153,71 232,64 254,83 250,153 169,164 151,145" fill={AMBER} {...outline} />
        <Polygon points="153,71 232,64 232,141 151,145" fill={PAPER} {...outline} />
        <Polygon points="232,141 250,153 254,83 232,64" fill={PAPER_MUTED} {...outline} />
        <Pips points={[[174,92],[213,89],[174,128],[213,125]]} radius={7} />
        <Path d="m232 141 18 12m-17-18 10 8m-9-21 11 8" {...fine} />
      </G>
      <Path d="m227 33 8-16m7 29 20-7M44 163l-18 10m34 0-4 18" stroke={AMBER} strokeWidth="4" />
    </G>
  );
}

function CategoriesArtwork() {
  return (
    <G>
      <Ellipse cx="157" cy="173" rx="112" ry="15" fill={withAlpha(Colors.black, 0.42)} />
      <G rotation={-18} origin="99,106">
        <Rect x="48" y="31" width="101" height="143" rx="7" fill={AMBER} {...outline} />
        <Path d="m65 52 66-3m-62 102 48-3" {...fine} />
        <Path d="M75 77h42v51H75Z" fill={INK} />
        <Path d="M84 90h24v25H84Zm24 4h11v17h-11" fill="none" stroke={PAPER} strokeWidth="4" />
      </G>
      <G rotation={2} origin="155,102">
        <Rect x="101" y="20" width="108" height="155" rx="7" fill={PAPER} {...outline} />
        <Path d="m118 41 72 1m-68 109 45 1" {...fine} />
        <Path d="m135 75 17-20 18 18 22-8-2 47-26 19-30-18Z" fill={AMBER} {...outline} />
        <Path d="m151 82 16 27m12-34-19 37" {...fine} />
      </G>
      <G rotation={19} origin="209,110">
        <Rect x="157" y="37" width="104" height="145" rx="7" fill={PAPER_MUTED} {...outline} />
        <Path d="m174 57 66 9m-61 91 39 6" {...fine} />
        <Circle cx="209" cy="106" r="29" fill={DEEP} {...outline} />
        <Path d="m191 102 12-14 13 14 15-5-5 24-22 8-19-13Z" fill={AMBER} />
      </G>
    </G>
  );
}

function NeverArtwork() {
  return (
    <G>
      <Ellipse cx="153" cy="171" rx="104" ry="17" fill={withAlpha(Colors.black, 0.42)} />
      <G rotation={-8} origin="120,110">
        <Path d="m76 163-8-41-20-34q-7-13 5-19 10-4 18 10l9 13-3-57q0-14 12-14 10 0 12 14l5 46 1-60q1-13 13-12 12 1 11 16l-1 55 10-47q3-13 14-10 11 4 8 17l-8 53 14-29q6-11 16-6 10 6 4 18l-18 42-13 27-2 24Z" fill={PAPER} {...outline} />
        <Path d="m76 151 79-4 5 32-80 5Z" fill={AMBER} {...outline} />
        <Path d="m84 107 17 17 4 18m13-39 22 5 12 15m-53-16 10-7m28 23 13 5M88 38l2 18m31-34v20m28-5-3 18" {...fine} />
      </G>
      <G rotation={14} origin="225,132">
        <Circle cx="225" cy="132" r="41" fill={AMBER} {...outline} />
        <Circle cx="225" cy="132" r="31" fill={SURFACE} stroke={PAPER} strokeWidth="3" />
        <Path d="m210 132 10 10 21-24" fill="none" stroke={PAPER} strokeWidth="6" strokeLinecap="square" />
      </G>
      <Path d="m215 47 13-18m1 30 22-8" stroke={AMBER} strokeWidth="4" />
    </G>
  );
}

function KingsArtwork() {
  return (
    <G>
      <Ellipse cx="148" cy="173" rx="112" ry="16" fill={withAlpha(Colors.black, 0.44)} />
      <Path d="M203 114h67l-8 39q-4 20-25 23l2 14h18v8h-52v-8h18l2-14q-21-4-24-23Z" fill={AMBER} {...outline} />
      <G rotation={-9} origin="143,99">
        <Rect x="61" y="12" width="164" height="169" rx="10" fill={PAPER} {...outline} />
        <Path d="m74 27 138 2m-139 136 137 2" {...fine} />
        <Path d="m95 82-10-32 26 14 28-38 27 38 28-15-10 34-44 8Z" fill={AMBER} {...outline} />
        <Path d="M105 97q34-25 67 0l-8 46q-26 30-52 0Z" fill={DEEP} {...outline} />
        <Circle cx="125" cy="106" r="5" fill={PAPER} />
        <Circle cx="151" cy="106" r="5" fill={PAPER} />
        <Path d="m119 125 19 11 20-11m-20-12v22" stroke={AMBER} strokeWidth="4" fill="none" />
        <Path d="m76 42 8-8 8 8-8 10m111 101 8-8 8 8-8 10" fill={INK} />
        <Path d="M105 97 84 116l25 12m63-31 21 19-25 12" fill={AMBER} {...outline} />
      </G>
    </G>
  );
}

function RoundArtwork() {
  return (
    <G>
      <Ellipse cx="151" cy="176" rx="109" ry="15" fill={withAlpha(Colors.black, 0.42)} />
      <G rotation={-5} origin="142,103">
        <Path d="M71 16h134l-5 169-10-7-11 8-10-8-11 7-11-8-12 7-11-8-12 7-11-8-12 7-9-8Z" fill={AMBER} />
        <Path d="M60 8h134l-5 166-10-7-11 8-10-8-11 7-11-8-12 7-11-8-12 7-11-8-12 7-9-8Z" fill={PAPER} {...outline} />
        <Path d="m79 28 88 1m-88 14 58 1m-61 83 90 2m-89 14 43 1m-44 13 91 2" {...fine} />
        <Path d="M82 62h50v51H82Z" fill={AMBER} {...outline} />
        <Path d="M93 74v28m13-28v28m13-28v28m13-17h14v17h-14" {...fine} />
      </G>
      <G>
        <Circle cx="215" cy="139" r="37" fill={AMBER} {...outline} />
        <Circle cx="215" cy="139" r="27" fill={PAPER} {...outline} />
        <Path d="m215 119-11 20 11 20 11-20Z" fill={INK} />
        <Path d="m215 126-5 13 5 13 5-13Z" fill={AMBER} />
      </G>
      <Path d="m43 43-18-8m15 24-21 2m223 13 19-5" stroke={AMBER} strokeWidth="4" />
    </G>
  );
}

function BottleArtwork() {
  return (
    <G>
      <Ellipse cx="150" cy="167" rx="119" ry="17" fill={withAlpha(Colors.black, 0.46)} />
      <G rotation={63} origin="151,100">
        <Path d="M132 9h37l-2 46 13 17 7 17 2 81-10 18-20 6h-35l-21-7-9-18 4-81 8-18 15-16Z" fill={AMBER} {...outline} />
        <Path d="M137 13h20v45l12 21 6 91-7 11" fill="none" stroke={PAPER} strokeWidth="7" strokeLinecap="square" opacity={0.58} />
        <Path d="m128 8 46 1-1 18-47-1Z" fill={PAPER_MUTED} {...outline} />
        <Path d="M99 95h88v58H98Z" fill={PAPER} {...outline} />
        <Path d="m108 106 70-1m-71 38 71-1" {...fine} />
        <Path d="M127 115h30v20h-30Z" fill={AMBER} {...outline} />
        <Path d="M157 120h13v11h-13" {...fine} />
        <Path d="m111 75 7-13m47 2 8 14m-63 88 2 14m58-14-1 15" {...fine} />
      </G>
      <G fill={PAPER} stroke={INK} strokeWidth="3">
        <Circle cx="49" cy="58" r="19" />
        <Circle cx="251" cy="52" r="19" />
        <Circle cx="251" cy="153" r="19" />
      </G>
      <Circle cx="49" cy="58" r="12" fill={AMBER} />
      <Circle cx="251" cy="52" r="12" fill={PAPER_MUTED} />
      <Circle cx="251" cy="153" r="12" fill={DEEP} />
      <Path d="m32 127-18 8m25 7-16 14" stroke={AMBER} strokeWidth="4" />
    </G>
  );
}

function ThumbArtwork() {
  return (
    <G>
      <Ellipse cx="151" cy="171" rx="108" ry="16" fill={withAlpha(Colors.black, 0.44)} />
      <G rotation={-5} origin="159,105">
        <Path d="m108 152-7-56 18-31 7-39q2-15 16-12 15 4 12 27l-4 28 58-3q16 0 17 13l-3 13q10 14-1 26 5 14-8 23-1 17-17 20l-59 10Z" fill={PAPER} {...outline} />
        <Path d="m72 96 33-6 14 75-38 7Z" fill={AMBER} {...outline} />
        <Path d="m165 88 55 2m-57 20 56 3m-55 17 46 6m-56 12 39 6m-53-83-7 26 10 25m-12-90-2 21m-45 100 14-3m-15-9 13-3" {...fine} />
      </G>
      <Ellipse cx="173" cy="161" rx="67" ry="22" fill={AMBER} {...outline} />
      <Ellipse cx="173" cy="157" rx="58" ry="17" fill={SURFACE} stroke={PAPER} strokeWidth="3" />
      <Path d="m224 45 15-20m-2 33 23-10M55 67 35 55m13 29-24-1" stroke={AMBER} strokeWidth="4" />
    </G>
  );
}

function RulesArtwork() {
  return (
    <G>
      <Ellipse cx="148" cy="174" rx="106" ry="15" fill={withAlpha(Colors.black, 0.42)} />
      <G rotation={-6} origin="133,102">
        <Path d="M59 19 203 10 218 171 70 184Z" fill={AMBER} />
        <Path d="M48 10 192 4 207 164 60 176Z" fill={PAPER} {...outline} />
        <Path d="m68 30 91-4m-87 22 62-3m-59 35 57-3m-54 19 47-3m-43 20 63-4m-60 20 43-3m-38 20 29-2" {...fine} />
      </G>
      <G rotation={8} origin="206,111">
        <Path d="m189 65 13 7 16-1 8 14 13 9-2 17 6 14-11 11-6 16-17 2-13 10-15-8-16-1-7-15-11-11 4-16-2-16 14-8 7-15Z" fill={AMBER} {...outline} />
        <Circle cx="195" cy="116" r="29" fill={PAPER} {...outline} />
        <Path d="m179 116 11 12 24-27" fill="none" stroke={INK} strokeWidth="7" strokeLinecap="square" />
        <Path d="m176 151 2 40 18-12 17 10 1-39" fill={AMBER} {...outline} />
      </G>
      <G rotation={23} origin="248,96">
        <Path d="M239 28h16v116l-8 24-9-24Z" fill={PAPER_MUTED} {...outline} />
        <Path d="m239 144 16-1-8 25Z" fill={PAPER} {...outline} />
        <Path d="m244 159 3 9 4-9Z" fill={INK} />
      </G>
    </G>
  );
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

/** One screen-printed prop per game. Covers are full-bleed; cards reuse its central mark. */
export const GameArtwork = React.memo(function GameArtwork({
  gameKey,
  size = 180,
  mode = 'mark',
}: {
  gameKey: string;
  size?: number;
  mode?: ArtworkMode;
}) {
  const cover = mode === 'cover';
  return (
    <Svg
      width={cover ? '100%' : size}
      height={cover ? '100%' : size}
      viewBox="0 0 300 200"
      preserveAspectRatio={cover ? 'xMidYMid slice' : 'xMidYMid meet'}
      accessible={false}
    >
      {cover ? <Backdrop gameKey={gameKey} /> : null}
      <Subject gameKey={gameKey} />
    </Svg>
  );
});
