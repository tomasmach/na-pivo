import React from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { Colors } from '@/theme/colors';

/** Hand-cut silhouettes, open carving marks and a second amber printing plate. */
export function GameArtwork({
  gameKey,
  size = 180,
  ink = Colors.stout,
  paper = Colors.foam,
}: {
  gameKey: string;
  size?: number;
  ink?: string;
  paper?: string;
}) {
  const amber = Colors.amber;
  const cut = { fill: 'none', stroke: ink, strokeWidth: 2.4, strokeLinecap: 'square' as const };
  const paperCut = { ...cut, stroke: paper };
  const crown = 'M77 97 68 65 90 78 105 47 120 79 143 62 137 98 107 103Z';

  return (
    <Svg width={size} height={size} viewBox="0 0 220 220" accessible={false}>
      {gameKey === 'quiz' && (
        <G>
          <Path d="M37 44 151 29 176 179 62 196 52 185 42 185 47 172 38 164Z" fill={amber} />
          <Path d="M34 34 146 23 163 178 48 190 51 180 40 174 44 161Z" fill={paper} stroke={ink} strokeWidth={3} />
          <Path d="m49 46 80-8M61 160l37-4m-34 16 29-4" {...cut} />
          <Path d="M78 82c-3-24 37-32 43-11 5 18-19 21-15 39l-14 2c-7-20 20-24 15-36-4-8-16-3-15 5Z" fill={ink} />
          <Path d="m95 121 15-2 2 15-15 2Z" fill={amber} />
          <G rotation={27} origin="157,115">
            <Path d="M148 41 168 39 170 162 158 189 146 161Z" fill={amber} stroke={ink} strokeWidth={3} />
            <Path d="m148 158 20 2-10 27Z" fill={paper} />
            <Path d="m153 178 5 10 5-11Z" fill={ink} />
            <Path d="m155 57 1 93m6-92 1 90M148 52l20-1" {...cut} />
          </G>
        </G>
      )}
      {gameKey === 'dice' && (
        <G>
          <G rotation={-14} origin="80,96">
            <Path d="M29 57 103 51 124 70 120 138 43 147 24 128Z" fill={amber} stroke={ink} strokeWidth={3} />
            <Path d="M29 57 103 51 101 123 24 128Z" fill={paper} stroke={ink} strokeWidth={3} />
            <Path d="m101 123 19 15m-19-15 23-53m-22 64 12 8m-22-7 11 8" {...cut} />
            {[[45,74],[83,70],[64,91],[43,111],[83,108]].map(([cx,cy]) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={6} fill={ink} />)}
          </G>
          <G rotation={17} origin="145,148">
            <Path d="M105 113 172 106 191 122 188 181 121 190 105 174Z" fill={amber} stroke={ink} strokeWidth={3} />
            <Path d="M105 113 172 106 172 168 105 174Z" fill={paper} stroke={ink} strokeWidth={3} />
            <Path d="m172 168 16 13m-16-13 19-46m-63 59 7 6m4-7 7 6m4-8 8 6" {...cut} />
            {[[121,130],[156,126],[122,157],[155,153]].map(([cx,cy]) => <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={6} fill={ink} />)}
          </G>
          <Path d="m157 49 9-13m4 26 18-6M27 173l-9 6m21 5-4 13" stroke={amber} strokeWidth={3} />
        </G>
      )}
      {gameKey === 'categories' && (
        <G>
          <Path d="M23 71 97 35 155 161 85 195Z" fill={amber} stroke={ink} strokeWidth={3} />
          <Path d="M76 30 153 35 148 179 68 174Z" fill={paper} stroke={ink} strokeWidth={3} />
          <Path d="M139 44 202 80 137 196 69 157Z" fill={paper} stroke={ink} strokeWidth={3} />
          <Path d="m139 58 47 26m-88-35 39 2M34 78l39-19m53 112 19-34 15 8-19 35Z" {...cut} />
          <Path d="m138 90-13 22 8 13 19 2 13-23-9-14Z" fill={amber} stroke={ink} strokeWidth={3} />
          <Path d="m143 93-8 16m17-14-8 15m-35 45 18 11m-22-3 18 11" {...cut} />
          <Path d="M93 74 118 72 116 111 94 114Z" fill={ink} />
          <Path d="m95 81 18-2m-17 8 16-1" {...paperCut} />
          <Path d="m45 96 11-6 21 40-12 7Z" fill={ink} />
        </G>
      )}
      {gameKey === 'never' && (
        <G>
          <Path d="m58 188-6-39-18-41q-5-14 7-18 9-2 15 12l7 11-7-65q-1-14 11-14 10 0 12 13l8 50-2-69q0-13 12-13t12 15l1 65 8-59q2-13 13-10 10 3 8 16l-6 66 13-36q5-12 15-7 9 4 5 17l-12 49-11 30-1 27Z" fill={paper} stroke={ink} strokeWidth={3} />
          <Path d="m59 174 81-5 4 30-82 5Z" fill={amber} stroke={ink} strokeWidth={3} />
          <Path d="m66 122 15 19 3 19m12-45 23 4 13 14m-52-14 9-6m22 24 14 4M65 48l3 17m29-35 1 18m29-9-2 16m28 26-4 13m-82 92 5 13m4-13 5 13" {...cut} />
          <Path d="m167 34 9 8 15-18-8-7Zm9 9-16 16 8 8 15-17Z" fill={amber} />
        </G>
      )}
      {gameKey === 'kings' && (
        <G>
          <G rotation={-10} origin="107,108">
            <Path d="M48 26 165 29 164 181 45 186Z" fill={paper} stroke={ink} strokeWidth={3} />
            <Path d="m57 40 97 2M57 171l95-2" {...cut} />
            <Path d={crown} fill={amber} stroke={ink} strokeWidth={3.5} />
            <Path d="m80 107 54-2m-47 8 39-1M100 128l8-13 8 12-8 14Z" fill={ink} />
            <Path d="m59 53 6-7 6 7-6 8m76 96 6-7 6 7-6 8" fill={ink} />
            <Path d="m77 77 7 18m3-13 5 12" {...cut} />
          </G>
          <Path d="M137 140 187 137 182 161q-4 14-17 16l1 13 16 2-1 7-48 2 1-8 17-3 1-13q-13-4-14-18Z" fill={amber} stroke={ink} strokeWidth={3} />
          <Path d="m145 147 33-3m-32 9 2 9m5-12 2 14" {...cut} />
        </G>
      )}
      {gameKey === 'round' && (
        <G>
          <Path d="M68 33 163 40 151 196l-12-7-10 7-10-8-11 6-10-7-12 6-10-9-12 7Z" fill={amber} />
          <Path d="M56 24 154 30 141 185l-11-6-12 7-10-8-11 5-11-8-11 6-10-8-12 7Z" fill={paper} stroke={ink} strokeWidth={3} />
          <Path d="m72 44 62 4m-62 9 42 3m-45 69 59 5m-58 7 26 2m-28 10 61 5m-57 9 57 3" {...cut} />
          <Path d="m81 73 33 3-4 41-34-4Z" fill={amber} stroke={ink} strokeWidth={3} />
          <Path d="m114 82 13 2-2 24-14-1m-28-22-2 21m10-20-1 21m8-20-1 22" {...cut} />
          <Circle cx={164} cy={153} r={24} fill={amber} stroke={ink} strokeWidth={3} />
          <Circle cx={164} cy={153} r={17} {...cut} />
          <Path d="m164 140-7 12 7 13 7-13Z" fill={ink} />
          <Path d="m40 48-12-7m10 20-15-1" stroke={amber} strokeWidth={3} />
        </G>
      )}
      {gameKey === 'bottle' && (
        <G rotation={22} origin="110,110">
          <Path d="m99 24 27 1-3 50 14 17 8 17-4 88-67-2 4-88 9-17 12-15Z" fill={amber} stroke={ink} strokeWidth={3} />
          <Path d="m98 23 30 1-1 11-30-2Z" fill={paper} stroke={ink} strokeWidth={3} />
          <Path d="m79 115 66 2-2 43-66-3Z" fill={paper} stroke={ink} strokeWidth={3} />
          <Path d="m99 125 19 1-1 21-20-1Zm19 5 8 1-1 12-8-1" fill={amber} stroke={ink} strokeWidth={2.5} />
          <Path d="m105 42-2 30m-7 15-9 18m2 3-2 6m-3 55-1 18m7-17-1 20m41-23-2 20m-18-18-1 13" {...cut} />
          <Path d="m58 91-14-9m13 24-19 1m118 51 16 9m-15-25 20-2" stroke={amber} strokeWidth={3} />
        </G>
      )}
      {gameKey === 'thumb' && (
        <G>
          <Path d="M78 155 71 98l18-28 5-36q2-13 13-10 15 5 13 25l-4 28 45-3q15 0 16 11l-2 11q9 13-1 23 5 13-7 21 0 15-14 18l-48 9Z" fill={paper} stroke={ink} strokeWidth={3} />
          <Path d="m47 100 29-6 11 69-32 6Z" fill={amber} stroke={ink} strokeWidth={3} />
          <Path d="m126 94 45 2m-48 19 49 3m-49 15 40 5m-50 11 35 6m-51-77-5 23 9 22M104 37l-1 16m-42 99 11-2m-12-6 10-2" {...cut} />
          <Path d="m31 189 159-7-1 8-158 7Z" fill={paper} />
          <Path d="m145 43 10-16m1 27 18-9M29 73l-13-8" stroke={amber} strokeWidth={3} />
        </G>
      )}
      {gameKey === 'rules' && (
        <G>
          <Path d="M38 39 153 27 171 184 51 195Z" fill={paper} stroke={ink} strokeWidth={3} />
          <Path d="m53 53 84-10m-82 19 59-7m-55 27 47-5m-44 18 39-4m-36 18 52-5m-49 18 37-4m-34 18 25-2m-20 24 67-8m-65 17 67-9" {...cut} />
          <Path d="m130 136-2 55 20-13 13 13 3-53Z" fill={amber} stroke={ink} strokeWidth={3} />
          <Path d="m143 66 12 6 14-1 7 13 12 8-1 15 5 13-10 10-5 14-15 2-12 8-13-7-15-1-6-14-10-9 3-15-2-14 13-8 6-13Z" fill={amber} stroke={ink} strokeWidth={3} />
          <Circle cx={148} cy={110} r={25} {...cut} />
          <Path d="m133 111 10 11 22-26" fill="none" stroke={ink} strokeWidth={6} />
          <Path d="m132 142 3-8m34-53-6 6m-33-1 6 5m36 35-8-4" {...cut} />
        </G>
      )}
    </Svg>
  );
}
