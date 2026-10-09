import { trackClientEvent } from '../telemetryClient';
import { trackRepeatedUiInteraction, trackUiInteraction } from '../uxTelemetry';

jest.mock('../telemetryClient', () => ({
  trackClientEvent: jest.fn(async () => undefined),
}));

const mockTrackClientEvent = trackClientEvent as jest.MockedFunction<typeof trackClientEvent>;

beforeEach(() => {
  jest.clearAllMocks();
});

it('tracks only a typed target and action', () => {
  trackUiInteraction('community_join_request', 'submit');

  expect(mockTrackClientEvent).toHaveBeenCalledWith({
    event: 'ui_interaction',
    context: {
      target: 'community_join_request',
      action: 'submit',
    },
  });
});

it('folds a burst of repeated taps into one event per target with the tap count', () => {
  jest.useFakeTimers();
  try {
    for (let i = 0; i < 12; i += 1) trackRepeatedUiInteraction('compass_skip');
    trackRepeatedUiInteraction('compass_reroll');
    expect(mockTrackClientEvent).not.toHaveBeenCalled();

    jest.advanceTimersByTime(5_000);
    expect(mockTrackClientEvent).toHaveBeenCalledTimes(2);
    expect(mockTrackClientEvent).toHaveBeenCalledWith({
      event: 'ui_interaction',
      context: { target: 'compass_skip', action: 'tap', count: 12 },
    });
    expect(mockTrackClientEvent).toHaveBeenCalledWith({
      event: 'ui_interaction',
      context: { target: 'compass_reroll', action: 'tap', count: 1 },
    });

    trackRepeatedUiInteraction('compass_skip');
    jest.advanceTimersByTime(5_000);
    expect(mockTrackClientEvent).toHaveBeenCalledTimes(3);
    expect(mockTrackClientEvent).toHaveBeenLastCalledWith({
      event: 'ui_interaction',
      context: { target: 'compass_skip', action: 'tap', count: 1 },
    });
  } finally {
    jest.useRealTimers();
  }
});
