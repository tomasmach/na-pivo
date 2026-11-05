import { emptyWeeklyHours } from '@/data/communityHours';

import { weekRows } from '../format';

describe('weekRows', () => {
  it('joins neighbouring days with the same hours and keeps closed days and today', () => {
    const week = emptyWeeklyHours();
    for (const day of ['mo', 'tu', 'we', 'th'] as const) week[day] = [['15:00', '23:00']];
    week.fr = [['15:00', '02:00']];
    week.sa = [['11:00', '14:00'], ['17:00', '02:00']];

    expect(weekRows(week, 'tu')).toEqual([
      { from: 'mo', to: 'th', intervals: ['15:00–23:00'], today: true },
      { from: 'fr', to: 'fr', intervals: ['15:00–02:00'], today: false },
      { from: 'sa', to: 'sa', intervals: ['11:00–14:00', '17:00–02:00'], today: false },
      { from: 'su', to: 'su', intervals: [], today: false },
    ]);
  });
});
