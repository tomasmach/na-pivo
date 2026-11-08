// Czech copy for the new look, area: common. English mirror in ./common.en.ts.
import { czechPlural } from '../plural';

export const commonCs = {
  tabKompas: 'Kompas',
  tabMapa: 'Mapa',
  tabVycep: 'Výčep',
  tabStamgast: 'Štamgast',
  tabPiva: 'Piva',
  tabParta: 'Parta',
  close: 'Zavřít',
  stepUp: 'Přidat',
  stepDown: 'Ubrat',
  duration: (hours: number, minutes: number) =>
    hours > 0 ? (minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`) : `${minutes} min`,
  secretPub: 'Tajná hospoda',
  secretPubs: (n: number) => (n === 1 ? 'Tajná hospoda' : czechPlural(n, { one: `${n} tajná hospoda`, few: `${n} tajné hospody`, many: `${n} tajných hospod` })),
  secretReveal: 'Ťukni a prozradím kam',
  secretHidesIn: (seconds: number) => `Za ${seconds} s ho zase schovám`,
};
