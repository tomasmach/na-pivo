/**
 * Icon library — thin wrappers around `lucide-react-native` so call sites
 * stay on the `{ size, color }` API. Lucide owns the actual SVG paths;
 * no hand-rolled approximations live here.
 */

import React, { memo, ComponentType } from 'react';
import Svg, { Circle as SvgCircle, Path as SvgPath } from 'react-native-svg';
// Per-icon deep imports: the package root re-exports all ~1,850 icons and
// Metro evaluates every one of them at startup.
import Armchair from 'lucide-react-native/icons/armchair';
import Beer from 'lucide-react-native/icons/beer';
import BeerOff from 'lucide-react-native/icons/beer-off';
import Compass from 'lucide-react-native/icons/compass';
import Undo2 from 'lucide-react-native/icons/undo-2';
import LockKeyhole from 'lucide-react-native/icons/lock-keyhole';
import Eye from 'lucide-react-native/icons/eye';
import EyeOff from 'lucide-react-native/icons/eye-off';
import MapPin from 'lucide-react-native/icons/map-pin';
import ExternalLink from 'lucide-react-native/icons/external-link';
import RefreshCw from 'lucide-react-native/icons/refresh-cw';
import Settings from 'lucide-react-native/icons/settings';
import BellRing from 'lucide-react-native/icons/bell-ring';
import Volume2 from 'lucide-react-native/icons/volume-2';
import Info from 'lucide-react-native/icons/info';
import Shield from 'lucide-react-native/icons/shield';
import ChevronLeft from 'lucide-react-native/icons/chevron-left';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Heart from 'lucide-react-native/icons/heart';
import Flag from 'lucide-react-native/icons/flag';
import MessageSquare from 'lucide-react-native/icons/message-square';
import Radius from 'lucide-react-native/icons/radius';
import Wifi from 'lucide-react-native/icons/wifi';
import Pencil from 'lucide-react-native/icons/pencil';
import Plus from 'lucide-react-native/icons/plus';
import Minus from 'lucide-react-native/icons/minus';
import Trash2 from 'lucide-react-native/icons/trash';
import Copy from 'lucide-react-native/icons/copy';
import X from 'lucide-react-native/icons/x';
import Coins from 'lucide-react-native/icons/coins';
import Star from 'lucide-react-native/icons/star';
import ThumbsUp from 'lucide-react-native/icons/thumbs-up';
import ThumbsDown from 'lucide-react-native/icons/thumbs-down';
import History from 'lucide-react-native/icons/rotate-ccw-clock';
import Clock from 'lucide-react-native/icons/clock';
import User from 'lucide-react-native/icons/user';
import Users from 'lucide-react-native/icons/users';
import UserPlus from 'lucide-react-native/icons/user-plus';
import Mail from 'lucide-react-native/icons/mail';
import Link from 'lucide-react-native/icons/link';
import Check from 'lucide-react-native/icons/check';
import BadgeCheck from 'lucide-react-native/icons/badge-check';
import KeyRound from 'lucide-react-native/icons/key-round';
import Crown from 'lucide-react-native/icons/crown';
import Camera from 'lucide-react-native/icons/camera';
import Images from 'lucide-react-native/icons/images';
import Sparkles from 'lucide-react-native/icons/sparkles';
import TreePine from 'lucide-react-native/icons/tree-pine';
import Search from 'lucide-react-native/icons/search';
import CreditCard from 'lucide-react-native/icons/credit-card';
import Accessibility from 'lucide-react-native/icons/accessibility';
import Target from 'lucide-react-native/icons/target';
import CircleDot from 'lucide-react-native/icons/circle-dot';
import Radio from 'lucide-react-native/icons/radio';
import Mic from 'lucide-react-native/icons/mic';
import Tv from 'lucide-react-native/icons/tv';
import SquareParking from 'lucide-react-native/icons/square-parking';
import MapPinned from 'lucide-react-native/icons/map-pinned';
import MapPinPlus from 'lucide-react-native/icons/map-pin-plus';
import Map from 'lucide-react-native/icons/map';
import List from 'lucide-react-native/icons/list';
import LocateFixed from 'lucide-react-native/icons/locate-fixed';
import SlidersHorizontal from 'lucide-react-native/icons/sliders-horizontal';
import Sprout from 'lucide-react-native/icons/sprout';
import ClipboardList from 'lucide-react-native/icons/clipboard-list';
import Flame from 'lucide-react-native/icons/flame';
import Trophy from 'lucide-react-native/icons/trophy';
import Moon from 'lucide-react-native/icons/moon';
import QrCode from 'lucide-react-native/icons/qr-code';
import Menu from 'lucide-react-native/icons/menu';
import GlassWater from 'lucide-react-native/icons/glass-water';
import Wine from 'lucide-react-native/icons/wine';
import ListFilter from 'lucide-react-native/icons/list-filter';
import House from 'lucide-react-native/icons/house';
import Milk from 'lucide-react-native/icons/milk';
import CupSoda from 'lucide-react-native/icons/cup-soda';
import HandPlatter from 'lucide-react-native/icons/hand-platter';
import Share2 from 'lucide-react-native/icons/share-2';
import Globe from 'lucide-react-native/icons/globe';
import TriangleAlert from 'lucide-react-native/icons/triangle-alert';
import type { LucideProps } from 'lucide-react-native';

export interface IconProps {
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
export const ChevronDownIcon = wrap(ChevronDown, 'ChevronDownIcon');
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
export const HouseIcon = wrap(House, 'HouseIcon');
export const MilkIcon = wrap(Milk, 'MilkIcon');
export const CupSodaIcon = wrap(CupSoda, 'CupSodaIcon');
export const HandPlatterIcon = wrap(HandPlatter, 'HandPlatterIcon');
export const Share2Icon = wrap(Share2, 'Share2Icon');
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
// Overflow menu glyph — three stacked lines, not a horizontal ellipsis.
export const MenuIcon = wrap(Menu, 'MenuIcon');
export const GlobeIcon = wrap(Globe, 'GlobeIcon');
export const TriangleAlertIcon = wrap(TriangleAlert, 'TriangleAlertIcon');
