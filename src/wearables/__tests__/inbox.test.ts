import startFixture from '../../../wearables/shared/fixtures/start-evening-command.v1.json';

import {
  enqueueWearableCommand,
  processWearableInbox,
  type WearableInboxDriver,
} from '../inbox';
import type { WearableCommandEnvelope } from '../protocol';
import { createWearableSyncState, type WearableSyncState } from '../stateReducer';

const envelope = startFixture as WearableCommandEnvelope;

function memoryDriver(initialState: WearableSyncState) {
  let inbox: WearableCommandEnvelope[] = [];
  let persistedState = initialState;
  const acknowledgements: string[] = [];
  let failAck = false;

  const driver: WearableInboxDriver = {
    loadInbox: async () => inbox,
    saveInbox: async (items) => {
      inbox = structuredClone(items);
    },
    commitState: async (state) => {
      persistedState = structuredClone(state);
    },
    acknowledge: async (messageId) => {
      if (failAck) throw new Error('transport disconnected after commit');
      acknowledgements.push(messageId);
    },
  };
  return {
    driver,
    get inbox() {
      return inbox;
    },
    get state() {
      return persistedState;
    },
    acknowledgements,
    setFailAck(value: boolean) {
      failAck = value;
    },
  };
}

describe('wearable durable inbox orchestration', () => {
  it('persists before processing and deduplicates an inbox replay', async () => {
    const memory = memoryDriver(createWearableSyncState(envelope.accountEpoch));

    expect(await enqueueWearableCommand(memory.driver, envelope)).toEqual({
      accepted: true,
      duplicate: false,
    });
    expect(await enqueueWearableCommand(memory.driver, envelope)).toEqual({
      accepted: true,
      duplicate: true,
    });
    expect(memory.inbox).toHaveLength(1);

    const result = await processWearableInbox(memory.driver, memory.state);
    expect(result.pendingItems).toBe(0);
    expect(result.state.evenings[envelope.payload.command.type === 'start_evening_and_add_drink'
      ? envelope.payload.command.eveningId
      : '']).toBeDefined();
    expect(memory.acknowledgements).toEqual([envelope.messageId]);
    expect(memory.inbox).toEqual([]);
  });

  it('replays safely when persistence succeeds but acknowledgement is interrupted', async () => {
    const memory = memoryDriver(createWearableSyncState(envelope.accountEpoch));
    await enqueueWearableCommand(memory.driver, envelope);
    memory.setFailAck(true);

    await expect(processWearableInbox(memory.driver, memory.state)).rejects.toThrow(
      'transport disconnected',
    );
    expect(memory.inbox).toHaveLength(1);
    const persistedAfterCrash = memory.state;
    const eveningId =
      envelope.payload.command.type === 'start_evening_and_add_drink'
        ? envelope.payload.command.eveningId
        : '';
    expect(persistedAfterCrash.evenings[eveningId].drinks).toHaveLength(1);

    memory.setFailAck(false);
    const replay = await processWearableInbox(memory.driver, persistedAfterCrash);
    expect(replay.outcomes[0].status).toBe('duplicate');
    expect(replay.state.evenings[eveningId].drinks).toHaveLength(1);
    expect(memory.inbox).toEqual([]);
  });

  it('keeps a sequence-gap command durable until its predecessor arrives', async () => {
    const memory = memoryDriver(createWearableSyncState(envelope.accountEpoch));
    const first = structuredClone(envelope);
    const third = structuredClone(envelope);
    third.messageId = '00000000-0000-4000-8000-000000000003';
    third.actorSequence = 3;
    if (third.payload.command.type === 'start_evening_and_add_drink') {
      third.payload.command.drink.id = '00000000-0000-4000-8000-000000000300';
    }

    await enqueueWearableCommand(memory.driver, first);
    await enqueueWearableCommand(memory.driver, third);
    const result = await processWearableInbox(memory.driver, memory.state);

    expect(result.outcomes).toHaveLength(1);
    expect(result.pendingItems).toBe(1);
    expect(memory.inbox[0].actorSequence).toBe(3);
  });

  it('reduces out-of-order delivery in actor sequence order', async () => {
    const memory = memoryDriver(createWearableSyncState(envelope.accountEpoch));
    const first = structuredClone(envelope);
    const eveningId =
      first.payload.command.type === 'start_evening_and_add_drink'
        ? first.payload.command.eveningId
        : '';
    const second = structuredClone(envelope) as WearableCommandEnvelope;
    second.messageId = '00000000-0000-4000-8000-000000000002';
    second.actorSequence = 2;
    second.payload.command = {
      type: 'add_drink',
      eveningId,
      drink: {
        id: '00000000-0000-4000-8000-000000000200',
        name: 'Kozel 11°',
        drinkType: 'beer',
        volumeMl: 500,
        priceCzk: 58,
        servingType: 'draft',
        recordedAt: '2026-07-30T19:30:00+02:00',
      },
    };
    const third = structuredClone(second);
    third.messageId = '00000000-0000-4000-8000-000000000003';
    third.actorSequence = 3;
    if (third.payload.command.type === 'add_drink') {
      third.payload.command.drink = {
        ...third.payload.command.drink,
        id: '00000000-0000-4000-8000-000000000300',
        recordedAt: '2026-07-30T20:00:00+02:00',
      };
    }

    await enqueueWearableCommand(memory.driver, third);
    await enqueueWearableCommand(memory.driver, first);
    await enqueueWearableCommand(memory.driver, second);
    const result = await processWearableInbox(memory.driver, memory.state);

    expect(result.pendingItems).toBe(0);
    expect(result.state.evenings[eveningId].drinks.map((drink) => drink.id)).toEqual([
      first.payload.command.type === 'start_evening_and_add_drink'
        ? first.payload.command.drink.id
        : '',
      '00000000-0000-4000-8000-000000000200',
      '00000000-0000-4000-8000-000000000300',
    ]);
  });

  it('rejects malformed private fields before they reach the durable inbox', async () => {
    const memory = memoryDriver(createWearableSyncState(envelope.accountEpoch));
    const unsafe = { ...envelope, bearerToken: 'secret' };
    const result = await enqueueWearableCommand(memory.driver, unsafe);
    expect(result.accepted).toBe(false);
    expect(memory.inbox).toEqual([]);
  });
});
