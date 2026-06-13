import { resetWalkingTelemetryForTests, recordWalkingSample } from '../walkingTelemetry';
import { trackClientEvent } from '../telemetryClient';

jest.mock('../telemetryClient', () => ({
  trackClientEvent: jest.fn(),
}));

const trackClientEventMock = trackClientEvent as jest.Mock;

afterEach(() => {
  resetWalkingTelemetryForTests();
  jest.restoreAllMocks();
  trackClientEventMock.mockClear();
});

describe('walkingTelemetry', () => {
  it('sends only accumulated distance increments, not coordinates', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000);
    recordWalkingSample({ lat: 50, lng: 14, accuracyMeters: 12 });

    now.mockReturnValueOnce(201_000);
    recordWalkingSample({ lat: 50.0027, lng: 14, accuracyMeters: 12 });

    expect(trackClientEventMock).toHaveBeenCalledTimes(1);
    const event = trackClientEventMock.mock.calls[0][0];
    expect(event.event).toBe('walking_distance');
    expect(event.context.distance_m).toBeGreaterThanOrEqual(250);
    expect(event.context).not.toHaveProperty('lat');
    expect(event.context).not.toHaveProperty('lng');
  });

  it('ignores inaccurate GPS samples', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(1_000);
    recordWalkingSample({ lat: 50, lng: 14, accuracyMeters: 120 });

    now.mockReturnValueOnce(201_000);
    recordWalkingSample({ lat: 50.0027, lng: 14, accuracyMeters: 120 });

    expect(trackClientEventMock).not.toHaveBeenCalled();
  });
});
