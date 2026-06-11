/**
 * Icon library — thin wrappers around `lucide-react-native` so call sites
 * stay on the `{ size, color }` API. Lucide owns the actual SVG paths;
 * no hand-rolled approximations live here.
 */

import React, { memo, ComponentType } from 'react';
import {
  Beer,
  BeerOff,
  LockKeyhole,
  Eye,
  MapPin,
  ExternalLink,
  RefreshCw,
  Settings,
  BellRing,
  Volume2,
  Info,
  Shield,
  ChevronLeft,
  ChevronRight,
  Heart,
  Flag,
  MessageSquare,
  Radius,
  Signal,
  Wifi,
  BatteryFull,
  Pencil,
  Plus,
  Trash2,
  Copy,
  X,
  LucideProps,
} from 'lucide-react-native';

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

export const BeerIcon = wrap(Beer, 'BeerIcon');
export const BeerOffIcon = wrap(BeerOff, 'BeerOffIcon');
export const LockKeyholeIcon = wrap(LockKeyhole, 'LockKeyholeIcon');
export const EyeIcon = wrap(Eye, 'EyeIcon');
export const MapPinIcon = wrap(MapPin, 'MapPinIcon');
export const ExternalLinkIcon = wrap(ExternalLink, 'ExternalLinkIcon');
export const RefreshCwIcon = wrap(RefreshCw, 'RefreshCwIcon');
export const SettingsIcon = wrap(Settings, 'SettingsIcon');
export const BellRingIcon = wrap(BellRing, 'BellRingIcon');
export const Volume2Icon = wrap(Volume2, 'Volume2Icon');
export const InfoIcon = wrap(Info, 'InfoIcon');
export const ShieldIcon = wrap(Shield, 'ShieldIcon');
export const ChevronLeftIcon = wrap(ChevronLeft, 'ChevronLeftIcon');
export const ChevronRightIcon = wrap(ChevronRight, 'ChevronRightIcon');
export const HeartIcon = wrap(Heart, 'HeartIcon');
export const FlagIcon = wrap(Flag, 'FlagIcon');
export const MessageSquareIcon = wrap(MessageSquare, 'MessageSquareIcon');
export const RadiusIcon = wrap(Radius, 'RadiusIcon');
export const SignalIcon = wrap(Signal, 'SignalIcon');
export const WifiIcon = wrap(Wifi, 'WifiIcon');
export const BatteryFullIcon = wrap(BatteryFull, 'BatteryFullIcon');
export const PencilIcon = wrap(Pencil, 'PencilIcon');
export const PlusIcon = wrap(Plus, 'PlusIcon');
export const Trash2Icon = wrap(Trash2, 'Trash2Icon');
export const CopyIcon = wrap(Copy, 'CopyIcon');
export const XIcon = wrap(X, 'XIcon');
