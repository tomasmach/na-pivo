import { showAppDialog } from '@/components/shared/AppDialog';
import type { MenuPhotoSource } from '@/data/menuPhotoPicker';
import { t } from '@/i18n';
import { Linking } from 'react-native';

export function menuScanPermissionDeniedCopy(source: MenuPhotoSource): string {
  return source === 'camera'
    ? t.contribute.scanMenu.permissionCameraDenied
    : t.contribute.scanMenu.permissionLibraryDenied;
}

export function showMenuScanPermissionBlocked(source: MenuPhotoSource): void {
  showAppDialog({
    title: t.contribute.scanMenu.sheetTitle,
    message:
      source === 'camera'
        ? t.contribute.scanMenu.permissionCameraBlocked
        : t.contribute.scanMenu.permissionLibraryBlocked,
    buttons: [
      { text: t.common.cancel, style: 'cancel' },
      {
        text: t.contribute.scanMenu.openSettings,
        onPress: () => void Linking.openSettings(),
      },
    ],
  });
}
