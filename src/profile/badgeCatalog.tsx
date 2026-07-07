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
  ClipboardListIcon,
  FlagIcon,
  HeartIcon,
  MapPinIcon,
  MapPinnedIcon,
  MoonIcon,
  SparklesIcon,
  SproutIcon,
  ThumbsUpIcon,
  TrophyIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import type { AccountAchievements } from '@/data/auth';
import { cs } from '@/i18n/cs';

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
  { key: 'firstBeer', title: cs.profile.badgeFirstBeerTitle, hint: cs.profile.badgeFirstBeerLocked, Icon: BeerIcon },
  { key: 'firstTen', title: cs.profile.badgeFirstTenTitle, hint: cs.profile.badgeFirstTenLocked, Icon: BeerIcon },
  { key: 'century', title: cs.profile.badgeCenturyTitle, hint: cs.profile.badgeCenturyLocked, Icon: TrophyIcon },
  { key: 'regular', title: cs.profile.badgeRegularTitle, hint: cs.profile.badgeRegularLocked, Icon: MapPinIcon },
  { key: 'stamgast', title: cs.profile.badgeStamgastTitle, hint: cs.profile.badgeStamgastLocked, Icon: HeartIcon },
  { key: 'pilgrim', title: cs.profile.badgePilgrimTitle, hint: cs.profile.badgePilgrimLocked, Icon: FlagIcon },
  { key: 'reviewer', title: cs.profile.badgeReviewerTitle, hint: cs.profile.badgeReviewerLocked, Icon: ThumbsUpIcon },
  { key: 'taster', title: cs.profile.badgeTasterTitle, hint: cs.profile.badgeTasterLocked, Icon: SparklesIcon },
  { key: 'nightOwl', title: cs.profile.badgeNightOwlTitle, hint: cs.profile.badgeNightOwlLocked, Icon: MoonIcon },
  { key: 'partyAnimal', title: cs.profile.badgePartyAnimalTitle, hint: cs.profile.badgePartyAnimalLocked, Icon: UsersIcon },
  // — Mapér badges (spec §5.3) —
  { key: 'firstMap', title: cs.mapPub.badgeFirstMapTitle, hint: cs.mapPub.badgeFirstMapLocked, Icon: SproutIcon },
  { key: 'explorer', title: cs.mapPub.badgeExplorerTitle, hint: cs.mapPub.badgeExplorerLocked, Icon: MapPinnedIcon },
  { key: 'cartographer', title: cs.mapPub.badgeCartographerTitle, hint: cs.mapPub.badgeCartographerLocked, Icon: MapPinnedIcon },
  { key: 'completionist', title: cs.mapPub.badgeCompletionistTitle, hint: cs.mapPub.badgeCompletionistLocked, Icon: BadgeCheckIcon },
  { key: 'factMachine', title: cs.mapPub.badgeFactMachineTitle, hint: cs.mapPub.badgeFactMachineLocked, Icon: ClipboardListIcon },
];

/** The unlocked slice, in catalog order — the public showcase. */
export function unlockedBadges(achievements: AccountAchievements): BadgeDef[] {
  return BADGE_CATALOG.filter((badge) => achievements[badge.key]);
}
