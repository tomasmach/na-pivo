import { prepareDrinkAddition } from '../drinkAddition';

const enqueueDrink = jest.fn();
const removeQueuedDrink = jest.fn();
const syncVisit = jest.fn();

jest.mock('../drinksQueue', () => ({
  enqueueDrink: (...args: unknown[]) => enqueueDrink(...args),
  removeQueuedDrink: (...args: unknown[]) => removeQueuedDrink(...args),
}));
jest.mock('../visitsSync', () => ({
  syncVisit: (...args: unknown[]) => syncVisit(...args),
}));

const ENTRY = { client_id: 'drink-1' } as any;
const VISIT = { clientId: 'visit-1' } as any;

beforeEach(() => {
  jest.clearAllMocks();
  enqueueDrink.mockResolvedValue('queued');
  syncVisit.mockResolvedValue('queued');
  removeQueuedDrink.mockResolvedValue(true);
});

it('fails before visit persistence when the drink write is not durable', async () => {
  enqueueDrink.mockResolvedValue('storage-error');

  await expect(prepareDrinkAddition(ENTRY, VISIT)).resolves.toBe('storage-error');

  expect(syncVisit).not.toHaveBeenCalled();
});

it('retracts the drink when visit persistence fails, so no ghost can flush', async () => {
  syncVisit.mockResolvedValue('storage-error');

  await expect(prepareDrinkAddition(ENTRY, VISIT)).resolves.toBe('storage-error');

  expect(removeQueuedDrink).toHaveBeenCalledWith('drink-1');
});

it('persists both records without delivering before the caller commits UI', async () => {
  await expect(prepareDrinkAddition(ENTRY, VISIT, 'PIVOXY')).resolves.toBe('queued');

  expect(enqueueDrink).toHaveBeenCalledWith(ENTRY, { deliver: false });
  expect(syncVisit).toHaveBeenCalledWith(VISIT, undefined, 'PIVOXY', { deliver: false });
});
