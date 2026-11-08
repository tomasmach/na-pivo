import type { Strings } from '../cs';
import { englishPlural } from '../enHelpers';

export const commonEn: Strings['nv']['common'] = {
  tabKompas: 'Compass',
  tabMapa: 'Map',
  tabVycep: 'Taproom',
  tabStamgast: 'Regular',
  tabPiva: 'Beers',
  tabParta: 'Crew',
  close: 'Close',
  stepUp: 'Add',
  stepDown: 'Remove',
  duration: (hours, minutes) => (hours > 0 ? (minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`) : `${minutes} min`),
  secretPub: 'Secret pub',
  secretPubs: (n) => (n === 1 ? 'Secret pub' : englishPlural(n, { one: `${n} secret pub`, other: `${n} secret pubs` })),
  secretReveal: "Tap and I'll tell you where",
  secretHidesIn: (seconds) => `Hiding it again in ${seconds} s`,
};
