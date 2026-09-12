import React from "react";
import Svg, { Circle, G, Path } from "react-native-svg";

import { Colors, withAlpha } from "@/theme/colors";

const INK = "#221B12";
const PAPER = Colors.foam;
const AMBER = Colors.amber;
const cut = { stroke: INK, strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

/** Standalone impressions: the prompt sheet itself is the paper. */
export const PromptCardPrint = React.memo(function PromptCardPrint({ gameKey }: { gameKey: string }) {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 220 120" preserveAspectRatio="xMidYMid meet" accessible={false}>
      {gameKey === "thumb" ? (
        <G>
          {/* A side-on hand: curled fingers above, thumb planted on the tabletop. */}
          <Path d="M22 104h178l-5 8H28Z" fill={AMBER} />
          <Path d="M23 103h176m-160 9h58m46 0h41" fill="none" {...cut} />
          <Path d="M49 35 78 30q12-15 31-13l41 5q11 2 11 12 19 1 19 13 12 3 10 15-1 13-16 14l-37-1 2 20q0 9-11 9h-11q-10 0-12-11l-6-24-39 5Z" fill={PAPER} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
          <Path d="M151 23q-12 4-11 15l20 3m-17-2q-12 5-9 16l35 3m-35-3q-9 7-3 19m-35-8q14-17 28-18" fill="none" {...cut} />
          <Path d="m117 91 13-1 1 9h-12Zm-36-49 8-4m-6 13 9-4m13-20 12 2m-9 6 12 2" fill="none" stroke={INK} strokeWidth={2} />
          <Path d="m19 31 35-3 10 49-38 8Z" fill={INK} />
          <Path d="m27 40 21-3m-18 12 20-3m-18 12 20-3" stroke={PAPER} strokeWidth={2} />
          <Circle cx="47" cy="68" r="3" fill={AMBER} />
          <Path d="m101 91-9-5m50 4 9-6" {...cut} />
        </G>
      ) : gameKey === "rules" ? (
        <G>
          {/* The same approval seal as the cover, impressed directly on paper. */}
          <Path d="m87 80-9 31 17-6 10 11 7-32m4-4 8 34 10-11 16 4-13-30" fill={INK} />
          <Path d="m89 92-5 13m43-14 4 12" stroke={PAPER} strokeWidth={2} />
          <Path d="m109 5 10 5 11-1 7 8 11 3 3 11 8 7-2 11 4 10-7 9-2 11-11 4-7 8-11-1-10 5-10-5-11 1-7-8-10-4-2-11-7-9 4-10-2-11 8-7 3-11 11-3 7-8 11 1Z" fill={AMBER} stroke={INK} strokeWidth={3.5} strokeLinejoin="round" />
          <Circle cx="109" cy="51" r="32" fill={PAPER} stroke={INK} strokeWidth={2.5} />
          <Path d="M87 41a25 25 0 0 1 32-13m13 34a25 25 0 0 1-32 13" fill="none" stroke={INK} strokeWidth={1.5} />
          <Path d="m91 49 12 12 22-27 6 5-27 33-20-19Z" fill={INK} />
          <Path d="M30 46h28m-17 7h17m103-7h29m-29 7h18" fill="none" {...cut} strokeWidth={2} />
        </G>
      ) : gameKey === "never" ? (
        <G>
          <Path d="M77 110 73 87 53 61q-5-8 2-12 6-4 13 5l9 10-7-40q-2-10 6-12 9-2 11 9l7 29-1-39q0-9 8-9t9 10l3 37 6-30q2-10 10-7 8 2 6 11l-4 31 9-18q4-8 11-4t3 13l-10 35-16 28-1 13Z" fill={PAPER} stroke={INK} strokeWidth={4} strokeLinejoin="round" />
          <Path d="M77 103h53l-3 13H80Z" fill={AMBER} />
          <Path d="M84 70q27-10 41 4m-29-14 3 6m14-9 1 8m-21 16 12 13m9-15-4 15" fill="none" {...cut} strokeWidth={2.5} />
          <Path d="m48 20-9-9m7 25-14-3m127-14 9-10m-6 27 15-3" {...cut} />
        </G>
      ) : (
        <G>
          {/* Three actual categories, without a second deck inside the card. */}
          <G rotation={-9} origin="45,66">
            <Path d="M20 45h42v53q-20 9-40-1Z" fill={AMBER} stroke={INK} strokeWidth={3.5} />
            <Path d="M63 51h8q12 0 11 13l-1 13q-1 10-18 10m0-28h6q5 0 4 6l-1 8q0 5-9 5" fill="none" {...cut} />
            <Path d="M18 46q-6-10 3-16 5-4 11 0 5-14 16-7 9-3 13 7 12 0 8 12l-5 7-18-3-8 4-11-4Z" fill={PAPER} stroke={INK} strokeWidth={3.5} />
            <Path d="m30 58 1 29m10-28 1 32m10-32 1 28" stroke={PAPER} strokeWidth={3} />
          </G>
          <G rotation={8} origin="110,50">
            <Path d="M97 26v51c-12-3-22 2-22 11 0 13 26 11 28-1V42l24-7v32c-11-3-22 3-22 11 0 13 27 11 28-2V15Z" fill={INK} />
            <Path d="m104 28 22-6v5l-22 7Z" fill={AMBER} />
          </G>
          <G rotation={-12} origin="174,65">
            <Circle cx="174" cy="62" r="31" fill={PAPER} stroke={INK} strokeWidth={3.5} />
            <Path d="m153 39 13 1 3 8 11 3-2 9-11 1-6 12-9-3-5-15Zm28 27 11-5 10 7-8 15-10 6-1-12-7-4Z" fill={AMBER} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
            <Path d="M145 47c-13 25 7 54 35 50 16-2 26-12 30-22m-35 23v10m-14 3h29" fill="none" {...cut} />
            <Path d="m176 35 3 7m-30 18 6 2m38-19 4 5" stroke={INK} strokeWidth={2} />
          </G>
        </G>
      )}
    </Svg>
  );
});

