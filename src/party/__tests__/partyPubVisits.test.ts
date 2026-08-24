const mockEnqueueVisitOp = jest.fn(async () => undefined);
const mockFlushVisitsQueue = jest.fn(async () => undefined);
const mockResolveQueuedVisitPartyAssociation = jest.fn(async () => undefined);
let mockEveningState: {
  pendingJoinCode: string | null;
  confirmedJoinCode: string | null;
} = {
  pendingJoinCode: null,
  confirmedJoinCode: null,
};

jest.mock('@/data/visitsQueue', () => ({
  enqueueVisitOp: mockEnqueueVisitOp,
  flushVisitsQueue: mockFlushVisitsQueue,
  resolveQueuedVisitPartyAssociation: mockResolveQueuedVisitPartyAssociation,
}));

jest.mock('@/stores/partyEveningStore', () => ({
  selectConfirmedPartyJoinCode: (state: typeof mockEveningState) => state.confirmedJoinCode,
  usePartyEveningStore: {
    getState: () => mockEveningState,
  },
}));

// Mocks must be registered before the module under test captures its queue helpers.
// eslint-disable-next-line import/first
import {
  buildPartyPubVisitEntry,
  enqueuePartyPubTransition,
  enqueuePartyPubVisit,
} from '@/party/partyPubVisits';
// eslint-disable-next-line import/first
import type { PartyPubVisit } from '@/mocks/livePartyStore';

const first: PartyPubVisit = {
  clientId: 'f7799c00-4188-49f2-b586-bd695b94d817',
  pubKey: 'u2fkbn1x',
  pubName: 'Lokál',
  pubCity: 'Praha',
  pubExternalId: 'place-lokal',
  startedAt: '2026-08-06T18:00:00.000Z',
  endedAt: '2026-08-06T19:00:00.000Z',
};

const second: PartyPubVisit = {
  clientId: '156a3d6e-25d3-41bb-8468-e69b17f03822',
  pubKey: 'u2fkbn2y',
  pubName: 'U Pinkasů',
  startedAt: '2026-08-06T19:00:00.000Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockEveningState = { pendingJoinCode: null, confirmedJoinCode: null };
});

describe('party pub visits', () => {
  it('projects one stable local stop into the idempotent PubVisit wire shape', () => {
    expect(buildPartyPubVisitEntry(first, 'pivoxy')).toMatchObject({
      client_id: first.clientId,
      name: 'Lokál',
      city: 'Praha',
      external_id: 'place-lokal',
      started_at: first.startedAt,
      ended_at: first.endedAt,
      updated_at: first.endedAt,
      party_code: 'PIVOXY',
    });
    expect(buildPartyPubVisitEntry(first, 'PIVOXY')).toEqual(
      expect.objectContaining({ lat: expect.any(Number), lng: expect.any(Number) }),
    );
  });

  it('queues the closed and newly opened stop once, then flushes them together', async () => {
    await enqueuePartyPubTransition({ previous: first, current: second }, 'PIVOXY');

    expect(mockEnqueueVisitOp).toHaveBeenCalledTimes(2);
    expect(mockEnqueueVisitOp).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        op: 'upsert',
        clientId: first.clientId,
        entry: expect.objectContaining({ party_code: 'PIVOXY', ended_at: first.endedAt }),
      }),
      { deliver: false },
    );
    expect(mockEnqueueVisitOp).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        op: 'upsert',
        clientId: second.clientId,
        entry: expect.objectContaining({ party_code: 'PIVOXY', ended_at: null }),
      }),
      { deliver: false },
    );
    expect(mockFlushVisitsQueue).toHaveBeenCalledTimes(1);
    expect(mockResolveQueuedVisitPartyAssociation).not.toHaveBeenCalled();
  });

  it('holds a reserved table code until creation settles', async () => {
    mockEveningState = { pendingJoinCode: 'PIVOXY', confirmedJoinCode: null };

    await enqueuePartyPubVisit(second, 'PIVOXY', { deferDelivery: true });

    expect(mockFlushVisitsQueue).not.toHaveBeenCalled();
    expect(mockResolveQueuedVisitPartyAssociation).not.toHaveBeenCalled();
  });

  it('repairs a staged association when table creation won the race', async () => {
    mockEveningState = { pendingJoinCode: null, confirmedJoinCode: 'PIVOXY' };

    await enqueuePartyPubVisit(second, 'pivoxy', { deferDelivery: true });

    expect(mockFlushVisitsQueue).not.toHaveBeenCalled();
    expect(mockResolveQueuedVisitPartyAssociation).toHaveBeenCalledWith('PIVOXY', 'PIVOXY');
  });
});
