import type { MenuPhotoPickResult, MenuPhotoSource } from '@/data/menuPhotoPicker';
import type { MenuScanResult } from '@/data/menuScanClient';
import { t } from '@/i18n';

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
            ? t.contribute.scanMenu.permissionCameraDenied
            : t.contribute.scanMenu.permissionLibraryDenied,
      };
    case 'denied-permanent':
      return { action: 'settings' };
    case 'error':
      return { action: 'toast', message: t.contribute.scanMenu.errorToast };
  }
}

export function menuScanFailureCopy(
  status: Exclude<MenuScanResult['status'], 'ok'>,
  emptyCopy: string = t.contribute.scanMenu.emptyToast,
): string {
  switch (status) {
    case 'empty':
      return emptyCopy;
    case 'unavailable':
      return t.contribute.scanMenu.unavailableToast;
    case 'daily-cap':
      return t.contribute.scanMenu.dailyCapToast;
    case 'rate-limited':
      return t.contribute.scanMenu.rateLimitedToast;
    case 'bad-image':
      return t.contribute.scanMenu.badImageToast;
    case 'error':
      return t.contribute.scanMenu.errorToast;
  }
}
