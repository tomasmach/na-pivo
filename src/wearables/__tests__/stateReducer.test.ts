import type {
  WearableCommand,
  WearableCommandEnvelope,
  WearableDrinkSpec,
  WearablePubRef,
} from '../protocol';
import { applyWearableCommand, createWearableSyncState } from '../stateReducer';

const EPOCH = '83d78467-da0d-4bed-9d75-d99a5e50c63b';
const PUB_A: WearablePubRef = {
  pubKey: 'u2fkbn4f',
  name: 'U Zlatého tygra',
  latitude: 50.08706,
  longitude: 14.41786,
};
const PUB_B: WearablePubRef = {
  pubKey: 'u2fk8zzz',
  name: 'U Černého vola',
  latitude: 50.0898,
  longitude: 14.3966,
};

function uuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function drink(id: number, name = 'Pilsner Urquell 12°'): WearableDrinkSpec {
  return {
    id: uuid(id),
    name,
    drinkType: 'beer',
    volumeMl: 500,
    priceCzk: 68,
    servingType: 'draft',
    recordedAt: '2026-07-30T19:00:00+02:00',
  };
}

function command(
  message: number,
  actorSequence: number,
  body: WearableCommand,
  options: { actorId?: string; baseRevision?: number } = {},
): WearableCommandEnvelope {
  return {
    protocolVersion: 1,
    messageId: uuid(message),
    accountEpoch: EPOCH,
    actorId: options.actorId ?? 'watch-a',
    actorKind: 'watchos',
    actorSequence,
    baseRevision: options.baseRevision ?? 0,
    sentAt: '2026-07-30T19:00:00+02:00',
    kind: 'command',
    payload: { command: body },
  };
}

function start(message: number, sequence: number, eveningId: number, drinkId: number, pub = PUB_A) {
  return command(message, sequence, {
    type: 'start_evening_and_add_drink',
    eveningId: uuid(eveningId),
    pub,
    drinkingDayKey: '2026-07-30',
    drink: drink(drinkId),
  });
}

