import { cs } from '@/i18n/cs';

import { menuPhotoPickFeedback, menuScanFailureCopy } from '../menuScanFeedback';

describe('shared menu scan feedback', () => {
  it.each([
    ['cancelled', 'camera', { action: 'cancel' }],
    ['picked', 'camera', { action: 'continue' }],
    ['denied', 'camera', { action: 'toast', message: cs.contribute.scanMenu.permissionCameraDenied }],
    ['denied', 'library', { action: 'toast', message: cs.contribute.scanMenu.permissionLibraryDenied }],
    ['denied-permanent', 'camera', { action: 'settings' }],
    ['denied-permanent', 'library', { action: 'settings' }],
    ['error', 'camera', { action: 'toast', message: cs.contribute.scanMenu.errorToast }],
  ] as const)('maps picker status %s from %s', (status, source, expected) => {
    expect(menuPhotoPickFeedback(status, source)).toEqual(expected);
  });

  it.each([
    ['empty', cs.contribute.scanMenu.emptyToast],
    ['unavailable', cs.contribute.scanMenu.unavailableToast],
    ['daily-cap', cs.contribute.scanMenu.dailyCapToast],
    ['rate-limited', cs.contribute.scanMenu.rateLimitedToast],
    ['bad-image', cs.contribute.scanMenu.badImageToast],
    ['error', cs.contribute.scanMenu.errorToast],
  ] as const)('maps scan status %s to its exact copy', (status, expected) => {
    expect(menuScanFailureCopy(status)).toBe(expected);
  });

  it('lets drink scanning keep its existing empty-result copy', () => {
    expect(menuScanFailureCopy('empty', cs.counter.scanDrinksEmpty)).toBe(cs.counter.scanDrinksEmpty);
  });
});
