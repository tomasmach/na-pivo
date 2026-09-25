import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { ensureAccount, generateUuidV4, getOrCreateDeviceId } from '@/data/account';
import { readAccountMerge } from '@/data/accountMerge';
import { beginTourAccountChange, endTourAccountChange, invalidateTours, tourBoundary } from '@/data/toursBoundary';
import { deletePublishedTour, fetchPublishedTours, fetchSharedTour, publishPublicTour, publishTour, reportPublicTour, revokeTour, shareTour, toTourWire, unpublishPublicTour } from '@/data/toursClient';
import type { Pub } from '@/data/pubs';
import { CHALLENGE_MAX, cleanChallenge, cloneTour, newTour, pubIdsOf, samePub, stopFromPub, TOUR_LIMIT, validPlan, validRun, validSchedule, uuidValid, type TourPlan, type TourRun, type TourResult, type TourError } from '@/tours/model';
export const TOURS_STORAGE_KEY = 'na-pivo-tours-v1';
export const TOURS_QUARANTINE_KEY = 'na-pivo-tours-quarantine-v1';
interface PendingPublication {
  plan: TourPlan;
  operationId: string;
  shareOperationId: string;
  rotate: boolean;
  stage: 'plan' | 'share';
}
interface ToursData {
  version: 1;
  owner: string | null;
  plans: TourPlan[];
  draft: TourPlan | null;
  activeRun: TourRun | null;
  runs: TourRun[];
  published: Record<string, string>;
  pending: Record<string, PendingPublication>;
  /** Public tours this phone reported; they stop showing here at once. Missing in older data. */
  hiddenPublic?: string[];
}
interface ToursState extends ToursData {
  hydrated: boolean;
  error: TourError | null;
  busy: boolean;
  hydrate: () => Promise<TourResult>;
  beginDraft: (id?: string) => Promise<TourResult>;
  updateDraft: (patch: Partial<Pick<TourPlan, 'title' | 'scheduledDate' | 'scheduledTime' | 'timezone' | 'stops'>>) => Promise<TourResult>;
  addStop: (pub: Pub) => Promise<TourResult>;
  replaceStop: (id: string, pub: Pub) => Promise<TourResult>;
  moveStop: (id: string, delta: number) => Promise<TourResult>;
  removeStop: (id: string) => Promise<TourResult>;
  setChallenge: (id: string, text: string) => Promise<TourResult>;
  saveDraft: () => Promise<TourResult>;
  discardDraft: () => Promise<TourResult>;
  deletePlan: (id: string) => Promise<TourResult>;
  copyPlan: (id: string, runId?: string) => Promise<TourResult>;
  startRun: (id: string) => Promise<TourResult>;
  markStop: (id: string, status: 'visited' | 'skipped' | null) => Promise<TourResult>;
  endRun: () => Promise<TourResult>;
  publish: (id: string, rotate?: boolean) => Promise<TourResult>;
  revoke: (id: string) => Promise<TourResult>;
  restorePublished: () => Promise<TourResult>;
  importShared: (token: string, update?: boolean) => Promise<TourResult>;
  chooseServerVersion: (id: string) => Promise<TourResult>;
  publishPublic: (id: string) => Promise<TourResult>;
  unpublishPublic: (id: string) => Promise<TourResult>;
  savePublic: (token: string) => Promise<TourResult>;
  reportPublic: (publicId: string) => Promise<TourResult>;
  copyLocalConflict: (id: string) => Promise<TourResult>;
  clearError: () => void;
}
// hiddenPublic is spelled out: zustand merges state, so a missing key would keep the previous account's list.
const empty = (): ToursData => ({ version: 1, owner: null, plans: [], draft: null, activeRun: null, runs: [], published: {}, pending: {}, hiddenPublic: undefined });
// Empty challenges stay out, so tours published before challenges keep their signature.
export const tourContentSignature = (p: TourPlan) => {
  const wire = toTourWire(p);
  return JSON.stringify({ ...wire, stops: wire.stops.map(({ challenge, ...stop }) => challenge ? { ...stop, challenge } : stop) });
};
function validateData(v: unknown): v is ToursData {
  if (!v || typeof v !== 'object')
    return false;
  const d = v as ToursData;
  return d.version === 1 && (d.owner === null || typeof d.owner === 'string') && Array.isArray(d.plans) && d.plans.length <= TOUR_LIMIT && d.plans.every((p) => validPlan(p)) && new Set(d.plans.map((p) => p.id)).size === d.plans.length &&
    (d.draft === null || validPlan(d.draft, true)) && (d.activeRun === null || (validRun(d.activeRun) && d.activeRun.endedAt === null)) && Array.isArray(d.runs) && d.runs.every((r) => validRun(r) && r.endedAt !== null) &&
    !!d.published && typeof d.published === 'object' && !Array.isArray(d.published) && Object.entries(d.published).every(([id, s]) => uuidValid(id) && typeof s === 'string') &&
    !!d.pending && typeof d.pending === 'object' && !Array.isArray(d.pending) && Object.entries(d.pending).every(([id, p]) => uuidValid(id) && validPlan(p.plan) && p.plan.id === id && uuidValid(p.operationId) && uuidValid(p.shareOperationId) && typeof p.rotate === 'boolean' && (p.stage === 'plan' || p.stage === 'share')) &&
    (d.hiddenPublic === undefined || (Array.isArray(d.hiddenPublic) && d.hiddenPublic.length <= 500 && d.hiddenPublic.every(uuidValid)));
}
let serial: Promise<unknown> = Promise.resolve();
function locked<T>(task: () => Promise<T>): Promise<T> {
  const next = serial.then(task, task);
  serial = next.catch(() => undefined);
  return next;
}
function data(): ToursData {
  const s = useToursStore.getState();
  return cloneTour({ version: s.version, owner: s.owner, plans: s.plans, draft: s.draft, activeRun: s.activeRun, runs: s.runs, published: s.published, pending: s.pending, ...(s.hiddenPublic ? { hiddenPublic: s.hiddenPublic } : {}) });
}
function failure(error: TourError): TourResult {
  useToursStore.setState({ error });
  return { ok: false, error };
}
function current(generation: number) {
  return generation === tourBoundary().generation && !tourBoundary().changing;
}
async function persist(d: ToursData, generation: number, internal = false): Promise<TourResult> {
  if (!validateData(d))
    return failure('invalid');
  if ((!internal && !current(generation)) || generation !== tourBoundary().generation)
    return { ok: false, error: 'account_changed' };
  try {
    await AsyncStorage.setItem(TOURS_STORAGE_KEY, JSON.stringify(d));
    if ((!internal && !current(generation)) || generation !== tourBoundary().generation)
      return { ok: false, error: 'account_changed' };
    useToursStore.setState({ ...d, error: null });
    return { ok: true };
  }
  catch {
    return failure('storage');
  }
}
async function hydrateOnce(): Promise<TourResult> {
  if (useToursStore.getState().hydrated)
    return { ok: true };
  const generation = tourBoundary().generation;
  if (!current(generation))
    return failure('account_changed');
  try {
    const raw = await AsyncStorage.getItem(TOURS_STORAGE_KEY);
    if (!current(generation))
      return { ok: false, error: 'account_changed' };
    if (!raw) {
      useToursStore.setState({ ...empty(), hydrated: true, error: null });
      return { ok: true };
    }
    let saved: unknown;
    try {
      saved = JSON.parse(raw);
    }
    catch {
      saved = null;
    }
    if (!validateData(saved)) {
      // Preserve the complete original; never replace malformed data with defaults.
      await AsyncStorage.setItem(TOURS_QUARANTINE_KEY, raw);
      if (!current(generation))
        return { ok: false, error: 'account_changed' };
      return failure('corrupt_storage');
    }
    const session = await ensureAccount();
    if (!current(generation))
      return { ok: false, error: 'account_changed' };
    const owner = session?.accountId ?? `device:${await getOrCreateDeviceId()}`;
    if (!current(generation))
      return { ok: false, error: 'account_changed' };
    if (saved.owner && saved.owner !== owner) {
      const merge = await readAccountMerge();
      if (!current(generation))
        return { ok: false, error: 'account_changed' };
      if (merge.ok && merge.intent?.fromAccountId === saved.owner && merge.intent.toAccountId === owner) {
        saved.owner = owner;
        const result = await persist(saved, generation);
        if (!result.ok)
          return result;
      }
      else if (saved.owner.startsWith('device:') && session && !session.authenticated) {
        saved.owner = owner;
      }
      else
        return failure('account_changed');
    }
    useToursStore.setState({ hiddenPublic: undefined, ...saved, hydrated: true, error: null });
    return { ok: true };
  }
  catch {
    return failure('storage');
  }
}
function mutate(fn: (d: ToursData) => TourResult | void): Promise<TourResult> {
  const generation = tourBoundary().generation;
  return locked(async () => {
    if (!current(generation))
      return failure('account_changed');
    const hydrated = await hydrateOnce();
    if (!hydrated.ok)
      return hydrated;
    const merge = await readAccountMerge();
    if (!current(generation) || !merge.ok || merge.intent)
      return failure('account_changed');
    const d = data();
    const result = fn(d);
    if (result && !result.ok)
      return failure(result.error);
    if (!d.owner) {
      const session = await ensureAccount();
      if (!current(generation))
        return failure('account_changed');
      d.owner = session?.accountId ?? `device:${await getOrCreateDeviceId()}`;
    }
    const stored = await persist(d, generation);
    return stored.ok ? (result ?? { ok: true }) : stored;
  });
}
function networkAction(fn: (generation: number) => Promise<TourResult>): Promise<TourResult> {
  const generation = tourBoundary().generation;
  return locked(async () => {
    if (!current(generation))
      return failure('account_changed');
    const hydrated = await hydrateOnce();
    if (!hydrated.ok)
      return hydrated;
    const merge = await readAccountMerge();
    if (!current(generation) || !merge.ok || merge.intent)
      return failure('account_changed');
    useToursStore.setState({ busy: true, error: null });
    try {
      const result = await fn(generation);
      if (!current(generation))
        return { ok: false, error: 'account_changed' };
      if (!result.ok)
        failure(result.error);
      return result;
    }
    catch {
      return failure('network');
    }
    finally {
      useToursStore.setState({ busy: false });
    }
  });
}
/** The server never knows which public tour a copy came from; keep that link on this phone. */
function withLocalFields(server: TourPlan, local: TourPlan | undefined): TourPlan {
  return local?.publicSource ? { ...server, publicSource: local.publicSource } : server;
}
function putPlan(d: ToursData, p: TourPlan) {
  const index = d.plans.findIndex((old) => old.id === p.id);
  if (index < 0)
    d.plans.unshift(p);
  else
    d.plans[index] = p;
}
export const useToursStore = create<ToursState>(() => ({
  ...empty(), hydrated: false, error: null, busy: false,
  hydrate: () => locked(hydrateOnce), clearError: () => useToursStore.setState({ error: null }),
  beginDraft: (id) => mutate((d) => {
    if (d.draft)
      return d.draft.id === id || !id ? { ok: true, id: d.draft.id } : { ok: false, error: 'busy' };
    const existing = id ? d.plans.find((p) => p.id === id) : null;
    if (id && !existing)
      return { ok: false, error: 'not_found' };
    if (!existing && d.plans.length >= TOUR_LIMIT)
      return { ok: false, error: 'limit' };
    d.draft = existing ? cloneTour(existing) : newTour();
    return { ok: true, id: d.draft.id };
  }),
  updateDraft: (patch) => mutate((d) => {
    if (!d.draft)
      return { ok: false, error: 'not_found' };
    const next = { ...d.draft, ...cloneTour(patch) };
    if (!validPlan(next, true))
      return { ok: false, error: 'invalid' };
    d.draft = next;
  }),
  addStop: (pub) => mutate((d) => {
    if (!d.draft)
      return { ok: false, error: 'not_found' };
    if (d.draft.stops.length >= 8)
      return { ok: false, error: 'limit' };
    const stop = stopFromPub(pub);
    if (d.draft.stops.some((s) => samePub(s, stop)))
      return { ok: false, error: 'duplicate' };
    d.draft.stops.push(stop);
  }),
  replaceStop: (id, pub) => mutate((d) => {
    if (!d.draft)
      return { ok: false, error: 'not_found' };
    const index = d.draft.stops.findIndex((s) => s.id === id);
    if (index < 0)
      return { ok: false, error: 'not_found' };
    const stop = stopFromPub(pub);
    if (d.draft.stops.some((s) => s.id !== id && samePub(s, stop)))
      return { ok: false, error: 'duplicate' };
    // A written challenge is the author's work; it moves to the replacement pub.
    const challenge = d.draft.stops[index].challenge;
    d.draft.stops[index] = challenge ? { ...stop, challenge } : stop;
  }),
  moveStop: (id, delta) => mutate((d) => {
    if (!d.draft)
      return { ok: false, error: 'not_found' };
    const index = d.draft.stops.findIndex((s) => s.id === id);
    const to = index + delta;
    if (index < 0 || !Number.isInteger(to) || to < 0 || to >= d.draft.stops.length)
      return { ok: false, error: 'invalid' };
    const [stop] = d.draft.stops.splice(index, 1);
    d.draft.stops.splice(to, 0, stop);
  }),
  removeStop: (id) => mutate((d) => {
    if (!d.draft)
      return { ok: false, error: 'not_found' };
    d.draft.stops = d.draft.stops.filter((s) => s.id !== id);
  }),
  setChallenge: (id, text) => mutate((d) => {
    const stop = d.draft?.stops.find((s) => s.id === id);
    if (!stop)
      return { ok: false, error: 'not_found' };
    const challenge = cleanChallenge(text);
    if (challenge.length > CHALLENGE_MAX)
      return { ok: false, error: 'invalid' };
    if (challenge)
      stop.challenge = challenge;
    else
      delete stop.challenge;
  }),
  saveDraft: () => mutate((d) => {
    if (!d.draft || !validPlan(d.draft) || !validSchedule(d.draft))
      return { ok: false, error: 'invalid' };
    if (!d.plans.some((p) => p.id === d.draft!.id) && d.plans.length >= TOUR_LIMIT)
      return { ok: false, error: 'limit' };
    d.draft.title = d.draft.title.trim();
    d.draft.updatedAt = new Date().toISOString();
    // Another route is the author's own tour now, not the public one it started from.
    // Reordering keeps the same pubs, like the server's count; only a new set is another route.
    if (d.draft.publicSource && [...pubIdsOf(d.draft)].sort().join('|') !== [...d.draft.publicSource.pubIds].sort().join('|'))
      delete d.draft.publicSource;
    putPlan(d, d.draft);
    const id = d.draft.id;
    d.draft = null;
    return { ok: true, id };
  }),
  discardDraft: () => mutate((d) => {
    d.draft = null;
  }),
  copyPlan: (id, runId) => mutate((d) => {
    const p = runId ? d.runs.find((run) => run.id === runId && run.planId === id)?.snapshot : d.plans.find((p) => p.id === id);
    if (!p)
      return { ok: false, error: 'not_found' };
    if (d.plans.length >= TOUR_LIMIT)
      return { ok: false, error: 'limit' };
    const copy = cloneTour(p);
    copy.id = generateUuidV4();
    copy.revision = 0;
    copy.updatedAt = new Date().toISOString();
    delete copy.share;
    delete copy.conflict;
    delete copy.source;
    delete copy.publication;
    delete copy.publicSource;
    copy.stops = copy.stops.map((s) => ({ ...s, id: generateUuidV4() }));
    putPlan(d, copy);
    return { ok: true, id: copy.id };
  }),
  startRun: (id) => mutate((d) => {
    if (d.activeRun)
      return { ok: false, error: 'active_run' };
    const p = d.plans.find((p) => p.id === id);
    if (!p)
      return { ok: false, error: 'not_found' };
    const snapshot = cloneTour(p);
    delete snapshot.share;
    delete snapshot.source;
    delete snapshot.conflict;
    delete snapshot.publication;
    d.activeRun = { id: generateUuidV4(), planId: id, snapshot, startedAt: new Date().toISOString(), endedAt: null, statuses: {} };
  }),
  markStop: (id, status) => mutate((d) => {
    if (!d.activeRun || !d.activeRun.snapshot.stops.some((s) => s.id === id))
      return { ok: false, error: 'not_found' };
    if (status === null)
      delete d.activeRun.statuses[id];
    else
      d.activeRun.statuses[id] = status;
  }),
  endRun: () => mutate((d) => {
    if (!d.activeRun)
      return { ok: false, error: 'not_found' };
    d.runs.unshift({ ...d.activeRun, endedAt: new Date().toISOString() });
    d.activeRun = null;
  }),
  deletePlan: (id) => networkAction(async (g) => {
    const d = data();
    const plan = d.plans.find((p) => p.id === id);
    if (!plan)
      return { ok: false, error: 'not_found' };
    if (d.activeRun?.planId === id)
      return { ok: false, error: 'active_run' };
    if (plan.revision > 0 && !plan.source) {
      const r = await deletePublishedTour(id);
      if (!current(g))
        return { ok: false, error: 'account_changed' };
      if (!r.ok)
        return r;
    }
    d.plans = d.plans.filter((p) => p.id !== id);
    d.runs = d.runs.filter((r) => r.planId !== id);
    if (d.draft?.id === id)
      d.draft = null;
    delete d.published[id];
    delete d.pending[id];
    return persist(d, g);
  }),
  publish: (id, rotate = false) => networkAction(async (g) => {
    let d = data();
    const plan = d.plans.find((p) => p.id === id);
    if (!plan)
      return { ok: false, error: 'not_found' };
    if (plan.source || !validSchedule(plan))
      return { ok: false, error: 'invalid' };
    let pending = d.pending[id];
    if (!pending) {
      // Rotating or renewing a link does not publish a new itinerary revision.
      const published = plan.revision > 0 && d.published[id] === tourContentSignature(plan);
      pending = { plan: cloneTour(plan), operationId: generateUuidV4(), shareOperationId: generateUuidV4(), rotate, stage: published ? 'share' : 'plan' };
      d.pending[id] = pending;
      const r = await persist(d, g);
      if (!r.ok)
        return r;
    }
    else if (rotate && !pending.rotate) {
      // A requested rotation must cut off the old link even behind a stalled share;
      // a fresh operation id keeps the earlier, non-rotating one replay-safe.
      pending = { ...pending, rotate: true, shareOperationId: generateUuidV4() };
      d.pending[id] = pending;
      const r = await persist(d, g);
      if (!r.ok)
        return r;
    }
    if (pending.stage === 'plan') {
      const result = await publishTour(pending.plan, pending.operationId);
      if (!current(g))
        return { ok: false, error: 'account_changed' };
      if (!result.ok) {
        if (result.error === 'invalid') {
          d = data();
          delete d.pending[id];
          const saved = await persist(d, g);
          if (!saved.ok)
            return saved;
        }
        if (result.error === 'conflict' && result.tour) {
          d = data();
          const local = d.plans.find((p) => p.id === id)!;
          local.conflict = result.tour;
          delete d.pending[id];
          const saved = await persist(d, g);
          if (!saved.ok)
            return saved;
        }
        return result;
      }
      d = data();
      const local = d.plans.find((p) => p.id === id)!;
      if (tourContentSignature(local) === tourContentSignature(pending.plan))
        putPlan(d, withLocalFields(result.tour, local));
      else {
        local.revision = result.tour.revision;
        local.share = result.tour.share;
      }
      d.published[id] = tourContentSignature(result.tour);
      pending = { ...pending, stage: 'share' };
      d.pending[id] = pending;
      const saved = await persist(d, g);
      if (!saved.ok)
        return saved;
    }
    const result = await shareTour(id, pending.shareOperationId, pending.rotate);
    if (!current(g))
      return { ok: false, error: 'account_changed' };
    d = data();
    const local = d.plans.find((p) => p.id === id)!;
    const remote = result.tour;
    if (remote && ((!result.ok && result.error === 'conflict') ||
      (result.ok && (remote.revision !== local.revision || tourContentSignature(remote) !== d.published[id])))) {
      // A different device may publish between our PUT and share request.
      // Keep our content and revision until the owner explicitly resolves it.
      local.conflict = remote;
      d.published[id] = tourContentSignature(remote);
      delete d.pending[id];
      const saved = await persist(d, g);
      return saved.ok ? { ok: false, error: 'conflict' } : saved;
    }
    if (!result.ok) return result;
    local.share = result.tour.share;
    delete d.pending[id];
    return persist(d, g);
  }),
  revoke: (id) => networkAction(async (g) => {
    const result = await revokeTour(id);
    if (!current(g))
      return { ok: false, error: 'account_changed' };
    if (!result.ok)
      return result;
    const d = data();
    const p = d.plans.find((p) => p.id === id);
    if (p)
      delete p.share;
    delete d.pending[id];
    return persist(d, g);
  }),
  restorePublished: () => networkAction(async (g) => {
    const result = await fetchPublishedTours();
    if (!current(g))
      return { ok: false, error: 'account_changed' };
    if (!result.ok)
      return result;
    const d = data();
    if (d.plans.length + result.tours.filter((p) => !d.plans.some((l) => l.id === p.id)).length > TOUR_LIMIT)
      return { ok: false, error: 'limit' };
    for (const remote of result.tours) {
      const local = d.plans.find((p) => p.id === remote.id);
      if (!local)
        putPlan(d, remote);
      else if (remote.revision > local.revision) {
        local.conflict = remote;
      }
      else
        local.share = remote.share;
      if (local && remote.publication)
        local.publication = remote.publication;
      d.published[remote.id] = tourContentSignature(remote);
    }
    return persist(d, g);
  }),
  importShared: (token, update = false) => networkAction(async (g) => {
    const result = await fetchSharedTour(token);
    if (!current(g))
      return { ok: false, error: 'account_changed' };
    if (!result.ok)
      return result;
    const d = data();
    const remote = result.tour;
    const existing = d.plans.find((p) => p.source?.tourId === remote.id);
    if (existing && (!update || existing.source!.revision >= remote.revision)) {
      // A rotated link still opens the same copy; future update checks use the valid link.
      if (existing.source!.token !== token) {
        existing.source!.token = token;
        const saved = await persist(d, g);
        if (!saved.ok) return saved;
      }
      return { ok: true, id: existing.id };
    }
    if (!existing && d.plans.length >= TOUR_LIMIT)
      return { ok: false, error: 'limit' };
    const copy = cloneTour(remote);
    copy.id = existing?.id ?? generateUuidV4();
    copy.revision = 0;
    delete copy.share;
    copy.source = { tourId: remote.id, revision: remote.revision, token };
    putPlan(d, copy);
    const saved = await persist(d, g);
    return saved.ok ? { ok: true, id: copy.id } : saved;
  }),
  chooseServerVersion: (id) => mutate((d) => {
    const local = d.plans.find((p) => p.id === id);
    if (!local?.conflict)
      return { ok: false, error: 'not_found' };
    putPlan(d, withLocalFields(local.conflict, local));
    d.published[id] = tourContentSignature(local.conflict);
    delete d.pending[id];
  }),
  publishPublic: (id) => networkAction(async (g) => {
    let d = data();
    const plan = d.plans.find((p) => p.id === id);
    if (!plan)
      return { ok: false, error: 'not_found' };
    // A past meetup is fine: the public copy has no date, and the day after the walk is when people publish.
    if (plan.source || plan.publicSource)
      return { ok: false, error: 'invalid' };
    let revision = plan.revision;
    // The public copy is frozen from the server plan, so that has to match this phone first.
    if (!revision || d.published[id] !== tourContentSignature(plan)) {
      const put = await publishTour(plan, generateUuidV4());
      if (!current(g))
        return { ok: false, error: 'account_changed' };
      if (!put.ok) {
        if (put.error === 'conflict' && put.tour) {
          d = data();
          d.plans.find((p) => p.id === id)!.conflict = put.tour;
          delete d.pending[id];
          const saved = await persist(d, g);
          if (!saved.ok)
            return saved;
        }
        return put;
      }
      d = data();
      const local = d.plans.find((p) => p.id === id)!;
      if (tourContentSignature(local) === tourContentSignature(plan))
        putPlan(d, withLocalFields(put.tour, local));
      else {
        local.revision = put.tour.revision;
        local.share = put.tour.share;
      }
      d.published[id] = tourContentSignature(put.tour);
      // A party-link publish stuck before its plan upload no longer needs that upload.
      if (d.pending[id]?.stage === 'plan')
        d.pending[id] = { ...d.pending[id], plan: cloneTour(local), stage: 'share' };
      const saved = await persist(d, g);
      if (!saved.ok)
        return saved;
      revision = put.tour.revision;
    }
    const result = await publishPublicTour(id, revision);
    if (!current(g))
      return { ok: false, error: 'account_changed' };
    if (!result.ok) {
      if (result.error === 'conflict' && result.tour) {
        d = data();
        d.plans.find((p) => p.id === id)!.conflict = result.tour;
        const saved = await persist(d, g);
        if (!saved.ok)
          return saved;
      }
      return result;
    }
    d = data();
    const local = d.plans.find((p) => p.id === id);
    if (local && result.tour.publication)
      local.publication = result.tour.publication;
    return persist(d, g);
  }),
  unpublishPublic: (id) => networkAction(async (g) => {
    const result = await unpublishPublicTour(id);
    if (!current(g))
      return { ok: false, error: 'account_changed' };
    if (!result.ok)
      return result;
    const d = data();
    const local = d.plans.find((p) => p.id === id);
    if (local?.publication?.status === 'active')
      local.publication.status = 'unpublished';
    return persist(d, g);
  }),
  savePublic: (token) => networkAction(async (g) => {
    const result = await fetchSharedTour(token);
    if (!current(g))
      return { ok: false, error: 'account_changed' };
    if (!result.ok)
      return result;
    if (!result.public)
      return { ok: false, error: 'invalid' };
    const d = data();
    const existing = d.plans.find((p) => p.publicSource?.publicId === result.public!.id);
    if (existing)
      return { ok: true, id: existing.id };
    if (d.plans.length >= TOUR_LIMIT)
      return { ok: false, error: 'limit' };
    // An own, editable plan: add a meetup, send it to the party, walk it.
    const copy = cloneTour(result.tour);
    copy.id = generateUuidV4();
    copy.revision = 0;
    copy.updatedAt = new Date().toISOString();
    delete copy.share;
    delete copy.publication;
    copy.publicSource = { publicId: result.public.id, token, pubIds: pubIdsOf(copy) };
    putPlan(d, copy);
    const saved = await persist(d, g);
    return saved.ok ? { ok: true, id: copy.id } : saved;
  }),
  reportPublic: (publicId) => networkAction(async (g) => {
    const result = await reportPublicTour(publicId);
    if (!current(g))
      return { ok: false, error: 'account_changed' };
    if (!result.ok)
      return result;
    const d = data();
    d.hiddenPublic = [...new Set([...(d.hiddenPublic ?? []), publicId])].slice(-500);
    return persist(d, g);
  }),
  copyLocalConflict: (id) => mutate((d) => {
    const local = d.plans.find((p) => p.id === id);
    if (!local?.conflict)
      return { ok: false, error: 'not_found' };
    if (d.plans.length >= TOUR_LIMIT)
      return { ok: false, error: 'limit' };
    const copy = cloneTour(local);
    copy.id = generateUuidV4();
    copy.revision = 0;
    delete copy.conflict;
    delete copy.share;
    delete copy.source;
    delete copy.publication;
    delete copy.publicSource;
    putPlan(d, local.conflict);
    putPlan(d, copy);
    delete d.pending[id];
    return { ok: true, id: copy.id };
  }),
}));
/**
 * Called while auth owns its session-transition lock; claim keeps the local run.
 * Tour storage must never block signing in: unreadable data stays for hydrate to
 * quarantine, and plans of an unknown owner are simply not adopted.
 */
