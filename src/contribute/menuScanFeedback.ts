import type { MenuPhotoPickResult, MenuPhotoSource } from '@/data/menuPhotoPicker';
import type { MenuScanResult } from '@/data/menuScanClient';
import { cs } from '@/i18n/cs';

export type MenuPhotoPickFeedback =
  | { action: 'continue' }
  | { action: 'cancel' }
  | { action: 'toast'; message: string }
  | { action: 'settings' };

export function menuPhotoPickFeedback(
  status: MenuPhotoPickResult['status'],
  source: MenuPhotoSource,
): MenuPhotoPickFeedback {
  switch (status) {
    case 'picked':
      return { action: 'continue' };
    case 'cancelled':
      return { action: 'cancel' };
    case 'denied':
      return {
        action: 'toast',
        message:
          source === 'camera'
            ? cs.contribute.scanMenu.permissionCameraDenied
            : cs.contribute.scanMenu.permissionLibraryDenied,
      };
    case 'denied-permanent':
      return { action: 'settings' };
    case 'error':
      return { action: 'toast', message: cs.contribute.scanMenu.errorToast };
  }
}

export function menuScanFailureCopy(
  status: Exclude<MenuScanResult['status'], 'ok'>,
  emptyCopy: string = cs.contribute.scanMenu.emptyToast,
): string {
  switch (status) {
    case 'empty':
      return emptyCopy;
    case 'unavailable':
      return cs.contribute.scanMenu.unavailableToast;
    case 'daily-cap':
      return cs.contribute.scanMenu.dailyCapToast;
    case 'rate-limited':
      return cs.contribute.scanMenu.rateLimitedToast;
    case 'bad-image':
      return cs.contribute.scanMenu.badImageToast;
    case 'error':
      return cs.contribute.scanMenu.errorToast;
  }
}
