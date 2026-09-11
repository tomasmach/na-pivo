import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { CONTEXT_KEYS_FOR_TESTS, trackClientEvent } from '../telemetryClient';
import { trackUiInteraction, UI_INTERACTION_TARGETS } from '../uxTelemetry';

jest.mock('../telemetryClient', () => ({
  ...jest.requireActual('../telemetryClient'),
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

/**
 * The server keeps its own copy of the target list and silently drops anything
 * it does not know. That is how a week of 3.0 taps arrived as an unknown target
 * and told us nothing — the new names were added here and never over there.
 */
it('sends only targets the backend still stores', () => {
  const serializer = readFileSync(
    join(__dirname, '../../../backend/pubs/api/serializers.py'),
    'utf8',
  );
  const block = serializer
    .split('_CLIENT_EVENT_INTERACTION_TARGETS = {')[1]
    .split('}')[0];
  const accepted = new Set(Array.from(block.matchAll(/"([a-z0-9_]+)"/g), (m) => m[1]));

  const sent = new Set<string>(UI_INTERACTION_TARGETS);

  expect([...sent].filter((target) => !accepted.has(target))).toEqual([]);
  expect([...accepted].filter((target) => !sent.has(target))).toEqual([]);
});

it('sends only context keys the backend still stores', () => {
  const serializer = readFileSync(
    join(__dirname, '../../../backend/pubs/api/serializers.py'),
    'utf8',
  );
  const block = serializer.split('_CLIENT_EVENT_CONTEXT_KEYS = {')[1].split('}')[0];
  const accepted = new Set(Array.from(block.matchAll(/"([a-z0-9_]+)"/g), (m) => m[1]));

  expect([...CONTEXT_KEYS_FOR_TESTS].filter((key) => !accepted.has(key))).toEqual([]);
});
