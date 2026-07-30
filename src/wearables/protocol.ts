import type { DrinkType, ServingType } from '@/drinks/drinkTypes';

export const WEARABLE_PROTOCOL_VERSION = 1 as const;

export type WearableActorKind = 'phone' | 'watchos' | 'wearos';
export type TargetSelection = 'manual' | 'nearest';

export interface WearablePubRef {
  pubKey: string;
  name: string;
  /** Public point-of-interest coordinate, never the user's observed location. */
  latitude: number;
  /** Public point-of-interest coordinate, never the user's observed location. */
  longitude: number;
  city?: string;
  externalId?: string;
}

export interface WearableDrinkSpec {
  id: string;
  name: string;
  drinkType: DrinkType;
  volumeMl: number;
  priceCzk: number;
  servingType: ServingType;
  recordedAt: string;
}

/**
 * A selectable template, never an already-recorded fact. Repeating it must mint
 * a new WearableDrinkSpec.id.
 */
export interface WearableDrinkChoice {
  choiceId: string;
  name: string;
  drinkType: DrinkType;
  volumeMl: number | null;
  priceCzk: number | null;
  servingType: ServingType;
}

export interface WearableTargetState {
  selection: TargetSelection;
  pub: WearablePubRef;
}

export type WearableEveningStatus = 'active' | 'closed' | 'conflict';

export interface WearableEveningState {
  eveningId: string;
  pub: WearablePubRef;
  drinkingDayKey: string;
  startedAt: string;
  closedAt?: string;
  status: WearableEveningStatus;
  drinks: WearableDrinkSpec[];
  removedDrinkIds: string[];
}

export type WearableCommand =
  | { type: 'set_target'; target: WearableTargetState }
  | { type: 'clear_target' }
  | {
      type: 'start_evening_and_add_drink';
      eveningId: string;
      pub: WearablePubRef;
      drinkingDayKey: string;
      drink: WearableDrinkSpec;
    }
  | { type: 'add_drink'; eveningId: string; drink: WearableDrinkSpec }
  | {
      type: 'remove_drink';
      eveningId: string;
      drinkId: string;
      reason: 'undo' | 'correction';
    }
  | { type: 'close_evening'; eveningId: string; closedAt: string }
  | { type: 'resolve_evening_conflict'; activeEveningId: string };

interface WearableEnvelopeBase {
  protocolVersion: typeof WEARABLE_PROTOCOL_VERSION;
  messageId: string;
  accountEpoch: string;
  actorId: string;
  actorKind: WearableActorKind;
  actorSequence: number;
  baseRevision: number;
  sentAt: string;
}

export interface WearableCommandEnvelope extends WearableEnvelopeBase {
  kind: 'command';
  payload: { command: WearableCommand };
}

export interface WearableStateSnapshotEnvelope extends WearableEnvelopeBase {
  kind: 'state_snapshot';
  payload: {
    revision: number;
    target: WearableTargetState | null;
    activeEvening: WearableEveningState | null;
    otherEvenings: WearableEveningState[];
    nearbyPubs: WearablePubRef[];
    recentDrinks: WearableDrinkChoice[];
    frequentDrinks: WearableDrinkChoice[];
    menuDrinks: WearableDrinkChoice[];
    pendingCommandCount: number;
    isStale: boolean;
    lastPhoneContactAt?: string;
  };
}

export interface WearableAckEnvelope extends WearableEnvelopeBase {
  kind: 'ack';
  payload: {
    acknowledgedMessageIds: string[];
    revision: number;
  };
}

export type WearableEnvelope =
  | WearableCommandEnvelope
  | WearableStateSnapshotEnvelope
  | WearableAckEnvelope;

export type WearableValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DRINKING_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const GENERIC_DRINK_NAMES = new Set([
  'beer',
  'drink',
  'napoj',
  'nealko',
  'neco',
  'něco',
  'nápoj',
  'panak',
  'panák',
  'pivo',
  'shot',
  'vino',
  'víno',
]);
const DRINK_TYPES = new Set<DrinkType>(['beer', 'soft_drink', 'wine', 'shot']);
const SERVING_TYPES = new Set<ServingType>([
  'unknown',
  'draft',
  'bottle',
  'can',
  'plastic_bottle',
  'other',
]);
const ACTOR_KINDS = new Set<WearableActorKind>(['phone', 'watchos', 'wearos']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  errors: string[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) errors.push(`${path}.${key} is not allowed`);
  }
}

function requireKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  path: string,
  errors: string[],
): void {
  for (const key of required) {
    if (!(key in value)) errors.push(`${path}.${key} is required`);
  }
}

