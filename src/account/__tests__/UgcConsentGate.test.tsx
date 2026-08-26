import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import {
  CURRENT_UGC_POLICY_VERSION,
  clearUgcConsentStateForTests,
  notifyUgcConsentRequired,
} from '@/data/ugcConsent';
import { flushNightsQueue } from '@/data/nightsQueue';

import { UgcConsentGate } from '../UgcConsentGate';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const acceptUgcConsent = jest.fn(async () => ({ ok: true as const }));
const refreshProfile = jest.fn(async () => undefined);
const showToast = jest.fn();

interface FakeAccountState {
  session: { accountId: string } | null;
  profile: { ugcConsent?: { accepted: boolean } } | null;
  acceptUgcConsent: typeof acceptUgcConsent;
  refreshProfile: typeof refreshProfile;
}

let accountState: FakeAccountState;

jest.mock('@/stores/accountStore', () => ({
  useAccountStore: Object.assign(
    (selector: (state: FakeAccountState) => unknown) => selector(accountState),
    { getState: () => accountState },
  ),
}));

let firstLaunchSession = false;

jest.mock('@/stores/onboardingStore', () => ({
  useOnboardingStore: (selector: (state: { firstLaunchSession: boolean }) => unknown) =>
    selector({ firstLaunchSession }),
}));

jest.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (state: { show: typeof showToast }) => unknown) =>
    selector({ show: showToast }),
}));

jest.mock('@/account/UgcConsentSheet', () => ({
  UgcConsentSheet: (props: Record<string, unknown>) =>
    React.createElement('UgcConsentSheet', props),
}));

jest.mock('@/data/addedPubsQueue', () => ({ flushAddedPubsQueue: jest.fn(async () => undefined) }));
jest.mock('@/data/beerCheckinsQueue', () => ({
  flushBeerCheckinsQueue: jest.fn(async () => undefined),
}));
jest.mock('@/data/beerPhotosQueue', () => ({ flushBeerPhotosQueue: jest.fn(async () => undefined) }));
jest.mock('@/data/communityQueue', () => ({ flushCommunityQueue: jest.fn(async () => undefined) }));
jest.mock('@/data/friendsQueue', () => ({ flushFriendsQueue: jest.fn(async () => undefined) }));
jest.mock('@/data/nightsQueue', () => ({ flushNightsQueue: jest.fn(async () => undefined) }));
jest.mock('@/data/pubNameCorrectionsQueue', () => ({
  flushPubNameCorrectionsQueue: jest.fn(async () => undefined),
}));

function renderGate(): TestRenderer.ReactTestRenderer {
  let renderer!: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(UgcConsentGate));
  });
  return renderer;
}

function sheetProps(renderer: TestRenderer.ReactTestRenderer): {
  visible: boolean;
  busy: boolean;
  onAccept: () => void;
  onLater: () => void;
} {
  return renderer.root.findByType('UgcConsentSheet' as unknown as React.ComponentType)
    .props as never;
}

describe('UgcConsentGate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearUgcConsentStateForTests();
    firstLaunchSession = false;
    accountState = {
      session: { accountId: 'account-1' },
      profile: { ugcConsent: { accepted: true } },
      acceptUgcConsent,
      refreshProfile,
    };
  });

  it('opens on a 428 from a gated write', () => {
    const renderer = renderGate();
    expect(sheetProps(renderer).visible).toBe(false);

    act(() => notifyUgcConsentRequired('ugc_consent_required'));

    expect(sheetProps(renderer).visible).toBe(true);
  });

  it('accepts the current policy version, closes and flushes the held writes', async () => {
    const renderer = renderGate();
    act(() => notifyUgcConsentRequired('ugc_consent_required'));

    await act(async () => {
      sheetProps(renderer).onAccept();
    });

    expect(acceptUgcConsent).toHaveBeenCalledWith(CURRENT_UGC_POLICY_VERSION);
    expect(sheetProps(renderer).visible).toBe(false);
    expect(flushNightsQueue).toHaveBeenCalled();
  });

  it('opens by itself when the profile says consent is missing', () => {
    accountState.profile = { ugcConsent: { accepted: false } };
    const renderer = renderGate();

    expect(sheetProps(renderer).visible).toBe(true);
  });

  it('stays quiet over the welcome pager on the first launch', () => {
    firstLaunchSession = true;
    accountState.profile = { ugcConsent: { accepted: false } };
    const renderer = renderGate();

    expect(sheetProps(renderer).visible).toBe(false);
  });

  it('does not re-open right after "Teď ne"', () => {
    accountState.profile = { ugcConsent: { accepted: false } };
    const renderer = renderGate();
    expect(sheetProps(renderer).visible).toBe(true);

    act(() => sheetProps(renderer).onLater());
    expect(sheetProps(renderer).visible).toBe(false);
    expect(showToast).toHaveBeenCalled();

    act(() => notifyUgcConsentRequired('ugc_consent_required'));
    expect(sheetProps(renderer).visible).toBe(false);
  });

  it('keeps the sheet open and complains when accepting fails', async () => {
    acceptUgcConsent.mockResolvedValueOnce({
      ok: false,
      code: 'network_error',
      detail: '',
    } as never);
    const renderer = renderGate();
    act(() => notifyUgcConsentRequired('ugc_consent_required'));

    await act(async () => {
      sheetProps(renderer).onAccept();
    });

    expect(sheetProps(renderer).visible).toBe(true);
    expect(showToast).toHaveBeenCalled();
    expect(flushNightsQueue).not.toHaveBeenCalled();
  });
});
