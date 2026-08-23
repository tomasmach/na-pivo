import React, { forwardRef, useImperativeHandle } from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { View } from 'react-native';

import { HistoricalBeerEntrySheet } from '../HistoricalBeerEntrySheet';
import { cs } from '@/i18n/cs';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
(globalThis as { requestAnimationFrame?: (callback: FrameRequestCallback) => number })
  .requestAnimationFrame = (callback) => setTimeout(callback, 0) as unknown as number;
(globalThis as { cancelAnimationFrame?: (handle: number) => void }).cancelAnimationFrame = (handle) =>
  clearTimeout(handle);

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@/components/shared/BottomSheetModal', () => ({
  BottomSheetModal: ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? children : null,
}));
jest.mock('@/components/shared/CloseButton', () => ({ CloseButton: () => null }));
jest.mock('@/components/shared/KeyboardAwareScrollView', () => ({
  KeyboardAwareScrollView: forwardRef(function MockScroll(
    { children }: { children?: React.ReactNode },
    ref,
  ) {
    useImperativeHandle(ref, () => ({ scrollTo: jest.fn() }));
    return <View>{children}</View>;
  }),
}));
jest.mock('@/components/shared/IconGlyph', () => ({
  BeerIcon: () => null,
  LockKeyholeIcon: () => null,
  PlusIcon: () => null,
  UsersIcon: () => null,
  XIcon: () => null,
}));
jest.mock('@/theme/fonts', () => ({
  FontScaleCap: { display: 1.1, heading: 1.2, body: 1.3 },
}));

let uuidSequence = 0;
jest.mock('@/data/account', () => ({
  generateUuidV4: () => `11111111-1111-4111-8111-${String(++uuidSequence).padStart(12, '0')}`,
}));

const enqueueBeerCheckInBatch = jest.fn(
  async (_operations?: { payload: Record<string, unknown> }[]) => 'queued',
);
let savedActionTicket: any = null;
let mockPrivateScopeCurrent = true;
jest.mock('@/data/beerCheckinsQueue', () => ({
  enqueueBeerCheckInBatch: (...args: unknown[]) => enqueueBeerCheckInBatch(...(args as [])),
  getOrCreateBeerCheckInActionTicket: async (key: string, create: () => unknown) => {
    if (savedActionTicket?.key === key) return savedActionTicket;
    savedActionTicket = create();
    return savedActionTicket;
  },
  loadBeerCheckInActionTicket: async (key: string) =>
    savedActionTicket?.key === key ? savedActionTicket : null,
  saveBeerCheckInActionTicket: async (ticket: unknown) => {
    savedActionTicket = ticket;
    return true;
  },
  removeBeerCheckInActionTicket: async (key: string) => {
    if (savedActionTicket?.key === key) savedActionTicket = null;
    return true;
  },
}));
jest.mock('@/data/privateAccountBoundary', () => ({
  PrivateAccountMutationFrozenError: class PrivateAccountMutationFrozenError extends Error {},
  isPrivateAccountMutationScopeCurrent: () => mockPrivateScopeCurrent,
  runPrivateAccountMutation: (
    task: (scope: { generation: number; signal: AbortSignal }) => Promise<unknown>,
  ) => task({ generation: 0, signal: new AbortController().signal }),
}));
jest.mock('@/data/beerSuggestionsClient', () => ({
  suggestBeerBrands: jest.fn(async () => []),
}));

const showToast = jest.fn();
jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));
jest.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (selector: (state: { priceCurrency: 'CZK' }) => unknown) =>
    selector({ priceCurrency: 'CZK' }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  uuidSequence = 0;
  savedActionTicket = null;
  mockPrivateScopeCurrent = true;
  enqueueBeerCheckInBatch.mockResolvedValue('queued');
});

async function fillRequiredFields(screen: ReturnType<typeof render>): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
  fireEvent.changeText(screen.getByPlaceholderText(cs.beerCheckins.beerPlaceholder), 'Radegast 12');
  fireEvent.changeText(screen.getByPlaceholderText(cs.myBeers.historicalPubPlaceholder), 'Lokál');
}

it('accepts only one multi-beer submit while storage is pending', async () => {
  let resolveWrite!: (result: 'queued') => void;
  enqueueBeerCheckInBatch.mockReturnValueOnce(new Promise((resolve) => {
    resolveWrite = resolve;
  }));
  const screen = render(
    <HistoricalBeerEntrySheet visible onClose={jest.fn()} onSaved={jest.fn()} />,
  );
  await fillRequiredFields(screen);

  const submit = screen.getByLabelText(cs.myBeers.historicalSubmit);
  fireEvent.press(submit);
  fireEvent.press(submit);

  await waitFor(() => expect(enqueueBeerCheckInBatch).toHaveBeenCalledTimes(1));
  await act(async () => resolveWrite('queued'));
});

it('hands every beer to one durable batch with stable drink and visit ids', async () => {
  const onSaved = jest.fn();
  const screen = render(
    <HistoricalBeerEntrySheet visible onClose={jest.fn()} onSaved={onSaved} />,
  );
  await fillRequiredFields(screen);
  fireEvent.press(screen.getByLabelText(cs.myBeers.historicalAddBeer));
  fireEvent.changeText(
    screen.getByPlaceholderText(cs.myBeers.historicalNextBeerPlaceholder),
    'Kozel 11',
  );

  fireEvent.press(screen.getByLabelText(cs.myBeers.historicalSubmit));
  await waitFor(() => expect(enqueueBeerCheckInBatch).toHaveBeenCalledTimes(1));

  const payloads = enqueueBeerCheckInBatch.mock.calls[0][0]!.map((operation) => operation.payload);
  expect(payloads).toHaveLength(2);
  expect(new Set(payloads.map((payload) => payload.visitClientId)).size).toBe(1);
  expect(new Set(payloads.map((payload) => payload.clientId)).size).toBe(2);
  expect(onSaved).toHaveBeenCalledWith(payloads);
});

