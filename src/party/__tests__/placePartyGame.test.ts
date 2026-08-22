import { placePartyGameAfterTableConfirmation } from '@/party/placePartyGame';
import type { PartyEvening } from '@/data/partyClient';

const INPUT = {
  catalogKey: 'pub-quiz',
  name: 'Pub kvíz',
  scoring: 'points' as const,
};

describe('placePartyGameAfterTableConfirmation', () => {
  it('does not send a child game POST while table creation is still pending', async () => {
    let resolveTable!: (table: PartyEvening) => void;
    const startTable = jest.fn(
      () => new Promise<PartyEvening>((resolve) => {
        resolveTable = resolve;
      }),
    );
    const place = jest.fn(async () => undefined);

    const placement = placePartyGameAfterTableConfirmation({
      confirmedPartyCode: null,
      startTable,
      readConfirmedPartyCode: () => null,
      place,
      input: INPUT,
    });
    await Promise.resolve();

    expect(startTable).toHaveBeenCalledTimes(1);
    expect(place).not.toHaveBeenCalled();

    resolveTable({ joinCode: 'PIVOXY' } as PartyEvening);
    await expect(placement).resolves.toBe(true);
    expect(place).toHaveBeenCalledWith('PIVOXY', INPUT);
  });

  it('never attempts placement when table creation fails', async () => {
    const place = jest.fn(async () => undefined);

    await expect(
      placePartyGameAfterTableConfirmation({
        confirmedPartyCode: null,
        startTable: async () => null,
        readConfirmedPartyCode: () => null,
        place,
        input: INPUT,
      }),
    ).resolves.toBe(false);

    expect(place).not.toHaveBeenCalled();
  });
});
