import type { Strings } from '../cs';

export const commonEn: Strings['nv']['common'] = {
  tabKompas: 'Compass',
  tabVycep: 'Taproom',
  tabStamgast: 'Regular',
  tabPiva: 'Beers',
  tabParta: 'Crew',
  close: 'Close',
  stepUp: 'Add',
  stepDown: 'Remove',
  duration: (hours, minutes) => (hours > 0 ? (minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`) : `${minutes} min`),
};