it('retries an atomic storage failure with the same drink and visit ids', async () => {
  enqueueBeerCheckInBatch
    .mockResolvedValueOnce('storage-error')
    .mockResolvedValueOnce('queued');
  const screen = render(
    <HistoricalBeerEntrySheet visible onClose={jest.fn()} onSaved={jest.fn()} />,
  );
  await fillRequiredFields(screen);
  fireEvent.press(screen.getByLabelText(cs.myBeers.historicalAddBeer));
  fireEvent.changeText(
    screen.getByPlaceholderText(cs.myBeers.historicalNextBeerPlaceholder),
    'Kozel 11',
  );

  fireEvent.press(screen.getByLabelText(cs.myBeers.historicalSubmit));
  await waitFor(() => expect(enqueueBeerCheckInBatch).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByLabelText(cs.myBeers.historicalSubmit));
  await waitFor(() => expect(enqueueBeerCheckInBatch).toHaveBeenCalledTimes(2));

  const first = enqueueBeerCheckInBatch.mock.calls[0][0]!.map(({ payload }) => payload);
  const retry = enqueueBeerCheckInBatch.mock.calls[1][0]!.map(({ payload }) => payload);
  expect(retry.map((payload) => payload.clientId)).toEqual(
    first.map((payload) => payload.clientId),
  );
  expect(retry.map((payload) => payload.visitClientId)).toEqual(
    first.map((payload) => payload.visitClientId),
  );
});

it('keeps the form and stable ids when an account transition rejects the batch', async () => {
  let finishBatch!: (result: 'queued') => void;
  enqueueBeerCheckInBatch
    .mockReturnValueOnce(new Promise((resolve) => { finishBatch = resolve; }))
    .mockResolvedValueOnce('queued');
  const onClose = jest.fn();
  const onSaved = jest.fn();
  const screen = render(
    <HistoricalBeerEntrySheet visible onClose={onClose} onSaved={onSaved} />,
  );
  await fillRequiredFields(screen);

  const submit = screen.getByLabelText(cs.myBeers.historicalSubmit);
  fireEvent.press(submit);
  await waitFor(() => expect(enqueueBeerCheckInBatch).toHaveBeenCalledTimes(1));
  mockPrivateScopeCurrent = false;
  await act(async () => finishBatch('queued'));
  await waitFor(() => expect(showToast).toHaveBeenCalledWith(
    cs.myBeers.historicalSaveError,
    expect.any(Object),
  ));
  expect(onSaved).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('Radegast 12')).toBeTruthy();

  mockPrivateScopeCurrent = true;
  fireEvent.press(submit);
  await waitFor(() => expect(enqueueBeerCheckInBatch).toHaveBeenCalledTimes(2));
  const firstPayload = enqueueBeerCheckInBatch.mock.calls[0][0]![0].payload;
  const retryPayload = enqueueBeerCheckInBatch.mock.calls[1][0]![0].payload;
  expect(retryPayload.clientId).toBe(firstPayload.clientId);
  expect(retryPayload.visitClientId).toBe(firstPayload.visitClientId);
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('ignores an old batch after close and reopen without resetting the new form', async () => {
  let resolveOld!: (result: 'queued') => void;
  let resolveCurrent!: (result: 'queued') => void;
  enqueueBeerCheckInBatch
    .mockReturnValueOnce(new Promise((resolve) => { resolveOld = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { resolveCurrent = resolve; }));
  const onClose = jest.fn();
  const onSaved = jest.fn();
  const screen = render(
    <HistoricalBeerEntrySheet visible onClose={onClose} onSaved={onSaved} />,
  );
  await fillRequiredFields(screen);
  fireEvent.press(screen.getByLabelText(cs.myBeers.historicalSubmit));

  screen.rerender(
    <HistoricalBeerEntrySheet visible={false} onClose={onClose} onSaved={onSaved} />,
  );
  screen.rerender(
    <HistoricalBeerEntrySheet visible onClose={onClose} onSaved={onSaved} />,
  );
  await fillRequiredFields(screen);
  fireEvent.press(screen.getByLabelText(cs.myBeers.historicalSubmit));
  const uuidsAfterCurrentSubmit = uuidSequence;

  await act(async () => resolveOld('queued'));
  fireEvent.press(screen.getByLabelText(cs.myBeers.historicalSubmit));
  expect(enqueueBeerCheckInBatch).toHaveBeenCalledTimes(2);
  expect(uuidSequence).toBe(uuidsAfterCurrentSubmit);
  expect(onSaved).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();

  await act(async () => resolveCurrent('queued'));
  expect(onSaved).toHaveBeenCalledTimes(1);
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('keeps the historical sheet open when its check-in is not durably stored', async () => {
  enqueueBeerCheckInBatch.mockResolvedValueOnce('storage-error');
  const onClose = jest.fn();
  const onSaved = jest.fn();
  const screen = render(
    <HistoricalBeerEntrySheet visible onClose={onClose} onSaved={onSaved} />,
  );

  await fillRequiredFields(screen);
  fireEvent.press(screen.getByLabelText(cs.myBeers.historicalSubmit));

  await waitFor(() => expect(enqueueBeerCheckInBatch).toHaveBeenCalledTimes(1));
  expect(showToast).toHaveBeenCalledWith(cs.myBeers.historicalSaveError, expect.any(Object));
  expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('zapsan'), expect.anything());
  expect(onSaved).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('Radegast 12')).toBeTruthy();
});
