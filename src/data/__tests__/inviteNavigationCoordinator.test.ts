import { createInviteNavigationCoordinator } from '../inviteNavigation';

/**
 * Pure seam for the invite confirmation navigation race.
 *
 * The coordinator owns one question only: given the stream of invite sources
 * (canonical explicit routes and a persisted cold-start restore), which
 * ownership decision applies now — none, push, or replace. It never touches
 * React, router or storage; callers translate decisions into navigation.
 */

const OLD = 'stale-old-code';
const NEW = 'fresh-new-code';
const OTHER = 'other-code';

describe('createInviteNavigationCoordinator', () => {
  it('pushes a restored stale code, then an explicit NEW wins via replace', () => {
    const nav = createInviteNavigationCoordinator();

    // Cold start: startup restores a stashed code before any explicit link.
    const lookup = nav.beginRestoreLookup();
    expect(nav.resolveRestoreLookup(lookup, OLD)).toEqual({ action: 'push', code: OLD });

    // The user then taps a real invite link while the stale confirmation is up:
    // the explicit code must take over the existing screen, never stack a
    // second confirmation push/modal.
    expect(nav.handleExplicitInviteCode(NEW)).toEqual({ action: 'replace', code: NEW });
  });

  it('is idempotent: repeating the same explicit code is a no-op', () => {
    const nav = createInviteNavigationCoordinator();
    expect(nav.handleExplicitInviteCode(NEW)).toEqual({ action: 'push', code: NEW });
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('none');
    expect(nav.handleExplicitInviteCode(NEW)).toEqual({ action: 'none', code: null });
  });

  it('promotes a restore-owned code when the same explicit code repeats', () => {
    const nav = createInviteNavigationCoordinator();
    const lookup = nav.beginRestoreLookup();
    expect(nav.resolveRestoreLookup(lookup, OLD)).toEqual({ action: 'push', code: OLD });

    // Same code arriving explicitly must not re-navigate…
    expect(nav.handleExplicitInviteCode(OLD).action).toBe('none');

    // …but ownership is now explicit, so another restore cannot take over.
    const lateRestore = nav.beginRestoreLookup();
    expect(nav.resolveRestoreLookup(lateRestore, OLD).action).toBe('none');
  });

  it('replaces with a different explicit code while the confirmation is owned', () => {
    const nav = createInviteNavigationCoordinator();
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('push');
    expect(nav.handleExplicitInviteCode(OTHER)).toEqual({ action: 'replace', code: OTHER });
    expect(nav.handleExplicitInviteCode(OLD)).toEqual({ action: 'replace', code: OLD });
  });

  it('a restored OLD is a no-op while an explicit OTHER owns the confirmation, never a replace', () => {
    const nav = createInviteNavigationCoordinator();
    expect(nav.handleExplicitInviteCode(OTHER).action).toBe('push');

    const lookup = nav.beginRestoreLookup();
    expect(nav.resolveRestoreLookup(lookup, OLD)).toEqual({ action: 'none', code: null });

    // And a second restore after a first one won cannot double-push either.
    const ownedByRestore = createInviteNavigationCoordinator();
    const first = ownedByRestore.beginRestoreLookup();
    expect(ownedByRestore.resolveRestoreLookup(first, OLD).action).toBe('push');
    const second = ownedByRestore.beginRestoreLookup();
    expect(ownedByRestore.resolveRestoreLookup(second, OLD).action).toBe('none');
  });

  it('a canonical route beats an older in-flight persisted restore', () => {
    const nav = createInviteNavigationCoordinator();
    const lateRestore = nav.beginRestoreLookup();
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('push');
    expect(nav.resolveRestoreLookup(lateRestore, OLD)).toEqual({ action: 'none', code: null });
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('none');
  });

  it.each([
    ['friend URL', (nav: ReturnType<typeof createInviteNavigationCoordinator>) =>
      nav.handleExplicitInviteCode(NEW)],
    ['party URL', (nav: ReturnType<typeof createInviteNavigationCoordinator>) =>
      nav.handleExplicitEntry('party:cold-url')],
    ['warm push', (nav: ReturnType<typeof createInviteNavigationCoordinator>) =>
      nav.handleExplicitEntry('notification:warm-push')],
  ])('drops an older async initial notification after a newer %s', (_label, applyNewer) => {
    const nav = createInviteNavigationCoordinator();
    const initialNotification = nav.beginExplicitLookup();

    applyNewer(nav);

    expect(
      nav.resolveExplicitEntry(initialNotification, 'notification:initial-push'),
    ).toBe(false);
  });

  it('lets the initial notification claim the launch when no newer explicit input arrived', () => {
    const nav = createInviteNavigationCoordinator();
    const initialNotification = nav.beginExplicitLookup();

    expect(
      nav.resolveExplicitEntry(initialNotification, 'notification:initial-push'),
    ).toBe(true);
    expect(nav.resolveRestoreLookup(nav.beginRestoreLookup(), OLD)).toEqual({
      action: 'none',
      code: null,
    });
  });

  it('invalidates a prepared warm notification when a newer invite URL arrives', () => {
    const nav = createInviteNavigationCoordinator();
    const prepared = nav.prepareExplicitEntry('notification:warm-a');

    expect(prepared?.isCurrent()).toBe(true);
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('push');

    expect(prepared?.isCurrent()).toBe(false);
    expect(prepared?.commit()).toBe(false);
  });

  it('does not suppress restore when a prepared warm notification is released', () => {
    const nav = createInviteNavigationCoordinator();
    const prepared = nav.prepareExplicitEntry('notification:warm-a');

    prepared?.release();

    expect(nav.resolveRestoreLookup(nav.beginRestoreLookup(), OLD)).toEqual({
      action: 'push',
      code: OLD,
    });
  });

  it('restores after cold A loses to prepared warm B and B then fails durably', () => {
    const nav = createInviteNavigationCoordinator();
    const coldTicket = nav.beginExplicitLookup();
    const coldA = nav.reserveExplicitEntry(coldTicket, 'notification:cold-a');
    const warmB = nav.prepareExplicitEntry('notification:warm-b');

    coldA?.release();
    expect(warmB?.isCurrent()).toBe(true);
    warmB?.release();

    expect(nav.resolveRestoreLookup(nav.beginRestoreLookup(), OLD)).toEqual({
      action: 'push',
      code: OLD,
    });
  });

  it('releases a failed durable reservation so startup restore can still win', () => {
    const nav = createInviteNavigationCoordinator();
    const notificationTicket = nav.beginExplicitLookup();
    const reservation = nav.reserveExplicitEntry(
      notificationTicket,
      'notification:initial-push',
    );

    expect(reservation?.isCurrent()).toBe(true);
    reservation?.release();

    const restore = nav.beginRestoreLookup();
    expect(nav.resolveRestoreLookup(restore, OLD)).toEqual({ action: 'push', code: OLD });
  });

  it('never releases over a newer explicit URL that invalidated the reservation', () => {
    const nav = createInviteNavigationCoordinator();
    const notificationTicket = nav.beginExplicitLookup();
    const reservation = nav.reserveExplicitEntry(
      notificationTicket,
      'notification:initial-push',
    );

    expect(nav.handleExplicitInviteCode(NEW).action).toBe('replace');
    expect(reservation?.isCurrent()).toBe(false);
    reservation?.release();

    expect(nav.resolveRestoreLookup(nav.beginRestoreLookup(), OLD).action).toBe('none');
  });

  it('after leaving the confirmation later invites enter via push again', () => {
    const nav = createInviteNavigationCoordinator();
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('push');

    nav.leaveConfirmation();

    expect(nav.handleExplicitInviteCode(OTHER)).toEqual({ action: 'push', code: OTHER });
  });

  it('keeps a launch restore suppressed after an explicit party intent is consumed and left', () => {
    const nav = createInviteNavigationCoordinator();

    nav.handleExplicitEntry('party:launch-intent');
    nav.leaveConfirmation();
    const lookup = nav.beginRestoreLookup();

    expect(nav.resolveRestoreLookup(lookup, OLD)).toEqual({ action: 'none', code: null });
  });

  it('keeps a launch restore suppressed after an explicit friend confirmation closes', () => {
    const nav = createInviteNavigationCoordinator();
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('push');

    nav.leaveConfirmation();
    const lookup = nav.beginRestoreLookup();

    expect(nav.resolveRestoreLookup(lookup, OLD)).toEqual({ action: 'none', code: null });
  });

  it('never navigates without any code', () => {
    const nav = createInviteNavigationCoordinator();
    expect(nav.handleExplicitInviteCode('')).toEqual({ action: 'none', code: null });
    expect(nav.handleExplicitInviteCode('   ').action).toBe('none');
    const restoreTicket = nav.beginRestoreLookup();
    expect(nav.resolveRestoreLookup(restoreTicket, '')).toEqual({ action: 'none', code: null });
  });
});