describe('applyWearableCommand', () => {
  it('makes message replay and drink UUID replay idempotent', () => {
    const initial = createWearableSyncState(EPOCH);
    const first = applyWearableCommand(initial, start(1, 1, 10, 100));
    const sameMessage = applyWearableCommand(first.state, start(1, 1, 10, 100));
    const sameDrink = applyWearableCommand(
      sameMessage.state,
      command(
        2,
        2,
        { type: 'add_drink', eveningId: uuid(10), drink: drink(100) },
        { baseRevision: first.state.revision },
      ),
    );

    expect(first.status).toBe('applied');
    expect(sameMessage.status).toBe('duplicate');
    expect(sameDrink.status).toBe('duplicate');
    expect(sameDrink.state.evenings[uuid(10)].drinks).toHaveLength(1);
  });

  it('uses a global remove-wins tombstone when remove arrives before add', () => {
    const initial = createWearableSyncState(EPOCH);
    const removed = applyWearableCommand(
      initial,
      command(
        1,
        1,
        {
          type: 'remove_drink',
          eveningId: uuid(10),
          drinkId: uuid(100),
          reason: 'undo',
        },
        { actorId: 'phone' },
      ),
    );
    const delayedStart = applyWearableCommand(
      removed.state,
      start(2, 1, 10, 100),
    );

    expect(removed.state.removedDrinkIds).toContain(uuid(100));
    expect(delayedStart.status).toBe('duplicate');
    expect(Object.keys(delayedStart.state.evenings)).toHaveLength(0);
  });

  it('aliases concurrent starts at the same pub on the same drinking day', () => {
    const first = applyWearableCommand(createWearableSyncState(EPOCH), start(1, 1, 10, 100));
    const second = applyWearableCommand(
      first.state,
      command(
        2,
        1,
        {
          type: 'start_evening_and_add_drink',
          eveningId: uuid(20),
          pub: PUB_A,
          drinkingDayKey: '2026-07-30',
          drink: drink(200, 'Kozel 11°'),
        },
        { actorId: 'watch-b', baseRevision: 0 },
      ),
    );

    expect(second.status).toBe('applied');
    expect(second.state.eveningAliases[uuid(20)]).toBe(uuid(10));
    expect(second.state.evenings[uuid(10)].drinks).toHaveLength(2);
    expect(second.state.evenings[uuid(20)]).toBeUndefined();
  });

  it('preserves different-pub evenings and raises an explicit conflict', () => {
    const first = applyWearableCommand(createWearableSyncState(EPOCH), start(1, 1, 10, 100));
    const second = applyWearableCommand(
      first.state,
      command(
        2,
        1,
        {
          type: 'start_evening_and_add_drink',
          eveningId: uuid(20),
          pub: PUB_B,
          drinkingDayKey: '2026-07-30',
          drink: drink(200),
        },
        { actorId: 'phone' },
      ),
    );

    expect(second.status).toBe('conflict');
    expect(Object.keys(second.state.evenings)).toHaveLength(2);
    expect(second.state.evenings[uuid(10)].drinks).toHaveLength(1);
    expect(second.state.evenings[uuid(20)].drinks).toHaveLength(1);
    expect(second.state.activeEveningId).toBe(uuid(10));
  });

  it('keeps a manual target over stale nearest and flags two stale manual targets', () => {
    const manualA = applyWearableCommand(
      createWearableSyncState(EPOCH),
      command(1, 1, {
        type: 'set_target',
        target: { selection: 'manual', pub: PUB_A },
      }),
    );
    const nearest = applyWearableCommand(
      manualA.state,
      command(
        2,
        1,
        { type: 'set_target', target: { selection: 'nearest', pub: PUB_B } },
        { actorId: 'phone', baseRevision: 0 },
      ),
    );
    const manualB = applyWearableCommand(
      nearest.state,
      command(
        3,
        1,
        { type: 'set_target', target: { selection: 'manual', pub: PUB_B } },
        { actorId: 'watch-b', baseRevision: 0 },
      ),
    );

    expect(nearest.status).toBe('duplicate');
    expect(nearest.state.target?.pub.pubKey).toBe(PUB_A.pubKey);
    expect(manualB.status).toBe('conflict');
    expect(manualB.state.target?.pub.pubKey).toBe(PUB_A.pubKey);
    expect(manualB.state.targetConflicts).toHaveLength(1);
  });

  it('preserves a late drink in a closed evening without reopening it', () => {
    const started = applyWearableCommand(createWearableSyncState(EPOCH), start(1, 1, 10, 100));
    const closed = applyWearableCommand(
      started.state,
      command(
        2,
        2,
        {
          type: 'close_evening',
          eveningId: uuid(10),
          closedAt: '2026-07-30T22:00:00+02:00',
        },
        { baseRevision: started.state.revision },
      ),
    );
    const late = applyWearableCommand(
      closed.state,
      command(
        3,
        1,
        { type: 'add_drink', eveningId: uuid(10), drink: drink(200) },
        { actorId: 'phone', baseRevision: started.state.revision },
      ),
    );

    expect(late.status).toBe('conflict');
    expect(late.state.evenings[uuid(10)].status).toBe('closed');
    expect(late.state.evenings[uuid(10)].drinks).toHaveLength(2);
    expect(late.state.activeEveningId).toBeNull();
  });

  it('defers a sequence gap and rejects commands from an old account epoch', () => {
    const initial = createWearableSyncState(EPOCH);
    const first = applyWearableCommand(initial, start(1, 1, 10, 100));
    const gap = applyWearableCommand(
      first.state,
      command(3, 3, { type: 'add_drink', eveningId: uuid(10), drink: drink(300) }),
    );
    const oldEpoch = {
      ...command(4, 2, { type: 'add_drink', eveningId: uuid(10), drink: drink(400) }),
      accountEpoch: uuid(999),
    };

    expect(gap.status).toBe('deferred');
    expect(applyWearableCommand(first.state, oldEpoch).status).toBe('rejected');
  });
});