function isIsoDateTime(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.includes('T') &&
    Number.isFinite(Date.parse(value))
  );
}

function validateUuid(value: unknown, path: string, errors: string[]): value is string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    errors.push(`${path} must be a UUID`);
    return false;
  }
  return true;
}

function validatePubRef(value: unknown, path: string, errors: string[]): value is WearablePubRef {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  hasOnlyKeys(
    value,
    ['pubKey', 'name', 'latitude', 'longitude', 'city', 'externalId'],
    path,
    errors,
  );
  requireKeys(value, ['pubKey', 'name', 'latitude', 'longitude'], path, errors);
  if (
    typeof value.pubKey !== 'string' ||
    value.pubKey.length < 1 ||
    value.pubKey.length > 64
  ) {
    errors.push(`${path}.pubKey must contain 1..64 characters`);
  }
  if (typeof value.name !== 'string' || value.name.trim().length < 1 || value.name.length > 200) {
    errors.push(`${path}.name must contain 1..200 characters`);
  }
  if (
    typeof value.latitude !== 'number' ||
    !Number.isFinite(value.latitude) ||
    value.latitude < -90 ||
    value.latitude > 90
  ) {
    errors.push(`${path}.latitude must be between -90 and 90`);
  }
  if (
    typeof value.longitude !== 'number' ||
    !Number.isFinite(value.longitude) ||
    value.longitude < -180 ||
    value.longitude > 180
  ) {
    errors.push(`${path}.longitude must be between -180 and 180`);
  }
  if (value.city !== undefined && (typeof value.city !== 'string' || value.city.length > 128)) {
    errors.push(`${path}.city must contain at most 128 characters`);
  }
  if (
    value.externalId !== undefined &&
    (typeof value.externalId !== 'string' || value.externalId.length > 128)
  ) {
    errors.push(`${path}.externalId must contain at most 128 characters`);
  }
  return errors.length === 0;
}

function normalizedDrinkName(value: string): string {
  return value.trim().toLocaleLowerCase('cs-CZ');
}

export function isConcreteDrinkName(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const normalized = normalizedDrinkName(value);
  return normalized.length >= 1 && normalized.length <= 80 && !GENERIC_DRINK_NAMES.has(normalized);
}

function validateDrinkSpec(
  value: unknown,
  path: string,
  errors: string[],
): value is WearableDrinkSpec {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  hasOnlyKeys(
    value,
    ['id', 'name', 'drinkType', 'volumeMl', 'priceCzk', 'servingType', 'recordedAt'],
    path,
    errors,
  );
  requireKeys(
    value,
    ['id', 'name', 'drinkType', 'volumeMl', 'priceCzk', 'servingType', 'recordedAt'],
    path,
    errors,
  );
  validateUuid(value.id, `${path}.id`, errors);
  if (!isConcreteDrinkName(value.name)) {
    errors.push(`${path}.name must be a concrete confirmed drink name`);
  }
  if (typeof value.drinkType !== 'string' || !DRINK_TYPES.has(value.drinkType as DrinkType)) {
    errors.push(`${path}.drinkType is invalid`);
  }
  if (
    typeof value.volumeMl !== 'number' ||
    !Number.isInteger(value.volumeMl) ||
    value.volumeMl < 10 ||
    value.volumeMl > 3000
  ) {
    errors.push(`${path}.volumeMl must be an integer between 10 and 3000`);
  } else if (value.drinkType === 'shot' && value.volumeMl > 200) {
    errors.push(`${path}.volumeMl must not exceed 200 for a shot`);
  }
  if (
    typeof value.priceCzk !== 'number' ||
    !Number.isInteger(value.priceCzk) ||
    value.priceCzk < 1 ||
    value.priceCzk > 1000
  ) {
    errors.push(`${path}.priceCzk must be an integer between 1 and 1000`);
  }
  if (
    typeof value.servingType !== 'string' ||
    !SERVING_TYPES.has(value.servingType as ServingType)
  ) {
    errors.push(`${path}.servingType is invalid`);
  }
  if (!isIsoDateTime(value.recordedAt)) {
    errors.push(`${path}.recordedAt must be an ISO-8601 date-time`);
  }
  return errors.length === 0;
}

