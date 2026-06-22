import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueueDrinkUpdate, flushUpdateDrinksQueue } from '../updateDrinksQueue';
import { updateDrinkName } from '../drinksClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../drinksClient', () => ({
  ...jest.requireActual('../drinksClient'),
  updateDrinkName: jest.fn(async () => 'ok'),
}));

const STORAGE_KEY = 'na-pivo-update-drinks-queue';

async function readQueue() {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

beforeEach(async () => {
  jest.clearAllMocks();
  (updateDrinkName as jest.Mock).mockResolvedValue('ok');
  await AsyncStorage.clear();
});

describe('enqueueDrinkUpdate', () => {
  it('sends the update and drops it from the queue on success', async () => {
    await enqueueDrinkUpdate({ client_id: 'a', beer_name: 'Kozel' });
    expect(updateDrinkName).toHaveBeenCalledWith('a', 'Kozel');
    expect(await readQueue()).toEqual([]);
  });

  it('keeps the latest name queued when the update must retry', async () => {
    (updateDrinkName as jest.Mock).mockResolvedValue('retry');
    await enqueueDrinkUpdate({ client_id: 'a', beer_name: 'Plzen' });
    await enqueueDrinkUpdate({ client_id: 'a', beer_name: 'Plzeň' });
    expect(await readQueue()).toEqual([{ client_id: 'a', beer_name: 'Plzeň' }]);
  });

  it('drops a permanently-rejected update from the queue', async () => {
    (updateDrinkName as jest.Mock).mockResolvedValue('permanent-error');
    await enqueueDrinkUpdate({ client_id: 'a', beer_name: 'Kozel' });
    expect(await readQueue()).toEqual([]);
  });
});

describe('flushUpdateDrinksQueue', () => {
  it('retries queued updates and keeps only retryable failures', async () => {
    (updateDrinkName as jest.Mock).mockResolvedValue('retry');
    await enqueueDrinkUpdate({ client_id: 'a', beer_name: 'Kozel' });
    await enqueueDrinkUpdate({ client_id: 'b', beer_name: 'Plzeň' });

    (updateDrinkName as jest.Mock).mockImplementation(async (clientId: string) =>
      clientId === 'a' ? 'ok' : 'retry',
    );
    await flushUpdateDrinksQueue();

    expect(await readQueue()).toEqual([{ client_id: 'b', beer_name: 'Plzeň' }]);
  });

  it('is a no-op on an empty queue', async () => {
    await flushUpdateDrinksQueue();
    expect(updateDrinkName).not.toHaveBeenCalled();
  });
});
