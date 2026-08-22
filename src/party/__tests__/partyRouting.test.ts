import {
  cancelPendingPartyRecapNavigation,
  finishPartyToRecap,
  minimizeParty,
} from '../partyRouting';

describe('Party route fallback', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    cancelPendingPartyRecapNavigation();
    jest.useRealTimers();
  });
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

  it('unwinds the requested root screens before navigating to one recap', () => {
    const router = { dismiss: jest.fn(), navigate: jest.fn() };

    finishPartyToRecap(router, 2);
    finishPartyToRecap(router, 2);

    expect(router.dismiss).toHaveBeenCalledTimes(1);
    expect(router.dismiss).toHaveBeenCalledWith(2);
    expect(router.navigate).not.toHaveBeenCalled();

    jest.advanceTimersByTime(259);
    expect(router.navigate).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith('/friends/party-recap');
  });

  it('cancels a pending recap without blocking the next finished evening', () => {
    const router = { dismiss: jest.fn(), navigate: jest.fn() };

    finishPartyToRecap(router);
    cancelPendingPartyRecapNavigation();
    jest.runOnlyPendingTimers();
    expect(router.navigate).not.toHaveBeenCalled();

    finishPartyToRecap(router);
    jest.advanceTimersByTime(260);
    expect(router.dismiss).toHaveBeenCalledTimes(2);
    expect(router.navigate).toHaveBeenCalledTimes(1);
    expect(router.navigate).toHaveBeenCalledWith('/friends/party-recap');
  });
});
