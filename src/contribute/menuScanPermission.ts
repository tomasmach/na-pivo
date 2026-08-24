import { showAppDialog } from '@/components/shared/AppDialog';
import type { MenuPhotoSource } from '@/data/menuPhotoPicker';
import { cs } from '@/i18n/cs';
import { Linking } from 'react-native';

export function menuScanPermissionDeniedCopy(source: MenuPhotoSource): string {
  return source === 'camera'
    ? cs.contribute.scanMenu.permissionCameraDenied
    : cs.contribute.scanMenu.permissionLibraryDenied;
}

export function showMenuScanPermissionBlocked(source: MenuPhotoSource): void {
  showAppDialog({
    title: cs.contribute.scanMenu.sheetTitle,
    message:
      source === 'camera'
        ? cs.contribute.scanMenu.permissionCameraBlocked
        : cs.contribute.scanMenu.permissionLibraryBlocked,
    buttons: [
      { text: cs.common.cancel, style: 'cancel' },
      {
        text: cs.contribute.scanMenu.openSettings,
        onPress: () => void Linking.openSettings(),
      },
    ],
  });
}
