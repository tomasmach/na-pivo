/**
 * Badge catalog — the single source of truth for every achievement badge:
 * display order, Czech title, locked hint, and medallion icon. Consumed by the
 * ODZNAKY grid on my own profile (all badges, locked ones dimmed with hints)
 * and by the "Vitrína odznaků" showcase on a public profile (unlocked only).
 */

import type { ComponentType } from 'react';

import {
  BadgeCheckIcon,
  BeerIcon,
  CameraIcon,
  ClipboardListIcon,
  CupSodaIcon,
  FlagIcon,
  HeartIcon,
  HouseIcon,
  MapPinIcon,
  MapPinnedIcon,
  MilkIcon,
  MoonIcon,
  SparklesIcon,
  SproutIcon,
  ThumbsUpIcon,
  TreePineIcon,
  TrophyIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import type { AccountAchievements } from '@/data/auth';
import { t } from '@/i18n';

export interface BadgeDef {
  key: keyof AccountAchievements;
  title: string;
  /** Locked-state hint ("Napočítej 100 piv"). */
  hint: string;
  Icon: ComponentType<{ size?: number; color: string }>;
}

/**
 * Display order tells the diary story: first beer → habits → taste → party,
 * then the Mapér arc. Rows of three on the profile grid.
 */
export const BADGE_CATALOG: readonly BadgeDef[] = [
  { key: 'firstBeer', title: t.profile.badgeFirstBeerTitle, hint: t.profile.badgeFirstBeerLocked, Icon: BeerIcon },
  { key: 'firstTen', title: t.profile.badgeFirstTenTitle, hint: t.profile.badgeFirstTenLocked, Icon: BeerIcon },
  { key: 'century', title: t.profile.badgeCenturyTitle, hint: t.profile.badgeCenturyLocked, Icon: TrophyIcon },
  { key: 'regular', title: t.profile.badgeRegularTitle, hint: t.profile.badgeRegularLocked, Icon: MapPinIcon },
  { key: 'stamgast', title: t.profile.badgeStamgastTitle, hint: t.profile.badgeStamgastLocked, Icon: HeartIcon },
  { key: 'pilgrim', title: t.profile.badgePilgrimTitle, hint: t.profile.badgePilgrimLocked, Icon: FlagIcon },
  { key: 'reviewer', title: t.profile.badgeReviewerTitle, hint: t.profile.badgeReviewerLocked, Icon: ThumbsUpIcon },
  { key: 'taster', title: t.profile.badgeTasterTitle, hint: t.profile.badgeTasterLocked, Icon: SparklesIcon },
  { key: 'nightOwl', title: t.profile.badgeNightOwlTitle, hint: t.profile.badgeNightOwlLocked, Icon: MoonIcon },
  { key: 'partyAnimal', title: t.profile.badgePartyAnimalTitle, hint: t.profile.badgePartyAnimalLocked, Icon: UsersIcon },
  // — Pivař badges (outside-pub drinking wave) —
  { key: 'chatar', title: t.profile.badgeChatarTitle, hint: t.profile.badgeChatarLocked, Icon: HouseIcon },
  { key: 'podSirakem', title: t.profile.badgePodSirakemTitle, hint: t.profile.badgePodSirakemLocked, Icon: TreePineIcon },
  { key: 'lahvacovyFilozof', title: t.profile.badgeLahvacTitle, hint: t.profile.badgeLahvacLocked, Icon: MilkIcon },
  { key: 'plechovkac', title: t.profile.badgePlechTitle, hint: t.profile.badgePlechLocked, Icon: CupSodaIcon },
  // — Mapér badges (spec §5.3) —
  { key: 'firstMap', title: t.mapPub.badgeFirstMapTitle, hint: t.mapPub.badgeFirstMapLocked, Icon: SproutIcon },
  { key: 'explorer', title: t.mapPub.badgeExplorerTitle, hint: t.mapPub.badgeExplorerLocked, Icon: MapPinnedIcon },
  { key: 'cartographer', title: t.mapPub.badgeCartographerTitle, hint: t.mapPub.badgeCartographerLocked, Icon: MapPinnedIcon },
  { key: 'completionist', title: t.mapPub.badgeCompletionistTitle, hint: t.mapPub.badgeCompletionistLocked, Icon: BadgeCheckIcon },
  { key: 'factMachine', title: t.mapPub.badgeFactMachineTitle, hint: t.mapPub.badgeFactMachineLocked, Icon: ClipboardListIcon },
  // FotoPivař (photo-contest win, server-only) closes the catalog.
  { key: 'fotoPivar', title: t.profile.badgeFotoPivarTitle, hint: t.profile.badgeFotoPivarLocked, Icon: CameraIcon },
];

/** The unlocked slice, in catalog order — the public showcase. */
export function unlockedBadges(achievements: AccountAchievements): BadgeDef[] {
  return BADGE_CATALOG.filter((badge) => achievements[badge.key]);
}
