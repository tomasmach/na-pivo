import { enqueueDelete } from './deleteDrinksQueue';
import { flushDrinksQueue, removeQueuedDrink } from './drinksQueue';
import {
  PrivateAccountMutationFrozenError,
  isPrivateAccountMutationScopeCurrent,
  runPrivateAccountMutation,
  type PrivateAccountMutationScope,
} from './privateAccountBoundary';
import { flushUpdateDrinksQueue, removeQueuedDrinkUpdate } from './updateDrinksQueue';

export type PrepareDrinkDeletionResult =
  | 'local-create-removed'
  | 'delete-queued'
  | 'storage-error';

function assertCurrentAccount(scope: PrivateAccountMutationScope): void {
  if (!isPrivateAccountMutationScopeCurrent(scope)) {
    throw new PrivateAccountMutationFrozenError();
  }
}

/**
 * Make the delete durable before discarding a pending edit for the same drink.
 * A failed tombstone must leave that edit intact so retrying the visible row
 * still carries the user's latest value.
 */
export async function prepareDrinkDeletion(
  clientId: string,
): Promise<PrepareDrinkDeletionResult> {
  return runPrivateAccountMutation(async (scope) => {
    await flushUpdateDrinksQueue();
    assertCurrentAccount(scope);
    const pulledFromCreateQueue = await removeQueuedDrink(clientId);
    assertCurrentAccount(scope);
    if (!pulledFromCreateQueue) {
      await flushDrinksQueue();
      assertCurrentAccount(scope);
      if ((await enqueueDelete(clientId)) === 'storage-error') return 'storage-error';
      assertCurrentAccount(scope);
    }

    // The delete/create removal is durable now. Cleanup failure cannot invalidate
    // that intent, and must never escape as an unhandled boundary rejection.
    await removeQueuedDrinkUpdate(clientId).catch(() => false);
    assertCurrentAccount(scope);
    return pulledFromCreateQueue ? 'local-create-removed' : 'delete-queued';
  });
}
