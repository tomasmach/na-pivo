import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueuePubReport, flushPubReportQueue, persistPubReport } from '../pubReportQueue';
import { reportPubIssue } from '../pubReportsClient';
import type { Pub } from '../pubs';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../pubReportsClient', () => ({
  reportPubIssue: jest.fn(async () => true),
}));

const STORAGE_KEY = 'na-pivo-pub-report-queue';

const PUB: Pub = {
  id: 'mapy:50.08120,14.41820',
  name: 'Palačinkárna U Testu',
  lat: 50.0812,
  lng: 14.4182,
  city: 'Praha',
  address: 'Testovací 12',
};

const OTHER: Pub = {
  id: 'mapy:49.19510,16.60680',
  name: 'Starobrno pivnice',
  lat: 49.1951,
  lng: 16.6068,
};

async function readQueue(): Promise<unknown[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('enqueuePubReport', () => {
  it('sends the report and leaves the queue empty on success', async () => {
    await expect(enqueuePubReport(PUB, 'closed')).resolves.toBe(true);

    expect(reportPubIssue).toHaveBeenCalledWith(PUB, 'closed', expect.any(AbortSignal));
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps a failed report queued instead of dropping it', async () => {
    (reportPubIssue as jest.Mock).mockResolvedValue(false);

    await expect(enqueuePubReport(PUB, 'closed')).resolves.toBe(false);

    await expect(readQueue()).resolves.toEqual([{ pub: PUB, reason: 'closed' }]);
  });

  it('dedupes re-reports of the same pub and reason', async () => {
    (reportPubIssue as jest.Mock).mockResolvedValue(false);

    await enqueuePubReport(PUB, 'closed');
    await enqueuePubReport(PUB, 'closed');
    await enqueuePubReport(PUB, 'not_pub');

    const queue = await readQueue();
    expect(queue).toHaveLength(2);
  });
});

describe('persistPubReport', () => {
  it('returns after durable storage without waiting for the network send', async () => {
    let resolveSend!: (sent: boolean) => void;
    (reportPubIssue as jest.Mock).mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        resolveSend = resolve;
      }),
    );

    await expect(persistPubReport(PUB, 'closed')).resolves.toBe(true);
    await expect(readQueue()).resolves.toEqual([{ pub: PUB, reason: 'closed' }]);

    resolveSend(true);
    await flushPubReportQueue();
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('does not claim persistence when storage rejects the write', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));

    await expect(persistPubReport(PUB, 'closed')).resolves.toBe(false);
    expect(reportPubIssue).not.toHaveBeenCalled();
  });
});

describe('flushPubReportQueue', () => {
  it('re-sends queued reports once the backend recovers and clears the queue', async () => {
    (reportPubIssue as jest.Mock).mockResolvedValue(false);
    await enqueuePubReport(PUB, 'closed');
    await enqueuePubReport(OTHER, 'not_pub');
    expect(await readQueue()).toHaveLength(2);

    (reportPubIssue as jest.Mock).mockResolvedValue(true);
    await flushPubReportQueue();

    expect(reportPubIssue).toHaveBeenCalledWith(PUB, 'closed', expect.any(AbortSignal));
    expect(reportPubIssue).toHaveBeenCalledWith(OTHER, 'not_pub', expect.any(AbortSignal));
    await expect(readQueue()).resolves.toEqual([]);
  });

  it('keeps only the reports that failed again', async () => {
    (reportPubIssue as jest.Mock).mockResolvedValue(false);
    await enqueuePubReport(PUB, 'closed');
    await enqueuePubReport(OTHER, 'not_pub');

    (reportPubIssue as jest.Mock).mockImplementation(
      async (pub: Pub) => pub.id === PUB.id,
    );
    await flushPubReportQueue();

    await expect(readQueue()).resolves.toEqual([{ pub: OTHER, reason: 'not_pub' }]);
  });

  it('does nothing on an empty queue', async () => {
    await flushPubReportQueue();
    expect(reportPubIssue).not.toHaveBeenCalled();
  });

  it('survives corrupted storage contents', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{not json');
    await expect(flushPubReportQueue()).resolves.toBeUndefined();
    expect(reportPubIssue).not.toHaveBeenCalled();
  });
});
