import {
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

  it('drops unknown routes instead of sending a raw pathname', () => {
    expect(productScreenFromPathname('/unknown/user@example.com')).toBeNull();
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