/** A question cut into a round pub-quiz ink stamp. */
export const QuizPrint = React.memo(function QuizPrint() {
  return (
    <Svg width={52} height={52} viewBox="0 0 52 52" accessible={false}>
      <Path d="M25 3C38 1 49 12 49 25S40 49 26 49 3 40 3 26 12 5 25 3Z" fill={AMBER} stroke={INK} strokeWidth={2.5} />
      <Path d="M9 25A17 17 0 0 1 25 9m18 18A17 17 0 0 1 27 43" fill="none" stroke={INK} strokeWidth={1.5} />
      <Path d="M18 20c-1-12 21-13 20-1 0 7-10 8-9 14h-7c-1-10 9-10 9-15 0-4-7-3-7 2Z" fill={INK} />
      <Path d="m22 36 7-1v7l-7 1Z" fill={INK} />
    </Svg>
  );
});

/** An engraved tankard flanked by receipt rules. */
export const RoundReceiptPrint = React.memo(function RoundReceiptPrint() {
  return (
    <Svg width="100%" height="100%" viewBox="0 0 180 62" preserveAspectRatio="xMidYMid meet" accessible={false}>
      <Path d="M6 24h47m-36 5h36m74-5h47m-47 5h36M30 45h24m72 0h24" fill="none" {...cut} strokeWidth={2} />
      <Path d="M68 24h34l-1 29q-17 8-31-1Z" fill={AMBER} stroke={INK} strokeWidth={3} />
      <Path d="M103 27h7q11 0 8 12-1 9-16 9m1-15h5q5 0 2 7l-8 2" fill="none" {...cut} />
      <Path d="M67 26q-8-8 0-14 6-4 10 0 1-10 11-7 8-4 12 5 13 0 9 10l-6 8-11-3-8 4-9-3Z" fill={PAPER} stroke={INK} strokeWidth={3} />
      <Path d="m77 34 1 15m7-16v18m8-17-1 16" stroke={INK} strokeWidth={2} />
      <Path d="m55 9 6 7m56-8-5 8M86 1v2" {...cut} strokeWidth={2} />
    </Svg>
  );
});

/** Die-cut pulp beer mats; the middle remains clear for native player text. */
export const ResultCoaster = React.memo(function ResultCoaster({ first }: { first: boolean }) {
  const edge = "M59 4C75 3 92 12 103 26c9 13 15 28 12 43-3 17-16 31-31 40-14 8-33 8-47 1C20 102 8 87 5 70 1 53 7 35 20 22 31 10 44 5 59 4Z";
  return (
    <Svg width="100%" height="100%" viewBox="0 0 120 120" accessible={false}>
      <Path d={edge} fill={withAlpha("#000000", 0.34)} transform="translate(1 3)" />
      <Path d={edge} fill={first ? AMBER : PAPER} stroke={INK} strokeWidth={2} />
      <Path d="M60 12c27 0 49 21 49 48 0 28-23 49-49 49S12 87 12 60c0-26 21-48 48-48Z" fill="none" stroke={INK} strokeWidth={1.5} opacity={0.65} />
      <Path d="M27 33A40 40 0 0 1 88 31M29 89a40 40 0 0 0 62-2" fill="none" stroke={INK} strokeWidth={3} opacity={first ? 0.9 : 0.6} />
      <Path d="m20 41 6 2m-9 7 6 1m-6 8h6m-5 9 6-1m-3 10 6-3m71-34-6 3m9 6-6 2m7 8h-6m5 10-6-1m3 10-5-3" stroke={INK} strokeWidth={1.5} opacity={0.6} />
    </Svg>
  );
});
