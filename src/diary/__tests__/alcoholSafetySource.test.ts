/**
 * Static source regressions for the alcohol-safety cleanup of the diary and
 * profile surfaces. Reads production sources as text — no rendering, no
 * fixtures, no global scans.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '..', '..', '..');

const readSource = (...segments: string[]): string =>
  fs.readFileSync(path.join(ROOT, ...segments), 'utf8');

describe('DiaryScreen static regressions', () => {
  const source = readSource('src', 'diary', 'DiaryScreen.tsx');

  it.each([
    'cs.diary.factPace',
    'cs.diary.statsMonthAvgLabel',
    'cs.diary.statsYearAvg',
    'recordRows',
    'computeRecords',
    'plausibleFastestBeerMs',
  ])('no longer contains %s', (forbidden) => {
    expect(source).not.toContain(forbidden);
  });

  it.each([
    'cs.diary.factSpent',
    'cs.diary.factSpan',
    'cs.diary.statsRatings',
    'cs.diary.statsWalked',
    'records={[]}',
  ])('still contains %s', (required) => {
    expect(source).toContain(required);
  });
});

describe('DiaryStatsSheet static regressions', () => {
  const source = readSource('src', 'diary', 'DiaryStatsSheet.tsx');

  it('does not render a records section', () => {
    expect(source).not.toContain('renderSection(cs.diary.statsRecordsTitle');
  });

  it('still declares the backward-compatible records prop', () => {
    expect(source).toContain('records: StatRow[]');
  });

  it('still renders pubs and years sections', () => {
    expect(source).toContain('renderSection(cs.diary.statsPubsTitle');
    expect(source).toContain('renderSection(cs.diary.statsYearsTitle');
  });
});

describe('ProfileMockScreen static regressions', () => {
  const source = readSource('src', 'profile', 'ProfileMockScreen.tsx');

  it.each([
    'profileTimeline',
    'profileRecords',
    'streakBest',
    'title="Série"',
    'title="Rekordy"',
    'styles.week',
    'styles.record',
  ])('no longer contains %s', (forbidden) => {
    expect(source).not.toContain(forbidden);
  });

  it.each(['profileSeries', 'BarChart', 'StatGrid', 'PhotoDiarySection'])(
    'still contains %s',
    (required) => {
      expect(source).toContain(required);
    },
  );
});
