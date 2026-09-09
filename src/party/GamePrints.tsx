import React from "react";
import Svg, { Circle, G, Line, Path, Rect } from "react-native-svg";

import { Colors, withAlpha } from "@/theme/colors";

const INK = "#221B12";
const PAPER = Colors.foam;
const AMBER = Colors.amber;

const roughLine = {
  stroke: INK,
  strokeWidth: 5,
  strokeLinecap: "square" as const,
  strokeLinejoin: "round" as const,
};

/** Ink printed directly on a prompt card. No second card hidden inside it. */
export const PromptCardPrint = React.memo(function PromptCardPrint({
  gameKey,
}: {
  gameKey: string;
}) {
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 220 120"
      preserveAspectRatio="xMidYMid meet"
      accessible={false}
    >
      {gameKey === "thumb" ? (
        <G rotation={-3} origin="110,60">
          <Path
            d="m63 103-5-39 17-19 8-27q3-13 15-10 11 3 9 18l-3 21 55-2q14 0 15 11l-3 10q8 10 0 19 2 12-10 17-5 11-18 11l-49-2Z"
            fill={withAlpha(AMBER, 0.22)}
          />
          <Path
            d="m61 98-5-38 18-19 8-26q3-12 14-9 12 3 9 19l-3 20 54-2q14 0 15 11l-3 11q8 10 0 19 3 11-10 17-4 12-18 12l-50 4Z"
            fill={PAPER}
            {...roughLine}
          />
          <Path d="m31 61 29-6 10 54-32 7Z" fill={AMBER} {...roughLine} />
          <Path d="m112 60 58 1m-60 17 58 2m-57 16 47 2m-52-52-6 20 9 17" fill="none" {...roughLine} strokeWidth={3} />
        </G>
      ) : gameKey === "rules" ? (
        <G>
          <Path d="M36 21 145 14l7 84-111 9Z" fill={withAlpha(AMBER, 0.18)} />
          <Path d="M29 15 139 9l7 84-112 10Z" fill="none" stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <Path d="m48 36 64-4m-62 17 43-3m-42 20 52-4m-50 18 35-3" fill="none" {...roughLine} strokeWidth={3} />
          <G rotation={7} origin="166,68">
            <Path d="m165 24 10 7 12-1 5 11 10 7-3 13 4 11-9 9-5 13-13 1-10 8-12-7-13-1-5-12-8-9 4-12-2-13 10-6 6-12 12 1Z" fill={AMBER} {...roughLine} />
            <Circle cx="166" cy="64" r="25" fill={PAPER} stroke={INK} strokeWidth={5} />
            <Path d="m152 65 10 10 20-23" fill="none" {...roughLine} strokeWidth={7} />
          </G>
        </G>
      ) : gameKey === "never" ? (
        <G>
          <Path d="M61 101 52 72 35 50q-7-10 3-16 9-5 16 7l9 10-2-31q0-12 10-12 10 0 11 13l4 28 2-35q1-11 11-10 11 1 9 13l-1 31 9-27q3-11 13-7 9 4 5 15l-9 31 13-17q7-8 15-2 8 7 1 15l-19 27-10 21Z" fill={PAPER} {...roughLine} />
          <Path d="m60 89 67-2 3 27-68 2Z" fill={AMBER} {...roughLine} />
          <Circle cx="169" cy="65" r="31" fill={AMBER} {...roughLine} />
          <Circle cx="169" cy="65" r="22" fill={PAPER} stroke={INK} strokeWidth={4} />
          <Path d="m157 65 8 9 17-20" fill="none" {...roughLine} />
        </G>
      ) : (
        <G>
          <Path d="M20 29 74 17l17 73-54 13Z" fill={withAlpha(AMBER, 0.28)} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <Path d="M82 14h58v82H82Z" fill={PAPER} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <Path d="m145 25 55 13-17 70-54-13Z" fill={withAlpha(AMBER, 0.28)} stroke={INK} strokeWidth={5} strokeLinejoin="round" />
          <Path d="m35 44 31-7m-27 21 22-5m-18 22 31-7m53-35-28 1m29 18-20 1m21 18-29 1m59-31 28 7m-32 10 20 5m-27 11 29 7" fill="none" {...roughLine} strokeWidth={3} />
          <Path d="m101 44 10-13 10 13 14-5-5 27-19 13-19-13-4-27Z" fill={AMBER} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
        </G>
      )}
    </Svg>
  );
});

/** A quiz seal printed into the question sheet. */
export const QuizPrint = React.memo(function QuizPrint() {
  return (
    <Svg width={52} height={52} viewBox="0 0 52 52" accessible={false}>
      <Path d="M5 7 45 4l3 40-42 4Z" fill={AMBER} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
      <Path d="M18 19c-1-7 11-10 15-4 4 7-6 9-5 15l-7 1c-2-8 7-10 5-13-2-3-5-1-5 2Z" fill={INK} />
      <Rect x="22" y="35" width="7" height="7" fill={PAPER} />
    </Svg>
  );
});

/** Receipt header: a beer mat seal and honest printed cuts, not cover art. */
export const RoundReceiptPrint = React.memo(function RoundReceiptPrint() {
  return (
    <Svg width={180} height={62} viewBox="0 0 180 62" accessible={false}>
      <Line x1="7" y1="14" x2="54" y2="11" stroke={INK} strokeWidth={4} strokeLinecap="square" />
      <Line x1="8" y1="26" x2="42" y2="24" stroke={INK} strokeWidth={3} strokeLinecap="square" />
      <Line x1="126" y1="13" x2="173" y2="16" stroke={INK} strokeWidth={4} strokeLinecap="square" />
      <Line x1="138" y1="26" x2="171" y2="29" stroke={INK} strokeWidth={3} strokeLinecap="square" />
      <Circle cx="90" cy="31" r="26" fill={AMBER} stroke={INK} strokeWidth={4} />
      <Circle cx="90" cy="31" r="18" fill={PAPER} stroke={INK} strokeWidth={3} />
      <Path d="M82 17h15l-2 9 5 4-2 18H81l-2-18 5-4Z" fill={INK} />
      <Path d="M84 32h11v12H84Zm11 2h5v8h-5" fill="none" stroke={PAPER} strokeWidth={2.5} />
    </Svg>
  );
});

/** A scored player stands on a printed beer mat, not a dashboard card. */
export const ResultCoaster = React.memo(function ResultCoaster({
  first,
}: {
  first: boolean;
}) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 120 120" accessible={false}>
      <Path
        d="M22 12 46 4 75 6 101 20 114 44 111 76 95 101 69 115 38 111 13 94 4 65 9 35Z"
        fill={withAlpha("#000000", 0.34)}
        transform="translate(2 4)"
      />
      <Path
        d="M22 12 46 4 75 6 101 20 114 44 111 76 95 101 69 115 38 111 13 94 4 65 9 35Z"
        fill={first ? AMBER : PAPER}
        stroke={INK}
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <Circle cx="59" cy="59" r="43" fill="none" stroke={INK} strokeWidth={2.5} opacity={first ? 0.72 : 0.48} />
      <Path d="m18 48 10-3m65 57 9-8M43 15l8-2m44 24 8 5" stroke={INK} strokeWidth={2.5} strokeLinecap="square" opacity={0.5} />
    </Svg>
  );
});
