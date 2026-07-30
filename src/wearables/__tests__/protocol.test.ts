import customBeerFixture from '../../../wearables/shared/fixtures/custom-beer-command.v1.json';
import removeDrinkFixture from '../../../wearables/shared/fixtures/remove-drink-command.v1.json';
import snapshotFixture from '../../../wearables/shared/fixtures/state-snapshot.v1.json';
import startFixture from '../../../wearables/shared/fixtures/start-evening-command.v1.json';

import {
  isConcreteDrinkName,
  parseWearableCommandEnvelope,
  parseWearableEnvelope,
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
