import customBeerFixture from '../../../wearables/shared/fixtures/custom-beer-command.v1.json';
import removeDrinkFixture from '../../../wearables/shared/fixtures/remove-drink-command.v1.json';
import snapshotFixture from '../../../wearables/shared/fixtures/state-snapshot.v1.json';
import startFixture from '../../../wearables/shared/fixtures/start-evening-command.v1.json';

import {
  isConcreteDrinkName,
  parseWearableCommandEnvelope,
  parseWearableEnvelope,
  type WearableStateSnapshotEnvelope,
} from '../protocol';

describe('wearable protocol v1', () => {
  it('accepts every canonical golden fixture', () => {
    expect(parseWearableEnvelope(startFixture)).toEqual({ ok: true, value: startFixture });
    expect(parseWearableEnvelope(customBeerFixture)).toEqual({
      ok: true,
      value: customBeerFixture,
    });
    expect(parseWearableEnvelope(snapshotFixture)).toEqual({ ok: true, value: snapshotFixture });
    expect(parseWearableEnvelope(removeDrinkFixture)).toEqual({
      ok: true,
      value: removeDrinkFixture,
    });
  });

  it('canonicalizes Swift UUID casing without mutating actor identity or input', () => {
    const swiftCommand = structuredClone(startFixture);
    swiftCommand.messageId = swiftCommand.messageId.toUpperCase();
    swiftCommand.accountEpoch = swiftCommand.accountEpoch.toUpperCase();
    swiftCommand.actorId = 'watchOS-Swift-UUID';
    swiftCommand.payload.command.eveningId =
      swiftCommand.payload.command.eveningId.toUpperCase();
    swiftCommand.payload.command.drink.id =
      swiftCommand.payload.command.drink.id.toUpperCase();
    const original = structuredClone(swiftCommand);

    const result = parseWearableCommandEnvelope(swiftCommand);

    expect(swiftCommand).toEqual(original);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      messageId: startFixture.messageId,
      accountEpoch: startFixture.accountEpoch,
      actorId: 'watchOS-Swift-UUID',
      payload: {
        command: {
          eveningId: startFixture.payload.command.eveningId,
          drink: { id: startFixture.payload.command.drink.id },
        },
      },
    });
  });

  it('canonicalizes nested snapshot tombstones and acknowledgement ids', () => {
    const snapshot = structuredClone(
      snapshotFixture,
    ) as unknown as WearableStateSnapshotEnvelope;
    const tombstoneId = '6041778d-3a81-44ec-a0ad-e428ce795330';
    const otherEveningId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const otherDrinkId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    snapshot.messageId = snapshot.messageId.toUpperCase();
    snapshot.accountEpoch = snapshot.accountEpoch.toUpperCase();
    if (!snapshot.payload.activeEvening) throw new Error('fixture must have an active evening');
    snapshot.payload.activeEvening.eveningId =
      snapshot.payload.activeEvening.eveningId.toUpperCase();
    snapshot.payload.activeEvening.drinks[0].id =
      snapshot.payload.activeEvening.drinks[0].id.toUpperCase();
    snapshot.payload.activeEvening.removedDrinkIds = [
      tombstoneId.toUpperCase(),
    ];
    snapshot.payload.otherEvenings = [
      {
        ...structuredClone(snapshot.payload.activeEvening),
        eveningId: otherEveningId.toUpperCase(),
        status: 'conflict',
        drinks: [
          {
            ...structuredClone(snapshot.payload.activeEvening.drinks[0]),
            id: otherDrinkId.toUpperCase(),
          },
        ],
        removedDrinkIds: [],
      },
    ];

    const snapshotResult = parseWearableEnvelope(snapshot);
    expect(snapshotResult.ok).toBe(true);
    if (!snapshotResult.ok || snapshotResult.value.kind !== 'state_snapshot') {
      return;
    }
    expect(snapshotResult.value.payload.activeEvening).toMatchObject({
      eveningId: snapshotFixture.payload.activeEvening?.eveningId,
      drinks: [
        { id: snapshotFixture.payload.activeEvening?.drinks[0].id },
      ],
      removedDrinkIds: [tombstoneId],
    });
    expect(snapshotResult.value.payload.otherEvenings[0]).toMatchObject({
      eveningId: otherEveningId,
      drinks: [{ id: otherDrinkId }],
    });

    const ackId = '0fa34236-bbd6-4f15-aaf6-ed531ba85a51';
    const ackInput = {
      protocolVersion: 1,
      messageId: '2866F494-79BE-44FF-8A50-AF527C86D9E0',
      accountEpoch: '83D78467-DA0D-4BED-9D75-D99A5E50C63B',
      actorId: 'phone-bridge-CaseSensitive',
      actorKind: 'phone',
      actorSequence: 1,
      baseRevision: 0,
      sentAt: '2026-07-30T19:01:00+02:00',
      kind: 'ack',
      payload: {
        acknowledgedMessageIds: [ackId.toUpperCase()],
        revision: 0,
      },
    };
    const ackResult = parseWearableEnvelope(ackInput);
    expect(ackResult.ok).toBe(true);
    if (!ackResult.ok || ackResult.value.kind !== 'ack') return;
    expect(ackResult.value).toMatchObject({
      messageId: '2866f494-79be-44ff-8a50-af527c86d9e0',
      accountEpoch: '83d78467-da0d-4bed-9d75-d99a5e50c63b',
      actorId: 'phone-bridge-CaseSensitive',
      payload: { acknowledgedMessageIds: [ackId] },
    });
  });

  it('rejects UUID identities that only differ by letter casing', () => {
    const duplicateId = '6041778d-3a81-44ec-a0ad-e428ce795330';
    const snapshot = structuredClone(
      snapshotFixture,
    ) as unknown as WearableStateSnapshotEnvelope;
    if (!snapshot.payload.activeEvening) throw new Error('fixture must have an active evening');
    snapshot.payload.activeEvening.removedDrinkIds = [
      duplicateId,
      duplicateId.toUpperCase(),
    ];
    expect(parseWearableEnvelope(snapshot).ok).toBe(false);

    const duplicateEveningSnapshot = structuredClone(
      snapshotFixture,
    ) as unknown as WearableStateSnapshotEnvelope;
    if (!duplicateEveningSnapshot.payload.activeEvening) {
      throw new Error('fixture must have an active evening');
    }
    duplicateEveningSnapshot.payload.otherEvenings = [
      {
        ...structuredClone(duplicateEveningSnapshot.payload.activeEvening),
        eveningId:
          duplicateEveningSnapshot.payload.activeEvening.eveningId.toUpperCase(),
        status: 'conflict',
        drinks: [],
      },
    ];
    expect(parseWearableEnvelope(duplicateEveningSnapshot).ok).toBe(false);

    const duplicateDrinkSnapshot = structuredClone(
      snapshotFixture,
    ) as unknown as WearableStateSnapshotEnvelope;
    if (!duplicateDrinkSnapshot.payload.activeEvening) {
      throw new Error('fixture must have an active evening');
    }
    duplicateDrinkSnapshot.payload.activeEvening.drinks.push({
      ...structuredClone(
        duplicateDrinkSnapshot.payload.activeEvening.drinks[0],
      ),
      id: duplicateDrinkSnapshot.payload.activeEvening.drinks[0].id.toUpperCase(),
    });
    expect(parseWearableEnvelope(duplicateDrinkSnapshot).ok).toBe(false);

    const ack = {
      ...structuredClone(startFixture),
      kind: 'ack',
      payload: {
        acknowledgedMessageIds: [duplicateId, duplicateId.toUpperCase()],
        revision: 0,
      },
    };
    expect(parseWearableEnvelope(ack).ok).toBe(false);
  });

  it('requires a concrete drink instead of a generic category', () => {
    const payload = structuredClone(startFixture);
    payload.payload.command.drink.name = 'Pivo';
    const result = parseWearableCommandEnvelope(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('concrete confirmed drink');

    expect(isConcreteDrinkName('Pilsner Urquell 12°')).toBe(true);
    expect(isConcreteDrinkName('Něco')).toBe(false);
  });

  it('accepts a custom private beer volume while keeping shot and price limits', () => {
    const customBeer = structuredClone(startFixture);
    customBeer.payload.command.drink.volumeMl = 450;
    expect(parseWearableCommandEnvelope(customBeer).ok).toBe(true);

    const shot = structuredClone(startFixture);
    shot.payload.command.drink.drinkType = 'shot';
    shot.payload.command.drink.name = 'Slivovice Jelínek';
    shot.payload.command.drink.volumeMl = 250;
    expect(parseWearableCommandEnvelope(shot).ok).toBe(false);

    const price = structuredClone(startFixture);
    price.payload.command.drink.priceCzk = 1001;
    expect(parseWearableCommandEnvelope(price).ok).toBe(false);
  });

  it('rejects token and raw user-location fields', () => {
    const withToken = {
      ...startFixture,
      bearerToken: 'must-never-cross-the-bridge',
    };
    const result = parseWearableEnvelope(withToken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('$.bearerToken is not allowed');

    const withRawLocation = structuredClone(startFixture) as typeof startFixture & {
      userLatitude?: number;
    };
    withRawLocation.userLatitude = 50.1;
    expect(parseWearableEnvelope(withRawLocation).ok).toBe(false);
  });

  it('rejects an unknown protocol major version', () => {
    expect(parseWearableEnvelope({ ...startFixture, protocolVersion: 2 }).ok).toBe(false);
  });
});
