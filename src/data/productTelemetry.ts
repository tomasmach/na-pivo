/**
 * Coarse product analytics built on the privacy-safe telemetry client.
 *
 * Route params are deliberately collapsed into fixed screen names before they
 * leave the device. Never send raw pathnames: dynamic routes contain account or
 * content identifiers that are unnecessary for product analytics.
 */

import { trackClientEvent } from './telemetryClient';

export const PRODUCT_SCREEN_NAMES = [
  'compass',
  'beer',
  'friends',
  'profile',
  'onboarding',
  'settings',
  'home_point',
  'celebration',
  'about',
  'privacy',
  'report',
  'contribute',
  'add_pub',
  'suggest_pub_event',
  'evening_detail',
  'beer_detail',
  'taproom',
  'sign_in',
  'password_reset',
  'email_verification',
  'account',
  'profile_privacy',
  'profile_edit',
  'party_settings',
  'badges',
  'leaderboards',
  'invite',
  'friend_profile',
  'photo_detail',
  'photo_contest',
  'community_events',
  'my_added_pubs',
  'profile_photos',
  'pub_page',
  'beer_rankings',
  'search',
  'stats',
  'receipt',
  'watched_beers',
  'plan_detail',
  'new_invite',
  'tour',
] as const;

export type ProductScreenName = (typeof PRODUCT_SCREEN_NAMES)[number];

const EXACT_SCREENS: Readonly<Record<string, ProductScreenName>> = {
  '/': 'compass',
  '/beer': 'beer',
  '/friends': 'friends',
  '/profile': 'profile',
  '/onboarding': 'onboarding',
  '/settings': 'settings',
  '/home-point': 'home_point',
  '/celebration': 'celebration',
  '/about': 'about',
  '/privacy': 'privacy',
  '/report': 'report',
  '/contribute': 'contribute',
  '/add-pub': 'add_pub',
  '/suggest-pub-event': 'suggest_pub_event',
  '/evening': 'evening_detail',
  '/beer-detail': 'beer_detail',
  '/vycep': 'taproom',
  '/auth': 'sign_in',
  '/auth/reset': 'password_reset',
  '/auth/verify': 'email_verification',
  '/account': 'account',
  '/profile/privacy': 'profile_privacy',
  '/profile/edit': 'profile_edit',
  '/profile/parta': 'party_settings',
  '/profile/badges': 'badges',
  '/leaderboards': 'leaderboards',
  '/parta/pozvanka': 'invite',
  '/photo-contest': 'photo_contest',
  '/community-events': 'community_events',
  '/my-added-pubs': 'my_added_pubs',
  '/pub': 'pub_page',
  '/profile/photos': 'profile_photos',
  // New look. Same purpose keeps the old name so dashboards run on across the redesign.
  '/nv/kompas': 'compass',
  '/nv/stamgast': 'beer',
  '/nv/parta': 'friends',
  '/nv/vycep': 'taproom',
  '/nv/piva': 'beer_rankings',
  '/nv/profil': 'profile',
  '/nv/onboarding': 'onboarding',
  '/nv/nastaveni': 'settings',
  '/nv/domovsky-bod': 'home_point',
  '/nv/novy-level': 'celebration',
  '/nv/o-appce': 'about',
  '/nv/napis-mi': 'report',
  '/nv/doplnit-info': 'contribute',
  '/nv/pridat-hospodu': 'add_pub',
  '/nv/spendlik': 'add_pub',
  '/nv/navrhnout-akci': 'suggest_pub_event',
  '/nv/prihlaseni': 'sign_in',
  '/nv/obnova-hesla': 'password_reset',
  '/nv/ucet': 'account',
  '/nv/upravit-profil': 'profile_edit',
  '/nv/sprava-party': 'party_settings',
  '/nv/odznaky': 'badges',
  '/nv/zebricky': 'leaderboards',
  '/nv/pozvanka-do-party': 'invite',
  '/nv/fotopivar': 'photo_contest',
  '/nv/pivo-u-nekoho': 'community_events',
  '/nv/setkani': 'community_events',
  '/nv/moje-setkani': 'community_events',
  '/nv/zalozit-setkani': 'community_events',
  '/nv/moje-hospody': 'my_added_pubs',
  '/nv/pivni-fotky': 'profile_photos',
  '/nv/hledani': 'search',
  '/nv/hledat-pivo': 'search',
  '/nv/cisla': 'stats',
  '/nv/cisla-hospody': 'stats',
  '/nv/uctenka': 'receipt',
  '/nv/hlidana-piva': 'watched_beers',
  '/nv/nova-pozvanka': 'new_invite',
  '/nv/tour': 'tour',
  '/nv/tour-editor': 'tour',
  '/nv/tour-historie': 'tour',
  '/nv/tour-mapa': 'tour',
  '/nv/tour-pruchod': 'tour',
  '/nv/tour-verejna': 'tour',
  '/nv/tour-vyber': 'tour',
  '/nv/tour-zverejnit': 'tour',
};

const DYNAMIC_SCREENS: readonly [RegExp, ProductScreenName][] = [
  [/^\/parta\/[^/]+$/, 'friend_profile'],
  [/^\/photo\/[^/]+$/, 'photo_detail'],
  [/^\/nv\/hospoda\/[^/]+$/, 'pub_page'],
  [/^\/nv\/pivo\/[^/]+$/, 'beer_detail'],
  [/^\/nv\/vecer\/[^/]+$/, 'evening_detail'],
  [/^\/nv\/kamos\/[^/]+$/, 'friend_profile'],
  [/^\/nv\/fotka\/[^/]+$/, 'photo_detail'],
  [/^\/nv\/plan\/[^/]+$/, 'plan_detail'],
];

export function productScreenFromPathname(pathname: string): ProductScreenName | null {
  const cleanPathname = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  const exact = EXACT_SCREENS[cleanPathname];
  if (exact) return exact;
  return DYNAMIC_SCREENS.find(([pattern]) => pattern.test(cleanPathname))?.[1] ?? null;
}

export function trackScreenViewed(
  screen: ProductScreenName,
  previousScreen?: ProductScreenName,
): void {
  void trackClientEvent({
    event: 'screen_viewed',
    context: {
      screen,
      previous_screen: previousScreen,
    },
  });
}
