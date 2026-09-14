import AsyncStorage from '@react-native-async-storage/async-storage';

import { resetCounterTelemetryForTests, trackCounterTabOpened } from '../counterTelemetry';
import { trackClientEvent } from '../telemetryClient';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('../telemetryClient', () => ({
  trackClientEvent: jest.fn(async () => undefined),
}));

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await AsyncStorage.clear();
  await resetCounterTelemetryForTests();
});

afterEach(() => {
  jest.useRealTimers();
});

describe('counter telemetry', () => {
  it('tracks tab opens without a return event the first time', async () => {
    jest.setSystemTime(new Date('2026-06-14T10:00:00+02:00'));

    await trackCounterTabOpened(false);

    expect(trackClientEvent).toHaveBeenCalledTimes(1);
    expect(trackClientEvent).toHaveBeenCalledWith({
      event: 'counter_tab_opened',
      context: { had_active_session: false },
    });
  });

  it('tracks same-day counter returns', async () => {
    jest.setSystemTime(new Date('2026-06-14T10:00:00+02:00'));
    await trackCounterTabOpened(false);
    jest.clearAllMocks();

    jest.setSystemTime(new Date('2026-06-14T21:00:00+02:00'));
    await trackCounterTabOpened(true);

    expect(trackClientEvent).toHaveBeenCalledWith({
      event: 'counter_tab_opened',
      context: { had_active_session: true },
    });
    expect(trackClientEvent).toHaveBeenCalledWith({
      event: 'counter_returned_same_day',
      context: undefined,
    });
  });

  it('tracks later counter returns with coarse day distance', async () => {
    jest.setSystemTime(new Date('2026-06-12T21:00:00+02:00'));
    await trackCounterTabOpened(false);
    jest.clearAllMocks();

    jest.setSystemTime(new Date('2026-06-14T18:00:00+02:00'));
    await trackCounterTabOpened(false);

    expect(trackClientEvent).toHaveBeenCalledWith({
      event: 'counter_returned_later',
      context: { return_days: 2 },
    });
  });
});
