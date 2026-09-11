import {
  UGC_POLICY_HEADER,
  CURRENT_UGC_POLICY_VERSION,
  parseUgcConsentSnapshot,
  rememberUgcConsent,
  ugcPolicyHeaders,
  subscribeUgcConsentRequired,
  notifyUgcConsentRequired,
  notifyUgcConsentRequiredFromResponse,
  clearUgcConsentStateForTests,
  holdUgcPublishing,
  isUgcConsentPending,
  ugcConsentStatus,
} from '../ugcConsent';

const VALID_WIRE = {
  policy_version: '2026-08-01',
  accepted: true,
  accepted_version: '2026-08-01',
  accepted_at: '2026-08-20T18:30:00Z',
};

const FRESH_ACCOUNT_WIRE = {
  policy_version: '2026-08-01',
  accepted: false,
  accepted_version: '',
  accepted_at: null,
};

describe('ugcConsent', () => {
  beforeEach(() => {
    clearUgcConsentStateForTests();
  });

  describe('UGC_POLICY_HEADER', () => {
    it('is the exact wire header name', () => {
      expect(UGC_POLICY_HEADER).toBe('X-Na-Pivo-UGC-Policy-Version');
    });
  });

  describe('CURRENT_UGC_POLICY_VERSION', () => {
    it('is the planned policy version baked into the client', () => {
      expect(CURRENT_UGC_POLICY_VERSION).toBe('2026-08-22');
    });
  });

  describe('parseUgcConsentSnapshot', () => {
    it('parses an exact valid wire object into camelCase', () => {
      expect(parseUgcConsentSnapshot(VALID_WIRE)).toEqual({
        policyVersion: '2026-08-01',
        accepted: true,
        acceptedVersion: '2026-08-01',
        acceptedAt: '2026-08-20T18:30:00Z',
      });
    });

    it('parses a valid fresh-account wire object (no consent yet)', () => {
      expect(parseUgcConsentSnapshot(FRESH_ACCOUNT_WIRE)).toEqual({
        policyVersion: '2026-08-01',
        accepted: false,
        acceptedVersion: '',
        acceptedAt: null,
      });
    });

    it('returns null for null/non-object input', () => {
      expect(parseUgcConsentSnapshot(null)).toBeNull();
      expect(parseUgcConsentSnapshot(undefined)).toBeNull();
      expect(parseUgcConsentSnapshot('nope')).toBeNull();
      expect(parseUgcConsentSnapshot(42)).toBeNull();
    });

    it('returns null when required fields are missing', () => {
      expect(parseUgcConsentSnapshot({})).toBeNull();
      expect(
        parseUgcConsentSnapshot({
          accepted: true,
          accepted_version: '2026-08-01',
          accepted_at: '2026-08-20T18:30:00Z',
        }),
      ).toBeNull();
    });

    it('returns null for malformed field values', () => {
      expect(parseUgcConsentSnapshot({ ...VALID_WIRE, policy_version: 123 })).toBeNull();
      expect(parseUgcConsentSnapshot({ ...VALID_WIRE, accepted: 'yes' })).toBeNull();
      expect(parseUgcConsentSnapshot({ ...VALID_WIRE, accepted_version: null })).toBeNull();
      expect(parseUgcConsentSnapshot({ ...VALID_WIRE, accepted_at: undefined })).toBeNull();
    });
  });

  describe('isUgcConsentPending', () => {
    it('is false for an account nothing is known about', () => {
      expect(isUgcConsentPending('account-1')).toBe(false);
    });

    it('is true once the server refused this account with a 428', () => {
      holdUgcPublishing('account-1');

      expect(isUgcConsentPending('account-1')).toBe(true);
      expect(isUgcConsentPending('account-2')).toBe(false);
    });

    it('is true when the last profile snapshot says the policy is not accepted', () => {
      rememberUgcConsent('account-1', parseUgcConsentSnapshot(FRESH_ACCOUNT_WIRE)!);

      expect(isUgcConsentPending('account-1')).toBe(true);
    });

    it('an accepted snapshot lifts a hold left by an earlier 428', () => {
      holdUgcPublishing('account-1');
      rememberUgcConsent('account-1', parseUgcConsentSnapshot(VALID_WIRE)!);

      expect(isUgcConsentPending('account-1')).toBe(false);
    });

    it('a non-accepted snapshot does not lift the hold', () => {
      holdUgcPublishing('account-1');
      rememberUgcConsent('account-1', parseUgcConsentSnapshot(FRESH_ACCOUNT_WIRE)!);

      expect(isUgcConsentPending('account-1')).toBe(true);
    });
  });

  describe('ugcConsentStatus', () => {
    const CURRENT_WIRE = {
      policy_version: CURRENT_UGC_POLICY_VERSION,
      accepted: true,
      accepted_version: CURRENT_UGC_POLICY_VERSION,
      accepted_at: '2026-09-11T20:00:00Z',
    };
    const STALE_REFUSAL_WIRE = {
      policy_version: CURRENT_UGC_POLICY_VERSION,
      accepted: false,
      accepted_version: '',
      accepted_at: null,
    };

    it('reports nothing known for an untouched account', () => {
      expect(ugcConsentStatus('account-1')).toEqual({ known: false, requiredCode: null });
    });

    it('keeps publishing open when a late profile answer contradicts an acceptance', () => {
      rememberUgcConsent('account-1', parseUgcConsentSnapshot(CURRENT_WIRE)!);
      // A /account/me that left before the acceptance finally answers.
      rememberUgcConsent('account-1', parseUgcConsentSnapshot(STALE_REFUSAL_WIRE)!);

      expect(ugcConsentStatus('account-1')).toEqual({ known: true, requiredCode: null });
      expect(isUgcConsentPending('account-1')).toBe(false);
    });

    it('ignores a 428 that crossed the acceptance in flight', () => {
      rememberUgcConsent('account-1', parseUgcConsentSnapshot(CURRENT_WIRE)!);
      holdUgcPublishing('account-1', 'ugc_consent_required');

      expect(isUgcConsentPending('account-1')).toBe(false);
    });

    it('still holds when the server asks for a newer policy than the accepted one', () => {
      rememberUgcConsent('account-1', parseUgcConsentSnapshot(CURRENT_WIRE)!);
      holdUgcPublishing('account-1', 'ugc_policy_update_required');

      expect(ugcConsentStatus('account-1')).toEqual({
        known: true,
        requiredCode: 'ugc_policy_update_required',
      });
    });

    it('locks again when a bumped policy arrives on the profile', () => {
      rememberUgcConsent('account-1', parseUgcConsentSnapshot(CURRENT_WIRE)!);
      rememberUgcConsent(
        'account-1',
        parseUgcConsentSnapshot({
          policy_version: '2026-12-01',
          accepted: false,
          accepted_version: CURRENT_UGC_POLICY_VERSION,
          accepted_at: '2026-09-11T20:00:00Z',
        })!,
      );

      expect(ugcConsentStatus('account-1')).toEqual({
        known: true,
        requiredCode: 'ugc_policy_update_required',
      });
      expect(ugcPolicyHeaders('account-1')).toEqual({ [UGC_POLICY_HEADER]: '2026-12-01' });
    });

    it('asks from scratch for an account that never accepted anything', () => {
      rememberUgcConsent('account-1', parseUgcConsentSnapshot(STALE_REFUSAL_WIRE)!);

      expect(ugcConsentStatus('account-1')).toEqual({
        known: true,
        requiredCode: 'ugc_consent_required',
      });
    });
  });

  describe('rememberUgcConsent + ugcPolicyHeaders', () => {
    it('returns the baked header for an unknown account', () => {
      rememberUgcConsent('account-1', parseUgcConsentSnapshot(VALID_WIRE)!);

      expect(ugcPolicyHeaders('account-2')).toEqual({
        [UGC_POLICY_HEADER]: CURRENT_UGC_POLICY_VERSION,
      });
    });

    it('returns the baked header when nothing was remembered', () => {
      expect(ugcPolicyHeaders('account-1')).toEqual({
        [UGC_POLICY_HEADER]: CURRENT_UGC_POLICY_VERSION,
      });
    });

    it('a remembered older policy version cannot downgrade below the baked one', () => {
      rememberUgcConsent(
        'account-1',
        parseUgcConsentSnapshot({ ...VALID_WIRE, policy_version: '2026-08-01' })!,
      );

      expect(ugcPolicyHeaders('account-1')).toEqual({
        [UGC_POLICY_HEADER]: CURRENT_UGC_POLICY_VERSION,
      });
    });

    it('a remembered newer policy version overrides the baked one, only for that account', () => {
      rememberUgcConsent(
        'account-1',
        parseUgcConsentSnapshot({ ...VALID_WIRE, policy_version: '2026-09-01' })!,
      );
      rememberUgcConsent(
        'account-2',
        parseUgcConsentSnapshot({ ...VALID_WIRE, policy_version: '2026-08-01' })!,
      );

      expect(ugcPolicyHeaders('account-1')).toEqual({
        [UGC_POLICY_HEADER]: '2026-09-01',
      });
      expect(ugcPolicyHeaders('account-2')).toEqual({
        [UGC_POLICY_HEADER]: CURRENT_UGC_POLICY_VERSION,
      });
    });

    it('clearing consent state returns accounts to the baked header', () => {
      rememberUgcConsent(
        'account-1',
        parseUgcConsentSnapshot({ ...VALID_WIRE, policy_version: '2026-09-01' })!,
      );
      clearUgcConsentStateForTests();

      expect(ugcPolicyHeaders('account-1')).toEqual({
        [UGC_POLICY_HEADER]: CURRENT_UGC_POLICY_VERSION,
      });
    });
  });

  describe('subscribeUgcConsentRequired / notifyUgcConsentRequired', () => {
    it('notifies listeners once per notify call for ugc_consent_required', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeUgcConsentRequired(listener);

      notifyUgcConsentRequired('ugc_consent_required');

      expect(listener).toHaveBeenCalledTimes(1);
      const call = listener.mock.calls[0];
      expect(call[0]).toMatchObject({ code: 'ugc_consent_required' });
      expect(call).toHaveLength(1);
      const payload = call[0];
      expect(Object.keys(payload).sort()).toEqual(['code', 'userInitiated']);
      // A background retry must stay marked as such — the sheet's quiet period
      // after "Teď ne" depends on it.
      expect(payload.userInitiated).toBe(false);

      unsubscribe();
    });

    it('marks a request the user just triggered', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeUgcConsentRequired(listener);

      notifyUgcConsentRequired('ugc_consent_required', { userInitiated: true });

      expect(listener.mock.calls[0][0]).toEqual({
        code: 'ugc_consent_required',
        userInitiated: true,
      });

      unsubscribe();
    });

    it('notifies listeners once per notify call for ugc_policy_update_required', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeUgcConsentRequired(listener);

      notifyUgcConsentRequired('ugc_policy_update_required');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({ code: 'ugc_policy_update_required' });

      unsubscribe();
    });

    it('ignores unknown codes', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeUgcConsentRequired(listener);

      notifyUgcConsentRequired('something_else' as never);

      expect(listener).not.toHaveBeenCalled();

      unsubscribe();
    });

    it('unsubscribe stops notifications', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeUgcConsentRequired(listener);

      unsubscribe();
      notifyUgcConsentRequired('ugc_consent_required');

      expect(listener).not.toHaveBeenCalled();
    });

    it('supports multiple listeners and notifies each once per call', () => {
      const first = jest.fn();
      const second = jest.fn();
      const unsubFirst = subscribeUgcConsentRequired(first);
      const unsubSecond = subscribeUgcConsentRequired(second);

      notifyUgcConsentRequired('ugc_policy_update_required');

      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);

      unsubFirst();
      unsubSecond();
    });
  });

  describe('notifyUgcConsentRequiredFromResponse', () => {
    it.each(['ugc_consent_required', 'ugc_policy_update_required'] as const)(
      'returns %s and notifies once for 428 with top-level code',
      (code) => {
        const listener = jest.fn();
        const unsubscribe = subscribeUgcConsentRequired(listener);

        expect(notifyUgcConsentRequiredFromResponse(428, { code, detail: 'detail' })).toBe(code);
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0][0]).toMatchObject({ code });

        unsubscribe();
      },
    );

    it('returns null and does not notify for 428 with unknown/malformed code', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeUgcConsentRequired(listener);

      expect(
        notifyUgcConsentRequiredFromResponse(428, { code: 'something_else' }),
      ).toBeNull();
      expect(notifyUgcConsentRequiredFromResponse(428, { detail: 'no code here' })).toBeNull();
      expect(notifyUgcConsentRequiredFromResponse(428, 'garbage')).toBeNull();
      expect(listener).not.toHaveBeenCalled();

      unsubscribe();
    });

    it('returns null and does not notify when the same semantic code arrives on non-428 status', () => {
      const listener = jest.fn();
      const unsubscribe = subscribeUgcConsentRequired(listener);

      for (const status of [200, 400, 401, 403, 500]) {
        expect(
          notifyUgcConsentRequiredFromResponse(status, { code: 'ugc_consent_required' }),
        ).toBeNull();
        expect(
          notifyUgcConsentRequiredFromResponse(status, {
            code: 'ugc_policy_update_required',
          }),
        ).toBeNull();
      }
      expect(listener).not.toHaveBeenCalled();

      unsubscribe();
    });
  });
});
