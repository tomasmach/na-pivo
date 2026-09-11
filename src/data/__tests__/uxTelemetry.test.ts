import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { trackClientEvent } from '../telemetryClient';
import { trackUiInteraction, UI_INTERACTION_TARGETS } from '../uxTelemetry';

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

/**
 * The server keeps its own copy of these whitelists and silently drops anything
 * it does not know. That is how a week of 3.0 taps arrived as an unknown target
 * and told us nothing — the new names were added here and never over there.
 *
 * Only one direction is checked: everything this app SENDS must be accepted.
 * The server is deliberately allowed to know more, because 1.5.x and 2.0 are
 * still out there sending names 3.0 has stopped using, and dropping those from
 * the server would break the one rule released versions depend on.
 */
function pythonSet(source: string, name: string): Set<string> {
  const opener = `${name} = {`;
  const start = source.indexOf(opener);
  if (start < 0) throw new Error(`${name} is gone from serializers.py — rename or move?`);
  const end = source.indexOf('\n}', start);
  if (end < 0) throw new Error(`${name} in serializers.py has no closing brace on its own line.`);
  const body = source
    .slice(start + opener.length, end)
    .split('\n')
    // A quoted word inside a comment is prose, not a whitelist entry.
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
  return new Set(Array.from(body.matchAll(/"([a-z0-9_]+)"/g), (match) => match[1]));
}

function typescriptList(source: string, opener: string): Set<string> {
  const start = source.indexOf(opener);
  if (start < 0) throw new Error(`"${opener}" is gone — rename or move?`);
  const end = source.indexOf('\n]', start);
  if (end < 0) throw new Error(`"${opener}" has no closing bracket on its own line.`);
  const body = source
    .slice(start + opener.length, end)
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
  return new Set(Array.from(body.matchAll(/'([a-z0-9_]+)'/g), (match) => match[1]));
}

const serializerSource = readFileSync(
  join(__dirname, '../../../backend/pubs/api/serializers.py'),
  'utf8',
);

it('sends only targets the backend still stores', () => {
  const accepted = pythonSet(serializerSource, '_CLIENT_EVENT_INTERACTION_TARGETS');
  const sent = new Set<string>(UI_INTERACTION_TARGETS);

  expect([...sent].filter((target) => !accepted.has(target))).toEqual([]);
});

it('sends only context keys the backend still stores', () => {
  const accepted = pythonSet(serializerSource, '_CLIENT_EVENT_CONTEXT_KEYS');
  const sent = typescriptList(
    readFileSync(join(__dirname, '../telemetryClient.ts'), 'utf8'),
    'const CONTEXT_KEYS = new Set([',
  );

  expect(sent.size).toBeGreaterThan(0);
  expect([...sent].filter((key) => !accepted.has(key))).toEqual([]);
});
