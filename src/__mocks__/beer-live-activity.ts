type BeerLiveActivityStatus = {
  active: boolean;
  dismissed: boolean;
  sessionId: string | null;
  notificationsEnabled: boolean;
  liveUpdatesSupported: boolean;
  liveUpdatesAllowed: boolean;
  presentation: 'none';
};

const unsupportedStatus: BeerLiveActivityStatus = {
  active: false,
  dismissed: false,
  sessionId: null,
  notificationsEnabled: false,
  liveUpdatesSupported: false,
  liveUpdatesAllowed: false,
  presentation: 'none',
};

export async function startOrUpdate(): Promise<BeerLiveActivityStatus> {
  return unsupportedStatus;
}

export async function end(): Promise<BeerLiveActivityStatus> {
  return unsupportedStatus;
}

export async function getStatus(): Promise<BeerLiveActivityStatus> {
  return unsupportedStatus;
}

export async function getPendingAdds(): Promise<never[]> {
  return [];
}

export async function ackPendingAdds(): Promise<void> {}

export async function clearPendingAdds(): Promise<boolean> {
  return false;
}
