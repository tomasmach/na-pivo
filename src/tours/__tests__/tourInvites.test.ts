import { inviteFriends } from '../tourInvites';
import { knownOccupied, sendTourInvites } from '@/data/tourInvitesClient';
import { enqueueTourInvite, queuedTourInvitees, setTourInvitePreparer } from '@/data/tourInvitesQueue';
import { t } from '@/i18n';

const plan: { id: string; share?: { url: string; expiresAt: string } } = { id: 'plan-1', share: { url: 'https://na-pivo.cz/t/x', expiresAt: '2999-01-01T00:00:00Z' } };
const mockStore = { plans: [plan], published: { 'plan-1': 'sig' }, pending: {}, error: null, hydrate: jest.fn(async () => ({ ok: true })),
  publish: jest.fn(), clearError: jest.fn() } as { plans: typeof plan[]; published: Record<string, string>; pending: object; error: null;
  hydrate: jest.Mock; publish: jest.Mock; clearError: jest.Mock };
jest.mock('@/stores/toursStore', () => ({ useToursStore: { getState: () => mockStore }, tourContentSignature: () => 'sig' }));
jest.mock('@/data/tourInvitesClient', () => ({ sendTourInvites: jest.fn(), knownOccupied: jest.fn(() => 0), TOUR_INVITE_LIMIT: 50 }));
jest.mock('@/data/tourInvitesQueue', () => ({ enqueueTourInvite: jest.fn(async () => true), flushTourInvitesQueue: jest.fn(), queuedTourInvitees: jest.fn(async () => []),
  setTourInvitePreparer: jest.fn() }));
jest.mock('../TourChrome', () => ({ tourError: (code: string) => code }));

const row = (id: string) => ({ friend: { id, nickname: id, displayName: id, avatarUrl: null, isPublic: true }, status: 'invited' as const, invitedAt: '', respondedAt: null, stale: false });
const offline = { ok: false, error: 'network', status: 0, retry: true } as const;

// Registered once when the module loads; clearAllMocks would forget the call.
const preparer = jest.mocked(setTourInvitePreparer).mock.calls[0][0]!;
beforeEach(() => { jest.clearAllMocks(); plan.share = { url: 'https://na-pivo.cz/t/x', expiresAt: '2999-01-01T00:00:00Z' }; mockStore.published = { 'plan-1': 'sig' }; });

it('never publishes or makes a link for a queued invite', async () => {
  // Content changed on the phone since: the online path would publish, the queue only checks the link.
  mockStore.published = { 'plan-1': 'older' };
  await expect(preparer('plan-1')).resolves.toBe('ok');
  plan.share = undefined;
  await expect(preparer('plan-1')).resolves.toBe('drop');
  expect(mockStore.publish).not.toHaveBeenCalled();
});

it('does not queue an invite for a tour without a link, since nothing would make one later', async () => {
  plan.share = undefined;
  mockStore.publish.mockResolvedValueOnce({ ok: false, error: 'network' });
  await expect(inviteFriends('plan-1', ['a'])).resolves.toEqual({ error: t.tourInvites.errors.network });
  expect(enqueueTourInvite).not.toHaveBeenCalled();
});

it('counts hidden invites the server reported toward the offline cap', async () => {
  jest.mocked(sendTourInvites).mockResolvedValue({ ok: false, error: 'network', status: 0, retry: true });
  jest.mocked(knownOccupied).mockReturnValueOnce(50);
  await expect(inviteFriends('plan-1', ['a'], [])).resolves.toEqual({ error: t.tourInvites.errors.limit });
});

it('refuses to queue past the cap offline, with the same message the server would give', async () => {
  jest.mocked(sendTourInvites).mockResolvedValue(offline);
  jest.mocked(queuedTourInvitees).mockResolvedValueOnce(['q1']);
  const roster = Array.from({ length: 48 }, (_, i) => row(`r${i}`));
  jest.mocked(knownOccupied).mockReturnValueOnce(48);
  await expect(inviteFriends('plan-1', ['a', 'b'], roster)).resolves.toEqual({ error: t.tourInvites.errors.limit });
  expect(enqueueTourInvite).not.toHaveBeenCalled();
});

it('queues what fits, counting re-invites of people already on the roster as no new room', async () => {
  jest.mocked(sendTourInvites).mockResolvedValue(offline);
  const roster = Array.from({ length: 49 }, (_, i) => row(`r${i}`));
  jest.mocked(knownOccupied).mockReturnValueOnce(49);
  await expect(inviteFriends('plan-1', ['a', 'r3'], roster)).resolves.toEqual({ status: 'queued' });
  expect(enqueueTourInvite).toHaveBeenCalledWith('plan-1', ['a', 'r3']);
});

it('does not queue when the server says the link is gone, or when this session never learned the invite count', async () => {
  jest.mocked(sendTourInvites).mockResolvedValueOnce({ ok: false, error: 'share_required', status: 409, retry: true });
  await expect(inviteFriends('plan-1', ['a'])).resolves.toEqual({ error: t.tourInvites.errors.network });
  jest.mocked(sendTourInvites).mockResolvedValueOnce({ ok: false, error: 'network', status: 0, retry: true });
  jest.mocked(knownOccupied).mockReturnValueOnce(null);
  await expect(inviteFriends('plan-1', ['a'])).resolves.toEqual({ error: t.tourInvites.errors.network });
  expect(enqueueTourInvite).not.toHaveBeenCalled();
});