export function adoptToursOwner(from: string | null, to: string): Promise<void> {
  return locked(async () => {
    const raw = await AsyncStorage.getItem(TOURS_STORAGE_KEY);
    if (!raw)
      return;
    let saved: unknown;
    try {
      saved = JSON.parse(raw);
    }
    catch {
      return;
    }
    if (!validateData(saved))
      return;
    if (saved.owner !== null && saved.owner !== from && saved.owner !== to && !saved.owner.startsWith('device:'))
      return;
    saved.owner = to;
    const result = await persist(saved, tourBoundary().generation, true);
    if (!result.ok)
      throw new Error('Tour owner persistence failed');
  });
}
/**
 * An evicted anonymous account leaves its plans on this phone. Hand them to the
 * device, the owner the next anonymous or signed-in account adopts.
 */
export function releaseToursToDevice(accountId: string): Promise<void> {
  return locked(async () => {
    try {
      const raw = await AsyncStorage.getItem(TOURS_STORAGE_KEY);
      if (!raw) return;
      const saved: unknown = JSON.parse(raw);
      if (!validateData(saved) || saved.owner !== accountId) return;
      saved.owner = `device:${await getOrCreateDeviceId()}`;
      await persist(saved, tourBoundary().generation, true);
    }
    catch {
      // Best effort: hydrate still refuses a foreign owner instead of leaking it.
    }
  });
}
export function clearToursPrivateData(): Promise<void> {
  invalidateTours();
  useToursStore.setState({ ...empty(), hydrated: false, error: null, busy: false });
  return locked(async () => {
    await AsyncStorage.multiRemove([TOURS_STORAGE_KEY, TOURS_QUARANTINE_KEY]);
  });
}
// Kept here for lifecycle consumers without coupling account.ts to the store.
export { beginTourAccountChange, endTourAccountChange };
