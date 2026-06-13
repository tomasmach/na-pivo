import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueueDelete, flushDeleteDrinksQueue } from '../deleteDrinksQueue';
import { deleteDrink } from '../drinksClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// drinksClient → account → expo-secure-store; mock so requireActual loads.
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../drinksClient', () => ({
  ...jest.requireActual('../drinksClient'),
  deleteDrink: jest.fn(async () => 'ok'),
}));

const STORAGE_KEY = 'na-pivo-delete-drinks-queue';

async function readQueue(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  (deleteDrink as jest.Mock).mockResolvedValue('ok');
  await AsyncStorage.clear();
});

describe('enqueueDelete', () => {
  it('sends the deletion and drops it from the queue on success', async () => {
    await enqueueDelete('a');
    expect(deleteDrink).toHaveBeenCalledWith('a');
    expect(await readQueue()).toEqual([]);
  });

  it('keeps the id queued when the deletion must retry', async () => {
    (deleteDrink as jest.Mock).mockResolvedValue('retry');
    await enqueueDelete('a');
    expect(await readQueue()).toEqual(['a']);
  });

  it('drops a permanently-rejected deletion from the queue', async () => {
    (deleteDrink as jest.Mock).mockResolvedValue('permanent-error');
    await enqueueDelete('a');
    expect(await readQueue()).toEqual([]);
  });

  it('dedupes the same client_id (no double queueing)', async () => {
    (deleteDrink as jest.Mock).mockResolvedValue('retry');
    await enqueueDelete('a');
    await enqueueDelete('a');
    expect(await readQueue()).toEqual(['a']);
  });
});

describe('flushDeleteDrinksQueue', () => {
  it('retries every queued deletion and removes the ones that succeed', async () => {
    (deleteDrink as jest.Mock).mockResolvedValue('retry');
    await enqueueDelete('a');
    await enqueueDelete('b');
    expect(await readQueue()).toEqual(['a', 'b']);

    // Now the backend is reachable again → both delete and the queue empties.
    (deleteDrink as jest.Mock).mockResolvedValue('ok');
    await flushDeleteDrinksQueue();
    expect(await readQueue()).toEqual([]);
  });

  it('is a no-op on an empty queue and never throws', async () => {
    await expect(flushDeleteDrinksQueue()).resolves.toBeUndefined();
    expect(deleteDrink).not.toHaveBeenCalled();
  });
});
