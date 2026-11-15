import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync } from 'expo-image-manipulator';

import { pickAndPrepareMenuPhoto } from '../menuPhotoPicker';

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: jest.fn(async () => ({ uri: 'file:///prepared.jpg' })),
  SaveFormat: { JPEG: 'jpeg' },
}));

function pick(width: number, height: number): void {
  jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValueOnce({
    canceled: false,
    assets: [{ uri: 'file:///photo.jpg', width, height }],
  } as unknown as ImagePicker.ImagePickerResult);
}

afterEach(() => jest.clearAllMocks());

describe('pickAndPrepareMenuPhoto', () => {
  it('shrinks the longer edge to the size the backend keeps', async () => {
    pick(3024, 4032);
    await expect(pickAndPrepareMenuPhoto('camera')).resolves.toEqual({ status: 'picked', uri: 'file:///prepared.jpg' });
    expect(jest.mocked(manipulateAsync).mock.calls[0][1]).toEqual([{ resize: { height: 1600 } }]);

    pick(4032, 3024);
    await pickAndPrepareMenuPhoto('camera');
    expect(jest.mocked(manipulateAsync).mock.calls[1][1]).toEqual([{ resize: { width: 1600 } }]);
  });

  it('never enlarges a small photo', async () => {
    pick(900, 1200);
    await pickAndPrepareMenuPhoto('camera');
    expect(jest.mocked(manipulateAsync).mock.calls[0][1]).toEqual([]);
  });
});
