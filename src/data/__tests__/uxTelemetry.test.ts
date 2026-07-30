import { trackClientEvent } from '../telemetryClient';
import { trackUiInteraction } from '../uxTelemetry';

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
