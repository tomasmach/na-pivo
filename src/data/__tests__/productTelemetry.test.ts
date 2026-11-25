import { readFileSync } from 'fs';
import { join } from 'path';

import {
  PRODUCT_SCREEN_NAMES,
  productScreenFromPathname,
  trackScreenViewed,
} from '../productTelemetry';
import { trackClientEvent } from '../telemetryClient';

jest.mock('../telemetryClient', () => ({
  trackClientEvent: jest.fn(async () => undefined),
}));

const mockTrackClientEvent = trackClientEvent as jest.MockedFunction<typeof trackClientEvent>;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('productScreenFromPathname', () => {
  it.each([
    ['/', 'compass'],
    ['/beer', 'beer'],
    ['/profile/parta/', 'party_settings'],
    ['/parta/abc-123', 'friend_profile'],
    ['/photo/u2fkbn1z?source=diary', 'photo_detail'],
  ])('maps %s to a coarse screen name', (pathname, expected) => {
    expect(productScreenFromPathname(pathname)).toBe(expected);
  });

  it.each([
    ['/nv/kompas', 'compass'],
    ['/nv/stamgast', 'beer'],
    ['/nv/parta', 'friends'],
    ['/nv/vycep', 'taproom'],
    ['/nv/piva', 'beer_rankings'],
    ['/nv/profil', 'profile'],
    ['/nv/nastaveni/', 'settings'],
    ['/nv/prihlaseni', 'sign_in'],
    ['/nv/sprava-party', 'party_settings'],
    ['/nv/zebricky', 'leaderboards'],
    ['/nv/tour-pruchod', 'tour'],
    ['/nv/hospoda/u-zlateho-tygra?from=kompas', 'pub_page'],
    ['/nv/pivo/pilsner-urquell', 'beer_detail'],
    ['/nv/vecer/evening-1', 'evening_detail'],
    ['/nv/kamos/abc-123', 'friend_profile'],
    ['/nv/fotka/3', 'photo_detail'],
    ['/nv/plan/plan-1', 'plan_detail'],
  ])('maps the new look route %s to %s', (pathname, expected) => {
    expect(productScreenFromPathname(pathname)).toBe(expected);
  });

  it('drops unknown routes instead of sending a raw pathname', () => {
    expect(productScreenFromPathname('/unknown/user@example.com')).toBeNull();
    expect(productScreenFromPathname('/nv/kamos/abc/extra')).toBeNull();
  });

  it('only uses screen names the server keeps', () => {
    const serializers = readFileSync(join(__dirname, '../../../backend/pubs/api/serializers.py'), 'utf8');
    const block = serializers.match(/_CLIENT_EVENT_SCREEN_NAMES = \{([\s\S]*?)\n\}/)?.[1] ?? '';
    const server = new Set([...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    expect(PRODUCT_SCREEN_NAMES.filter((name) => !server.has(name))).toEqual([]);
  });
});

describe('trackScreenViewed', () => {
  it('sends only fixed current and previous screen names', () => {
    trackScreenViewed('friend_profile', 'friends');

    expect(mockTrackClientEvent).toHaveBeenCalledWith({
      event: 'screen_viewed',
      context: {
        screen: 'friend_profile',
        previous_screen: 'friends',
      },
    });
  });
});
