import { inviteFriends } from '../tourInvites';
import { sendTourInvites } from '@/data/tourInvitesClient';
import { enqueueTourInvite, queuedTourInvitees } from '@/data/tourInvitesQueue';
import { t } from '@/i18n';

const plan = { id: 'plan-1', share: { url: 'https://na-pivo.cz/t/x', expiresAt: '2999-01-01T00:00:00Z' } };
const mockStore = { plans: [plan], published: { 'plan-1': 'sig' }, pending: {}, error: null, hydrate: jest.fn(async () => ({ ok: true })),
  publish: jest.fn(), clearError: jest.fn() };
jest.mock('@/stores/toursStore', () => ({ useToursStore: { getState: () => mockStore }, tourContentSignature: () => 'sig' }));
jest.mock('@/data/tourInvitesClient', () => ({ sendTourInvites: jest.fn(), TOUR_INVITE_LIMIT: 50 }));
jest.mock('@/data/tourInvitesQueue', () => ({ enqueueTourInvite: jest.fn(async () => true), flushTourInvitesQueue: jest.fn(), queuedTourInvitees: jest.fn(async () => []),
  setTourInvitePreparer: jest.fn() }));
jest.mock('../TourChrome', () => ({ tourError: (code: string) => code }));

const row = (id: string) => ({ friend: { id, nickname: id, displayName: id, avatarUrl: null, isPublic: true }, status: 'invited' as const, invitedAt: '', respondedAt: null, stale: false });
const offline = { ok: false, error: 'network', status: 0, retry: true } as const;

beforeEach(() => jest.clearAllMocks());

it('refuses to queue past the cap offline, with the same message the server would give', async () => {
  jest.mocked(sendTourInvites).mockResolvedValue(offline);
  jest.mocked(queuedTourInvitees).mockResolvedValueOnce(['q1']);
  const roster = Array.from({ length: 48 }, (_, i) => row(`r${i}`));
  await expect(inviteFriends('plan-1', ['a', 'b'], roster)).resolves.toEqual({ error: t.tourInvites.errors.limit });
  expect(enqueueTourInvite).not.toHaveBeenCalled();
});

it('queues what fits, counting re-invites of people already on the roster as no new room', async () => {
  jest.mocked(sendTourInvites).mockResolvedValue(offline);
  const roster = Array.from({ length: 49 }, (_, i) => row(`r${i}`));
  await expect(inviteFriends('plan-1', ['a', 'r3'], roster)).resolves.toEqual({ status: 'queued' });
  expect(enqueueTourInvite).toHaveBeenCalledWith('plan-1', ['a', 'r3']);
});