function validateDrinkChoice(
  value: unknown,
  path: string,
  errors: string[],
): value is WearableDrinkChoice {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  hasOnlyKeys(
    value,
    ['choiceId', 'name', 'drinkType', 'volumeMl', 'priceCzk', 'servingType'],
    path,
    errors,
  );
  requireKeys(
    value,
    ['choiceId', 'name', 'drinkType', 'volumeMl', 'priceCzk', 'servingType'],
    path,
    errors,
  );
  if (
    typeof value.choiceId !== 'string' ||
    value.choiceId.length < 1 ||
    value.choiceId.length > 128
  ) {
    errors.push(`${path}.choiceId must contain 1..128 characters`);
  }
  if (!isConcreteDrinkName(value.name)) {
    errors.push(`${path}.name must be a concrete confirmed drink name`);
  }
  if (typeof value.drinkType !== 'string' || !DRINK_TYPES.has(value.drinkType as DrinkType)) {
    errors.push(`${path}.drinkType is invalid`);
  }
  if (
    value.volumeMl !== null &&
    (typeof value.volumeMl !== 'number' ||
      !Number.isInteger(value.volumeMl) ||
      value.volumeMl < 10 ||
      value.volumeMl > 3000)
  ) {
    errors.push(`${path}.volumeMl must be null or an integer between 10 and 3000`);
  } else if (value.drinkType === 'shot' && value.volumeMl !== null && value.volumeMl > 200) {
    errors.push(`${path}.volumeMl must not exceed 200 for a shot`);
  }
  if (
    value.priceCzk !== null &&
    (typeof value.priceCzk !== 'number' ||
      !Number.isInteger(value.priceCzk) ||
      value.priceCzk < 1 ||
      value.priceCzk > 1000)
  ) {
    errors.push(`${path}.priceCzk must be null or an integer between 1 and 1000`);
  }
  if (
    typeof value.servingType !== 'string' ||
    !SERVING_TYPES.has(value.servingType as ServingType)
  ) {
    errors.push(`${path}.servingType is invalid`);
  }
  return errors.length === 0;
}

function validateTarget(
  value: unknown,
  path: string,
  errors: string[],
): value is WearableTargetState {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  hasOnlyKeys(value, ['selection', 'pub'], path, errors);
  requireKeys(value, ['selection', 'pub'], path, errors);
  if (value.selection !== 'manual' && value.selection !== 'nearest') {
    errors.push(`${path}.selection must be manual or nearest`);
  }
  validatePubRef(value.pub, `${path}.pub`, errors);
  return errors.length === 0;
}

function validateStringArray(
  value: unknown,
  path: string,
  errors: string[],
  itemValidator?: (item: unknown, itemPath: string, itemErrors: string[]) => boolean,
): value is string[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return false;
  }
  value.forEach((item, index) => {
    if (itemValidator) itemValidator(item, `${path}[${index}]`, errors);
    else if (typeof item !== 'string') errors.push(`${path}[${index}] must be a string`);
  });
  if (new Set(value).size !== value.length) errors.push(`${path} must contain unique items`);
  return errors.length === 0;
}

function validateEvening(
  value: unknown,
  path: string,
  errors: string[],
): value is WearableEveningState {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  hasOnlyKeys(
    value,
    [
      'eveningId',
      'pub',
      'drinkingDayKey',
      'startedAt',
      'closedAt',
      'status',
      'drinks',
      'removedDrinkIds',
    ],
    path,
    errors,
  );
  requireKeys(
    value,
    ['eveningId', 'pub', 'drinkingDayKey', 'startedAt', 'status', 'drinks', 'removedDrinkIds'],
    path,
    errors,
  );
  validateUuid(value.eveningId, `${path}.eveningId`, errors);
  validatePubRef(value.pub, `${path}.pub`, errors);
  if (typeof value.drinkingDayKey !== 'string' || !DRINKING_DAY_RE.test(value.drinkingDayKey)) {
    errors.push(`${path}.drinkingDayKey must be YYYY-MM-DD`);
  }
  if (!isIsoDateTime(value.startedAt)) errors.push(`${path}.startedAt must be an ISO date-time`);
  if (value.closedAt !== undefined && !isIsoDateTime(value.closedAt)) {
    errors.push(`${path}.closedAt must be an ISO date-time`);
  }
  if (value.status !== 'active' && value.status !== 'closed' && value.status !== 'conflict') {
    errors.push(`${path}.status is invalid`);
  }
  if (!Array.isArray(value.drinks)) {
    errors.push(`${path}.drinks must be an array`);
  } else {
    value.drinks.forEach((drink, index) =>
      validateDrinkSpec(drink, `${path}.drinks[${index}]`, errors),
    );
  }
  validateStringArray(value.removedDrinkIds, `${path}.removedDrinkIds`, errors, validateUuid);
  return errors.length === 0;
}

