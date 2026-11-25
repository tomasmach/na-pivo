import { commonCs } from './common.cs';
import { kompasCs } from './kompas.cs';
import { pivaCs } from './piva.cs';
import { vycepCs } from './vycep.cs';
import { stamgastCs } from './stamgast.cs';
import { tourCs } from './tour.cs';
import { partaCs } from './parta.cs';
import { profilCs } from './profil.cs';
import { sdileniCs } from './sdileni.cs';

// One file per area so parallel work on the new look never edits the same copy file.
export const nvCs = {
  common: commonCs,
  kompas: kompasCs,
  piva: pivaCs,
  vycep: vycepCs,
  stamgast: stamgastCs,
  tour: tourCs,
  parta: partaCs,
  profil: profilCs,
  sdileni: sdileniCs,
};
