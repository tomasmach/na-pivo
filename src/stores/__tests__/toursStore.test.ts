import AsyncStorage from '@react-native-async-storage/async-storage';
import { useToursStore as store, clearToursPrivateData, adoptToursOwner, releaseToursToDevice, TOURS_STORAGE_KEY, TOURS_QUARANTINE_KEY, tourContentSignature } from '../toursStore';
import { beginTourAccountChange, endTourAccountChange } from '@/data/toursBoundary';
import { publishTour, shareTour, fetchSharedTour, publishPublicTour } from '@/data/toursClient';
import { validPlan, cloneTour } from '@/tours/model';
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock') }));
jest.mock('@/data/account', () => ({
  ensureAccount: jest.fn(async () => ({ accountId: 'owner-a', authenticated: false })), getOrCreateDeviceId: jest.fn(async () => 'device-a'),
  generateUuidV4: jest.fn(() => {
    const { randomUUID } = jest.requireActual('node:crypto');
    return randomUUID();
  }),
}));
jest.mock('@/data/accountMerge', () => ({ readAccountMerge: jest.fn(async () => ({ ok: true, intent: null })) }));
jest.mock('@/data/toursClient', () => ({
  toTourWire: jest.requireActual('@/data/toursClient').toTourWire, fetchSharedTour: jest.fn(), publishTour: jest.fn(), shareTour: jest.fn(), revokeTour: jest.fn(), deletePublishedTour: jest.fn(), fetchPublishedTours: jest.fn(),
  publishPublicTour: jest.fn(), unpublishPublicTour: jest.fn(), reportPublicTour: jest.fn(),
}));
const pub = (id: number) => ({ id: String(id), name: `Pub ${id}`, lat: 50 + id / 100, lng: 14 });
async function makePlan() {
  await store.getState().beginDraft();
  await store.getState().updateDraft({ title: 'My tour' });
  await store.getState().addStop(pub(1));
  await store.getState().addStop(pub(2));
  const r = await store.getState().saveDraft();
  if (!r.ok)
    throw new Error(r.error);
  return r.id!;
}
beforeEach(async () => {
  jest.clearAllMocks();
  await clearToursPrivateData();
  await store.getState().hydrate();
});
describe('Tours durable lifecycle', () => {
  it('restores an unfinished draft and stable stop identity after reorder/restart', async () => {
    await store.getState().beginDraft();
    await store.getState().addStop(pub(1));
    await store.getState().addStop(pub(2));
    const id = store.getState().draft!.stops[0].id;
    await store.getState().moveStop(id, 1);
    expect(store.getState().draft!.stops[1].id).toBe(id);
    store.setState({ hydrated: false, draft: null });
    await store.getState().hydrate();
    expect(store.getState().draft!.stops[1].id).toBe(id);
  });
  it('preserves a run snapshot through edit, replacement, import and undo; allows one active run', async () => {
    const id = await makePlan();
    await store.getState().startRun(id);
    const stopId = store.getState().activeRun!.snapshot.stops[0].id;
    expect(await store.getState().startRun(id)).toEqual({ ok: false, error: 'active_run' });
    await store.getState().markStop(stopId, 'visited');
    await store.getState().beginDraft(id);
    await store.getState().replaceStop(stopId, pub(3));
    await store.getState().saveDraft();
    expect(store.getState().activeRun!.snapshot.stops[0].pubId).toBe('1');
    expect(store.getState().plans[0].stops[0].pubId).toBe('3');
    await store.getState().markStop(stopId, null);
    expect(store.getState().activeRun!.statuses).toEqual({});
    await store.getState().markStop(stopId, 'skipped');
    await store.getState().endRun();
    expect(store.getState().runs[0].statuses[stopId]).toBe('skipped');
    await store.getState().startRun(id);
    expect(store.getState().runs).toHaveLength(1);
  });
  it('copies the selected historical snapshot after the current plan has changed', async () => {
    const id = await makePlan();
    await store.getState().startRun(id);
    await store.getState().markStop(store.getState().activeRun!.snapshot.stops[0].id, 'visited');
    await store.getState().endRun();
    const history = cloneTour(store.getState().runs[0]);
    await store.getState().beginDraft(id);
    await store.getState().updateDraft({ title: 'New itinerary', scheduledDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), scheduledTime: '19:30' });
    await store.getState().addStop(pub(3));
    expect(await store.getState().saveDraft()).toEqual({ ok: true, id });

    const result = await store.getState().copyPlan(id, history.id);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const copy = store.getState().plans.find((p) => p.id === result.id)!;
    expect(copy).toMatchObject({ title: 'My tour', scheduledDate: null, scheduledTime: null, revision: 0 });
    expect(copy.stops.map((s) => s.pubId)).toEqual(['1', '2']);
    expect(copy.id).not.toBe(id);
    expect(copy.stops.map((s) => s.id)).not.toEqual(history.snapshot.stops.map((s) => s.id));
    expect(copy.share).toBeUndefined();
    expect(copy.source).toBeUndefined();
    expect(store.getState().runs).toEqual([history]);
    expect(store.getState().activeRun).toBeNull();
    expect(await store.getState().copyPlan(id, 'missing-run')).toEqual({ ok: false, error: 'not_found' });
    const currentCopy = await store.getState().copyPlan(id);
    expect(currentCopy.ok && store.getState().plans.find((p) => p.id === currentCopy.id)?.title).toBe('New itinerary');
  });
  it('does not discard local state on storage failure', async () => {
    await store.getState().beginDraft();
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk'));
    expect(await store.getState().updateDraft({ title: 'Lost?' })).toEqual({ ok: false, error: 'storage' });
    expect(store.getState().draft!.title).toBe('');
  });
  it('keeps malformed storage intact and in quarantine, refuses overwriting', async () => {
    await AsyncStorage.setItem(TOURS_STORAGE_KEY, '{bad');
    store.setState({ hydrated: false });
    expect(await store.getState().hydrate()).toEqual({ ok: false, error: 'corrupt_storage' });
    expect(await AsyncStorage.getItem(TOURS_STORAGE_KEY)).toBe('{bad');
    expect(await AsyncStorage.getItem(TOURS_QUARANTINE_KEY)).toBe('{bad');
    expect((await store.getState().beginDraft()).ok).toBe(false);
  });
  it('claims anonymous local plans but clears all private tour data on logout', async () => {
    await makePlan();
    await store.getState().startRun(store.getState().plans[0].id);
    beginTourAccountChange();
    expect(await store.getState().endRun()).toEqual({ ok: false, error: 'account_changed' });
    await adoptToursOwner('owner-a', 'owner-b');
    expect(store.getState().owner).toBe('owner-b');
    expect(store.getState().activeRun).not.toBeNull();
    endTourAccountChange();
    await clearToursPrivateData();
    expect(store.getState().plans).toEqual([]);
    expect(await AsyncStorage.getItem(TOURS_STORAGE_KEY)).toBeNull();
  });
  it('never blocks signing in, and hands an evicted anonymous account\'s plans to the device', async () => {
    await makePlan();
    const raw = JSON.parse((await AsyncStorage.getItem(TOURS_STORAGE_KEY))!);
    await AsyncStorage.setItem(TOURS_STORAGE_KEY, JSON.stringify({ ...raw, owner: 'evicted-a' }));
    // An unknown owner is left alone instead of throwing inside the auth transition.
    await expect(adoptToursOwner('owner-a2', 'owner-b')).resolves.toBeUndefined();
    expect(JSON.parse((await AsyncStorage.getItem(TOURS_STORAGE_KEY))!).owner).toBe('evicted-a');
    await AsyncStorage.setItem(TOURS_STORAGE_KEY, '{bad');
    await expect(adoptToursOwner('owner-a2', 'owner-b')).resolves.toBeUndefined();

    await AsyncStorage.setItem(TOURS_STORAGE_KEY, JSON.stringify({ ...raw, owner: 'evicted-a' }));
    await releaseToursToDevice('evicted-a');
    expect(JSON.parse((await AsyncStorage.getItem(TOURS_STORAGE_KEY))!).owner).toBe('device:device-a');
    await adoptToursOwner('owner-a2', 'owner-b');
    expect(JSON.parse((await AsyncStorage.getItem(TOURS_STORAGE_KEY))!).owner).toBe('owner-b');
    expect(store.getState().plans).toHaveLength(1);
  });
  it('retries exactly the same operation after a lost response, retains conflict versions', async () => {
    const id = await makePlan();
    const local = cloneTour(store.getState().plans[0]);
    (publishTour as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'network' }).mockResolvedValueOnce({ ok: false, error: 'conflict', tour: { ...local, title: 'Other phone', revision: 2 } });
    await store.getState().publish(id);
    const first = (publishTour as jest.Mock).mock.calls[0];
    await store.getState().publish(id);
    expect((publishTour as jest.Mock).mock.calls[1]).toEqual(first);
    expect(store.getState().plans[0].title).toBe('My tour');
    expect(store.getState().plans[0].conflict?.title).toBe('Other phone');
    await store.getState().copyLocalConflict(id);
    expect(store.getState().plans.map((p) => p.title).sort()).toEqual(['My tour', 'Other phone']);
  });
  it('retries a lost share response without repeating PUT or marking canonicalized content dirty', async () => {
    const id = await makePlan();
    const local = cloneTour(store.getState().plans[0]);
    const canonical = { ...local, revision: 1, stops: local.stops.map((s) => ({ ...s, pubId: `canonical-${s.pubId}` })) };
    const shared = { ...canonical, share: { url: `https://na-pivo.cz/t/${'x'.repeat(43)}`, expiresAt: '2026-11-01T00:00:00Z' } };
    (publishTour as jest.Mock).mockResolvedValue({ ok: true, tour: canonical });
    (shareTour as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'network' }).mockResolvedValueOnce({ ok: true, tour: shared });
    expect(await store.getState().publish(id)).toEqual({ ok: false, error: 'network' });
    const shareOperation = (shareTour as jest.Mock).mock.calls[0];
    expect(await store.getState().publish(id)).toEqual({ ok: true });
    expect(publishTour).toHaveBeenCalledTimes(1);
    expect((shareTour as jest.Mock).mock.calls[1]).toEqual(shareOperation);
    expect(store.getState().plans[0].share).toEqual(shared.share);
    expect(store.getState().published[id]).toEqual(tourContentSignature(store.getState().plans[0]));
  });
  it('still rotates the link when a stalled share was not a rotation', async () => {
    const id = await makePlan();
    const local = cloneTour(store.getState().plans[0]);
    const canonical = { ...local, revision: 1 };
    const shared = { ...canonical, share: { url: `https://na-pivo.cz/t/${'y'.repeat(43)}`, expiresAt: '2026-11-01T00:00:00Z' } };
    (publishTour as jest.Mock).mockResolvedValue({ ok: true, tour: canonical });
    (shareTour as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'network' }).mockResolvedValueOnce({ ok: true, tour: shared });
    expect(await store.getState().publish(id)).toEqual({ ok: false, error: 'network' });
    const [, stalledOperation, stalledRotate] = (shareTour as jest.Mock).mock.calls[0];
    expect(stalledRotate).toBe(false);
    expect(await store.getState().publish(id, true)).toEqual({ ok: true });
    const [, operation, rotated] = (shareTour as jest.Mock).mock.calls[1];
    expect(rotated).toBe(true);
    expect(operation).not.toBe(stalledOperation);
    expect(publishTour).toHaveBeenCalledTimes(1);
  });
  it.each([true, false])('shares unchanged content without a new revision and retries the same operation (rotate=%s)', async (rotate) => {
    const id = await makePlan();
    const remote = { ...cloneTour(store.getState().plans[0]), revision: 1 };
    store.setState({ plans: [remote], published: { [id]: tourContentSignature(remote) } });
    (shareTour as jest.Mock).mockResolvedValueOnce({ ok: false, error: 'network' }).mockResolvedValueOnce({ ok: true, tour: remote });
    expect(await store.getState().publish(id, rotate)).toEqual({ ok: false, error: 'network' });
    const first = (shareTour as jest.Mock).mock.calls[0];
    // The pending operation must also survive an app restart.
    store.setState({ hydrated: false, plans: [], pending: {} });
    await store.getState().hydrate();
    expect(await store.getState().publish(id, rotate)).toEqual({ ok: true });
    expect(publishTour).not.toHaveBeenCalled();
    expect(first).toEqual([id, expect.any(String), rotate]);
    expect((shareTour as jest.Mock).mock.calls[1]).toEqual(first);
    expect(store.getState().plans[0].revision).toBe(1);
    expect(store.getState().pending[id]).toBeUndefined();
  });
  it('publishes edited content before rotating its link', async () => {
    const id = await makePlan();
    const published = { ...cloneTour(store.getState().plans[0]), revision: 1 };
    store.setState({ plans: [published], published: { [id]: tourContentSignature(published) } });
    await store.getState().beginDraft(id);
    await store.getState().updateDraft({ title: 'Changed itinerary' });
    await store.getState().saveDraft();
    const updated = { ...cloneTour(store.getState().plans[0]), revision: 2 };
    (publishTour as jest.Mock).mockResolvedValue({ ok: true, tour: updated });
    (shareTour as jest.Mock).mockResolvedValue({ ok: true, tour: updated });
    expect(await store.getState().publish(id, true)).toEqual({ ok: true });
    expect(publishTour).toHaveBeenCalledWith(expect.objectContaining({ title: 'Changed itinerary', revision: 1 }), expect.any(String));
    expect(shareTour).toHaveBeenCalledWith(id, expect.any(String), true);
    expect(jest.mocked(publishTour).mock.invocationCallOrder[0]).toBeLessThan(jest.mocked(shareTour).mock.invocationCallOrder[0]);
    expect(store.getState().plans[0].revision).toBe(2);
  });
  it.each([true, false])('preserves another device publication returned by share (HTTP success=%s)', async (success) => {
    const id = await makePlan();
    const local = cloneTour(store.getState().plans[0]);
    const first = { ...local, revision: 1 };
    const remote = { ...local, title: 'Other device', revision: 2 };
    (publishTour as jest.Mock).mockResolvedValue({ ok: true, tour: first });
    (shareTour as jest.Mock).mockResolvedValue(success ? { ok: true, tour: remote } : { ok: false, error: 'conflict', tour: remote });
    expect(await store.getState().publish(id)).toEqual({ ok: false, error: 'conflict' });
    expect(store.getState().plans[0]).toMatchObject({ title: 'My tour', revision: 1, conflict: { title: 'Other device', revision: 2 } });
    expect(store.getState().pending[id]).toBeUndefined();
    await store.getState().copyLocalConflict(id);
    expect(store.getState().plans.find((p) => p.id === id)?.title).toBe('Other device');
    expect(store.getState().plans.find((p) => p.id !== id)?.title).toBe('My tour');
  });
  it('drops a late publication response during account transition before it reaches state', async () => {
    const id = await makePlan();
    const local = cloneTour(store.getState().plans[0]);
    let resolve!: (v: unknown) => void;
    let started!: (v: void) => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    (publishTour as jest.Mock).mockImplementation(() => {
      started();
      return new Promise((r) => {
        resolve = r;
      });
    });
    const inFlight = store.getState().publish(id);
    await ready;
    beginTourAccountChange();
    const cleared = clearToursPrivateData();
    resolve({ ok: true, tour: { ...local, revision: 1 } });
    expect(await inFlight).toEqual({ ok: false, error: 'account_changed' });
    await cleared;
    endTourAccountChange();
    expect(store.getState().plans).toEqual([]);
    expect(shareTour).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(TOURS_STORAGE_KEY)).toBeNull();
  });
  it('retains the imported copy and private run while adopting a rotated link', async () => {
    await makePlan();
    const remote = { ...cloneTour(store.getState().plans[0]), revision: 1 };
    await clearToursPrivateData();
    await store.getState().hydrate();
    (fetchSharedTour as jest.Mock).mockResolvedValue({ ok: true, tour: remote });
    await store.getState().importShared('x'.repeat(32));
    const importedId = store.getState().plans[0].id;
    await store.getState().startRun(importedId);
    await store.getState().markStop(store.getState().activeRun!.snapshot.stops[0].id, 'visited');
    const active = cloneTour(store.getState().activeRun);
    const rotatedToken = 'y'.repeat(32);
    expect(await store.getState().importShared(rotatedToken)).toEqual({ ok: true, id: importedId });
    expect(store.getState().plans).toHaveLength(1);
    expect(store.getState().plans[0].source).toMatchObject({ revision: 1, token: rotatedToken });
    expect(store.getState().activeRun).toEqual(active);
    store.setState({ hydrated: false, plans: [] });
    await store.getState().hydrate();
    expect(store.getState().plans[0].source?.token).toBe(rotatedToken);
  });
  it('deduplicates imported revisions and only replaces the plan on explicit update', async () => {
    const id = await makePlan();
    const remote = { ...cloneTour(store.getState().plans[0]), revision: 1 };
    await clearToursPrivateData();
    await store.getState().hydrate();
    (fetchSharedTour as jest.Mock).mockResolvedValue({ ok: true, tour: remote });
    const token = 'x'.repeat(32);
    const result = await store.getState().importShared(token);
    expect(result.ok).toBe(true);
    await store.getState().importShared(token);
    expect(store.getState().plans).toHaveLength(1);
    const imported = store.getState().plans[0];
    expect(imported.id).not.toBe(id);
    expect(validPlan(imported)).toBe(true);
    await store.getState().startRun(imported.id);
    (fetchSharedTour as jest.Mock).mockResolvedValue({ ok: true, tour: { ...remote, title: 'Changed', revision: 2 } });
    await store.getState().importShared(token);
    expect(store.getState().plans[0].title).toBe('My tour');
    await store.getState().importShared(token, true);
    expect(store.getState().plans[0].title).toBe('Changed');
    expect(store.getState().activeRun!.snapshot.title).toBe('My tour');
  });
  it('writes, keeps on pub replacement and clears a challenge without changing old publish signatures', async () => {
    const id = await makePlan();
    const before = tourContentSignature(store.getState().plans[0]);
    const legacyWire = JSON.parse(before);
    expect(legacyWire.stops[0]).not.toHaveProperty('challenge');
    await store.getState().beginDraft(id);
    const stopId = store.getState().draft!.stops[0].id;
    expect(await store.getState().setChallenge(stopId, '  Najdi\nnejstarší pípu ')).toEqual({ ok: true });
    expect(store.getState().draft!.stops[0].challenge).toBe('Najdi nejstarší pípu');
    expect(await store.getState().setChallenge(stopId, 'x'.repeat(121))).toEqual({ ok: false, error: 'invalid' });
    await store.getState().replaceStop(stopId, pub(3));
    expect(store.getState().draft!.stops[0]).toMatchObject({ pubId: '3', challenge: 'Najdi nejstarší pípu' });
    await store.getState().saveDraft();
    expect(tourContentSignature(store.getState().plans[0])).not.toBe(before);
    await store.getState().beginDraft(id);
    await store.getState().setChallenge(store.getState().draft!.stops[0].id, '   ');
    expect(store.getState().draft!.stops[0].challenge).toBe('');
  });
  it('uploads the plan before its frozen public copy and passes a refusal through with its stop', async () => {
    const id = await makePlan();
    const publication = { id: '33333333-3333-4333-8333-333333333333', token: 'publicTokenForTests12', url: 'https://na-pivo.cz/t/publicTokenForTests12', status: 'active' as const, revision: 1, planRevision: 1, peopleCount: 0 };
    jest.mocked(publishTour).mockImplementation(async (plan) => ({ ok: true, tour: { ...cloneTour(plan), revision: 1 } }));
    jest.mocked(publishPublicTour).mockResolvedValueOnce({ ok: false, error: 'text_rejected', field: 'challenge', stop: 1 });
    expect(await store.getState().publishPublic(id)).toEqual({ ok: false, error: 'text_rejected', field: 'challenge', stop: 1 });
    expect(publishTour).toHaveBeenCalledTimes(1);
    expect(publishPublicTour).toHaveBeenCalledWith(id, 1);
    jest.mocked(publishPublicTour).mockImplementationOnce(async () => ({ ok: true, tour: { ...cloneTour(store.getState().plans[0]), publication } }));
    expect(await store.getState().publishPublic(id)).toEqual({ ok: true });
    // The server plan already matched, so only the public copy was sent again.
    expect(publishTour).toHaveBeenCalledTimes(1);
    expect(store.getState().plans[0].publication).toEqual(publication);
  });
  it('saves a public tour as an own editable copy once, and drops the link when its pubs change', async () => {
    const remote = { ...cloneTour(store.getState().plans[0] ?? { id: '44444444-4444-4444-8444-444444444444' }), id: '44444444-4444-4444-8444-444444444444', title: 'Veřejná', scheduledDate: null, scheduledTime: null, timezone: 'Europe/Prague', revision: 2, updatedAt: new Date().toISOString(),
      stops: [1, 2].map((n) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, pubId: `directory:p${n}`, cacheKey: null, name: `Pub ${n}`, address: 'Praha', lat: 50 + n / 100, lon: 14 })) };
    const info = { id: remote.id, peopleCount: 0, city: 'Praha', walkM: 900, author: { id: 'a', nickname: 'pivni_vlk', displayName: '', avatarUrl: null } };
    jest.mocked(fetchSharedTour).mockResolvedValue({ ok: true, tour: remote, public: info });
    const saved = await store.getState().savePublic('publicTokenForTests12');
    expect(saved.ok && saved.id).toBeTruthy();
    const id = (saved as { id: string }).id;
    expect(await store.getState().savePublic('publicTokenForTests12')).toEqual({ ok: true, id });
    expect(store.getState().plans.find((p) => p.id === id)!.publicSource).toEqual({ publicId: remote.id, token: 'publicTokenForTests12', pubIds: ['directory:p1', 'directory:p2'] });
    await store.getState().beginDraft(id);
    await store.getState().updateDraft({ title: 'Náš pátek' });
    await store.getState().saveDraft();
    expect(store.getState().plans.find((p) => p.id === id)!.publicSource).toBeDefined();
    await store.getState().beginDraft(id);
    await store.getState().replaceStop(store.getState().draft!.stops[0].id, pub(7));
    await store.getState().saveDraft();
    expect(store.getState().plans.find((p) => p.id === id)!.publicSource).toBeUndefined();
  });
  it('publishes a tour whose meetup already passed and forgets reported tours at an account boundary', async () => {
    const id = await makePlan();
    store.setState({ plans: store.getState().plans.map((p) => (p.id === id ? { ...p, scheduledDate: '2020-01-01' } : p)) });
    jest.mocked(publishTour).mockImplementation(async (plan) => ({ ok: true, tour: { ...cloneTour(plan), revision: 1 } }));
    jest.mocked(publishPublicTour).mockResolvedValueOnce({ ok: false, error: 'network' });
    await store.getState().publishPublic(id);
    expect(publishPublicTour).toHaveBeenCalledWith(id, 1);
    store.setState({ hiddenPublic: ['55555555-5555-4555-8555-555555555555'] });
    await clearToursPrivateData();
    await store.getState().hydrate();
    expect(store.getState().hiddenPublic).toBeUndefined();
  });
});

