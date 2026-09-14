import {
  PrivateAccountMutationFrozenError,
  beginPrivateAccountTransition,
  resetPrivateAccountBoundaryForTests,
} from '@/data/privateAccountBoundary';
import { prepareDrinkDeletion } from '@/data/drinkDeletion';

const flushUpdateDrinksQueue: jest.Mock<Promise<void>, []> = jest.fn(
  async (): Promise<void> => undefined,
);
const removeQueuedDrinkUpdate = jest.fn(async () => true);
jest.mock('@/data/updateDrinksQueue', () => ({
  flushUpdateDrinksQueue: (...args: unknown[]) => flushUpdateDrinksQueue(...(args as [])),
  removeQueuedDrinkUpdate: (...args: unknown[]) => removeQueuedDrinkUpdate(...(args as [])),
}));

const flushDrinksQueue: jest.Mock<Promise<void>, []> = jest.fn(
  async (): Promise<void> => undefined,
);
const removeQueuedDrink = jest.fn(async () => true);
jest.mock('@/data/drinksQueue', () => ({
  flushDrinksQueue: (...args: unknown[]) => flushDrinksQueue(...(args as [])),
  removeQueuedDrink: (...args: unknown[]) => removeQueuedDrink(...(args as [])),
}));

const enqueueDelete = jest.fn(async () => 'queued');
jest.mock('@/data/deleteDrinksQueue', () => ({
  enqueueDelete: (...args: unknown[]) => enqueueDelete(...(args as [])),
}));

beforeEach(() => {
  jest.clearAllMocks();
  resetPrivateAccountBoundaryForTests();
});

afterEach(() => {
  resetPrivateAccountBoundaryForTests();
});

it('holds one account lease and stops before removing A intents during an A to B transition', async () => {
  let finishFirstStep!: () => void;
  let firstStepStarted!: () => void;
  const started = new Promise<void>((resolve) => { firstStepStarted = resolve; });
  flushUpdateDrinksQueue.mockReturnValueOnce(new Promise<void>((resolve) => {
    finishFirstStep = resolve;
    firstStepStarted();
  }));

  const deletion = prepareDrinkDeletion('11111111-1111-4111-8111-111111111111');
  const outcome = deletion.then(
    (value) => ({ status: 'resolved' as const, value }),
    (error: unknown) => ({ status: 'rejected' as const, error }),
  );
  await started;

  const transition = beginPrivateAccountTransition('account-switch', 'A');
  expect(transition).not.toBeNull();
  let drained = false;
  const drain = transition!.drain().then(() => { drained = true; });
  await Promise.resolve();
  expect(drained).toBe(false);

  finishFirstStep();
  await drain;
  transition!.release();

  expect(await outcome).toEqual({
    status: 'rejected',
    error: expect.any(PrivateAccountMutationFrozenError),
  });
  expect(removeQueuedDrink).not.toHaveBeenCalled();
  expect(flushDrinksQueue).not.toHaveBeenCalled();
  expect(enqueueDelete).not.toHaveBeenCalled();
  expect(removeQueuedDrinkUpdate).not.toHaveBeenCalled();
});
