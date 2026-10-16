import React, { memo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { Colors, withAlpha } from '@/theme/colors';
import type { TourStop } from './model';

interface TourJourneyIllustrationProps {
  stops: readonly Pick<TourStop, 'id'>[];
  statuses?: Readonly<Record<string, 'visited' | 'skipped'>>;
  nextStopId?: string;
}

// Imagined Czech pub facades, not depictions of the named venues or geography.
function PubFacade({ alternate, current, compact }: {
  alternate: boolean;
  current: boolean;
  compact: boolean;
}) {
  const door = current ? Colors.amber : withAlpha(Colors.foam, 0.12);
  return alternate ? (
    <G>
      <Path d="M8 94V28H80V94Z" fill={Colors.stout3} stroke={Colors.foamMuted} />
      <Path d="M3 28 14 11H74L85 28Z" fill={Colors.stout2} />
      <Path d="M12 34H76M8 59H80M3 94H85M18 11V4H26V11" />
      <Path d="M19 41H30V52H19ZM38 41H49V52H38ZM57 41H68V52H57Z" fill={withAlpha(Colors.foam, 0.06)} />
      <Path d="M36 94V72A8 8 0 0 1 52 72V94" fill={door} />
      <Path d="M16 70H27V86H16ZM61 70H72V86H61Z" fill={withAlpha(Colors.foam, 0.06)} />
      <Path d="M13 65H30M58 65H75M39 61H49" />
      {!compact && <>
        <Path d="M16 47H30M57 47H68M22 70V86M66 70V86M47 82V85M22 17H66M18 22H71" />
        <Path d="M80 40H92V46M88 47H96L95 59H89ZM90 44H94" />
        <Path d="M91 49V56M12 91H29M59 91H75" stroke={Colors.amberLight} />
        <Path d="M2 94V85M0 85C-5 78 2 77 2 82C3 74 10 77 5 85" stroke={Colors.mutedText} />
      </>}
    </G>
  ) : (
    <G>
      <Path d="M10 94V29L44 5L78 29V94Z" fill={Colors.stout3} stroke={Colors.foamMuted} />
      <Path d="M4 30 44 2 84 30M15 36H73M7 94H81M15 89H31M57 89H73" />
      <Path d="M26 14V6H33V9M38 21H50V30H38Z" fill={Colors.stout2} />
      <Path d="M18 46H30V65H18ZM58 46H70V65H58Z" fill={withAlpha(Colors.foam, 0.06)} />
      <Path d="M34 94V66A10 10 0 0 1 54 66V94" fill={door} />
      <Path d="M30 94H58M19 71H29M59 71H69" />
      {!compact && <>
        <Path d="M24 46V65M18 54H30M64 46V65M58 54H70M48 79V82M38 94V69M40 18H48" />
        <Path d="M10 40H-3V51" />
        <Circle cx={-3} cy={61} r={10} fill={Colors.stout2} />
        <Path d="M-7 56H0V65H-7ZM0 58H3V63H0M-7 54H0" stroke={Colors.foamMuted} />
        <Path d="M79 38H89V44M86 46H92L91 55H87ZM88 43H90" />
        <Path d="M88 48V52" stroke={Colors.amberLight} />
        <Path d="M15 78H24M62 80H72M67 83H75" stroke={Colors.border} />
      </>}
    </G>
  );
}

export const TourJourneyIllustration = memo(function TourJourneyIllustration({
  stops,
  statuses = {},
  nextStopId,
}: TourJourneyIllustrationProps) {
  const count = stops.length;
  const compact = count > 4;
  const spacing = count > 1 ? (compact ? 282 : 218) / (count - 1) : 0;
  const start = count > 1 ? (350 - spacing * (count - 1)) / 2 : 175;
  const scale = Math.min(1.05, count > 1 ? spacing / 110 : 1.05);
  const baseline = 122;
  const badgeY = 140;
  const skyline = withAlpha(Colors.foamMuted, 0.14);

  return (
    <View style={[styles.artwork, compact && styles.compactArtwork]} pointerEvents="none" accessible={false}
      accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width="100%" height="100%" viewBox={compact ? '0 24 350 134' : '0 0 350 158'} pointerEvents="none" accessible={false}>
        <G fill="none" strokeLinecap="round" strokeLinejoin="round">
          <Path stroke={skyline} strokeWidth={1.25}
            d="M0 116H15V63L36 47L56 63V79H79V48L87 34L95 48V73H112V62L135 48L158 62V84H179V42L188 26L197 42V73H212V57L231 45L250 57V91H271V61L294 45L317 61V84H338V115H350" />
          <Path stroke={skyline} strokeWidth={1}
            d="M26 77V91M43 77V91M126 70V79M142 70V79M184 50H192M224 66V79M239 66V79M287 71V84M302 71V84M0 126H350" />
          <Path stroke={withAlpha(Colors.foamMuted, 0.08)} strokeWidth={1}
            d="M10 130H40M91 129H117M177 130H203M271 131H290M316 130H340" />
          {count > 1 && <Path
            d={`M${start} ${badgeY} C${start + spacing * 0.35} 155 ${start + spacing * 0.65} 155 ${start + spacing} ${badgeY}${stops.slice(2).map((_, index) => ` S${start + spacing * (index + 1.65)} 130 ${start + spacing * (index + 2)} ${badgeY}`).join('')}`}
            stroke={withAlpha(Colors.foamMuted, 0.55)} strokeWidth={1.5} strokeDasharray="1 5" />}
          {stops.map((stop, index) => {
            const x = start + index * spacing;
            const current = stop.id === nextStopId;
            const status = statuses[stop.id];
            const visited = status === 'visited';
            const fill = visited ? Colors.foam : Colors.stout;
            const ink = visited ? Colors.stout : current ? Colors.amber : Colors.foamMuted;
            return (
              <G key={stop.id}>
                <G transform={`translate(${x - 44 * scale}, ${baseline - 94 * scale}) scale(${scale})`}
                  stroke={withAlpha(Colors.foamMuted, status === 'skipped' ? 0.4 : 0.8)}
                  strokeWidth={Math.min(2.2, 1.4 / scale)}>
                  <PubFacade alternate={index % 2 === 1} current={current} compact={compact} />
                </G>
                <Path d={`M${x} ${baseline + 1}V${badgeY - 11}`} stroke={withAlpha(Colors.foamMuted, 0.4)} strokeWidth={1} />
                <Circle cx={x} cy={badgeY} r={11} fill={fill}
                  stroke={current ? Colors.amber : withAlpha(Colors.foamMuted, visited ? 1 : 0.4)} strokeWidth={1.25} />
                {visited ? <Path d={`m${x - 4} ${badgeY} 2.5 2.5 5-5`} stroke={ink} strokeWidth={1.8} />
                  : status === 'skipped' ? <Path d={`M${x - 3.5} ${badgeY}H${x + 3.5}`} stroke={ink} strokeWidth={1.8} />
                    : <SvgText x={x} y={badgeY + 4.2} textAnchor="middle" fontSize={12} fontFamily={Platform.OS === 'ios' ? 'System' : 'sans-serif'} fontWeight="700" fill={ink}>{index + 1}</SvgText>}
              </G>
            );
          })}
        </G>
      </Svg>
    </View>
  );
});

const styles = StyleSheet.create({
  artwork: { width: '100%', aspectRatio: 350 / 158 },
  compactArtwork: { aspectRatio: 350 / 134 },
});
