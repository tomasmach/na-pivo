import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';

import { enqueueFeedback, flushFeedbackQueue } from '../feedbackQueue';
import { submitFeedback } from '../feedbackClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../account', () => ({ generateUuidV4: jest.fn(() => 'client-1') }));

jest.mock('../feedbackClient', () => ({
  buildFeedbackEntry: jest.fn((input, clientId, attachmentUri) => ({
    client_id: clientId,
    category: input.category,
    message: input.message.trim(),
    app_version: 'v1',
    platform: 'ios',
    os_version: '18',
    ...(attachmentUri ? { attachment_uri: attachmentUri } : {}),
  })),
  submitFeedback: jest.fn(async () => 'retry'),
}));

const STORAGE_KEY = 'na-pivo-feedback-queue';
const mockSubmit = submitFeedback as jest.MockedFunction<typeof submitFeedback>;

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockSubmit.mockResolvedValue('retry');
});

it('persists a picked image in the durable feedback queue while offline', async () => {
  const copy = jest.spyOn(File.prototype, 'copy');

  await enqueueFeedback({
    category: 'bug',
    message: '  Spadne mi kompas.  ',
    attachmentUri: 'file:///picker-cache/photo.jpg',
  });
  await flushFeedbackQueue();

  const queue = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) ?? '[]');
  expect(copy).toHaveBeenCalled();
  expect(queue).toHaveLength(1);
  expect(queue[0]).toEqual(
    expect.objectContaining({
      client_id: 'client-1',
      message: 'Spadne mi kompas.',
      attachment_uri: expect.stringContaining('feedback-attachments/client-1.jpg'),
    }),
  );
  expect(mockSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ attachment_uri: expect.any(String) }),
  );
});

it('clears the queued entry after a later successful upload', async () => {
  await enqueueFeedback({
    category: 'bug',
    message: 'Spadne mi kompas.',
    attachmentUri: 'file:///picker-cache/photo.jpg',
  });
  await flushFeedbackQueue();
  expect(await AsyncStorage.getItem(STORAGE_KEY)).not.toBeNull();

  mockSubmit.mockResolvedValue('ok');
  await flushFeedbackQueue();

  expect(await AsyncStorage.getItem(STORAGE_KEY)).toBeNull();
});
