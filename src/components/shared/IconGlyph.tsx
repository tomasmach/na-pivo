
import React, { memo, ComponentType } from 'react';
import Svg, { Circle as SvgCircle, Path as SvgPath } from 'react-native-svg';
// Per-icon deep imports: the package root re-exports all ~1,850 icons and
// Metro evaluates every one of them at startup.
import Armchair from 'lucide-react-native/icons/armchair';
import Volume2 from 'lucide-react-native/icons/volume-2';
import Info from 'lucide-react-native/icons/info';
import Radius from 'lucide-react-native/icons/radius';
import Coins from 'lucide-react-native/icons/coins';
import User from 'lucide-react-native/icons/user';
import List from 'lucide-react-native/icons/list';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import type { LucideProps } from 'lucide-react-native';

interface IconProps {
  size?: number;
  color: string;
}

function wrap(Lucide: ComponentType<LucideProps>, displayName: string) {
  const Wrapped = memo(function Icon({ size = 20, color }: IconProps) {
    return <Lucide size={size} color={color} strokeWidth={2} />;
  });
  Wrapped.displayName = displayName;
  return Wrapped;
}

export const ArmchairIcon = wrap(Armchair, 'ArmchairIcon');
export const Volume2Icon = wrap(Volume2, 'Volume2Icon');
export const InfoIcon = wrap(Info, 'InfoIcon');
export const RadiusIcon = wrap(Radius, 'RadiusIcon');
export const CoinsIcon = wrap(Coins, 'CoinsIcon');
export const UserIcon = wrap(User, 'UserIcon');
// Soccer ball — lucide ships no soccer/football glyph, so this is a deliberate
// hand-rolled exception (owner wanted a real football for "stolní fotbal"):
// outer circle + central pentagon + radial seams, drawn to match the lucide look.
const SoccerBallIcon = memo(function SoccerBallIcon({ size = 20, color }: IconProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <SvgCircle cx={12} cy={12} r={9} />
      <SvgPath d="M12 8.8 L15.04 11.01 L13.88 14.59 L10.12 14.59 L8.96 11.01 Z M12 8.8 L12 3 M15.04 11.01 L20.56 9.22 M13.88 14.59 L17.29 19.28 M10.12 14.59 L6.71 19.28 M8.96 11.01 L3.44 9.22" />
    </Svg>
  );
});
SoccerBallIcon.displayName = 'SoccerBallIcon';
export const ListIcon = wrap(List, 'ListIcon');
export const SlidersHorizontalIcon = wrap(SlidersHorizontal, 'SlidersHorizontalIcon');
