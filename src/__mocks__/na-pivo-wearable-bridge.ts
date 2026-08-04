export const publishSnapshot = jest.fn(async () => undefined);
export const clearWearableSnapshot = jest.fn(async () => undefined);
export const getPendingCommands = jest.fn(async () => [] as string[]);
export const getAcknowledgedActorSequences = jest.fn(async () => ({}));
export const ackPendingCommands = jest.fn(async () => undefined);
export const requestSync = jest.fn(async () => undefined);
export const getTransportStatus = jest.fn(async () => ({
  supported: false,
  paired: false,
  reachable: false,
  pendingCommands: 0,
  lastReceivedAt: null,
  lastSentAt: null,
}));
export const addWearableCommandListener = jest.fn(() => ({
  remove: jest.fn(),
}));
