import { showAppDialog } from '@/components/shared/AppDialog';
import { cs } from '@/i18n/cs';
import { menuScanPermissionDeniedCopy, showMenuScanPermissionBlocked } from '../menuScanPermission';
import { Linking } from 'react-native';

jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));

it('keeps retryable denials source-specific', () => {
  expect(menuScanPermissionDeniedCopy('camera')).toBe(cs.contribute.scanMenu.permissionCameraDenied);
  expect(menuScanPermissionDeniedCopy('library')).toBe(cs.contribute.scanMenu.permissionLibraryDenied);
});

it('opens system settings after a permanent denial', () => {
  showMenuScanPermissionBlocked('camera');
  const dialog = (showAppDialog as jest.Mock).mock.calls[0][0];
  expect(dialog.message).toBe(cs.contribute.scanMenu.permissionCameraBlocked);
  dialog.buttons[1].onPress();
  expect(Linking.openSettings).toHaveBeenCalledTimes(1);
});
