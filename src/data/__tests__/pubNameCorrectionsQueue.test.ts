import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueuePubNameCorrection,
  flushPubNameCorrectionsQueue,
  persistPubNameCorrection,
} from '../pubNameCorrectionsQueue';
import {
  submitPubNameCorrection,
  type PubNameCorrectionEntry,
} from '../pubNameCorrectionsClient';
import { clearPubsSnapshot } from '../pubs';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../pubNameCorrectionsClient', () => ({
  submitPubNameCorrection: jest.fn(async () => 'ok'),
}));

jest.mock('../pubs', () => ({
  clearPubsSnapshot: jest.fn(async () => undefined),
}));

const STORAGE_KEY = 'na-pivo-pub-name-corrections-queue';

const ENTRY_A: PubNameCorrectionEntry = {
  client_id: 'client-a',
  name: 'Hospoda U Testu',
  suggested_name: 'U Testu po novém',
  lat: 50.0812,
  lng: 14.4182,
  city: 'Praha',
  address: 'Testovací 12',
  external_id: 'mapy:50.08120,14.41820',
};

const ENTRY_B: PubNameCorrectionEntry = {
  client_id: 'client-b',
  name: 'Pivnice Za Rohem',
  suggested_name: 'Za Rohem',
  lat: 50.08121,
  lng: 14.41821,
};

async function readQueue(): Promise<PubNameCorrectionEntry[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('enqueuePubNameCorrection', () => {
  it('sends the correction and leaves the queue empty on success', async () => {
    await expect(enqueuePubNameCorrection(ENTRY_A)).resolves.toBe(true);

    expect(submitPubNameCorrection).toHaveBeenCalledWith(ENTRY_A, expect.any(AbortSignal));
    expect(clearPubsSnapshot).toHaveBeenCalled();
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps a failed correction queued instead of dropping it', async () => {
    (submitPubNameCorrection as jest.Mock).mockResolvedValue('retry');

    await expect(enqueuePubNameCorrection(ENTRY_A)).resolves.toBe(false);

    await expect(readQueue()).resolves.toEqual([ENTRY_A]);
  });

  it('drops a permanently rejected correction', async () => {
    (submitPubNameCorrection as jest.Mock).mockResolvedValue('permanent-error');

    await expect(enqueuePubNameCorrection(ENTRY_A)).resolves.toBe(true);

    expect(clearPubsSnapshot).not.toHaveBeenCalled();
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('dedupes a retry of the same client_id', async () => {
    (submitPubNameCorrection as jest.Mock).mockResolvedValue('retry');

    await enqueuePubNameCorrection(ENTRY_A);
    await enqueuePubNameCorrection({ ...ENTRY_A, suggested_name: 'Ještě novější' });
    await enqueuePubNameCorrection(ENTRY_B);

    const queue = await readQueue();
    expect(queue).toHaveLength(2);
    expect(queue.map((entry) => entry.client_id)).toEqual(['client-a', 'client-b']);
    expect(queue[0].suggested_name).toBe('Ještě novější');
  });

  it('rejects when storage fails so callers cannot mistake data loss for an offline queue', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

    await expect(enqueuePubNameCorrection(ENTRY_A)).rejects.toThrow();
    expect(submitPubNameCorrection).not.toHaveBeenCalled();
  });
});

describe('persistPubNameCorrection', () => {
  it('does not report a permanent server rejection as success', async () => {
    (submitPubNameCorrection as jest.Mock).mockResolvedValue('permanent-error');

    const queued = await persistPubNameCorrection(ENTRY_A);
    expect(queued.persisted).toBe(true);
    if (!queued.persisted) throw new Error('expected persisted correction');
    await expect(queued.sync).resolves.toBe('rejected');
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('reports a storage error before attempting delivery', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

    await expect(persistPubNameCorrection(ENTRY_A)).resolves.toEqual({ persisted: false });
    expect(submitPubNameCorrection).not.toHaveBeenCalled();
  });

  it('returns after storage and syncs the new correction before an old backlog', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([ENTRY_B]));
    let resolveSend!: (result: 'ok') => void;
    (submitPubNameCorrection as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );

    const queued = await persistPubNameCorrection(ENTRY_A);
    expect(queued.persisted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(submitPubNameCorrection).toHaveBeenCalledWith(ENTRY_A, expect.any(AbortSignal));

    resolveSend('ok');
    if (!queued.persisted) throw new Error('expected persisted correction');
    await expect(queued.sync).resolves.toBe('synced');
    await expect(readQueue()).resolves.toEqual([ENTRY_B]);
  });
});

describe('flushPubNameCorrectionsQueue', () => {
  it('re-sends queued corrections once the backend recovers and clears the queue', async () => {
    (submitPubNameCorrection as jest.Mock).mockResolvedValue('retry');
    await enqueuePubNameCorrection(ENTRY_A);
    await enqueuePubNameCorrection(ENTRY_B);
    expect(await readQueue()).toHaveLength(2);

    (submitPubNameCorrection as jest.Mock).mockResolvedValue('ok');
    await flushPubNameCorrectionsQueue();

    expect(submitPubNameCorrection).toHaveBeenCalledWith(ENTRY_A, expect.any(AbortSignal));
    expect(submitPubNameCorrection).toHaveBeenCalledWith(ENTRY_B, expect.any(AbortSignal));
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('survives corrupted storage contents', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushPubNameCorrectionsQueue()).resolves.toBeUndefined();
    expect(submitPubNameCorrection).not.toHaveBeenCalled();
  });
});
