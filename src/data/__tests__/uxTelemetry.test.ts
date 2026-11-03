import { telemetrySessionGeneration, trackClientEvent } from '../telemetryClient';
import { trackRepeatedUiInteraction, trackUiInteraction } from '../uxTelemetry';

jest.mock('../telemetryClient', () => ({
  telemetrySessionGeneration: jest.fn(() => 0),
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

it('drops taps from an account that signed out before the window closed', () => {
  const generation = telemetrySessionGeneration as jest.MockedFunction<
    typeof telemetrySessionGeneration
  >;
  jest.useFakeTimers();
  try {
    generation.mockReturnValue(0);
    trackRepeatedUiInteraction('compass_skip');
    trackRepeatedUiInteraction('compass_skip');
    generation.mockReturnValue(1);
    trackRepeatedUiInteraction('compass_skip');

    jest.advanceTimersByTime(5_000);
    expect(mockTrackClientEvent).toHaveBeenCalledTimes(1);
    expect(mockTrackClientEvent).toHaveBeenCalledWith({
      event: 'ui_interaction',
      context: { target: 'compass_skip', action: 'tap', count: 1 },
    });
  } finally {
    generation.mockReturnValue(0);
    jest.useRealTimers();
  }
});
