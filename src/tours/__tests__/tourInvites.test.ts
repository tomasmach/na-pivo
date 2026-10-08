import { inviteFriends } from '../tourInvites';
import { sendTourInvites } from '@/data/tourInvitesClient';
import { t } from '@/i18n';

const plan: { id: string; share?: { url: string; expiresAt: string } } = { id: 'plan-1', share: { url: 'https://na-pivo.cz/t/x', expiresAt: '2999-01-01T00:00:00Z' } };
const mockStore = { plans: [plan], published: { 'plan-1': 'sig' }, pending: {}, error: null, hydrate: jest.fn(async () => ({ ok: true })),
  publish: jest.fn() } as { plans: typeof plan[]; published: Record<string, string>; pending: object; error: null; hydrate: jest.Mock; publish: jest.Mock };
jest.mock('@/stores/toursStore', () => ({ useToursStore: { getState: () => mockStore }, tourContentSignature: () => 'sig' }));
jest.mock('@/data/tourInvitesClient', () => ({ sendTourInvites: jest.fn() }));
jest.mock('../TourChrome', () => ({ tourError: (code: string) => (code === 'network' ? t.tourInvites.errors.network : code) }));

beforeEach(() => { jest.clearAllMocks(); plan.share = { url: 'https://na-pivo.cz/t/x', expiresAt: '2999-01-01T00:00:00Z' }; mockStore.published = { 'plan-1': 'sig' }; });

it('sends at once and says plainly when there is no signal, with nothing left to go out later', async () => {
  jest.mocked(sendTourInvites).mockResolvedValueOnce({ ok: true, value: { roster: [], invited: 2 } });
  await expect(inviteFriends('plan-1', ['a', 'b'])).resolves.toEqual({ status: 'sent', roster: [], invited: 2 });
  jest.mocked(sendTourInvites).mockResolvedValueOnce({ ok: false, error: 'network', status: 0, retry: true });
  await expect(inviteFriends('plan-1', ['a'])).resolves.toEqual({ error: t.tourInvites.errors.network });
});

it('puts an edited tour on the server before inviting, and invites nobody when that fails', async () => {
  mockStore.published = { 'plan-1': 'older' };
  mockStore.publish.mockResolvedValueOnce({ ok: false, error: 'network' });
  await expect(inviteFriends('plan-1', ['a'])).resolves.toEqual({ error: t.tourInvites.errors.network });
  expect(mockStore.publish).toHaveBeenCalledWith('plan-1');
  expect(sendTourInvites).not.toHaveBeenCalled();
});

it('passes on why the server refused', async () => {
  jest.mocked(sendTourInvites).mockResolvedValueOnce({ ok: false, error: 'limit', status: 409, retry: false });
  await expect(inviteFriends('plan-1', ['a'])).resolves.toEqual({ error: t.tourInvites.errors.limit });
});

it('puts up the tour saved since when an older publish was still waiting', async () => {
  // The waiting publish carries the older plan; only the second one matches what the phone shows.
  mockStore.published = { 'plan-1': 'older' };
  mockStore.publish
    .mockImplementationOnce(async () => { mockStore.published = { 'plan-1': 'older-2' }; return { ok: true }; })
    .mockImplementationOnce(async () => { mockStore.published = { 'plan-1': 'sig' }; return { ok: true }; });
  jest.mocked(sendTourInvites).mockResolvedValueOnce({ ok: true, value: { roster: [], invited: 1 } });
  await expect(inviteFriends('plan-1', ['a'])).resolves.toEqual({ status: 'sent', roster: [], invited: 1 });
  expect(mockStore.publish).toHaveBeenCalledTimes(2);
});
