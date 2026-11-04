
import React, { memo, ComponentType } from 'react';
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
export const ListIcon = wrap(List, 'ListIcon');
export const SlidersHorizontalIcon = wrap(SlidersHorizontal, 'SlidersHorizontalIcon');
