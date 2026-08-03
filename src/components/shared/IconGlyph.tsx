/**
 * Icon library — thin wrappers around `lucide-react-native` so call sites
 * stay on the `{ size, color }` API. Lucide owns the actual SVG paths;
 * no hand-rolled approximations live here.
 */

import React, { memo, ComponentType } from 'react';
import Svg, { Circle as SvgCircle, G, Path as SvgPath } from 'react-native-svg';
import {
  Armchair,
  Beer,
  BeerOff,
  HandMetal,
  ChartColumn,
  ChartPie,
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
  ChevronDown,
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
  Dices,
  Play,
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
  Menu,
  GlassWater,
  Wine,
  ListFilter,
  House,
  Milk,
  CupSoda,
  HandPlatter,
  Share2,
  Globe,
  TriangleAlert,
  LucideProps,
} from 'lucide-react-native';

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
/**
 * Cheers — the social reaction, NOT a count of beers.
 *
 * Both were the same mug, which made "12" under a post ambiguous: twelve people
 * clinked, or twelve beers were drunk? So the vocabulary splits by COUNT rather
 * than by drawing something unrelated: one mug means one beer, two mugs tilted
 * into each other mean the clink. Same lucide path, composed — an unrelated
 * glyph (a party popper, a heart) would have meant relearning the icon.
 */
/**
 * Cheers — two mugs meeting, drawn here rather than composed.
 *
 * This is the one glyph the icon set could not borrow. `BeerIcon` (lucide) is a
 * mug drawn to stand alone: put two side by side and they do not clink, they
 * queue. A clink needs the mugs LEANING INTO each other with their rims meeting,
 * and no arrangement of an upright glyph gets there.
 *
 * So one mug is drawn once and used twice — the second is the first mirrored
 * about the middle — which keeps the pair exactly symmetrical and means the
 * shape only has to be got right once. Three short strokes at the meeting point
 * are the impact; without them two tilted mugs read as falling over.
 *
 * Deliberately WIDER than tall (28×24). Two mugs squeezed into one mug's square
 * are two half-size mugs, and at 17pt that is a smudge.
 *
 * Stroke weight, caps and joins match lucide so it sits in the same set.
 */
const CHEERS_RATIO = 28 / 24;

/**
 * One mug, as bare paths, so the shape exists exactly once.
 *
 * `CheersIcon` composes two of these; `CheersButton` animates two of these. If
 * the drawing lived in both places they would drift the first time either was
 * touched.
 */
export const CHEERS_MUG_PATHS = [
  'M -4.5 -7 L 4.5 -7 L 3.7 7.2 A 1.8 1.8 0 0 1 2.1 9 L -2.1 9 A 1.8 1.8 0 0 1 -3.7 7.2 Z',
  'M -4.3 -3.2 L 4.3 -3.2',
  'M 4.6 -3.4 L 6.2 -3.4 A 3.2 3.2 0 0 1 6.2 3 L 4.2 3',
] as const;

/** The three short strokes that read as the impact. */
export const CHEERS_SPARK_PATHS = [
  'M 0 -10.5 L 0 -8.4',
  'M -3.4 -9.2 L -2.1 -7.6',
  'M 3.4 -9.2 L 2.1 -7.6',
] as const;

/** One mug, centred on its own origin: body, foam line, handle. */
const MUG = (
  <>
    <SvgPath d="M -4.5 -7 L 4.5 -7 L 3.7 7.2 A 1.8 1.8 0 0 1 1.9 9 L -1.9 9 A 1.8 1.8 0 0 1 -3.7 7.2 Z" />
    <SvgPath d="M -4.3 -3.2 L 4.3 -3.2" />
    <SvgPath d="M 4.6 -3.4 L 6.2 -3.4 A 3.2 3.2 0 0 1 6.2 3 L 4.2 3" />
  </>
);

export const CheersIcon = memo(function CheersIcon({ size = 20, color }: IconProps) {
  return (
    <Svg
      width={size * CHEERS_RATIO}
      height={size}
      viewBox="0 0 28 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <G transform="translate(18,12) rotate(-14)">{MUG}</G>
      {/* The same mug, mirrored about the middle — one shape, two mugs. */}
      <G transform="translate(28,0) scale(-1,1)">
        <G transform="translate(18,12) rotate(-14)">{MUG}</G>
      </G>
      {/* The clink. Without it the pair reads as two mugs tipping over. */}
      <SvgPath d="M 14 0.8 L 14 3" />
      <SvgPath d="M 10.5 2.2 L 11.8 3.8" />
      <SvgPath d="M 17.5 2.2 L 16.2 3.8" />
    </Svg>
  );
});

export const BeerOffIcon = wrap(BeerOff, 'BeerOffIcon');
export const ChartColumnIcon = wrap(ChartColumn, 'ChartColumnIcon');
export const ChartPieIcon = wrap(ChartPie, 'ChartPieIcon');
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
export const HandMetalIcon = wrap(HandMetal, 'HandMetalIcon');
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
export const PlayIcon = wrap(Play, 'PlayIcon');
// "Společenské hry" is literally board games, and dice is the glyph everyone
// reads as that. A football said one specific game — table football — on a menu
// whose whole point is that it is a list of many.
export const DicesIcon = wrap(Dices, 'DicesIcon');
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
