// Czech copy for the new look, area: common. English mirror in ./common.en.ts.
export const commonCs = {
  tabKompas: 'Kompas',
  tabVycep: 'Výčep',
  tabStamgast: 'Štamgast',
  tabPiva: 'Piva',
  tabParta: 'Parta',
  close: 'Zavřít',
  stepUp: 'Přidat',
  stepDown: 'Ubrat',
  duration: (hours: number, minutes: number) =>
    hours > 0 ? (minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`) : `${minutes} min`,
};
