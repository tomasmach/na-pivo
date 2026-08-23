import { createInviteNavigationCoordinator } from '../inviteNavigation';

/**
 * Pure seam for the invite confirmation navigation race.
 *
 * The coordinator owns one question only: given the stream of invite sources
 * (warm explicit URLs, a delayed async initial URL — itself explicit — and a
 * persisted cold-start restore), which navigation does the app perform now —
 * none, push, or replace. It never touches React, router, Linking or storage;
 * callers translate decisions into navigation.
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

  it('a delayed initial URL that stays newest navigates like an explicit event', () => {
    const nav = createInviteNavigationCoordinator();

    // getInitialURL is issued at launch; its ticket exists before the await…
    const ticket = nav.beginExplicitLookup();
    // …and nothing newer landed while it was in flight, so it acts explicitly.
    expect(nav.resolveExplicitLookup(ticket, NEW)).toEqual({ action: 'push', code: NEW });
  });

  it('an in-flight initial URL keeps explicit priority even when a restore resolves first', () => {
    const nav = createInviteNavigationCoordinator();

    // Cold start issues getInitialURL…
    const initial = nav.beginExplicitLookup();
    // …and account initialization starts its persisted-restore lookup too.
    const restore = nav.beginRestoreLookup();

    // The restore physically lands FIRST with the stashed code…
    expect(nav.resolveRestoreLookup(restore, OLD)).toEqual({ action: 'push', code: OLD });

    // …but the initial URL is the OLDER explicit request: it must take over
    // the confirmation via replace, not be swallowed by the restore.
    expect(nav.resolveExplicitLookup(initial, NEW)).toEqual({ action: 'replace', code: NEW });
    // And once replaced, the explicit owner is idempotent on its own code.
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('none');
  });

  it('a newer warm explicit beats an older delayed initial explicit result', () => {
    const nav = createInviteNavigationCoordinator();

    // getInitialURL is issued at launch…
    const lateLookup = nav.beginExplicitLookup();
    // …but the user taps a fresh invite link before it resolves.
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('push');

    // The late async result carries an older sequence than the warm event:
    // it must not overwrite the newer explicit URL (no replace, no second push).
    expect(nav.resolveExplicitLookup(lateLookup, OLD)).toEqual({ action: 'none', code: null });

    // The explicit owner survives: repeating its code stays a no-op.
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('none');
  });

  it('a newer explicit code wins over an older explicit async result', () => {
    const nav = createInviteNavigationCoordinator();

    const older = nav.beginExplicitLookup();
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('push');
    const newer = nav.beginExplicitLookup();
    expect(nav.handleExplicitInviteCode(OTHER).action).toBe('replace');

    // Both lookups predate the latest explicit event; neither may win.
    expect(nav.resolveExplicitLookup(newer, OLD).action).toBe('none');
    expect(nav.resolveExplicitLookup(older, NEW).action).toBe('none');
  });

  it('after leaving the confirmation later invites enter via push again', () => {
    const nav = createInviteNavigationCoordinator();
    expect(nav.handleExplicitInviteCode(NEW).action).toBe('push');

    nav.leaveConfirmation();

    expect(nav.handleExplicitInviteCode(OTHER)).toEqual({ action: 'push', code: OTHER });

    // A restored code gets a second chance too once nothing owns the screen.
    const closed = createInviteNavigationCoordinator();
    expect(closed.handleExplicitInviteCode(NEW).action).toBe('push');
    closed.leaveConfirmation();
    const lookup = closed.beginRestoreLookup();
    expect(closed.resolveRestoreLookup(lookup, OLD)).toEqual({ action: 'push', code: OLD });
  });

  it('never navigates without any code', () => {
    const nav = createInviteNavigationCoordinator();
    expect(nav.handleExplicitInviteCode('')).toEqual({ action: 'none', code: null });
    expect(nav.handleExplicitInviteCode('   ').action).toBe('none');
    const explicitTicket = nav.beginExplicitLookup();
    expect(nav.resolveExplicitLookup(explicitTicket, '')).toEqual({ action: 'none', code: null });
    const restoreTicket = nav.beginRestoreLookup();
    expect(nav.resolveRestoreLookup(restoreTicket, '')).toEqual({ action: 'none', code: null });
  });
});
