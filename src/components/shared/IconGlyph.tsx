/**
 * Icon library — thin wrappers around `lucide-react-native` so call sites
 * stay on the `{ size, color }` API. Lucide owns the actual SVG paths;
 * no hand-rolled approximations live here.
 */

import React, { memo, ComponentType } from 'react';
import Svg, { Circle as SvgCircle, Path as SvgPath } from 'react-native-svg';
import {
  Beer,
  BeerOff,
  Compass,
  Undo2,
  LockKeyhole,
  Eye,
  EyeOff,
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
  Wifi,
  Pencil,
  Plus,
  Minus,
  Trash2,
  Copy,
  X,
  Coins,
  Star,
  ThumbsUp,
  ThumbsDown,
  History,
  Clock,
  User,
  Users,
  UserPlus,
  Mail,
  Link,
  Check,
  BadgeCheck,
  KeyRound,
  Crown,
  Camera,
  Images,
  Sparkles,
  TreePine,
  Search,
  CreditCard,
  Accessibility,
  Target,
  CircleDot,
  Radio,
  Mic,
  Tv,
  SquareParking,
  MapPinned,
  MapPinPlus,
  Map,
  List,
  LocateFixed,
  SlidersHorizontal,
  Sprout,
  ClipboardList,
  Flame,
  Trophy,
  Moon,
  QrCode,
  Ellipsis,
  GlassWater,
  Wine,
  ListFilter,
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
export const CompassIcon = wrap(Compass, 'CompassIcon');
export const Undo2Icon = wrap(Undo2, 'Undo2Icon');
export const LockKeyholeIcon = wrap(LockKeyhole, 'LockKeyholeIcon');
export const EyeIcon = wrap(Eye, 'EyeIcon');
export const EyeOffIcon = wrap(EyeOff, 'EyeOffIcon');
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
export const WifiIcon = wrap(Wifi, 'WifiIcon');
export const GlassWaterIcon = wrap(GlassWater, 'GlassWaterIcon');
export const WineIcon = wrap(Wine, 'WineIcon');
export const PencilIcon = wrap(Pencil, 'PencilIcon');
export const PlusIcon = wrap(Plus, 'PlusIcon');
export const MinusIcon = wrap(Minus, 'MinusIcon');
export const Trash2Icon = wrap(Trash2, 'Trash2Icon');
export const CopyIcon = wrap(Copy, 'CopyIcon');
export const XIcon = wrap(X, 'XIcon');
export const CoinsIcon = wrap(Coins, 'CoinsIcon');
export const StarIcon = wrap(Star, 'StarIcon');
export const ThumbsUpIcon = wrap(ThumbsUp, 'ThumbsUpIcon');
export const ThumbsDownIcon = wrap(ThumbsDown, 'ThumbsDownIcon');
export const HistoryIcon = wrap(History, 'HistoryIcon');
export const ClockIcon = wrap(Clock, 'ClockIcon');
export const UserIcon = wrap(User, 'UserIcon');
export const UsersIcon = wrap(Users, 'UsersIcon');
export const UserPlusIcon = wrap(UserPlus, 'UserPlusIcon');
export const MailIcon = wrap(Mail, 'MailIcon');
export const LinkIcon = wrap(Link, 'LinkIcon');
export const CheckIcon = wrap(Check, 'CheckIcon');
export const BadgeCheckIcon = wrap(BadgeCheck, 'BadgeCheckIcon');
export const KeyRoundIcon = wrap(KeyRound, 'KeyRoundIcon');
export const CrownIcon = wrap(Crown, 'CrownIcon');
export const CameraIcon = wrap(Camera, 'CameraIcon');
export const ImagesIcon = wrap(Images, 'ImagesIcon');
export const SparklesIcon = wrap(Sparkles, 'SparklesIcon');
export const TreePineIcon = wrap(TreePine, 'TreePineIcon');
export const SearchIcon = wrap(Search, 'SearchIcon');
export const ListFilterIcon = wrap(ListFilter, 'ListFilterIcon');
// "Zmapuj hospodu" amenity + Mapér glyphs.
export const CreditCardIcon = wrap(CreditCard, 'CreditCardIcon');
export const AccessibilityIcon = wrap(Accessibility, 'AccessibilityIcon');
export const TargetIcon = wrap(Target, 'TargetIcon');
export const CircleDotIcon = wrap(CircleDot, 'CircleDotIcon');
// Soccer ball — lucide ships no soccer/football glyph, so this is a deliberate
// hand-rolled exception (owner wanted a real football for "stolní fotbal"):
// outer circle + central pentagon + radial seams, drawn to match the lucide look.
export const SoccerBallIcon = memo(function SoccerBallIcon({ size = 20, color }: IconProps) {
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
export const RadioIcon = wrap(Radio, 'RadioIcon');
export const MicIcon = wrap(Mic, 'MicIcon');
export const TvIcon = wrap(Tv, 'TvIcon');
export const SquareParkingIcon = wrap(SquareParking, 'SquareParkingIcon');
export const MapPinnedIcon = wrap(MapPinned, 'MapPinnedIcon');
export const MapPinPlusIcon = wrap(MapPinPlus, 'MapPinPlusIcon');
export const MapIcon = wrap(Map, 'MapIcon');
export const ListIcon = wrap(List, 'ListIcon');
export const LocateFixedIcon = wrap(LocateFixed, 'LocateFixedIcon');
export const SlidersHorizontalIcon = wrap(SlidersHorizontal, 'SlidersHorizontalIcon');
export const SproutIcon = wrap(Sprout, 'SproutIcon');
export const ClipboardListIcon = wrap(ClipboardList, 'ClipboardListIcon');
// Parta 2.0 — streak flame + leaderboard trophy.
export const FlameIcon = wrap(Flame, 'FlameIcon');
export const TrophyIcon = wrap(Trophy, 'TrophyIcon');
export const MoonIcon = wrap(Moon, 'MoonIcon');
// Parta 3.0 — "Můj kód" QR growth glyph.
export const QrCodeIcon = wrap(QrCode, 'QrCodeIcon');
// Parta 3.0 — friend-profile overflow "…" menu glyph.
export const EllipsisIcon = wrap(Ellipsis, 'EllipsisIcon');