function validateCommand(value: unknown, path: string, errors: string[]): value is WearableCommand {
  if (!isRecord(value) || typeof value.type !== 'string') {
    errors.push(`${path} must be a command object`);
    return false;
  }
  switch (value.type) {
    case 'set_target':
      hasOnlyKeys(value, ['type', 'target'], path, errors);
      requireKeys(value, ['type', 'target'], path, errors);
      validateTarget(value.target, `${path}.target`, errors);
      break;
    case 'clear_target':
      hasOnlyKeys(value, ['type'], path, errors);
      break;
    case 'start_evening_and_add_drink':
      hasOnlyKeys(value, ['type', 'eveningId', 'pub', 'drinkingDayKey', 'drink'], path, errors);
      requireKeys(value, ['type', 'eveningId', 'pub', 'drinkingDayKey', 'drink'], path, errors);
      validateUuid(value.eveningId, `${path}.eveningId`, errors);
      validatePubRef(value.pub, `${path}.pub`, errors);
      if (typeof value.drinkingDayKey !== 'string' || !DRINKING_DAY_RE.test(value.drinkingDayKey)) {
        errors.push(`${path}.drinkingDayKey must be YYYY-MM-DD`);
      }
      validateDrinkSpec(value.drink, `${path}.drink`, errors);
      break;
    case 'add_drink':
      hasOnlyKeys(value, ['type', 'eveningId', 'drink'], path, errors);
      requireKeys(value, ['type', 'eveningId', 'drink'], path, errors);
      validateUuid(value.eveningId, `${path}.eveningId`, errors);
      validateDrinkSpec(value.drink, `${path}.drink`, errors);
      break;
    case 'remove_drink':
      hasOnlyKeys(value, ['type', 'eveningId', 'drinkId', 'reason'], path, errors);
      requireKeys(value, ['type', 'eveningId', 'drinkId', 'reason'], path, errors);
      validateUuid(value.eveningId, `${path}.eveningId`, errors);
      validateUuid(value.drinkId, `${path}.drinkId`, errors);
      if (value.reason !== 'undo' && value.reason !== 'correction') {
        errors.push(`${path}.reason must be undo or correction`);
      }
      break;
    case 'close_evening':
      hasOnlyKeys(value, ['type', 'eveningId', 'closedAt'], path, errors);
      requireKeys(value, ['type', 'eveningId', 'closedAt'], path, errors);
      validateUuid(value.eveningId, `${path}.eveningId`, errors);
      if (!isIsoDateTime(value.closedAt)) {
        errors.push(`${path}.closedAt must be an ISO date-time`);
      }
      break;
    case 'resolve_evening_conflict':
      hasOnlyKeys(value, ['type', 'activeEveningId'], path, errors);
      requireKeys(value, ['type', 'activeEveningId'], path, errors);
      validateUuid(value.activeEveningId, `${path}.activeEveningId`, errors);
      break;
    default:
      errors.push(`${path}.type is unsupported`);
  }
  return errors.length === 0;
}

function validateEnvelopeBase(
  value: Record<string, unknown>,
  errors: string[],
): void {
  requireKeys(
    value,
    [
      'protocolVersion',
      'messageId',
      'accountEpoch',
      'actorId',
      'actorKind',
      'actorSequence',
      'baseRevision',
      'sentAt',
      'kind',
      'payload',
    ],
    '$',
    errors,
  );
  if (value.protocolVersion !== WEARABLE_PROTOCOL_VERSION) {
    errors.push('$.protocolVersion is unsupported');
  }
  validateUuid(value.messageId, '$.messageId', errors);
  validateUuid(value.accountEpoch, '$.accountEpoch', errors);
  if (
    typeof value.actorId !== 'string' ||
    value.actorId.length < 1 ||
    value.actorId.length > 128
  ) {
    errors.push('$.actorId must contain 1..128 characters');
  }
  if (
    typeof value.actorKind !== 'string' ||
    !ACTOR_KINDS.has(value.actorKind as WearableActorKind)
  ) {
    errors.push('$.actorKind is invalid');
  }
  if (
    typeof value.actorSequence !== 'number' ||
    !Number.isInteger(value.actorSequence) ||
    value.actorSequence < 1
  ) {
    errors.push('$.actorSequence must be a positive integer');
  }
  if (
    typeof value.baseRevision !== 'number' ||
    !Number.isInteger(value.baseRevision) ||
    value.baseRevision < 0
  ) {
    errors.push('$.baseRevision must be a non-negative integer');
  }
  if (!isIsoDateTime(value.sentAt)) errors.push('$.sentAt must be an ISO date-time');
}

