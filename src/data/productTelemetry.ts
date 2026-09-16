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
  '/profile/photos': 'profile_photos',
};

export function productScreenFromPathname(pathname: string): ProductScreenName | null {
  const cleanPathname = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  const exact = EXACT_SCREENS[cleanPathname];
  if (exact) return exact;
  if (/^\/parta\/[^/]+$/.test(cleanPathname)) return 'friend_profile';
  if (/^\/photo\/[^/]+$/.test(cleanPathname)) return 'photo_detail';
  return null;
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
