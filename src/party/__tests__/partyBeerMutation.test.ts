import {
  closeAfterDurablePartyBeerMutation,
  createPartyBeerMutationGate,
} from '@/party/partyBeerMutation';

it('serializes one drink and reports a storage failure without claiming success', async () => {
  let resolve!: (result: 'storage-error') => void;
  const mutate = jest.fn(() => new Promise<'storage-error'>((done) => { resolve = done; }));
  const onFailure = jest.fn();
  const run = createPartyBeerMutationGate(onFailure);

  const first = run('drink-1', mutate);
  await expect(run('drink-1', mutate)).resolves.toBe(false);
  expect(mutate).toHaveBeenCalledTimes(1);
  resolve('storage-error');

  await expect(first).resolves.toBe(false);
  expect(onFailure).toHaveBeenCalledTimes(1);
});

it('contains an account-boundary rejection and allows a later retry', async () => {
  const onFailure = jest.fn();
  const run = createPartyBeerMutationGate(onFailure);

  await expect(
    run('drink-1', jest.fn(async () => { throw new Error('account transition'); })),
  ).resolves.toBe(false);
  await expect(
    run('drink-1', jest.fn(async () => 'updated' as const)),
  ).resolves.toBe(true);
  expect(onFailure).toHaveBeenCalledTimes(1);
});

it('closes an edit only after durable success', async () => {
  const close = jest.fn();
  const run = createPartyBeerMutationGate(jest.fn());

  await expect(closeAfterDurablePartyBeerMutation(
    run,
    'drink-1',
    async () => 'storage-error',
    close,
  )).resolves.toBe(false);
  expect(close).not.toHaveBeenCalled();

  await expect(closeAfterDurablePartyBeerMutation(
    run,
    'drink-1',
    async () => 'updated',
    close,
  )).resolves.toBe(true);
  expect(close).toHaveBeenCalledTimes(1);
});

it('does not let a late edit close a different form opened after cancel', async () => {
  let finishMutation!: (result: 'updated') => void;
  const mutate = jest.fn(() => new Promise<'updated'>((resolve) => {
    finishMutation = resolve;
  }));
  const close = jest.fn();
  const run = createPartyBeerMutationGate(jest.fn());
  let formGeneration = 4;
  const submittedGeneration = formGeneration;
  const closeWithGeneration = closeAfterDurablePartyBeerMutation as unknown as (
    gate: typeof run,
    drinkId: string,
    mutation: typeof mutate,
    onClose: typeof close,
    isCurrent: () => boolean,
  ) => Promise<boolean>;

  const saving = closeWithGeneration(
    run,
    'drink-a',
    mutate,
    close,
    () => formGeneration === submittedGeneration,
  );
  formGeneration += 1;
  finishMutation('updated');

  await expect(saving).resolves.toBe(true);
  expect(close).not.toHaveBeenCalled();
});