function validateSnapshotPayload(value: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('$.payload must be an object');
    return;
  }
  hasOnlyKeys(
    value,
    [
      'revision',
      'target',
      'activeEvening',
      'otherEvenings',
      'nearbyPubs',
      'recentDrinks',
      'frequentDrinks',
      'menuDrinks',
      'pendingCommandCount',
      'isStale',
      'lastPhoneContactAt',
    ],
    '$.payload',
    errors,
  );
  requireKeys(
    value,
    [
      'revision',
      'target',
      'activeEvening',
      'otherEvenings',
      'nearbyPubs',
      'recentDrinks',
      'frequentDrinks',
      'menuDrinks',
      'pendingCommandCount',
      'isStale',
    ],
    '$.payload',
    errors,
  );
  if (typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 0) {
    errors.push('$.payload.revision must be a non-negative integer');
  }
  if (value.target !== null) validateTarget(value.target, '$.payload.target', errors);
  if (value.activeEvening !== null) {
    validateEvening(value.activeEvening, '$.payload.activeEvening', errors);
  }
  for (const [key, validator] of [
    ['otherEvenings', validateEvening],
    ['nearbyPubs', validatePubRef],
  ] as const) {
    const items = value[key];
    if (!Array.isArray(items)) errors.push(`$.payload.${key} must be an array`);
    else items.forEach((item, index) => validator(item, `$.payload.${key}[${index}]`, errors));
  }
  for (const key of ['recentDrinks', 'frequentDrinks', 'menuDrinks'] as const) {
    const items = value[key];
    if (!Array.isArray(items)) errors.push(`$.payload.${key} must be an array`);
    else {
      items.forEach((item, index) =>
        validateDrinkChoice(item, `$.payload.${key}[${index}]`, errors),
      );
    }
  }
  if (
    typeof value.pendingCommandCount !== 'number' ||
    !Number.isInteger(value.pendingCommandCount) ||
    value.pendingCommandCount < 0
  ) {
    errors.push('$.payload.pendingCommandCount must be a non-negative integer');
  }
  if (typeof value.isStale !== 'boolean') errors.push('$.payload.isStale must be boolean');
  if (value.lastPhoneContactAt !== undefined && !isIsoDateTime(value.lastPhoneContactAt)) {
    errors.push('$.payload.lastPhoneContactAt must be an ISO date-time');
  }
}

export function parseWearableEnvelope(
  input: unknown,
): WearableValidationResult<WearableEnvelope> {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ['$ must be an object'] };
  hasOnlyKeys(
    input,
    [
      'protocolVersion',
      'messageId',
      'accountEpoch',
      'actorId',
      'actorKind',
      'actorSequence',
      'baseRevision',
      'sentAt',
      'kind',
      'payload',
    ],
    '$',
    errors,
  );
  validateEnvelopeBase(input, errors);

  if (input.kind === 'command') {
    if (!isRecord(input.payload)) errors.push('$.payload must be an object');
    else {
      hasOnlyKeys(input.payload, ['command'], '$.payload', errors);
      requireKeys(input.payload, ['command'], '$.payload', errors);
      validateCommand(input.payload.command, '$.payload.command', errors);
    }
  } else if (input.kind === 'state_snapshot') {
    validateSnapshotPayload(input.payload, errors);
  } else if (input.kind === 'ack') {
    if (!isRecord(input.payload)) errors.push('$.payload must be an object');
    else {
      hasOnlyKeys(input.payload, ['acknowledgedMessageIds', 'revision'], '$.payload', errors);
      requireKeys(input.payload, ['acknowledgedMessageIds', 'revision'], '$.payload', errors);
      validateStringArray(
        input.payload.acknowledgedMessageIds,
        '$.payload.acknowledgedMessageIds',
        errors,
        validateUuid,
      );
      if (
        typeof input.payload.revision !== 'number' ||
        !Number.isInteger(input.payload.revision) ||
        input.payload.revision < 0
      ) {
        errors.push('$.payload.revision must be a non-negative integer');
      }
    }
  } else {
    errors.push('$.kind is unsupported');
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, value: input as unknown as WearableEnvelope };
}

export function parseWearableCommandEnvelope(
  input: unknown,
): WearableValidationResult<WearableCommandEnvelope> {
  const result = parseWearableEnvelope(input);
  if (!result.ok) return result;
  if (result.value.kind !== 'command') {
    return { ok: false, errors: ['$.kind must be command'] };
  }
  return { ok: true, value: result.value };
}
