import {
  cancelPendingPartyRecapNavigation,
  completePendingPartyRecapNavigation,
  finishPartyToRecap,
  minimizeParty,
} from '../partyRouting';

describe('Party route fallback', () => {
  afterEach(cancelPendingPartyRecapNavigation);
  it('returns to the previous screen when the stack has one', () => {
    const router = { canGoBack: () => true, back: jest.fn(), replace: jest.fn() };

    minimizeParty(router);

    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('leaves a cold-start /beer route through the friends tab', () => {
    const router = { canGoBack: () => false, back: jest.fn(), replace: jest.fn() };

    minimizeParty(router);

    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/friends');
  });

  it('unwinds every party screen and waits for the native pathname transition', () => {
    const router = {
      canDismiss: () => true,
      dismissAll: jest.fn(),
      replace: jest.fn(),
      navigate: jest.fn(),
    };

    finishPartyToRecap(router, '/party-finish');
    finishPartyToRecap(router, '/party-finish');

    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
    expect(completePendingPartyRecapNavigation(router, '/party-finish')).toBe(false);

    expect(completePendingPartyRecapNavigation(router, '/friends')).toBe(true);
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith('/friends/party-recap');
    expect(completePendingPartyRecapNavigation(router, '/friends')).toBe(false);
  });

  it('replaces a cold-start party root without dispatching an invalid dismiss', () => {
    const router = {
      canDismiss: () => false,
      dismissAll: jest.fn(),
      replace: jest.fn(),
      navigate: jest.fn(),
    };

    finishPartyToRecap(router, '/party-live');
    finishPartyToRecap(router, '/party-live');

    expect(router.dismissAll).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith('/friends/party-recap');
    expect(completePendingPartyRecapNavigation(router, '/friends/party-recap')).toBe(true);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('replaces a cold-start party-live root left by dismissAll', () => {
    const router = {
      canDismiss: () => true,
      dismissAll: jest.fn(),
      replace: jest.fn(),
      navigate: jest.fn(),
    };

    finishPartyToRecap(router, '/party-finish');
    expect(completePendingPartyRecapNavigation(router, '/party-live')).toBe(true);
    expect(router.replace).toHaveBeenCalledWith('/friends/party-recap');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('cancels a pending recap without blocking the next finished evening', () => {
    const router = {
      canDismiss: () => true,
      dismissAll: jest.fn(),
      replace: jest.fn(),
      navigate: jest.fn(),
    };

    finishPartyToRecap(router, '/party-finish');
    cancelPendingPartyRecapNavigation();
    expect(completePendingPartyRecapNavigation(router, '/friends')).toBe(false);

    finishPartyToRecap(router, '/party-finish');
    completePendingPartyRecapNavigation(router, '/friends');
    expect(router.dismissAll).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenCalledTimes(1);
  });
});
