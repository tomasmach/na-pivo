import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type WearableTransportStatus = {
  supported: boolean;
  paired: boolean;
  reachable: boolean;
  pendingCommands: number;
  lastReceivedAt: string | null;
  lastSentAt: string | null;
};

type NaPivoWearableBridgeNativeModule = {
  publishSnapshot?(envelopeJson: string): Promise<void>;
  getPendingCommands?(): Promise<string[]>;
  ackPendingCommands?(messageIds: string[]): Promise<void>;
  getTransportStatus?(): Promise<WearableTransportStatus>;
  requestSync?(): Promise<void>;
  addListener?(
    eventName: 'onWearableCommand',
    listener: () => void,
  ): { remove(): void };
};

const nativeModule =
  Platform.OS === 'android' || Platform.OS === 'ios'
    ? requireOptionalNativeModule<NaPivoWearableBridgeNativeModule>(
        'NaPivoWearableBridge',
      )
    : null;

const unsupportedStatus: WearableTransportStatus = {
  supported: false,
  paired: false,
  reachable: false,
  pendingCommands: 0,
  lastReceivedAt: null,
  lastSentAt: null,
};

/**
 * Sends the latest materialized phone state. Native transports coalesce this
 * snapshot, while user commands remain individually durable and idempotent.
 */
export async function publishSnapshot(envelopeJson: string): Promise<void> {
  await nativeModule?.publishSnapshot?.(envelopeJson);
}

/**
 * Reads command envelopes without deleting them. Callers acknowledge only
 * after the command and its existing backend queue entry are both durable.
 */
export async function getPendingCommands(): Promise<string[]> {
  return nativeModule?.getPendingCommands?.() ?? [];
}

export async function ackPendingCommands(messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  await nativeModule?.ackPendingCommands?.(messageIds);
}

export async function getTransportStatus(): Promise<WearableTransportStatus> {
  return nativeModule?.getTransportStatus?.() ?? unsupportedStatus;
}

export async function requestSync(): Promise<void> {
  await nativeModule?.requestSync?.();
}

/** Native delivery is only a wake-up; commands remain durable until acked. */
export function addWearableCommandListener(
  listener: () => void,
): { remove(): void } {
  return nativeModule?.addListener?.('onWearableCommand', listener) ?? {
    remove() {},
  };
}
