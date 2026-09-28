import { answerTourInvite, fetchMyTourInvite, fetchOpenTourInvites, fetchTourRoster, sendTourInvites } from '../tourInvitesClient';

jest.mock('../backendConfig', () => ({ getBackendEndpoint: (path: string) => `https://api.example.test${path}` }));
jest.mock('../account', () => ({
  ensureAccount: jest.fn(async () => ({ token: 't', authenticated: true })),
  clearCachedAnonymousAccount: jest.fn(async () => false),
}));

const plan = '6f1c2d3e-4a5b-4c6d-8e7f-0123456789ab';
const petr = { id: 'p-1', nickname: 'petr', display_name: 'Petr', avatar_url: null, is_public: true };
const reply = (status: number, body: unknown) => (global.fetch as jest.Mock).mockResolvedValue({ status, json: async () => body });

beforeEach(() => {
  global.fetch = jest.fn();
});

it('sends the picked friends and reads back the roster, skipping rows it cannot read', async () => {
  reply(201, { invited: 1, invites: [{ account: petr, status: 'invited', invited_at: '2026-09-28T19:00:00Z', responded_at: null }, { account: {}, status: 'going' }] });
  const result = await sendTourInvites(plan, ['p-1']);
  expect(global.fetch).toHaveBeenCalledWith(`https://api.example.test/v1/tours/${plan}/invites`,
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ recipient_ids: ['p-1'] }) }));
  expect(result).toEqual({ ok: true, value: { invited: 1, roster: [expect.objectContaining({ status: 'invited', friend: expect.objectContaining({ nickname: 'petr' }) })] } });
});

it('tells what the server refused and whether a retry could help', async () => {
  reply(409, { error: 'ghost_mode' });
  await expect(sendTourInvites(plan, ['p-1'])).resolves.toMatchObject({ ok: false, error: 'ghost', retry: false });
  reply(409, { error: 'share_required' });
  await expect(sendTourInvites(plan, ['p-1'])).resolves.toMatchObject({ ok: false, error: 'share_required', retry: true });
  reply(400, { error: 'not_friends' });
  await expect(sendTourInvites(plan, ['p-1'])).resolves.toMatchObject({ ok: false, error: 'not_friends', retry: false });
  reply(503, null);
  await expect(sendTourInvites(plan, ['p-1'])).resolves.toMatchObject({ ok: false, error: 'network', retry: true });
  (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
  await expect(sendTourInvites(plan, ['p-1'])).resolves.toMatchObject({ ok: false, error: 'network', status: 0, retry: true });
});

it('reads a bare 404 as a server without invites, and a named one as no such tour', async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ status: 404, json: async () => { throw new SyntaxError('html'); } });
  await expect(fetchTourRoster(plan)).resolves.toMatchObject({ ok: false, error: 'unsupported' });
  reply(404, { error: 'not_found' });
  await expect(fetchMyTourInvite(plan)).resolves.toMatchObject({ ok: false, error: 'not_found' });
});

it('answers an invite and parses the inviter', async () => {
  reply(200, { plan_id: plan, status: 'going', inviter: petr, invited_at: '2026-09-28T19:00:00Z', responded_at: '2026-09-28T19:05:00Z' });
  await expect(answerTourInvite(plan, 'going')).resolves.toEqual({ ok: true, value: { planId: plan, status: 'going', inviter: expect.objectContaining({ id: 'p-1' }) } });
  expect(global.fetch).toHaveBeenLastCalledWith(`https://api.example.test/v1/tour-invites/${plan}`, expect.objectContaining({ method: 'PUT', body: '{"status":"going"}' }));
  reply(200, { plan_id: plan, status: 'maybe', inviter: petr });
  await expect(fetchMyTourInvite(plan)).resolves.toMatchObject({ ok: false, error: 'invalid' });
});

it('lists open invites with what the Tours list needs, and drops rows without a usable link', async () => {
  const row = { plan_id: plan, status: 'invited', inviter: petr, token: 'invite-token-for-tours-list-test', title: 'Pátek po hospodách',
    scheduled_date: '2026-10-02', scheduled_time: '19:00', first_pub: 'U Bulínů' };
  reply(200, { invites: [row, { ...row, token: '../../x' }] });
  await expect(fetchOpenTourInvites()).resolves.toEqual({ ok: true, value: [expect.objectContaining({
    planId: plan, token: row.token, title: 'Pátek po hospodách', scheduledDate: '2026-10-02', scheduledTime: '19:00', firstPub: 'U Bulínů' })] });
  expect(global.fetch).toHaveBeenLastCalledWith('https://api.example.test/v1/tour-invites', expect.objectContaining({ method: 'GET' }));
  (global.fetch as jest.Mock).mockResolvedValue({ status: 404, json: async () => { throw new SyntaxError('html'); } });
  await expect(fetchOpenTourInvites()).resolves.toMatchObject({ ok: false, error: 'unsupported' });
});

it('marks a roster row whose link went dead', async () => {
  reply(200, { invites: [{ account: petr, status: 'invited', stale: true }, { account: { ...petr, id: 'p-2' }, status: 'going' }] });
  const result = await fetchTourRoster(plan);
  expect(result.ok && result.value.map((row) => row.stale)).toEqual([true, false]);
});
