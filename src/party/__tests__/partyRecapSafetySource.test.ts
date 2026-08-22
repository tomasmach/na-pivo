import fs from 'fs';
import path from 'path';

const SCREEN_PATH = path.resolve(__dirname, '..', 'PartyRecapScreen.tsx');
const source = fs.readFileSync(SCREEN_PATH, 'utf8');

const FORBIDDEN_TOKENS = [
  'nightMvp',
  'nightBrokenRecords',
  'personalNightRecord',
  'mergeConfirmedNightBest',
  'fetchMyStats',
  'RECORD_TITLE',
  'MVP',
  'Osobní rekordy',
  'nightHourly',
  'V čase',
  'U stolu',
  'styles.rank',
  'styles.mvp',
];

const REQUIRED_CONTRACTS = [
  'beerCountLabel(person.beers)',
  "'Piva'",
  "'Večer'",
  "'Hospody'",
  'Vyhrál',
  'game.result?.scores.map',
  'night.photos.map',
  'NightRoute',
  'Share.share',
];

describe('PartyRecapScreen safety contract', () => {
  it('keeps every required contract token in the source', () => {
    const missing = REQUIRED_CONTRACTS.filter((token) => !source.includes(token));
    if (missing.length > 0) {
      throw new Error(
        `PartyRecapScreen.tsx postrádá povinné kontrakty: ${missing.join(', ')}`,
      );
    }
    expect(missing).toEqual([]);
  });


  it('contains none of the forbidden alcohol MVP/rank/records/tempo identifiers', () => {
    const hits = FORBIDDEN_TOKENS.filter((token) => source.includes(token));
    if (hits.length > 0) {
      throw new Error(
        `PartyRecapScreen.tsx obsahuje zakázané produkční tokeny: ${hits.join(', ')}`,
      );
    }
    expect(hits).toEqual([]);
  });
});
