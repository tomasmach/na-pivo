/**
 * Global owner of the UGC-consent sheet.
 *
 * Two triggers, one sheet:
 *
 *   reactive   any gated write answered 428 — `ugcConsent` publishes it on the
 *              event bus and this opens the sheet. Never stacks, and after
 *              "Teď ne" it stays out of the way for a minute so a queue flush
 *              retrying in the background cannot re-open it in the user's face.
 *   proactive  the profile loaded with `ugcConsent.accepted === false`, so the
 *              first publish would fail anyway. Once per account.
 *
 * Anonymous device accounts are included on purpose: they hold a server-issued
 * bearer token, so `PUT /v1/account/me/ugc-consent` authenticates for them
 * exactly like it does for a durable account.
 *
 * Accepting flushes the queues that hold gated writes, so the večer / fotka /
 * komentář the user was actually trying to publish goes out right away instead
 * of waiting for the next foreground.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { UgcConsentSheet } from '@/account/UgcConsentSheet';
import { flushAddedPubsQueue } from '@/data/addedPubsQueue';
import { flushBeerCheckinsQueue } from '@/data/beerCheckinsQueue';
import { flushBeerPhotosQueue } from '@/data/beerPhotosQueue';
import { flushCommunityQueue } from '@/data/communityQueue';
import { flushFriendsQueue } from '@/data/friendsQueue';
import { flushNightsQueue } from '@/data/nightsQueue';
import { flushPubNameCorrectionsQueue } from '@/data/pubNameCorrectionsQueue';
import {
  CURRENT_UGC_POLICY_VERSION,
  UGC_POLICY_HEADER,
  subscribeUgcConsentRequired,
  ugcPolicyHeaders,
} from '@/data/ugcConsent';
import { cs } from '@/i18n/cs';
import { useAccountStore } from '@/stores/accountStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { useToastStore } from '@/stores/toastStore';

/** After "Teď ne", a background retry must not re-open the sheet immediately. */
const REOPEN_COOLDOWN_MS = 60_000;

/** The version the server currently wants, as learned from the last snapshot. */
function policyVersionFor(accountId: string | null): string {
  if (!accountId) return CURRENT_UGC_POLICY_VERSION;
  return ugcPolicyHeaders(accountId)[UGC_POLICY_HEADER] ?? CURRENT_UGC_POLICY_VERSION;
}

/** Re-send everything the server was holding back for missing consent. */
function flushGatedQueues(): void {
  void flushBeerCheckinsQueue();
  void flushBeerPhotosQueue();
  void flushNightsQueue();
  void flushCommunityQueue();
  void flushFriendsQueue();
  void flushAddedPubsQueue();
  void flushPubNameCorrectionsQueue();
}

export function UgcConsentGate() {
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const visibleRef = useRef(false);
  const busyRef = useRef(false);
  const closedAtRef = useRef(0);
  const proactiveAccountRef = useRef<string | null>(null);

  const showToast = useToastStore((s) => s.show);
  const accountId = useAccountStore((s) => s.session?.accountId ?? null);
  const consentAccepted = useAccountStore((s) => s.profile?.ugcConsent?.accepted);
  // The welcome pager owns the first launch. Asking about publishing rules over
  // it is noise for someone who has not published anything yet — the reactive
  // trigger still catches their first real attempt.
  const firstLaunchSession = useOnboardingStore((s) => s.firstLaunchSession);

  const open = useCallback((): boolean => {
    if (visibleRef.current) return false;
    if (Date.now() - closedAtRef.current < REOPEN_COOLDOWN_MS) return false;
    visibleRef.current = true;
    setVisible(true);
    return true;
  }, []);

  const close = useCallback(() => {
    visibleRef.current = false;
    closedAtRef.current = Date.now();
    setVisible(false);
  }, []);

  useEffect(() => subscribeUgcConsentRequired(() => void open()), [open]);

  useEffect(() => {
    if (consentAccepted !== false || !accountId || firstLaunchSession) return;
    if (proactiveAccountRef.current === accountId) return;
    if (open()) proactiveAccountRef.current = accountId;
  }, [accountId, consentAccepted, firstLaunchSession, open]);

  const handleLater = useCallback(() => {
    if (busyRef.current) return;
    close();
    showToast(cs.ugcConsent.laterHint);
  }, [close, showToast]);

  const handleAccept = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);

    void (async () => {
      const store = useAccountStore.getState();
      const version = policyVersionFor(accountId);
      let result = await store.acceptUgcConsent(version);
      // A stale version means our constant is behind the server's. The profile
      // snapshot carries the deployed version, so re-read it and try once more.
      if (!result.ok && result.code === 'ugc_policy_update_required') {
        await store.refreshProfile();
        const learned = policyVersionFor(useAccountStore.getState().session?.accountId ?? null);
        if (learned !== version) result = await store.acceptUgcConsent(learned);
      }

      busyRef.current = false;
      setBusy(false);

      if (!result.ok) {
        showToast(cs.ugcConsent.error);
        return;
      }
      // Not `close()`: accepting is not a dismissal, so it must not arm the
      // cooldown — a later policy bump should be able to ask straight away.
      visibleRef.current = false;
      setVisible(false);
      flushGatedQueues();
    })();
  }, [accountId, showToast]);

  return (
    <UgcConsentSheet
      visible={visible}
      busy={busy}
      onAccept={handleAccept}
      onLater={handleLater}
    />
  );
}
