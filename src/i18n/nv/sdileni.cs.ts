// Czech copy for the new look, area: sdileni. English mirror in ./sdileni.en.ts.
import { czechPlural } from '../plural';

const PIVA = { one: 'PIVO', few: 'PIVA', many: 'PIV' };

export const sdileniCs = {
  // Sdílet hospodu
  shareTitle: 'Sdílet',
  whenLabel: 'Kdy tam budeš',
  now: 'Teď',
  nowSticker: 'teď',
  otherTime: 'Jiný čas',
  toInstagram: 'Vložit do Instagramu',
  sendLink: 'Poslat odkaz',
  saveSticker: 'Uložit nálepku',
  inInstagram: 'Nálepka je v Instagramu.',
  copied: 'Nálepka je ve schránce. Vlož ji do story.',
  linkCopied: 'Odkaz zkopírovaný.',
  shareError: 'Nálepku se nepovedlo připravit. Zkus to znovu.',

  // Pozvat partu na tour
  inviteTitle: 'Pozvat partu',
  stickerToInstagram: 'Nálepka do Instagramu',
  sendInvite: 'Poslat pozvánku',
  sendInviteSub: 'Kámoši dostanou pozvánku v appce',
  publicLink: 'Sdílet veřejný odkaz',
  publicLinkSub: 'Pro kohokoli, i bez appky',

  // Nálepka na story
  stickersTitle: 'Nálepka na story',
  kindTacek: 'Tácek',
  kindCedule: 'Cedule',
  kindCislo: 'Velké číslo',
  saveToPhotos: 'Uložit do fotek',
  savedToPhotos: 'Nálepka je ve Fotkách.',
  photosDeniedTitle: 'Do Fotek nemůžu',
  photosDeniedBody: 'Povol v Nastavení, ať ti Na pivo může přidávat do Fotek, a zkus to znovu.',
  photosDeniedBack: 'Zpátky',
  openSettings: 'Otevřít Nastavení',
  shareElsewhere: 'Sdílet jinam',

  // Kdo co vidí
  consentTitle: 'Kdo co vidí',
  consentBody: 'Jedno nastavení pro vyvěšené noci, hodnocení i fotky. Změníš ho kdykoli tady.',
  shareAll: 'Sdílet všem',
  shareAllOn: 'Uvidí to každý v Na pivo',
  shareAllOff: 'Uvidí to jen tvoje parta',
  consentDay: 'U piva je jen den, ne hodina.',
  consentPrivate: 'Útrata, poloha a jednotlivá piva zůstávají jen tobě.',
  consentReport: 'Každou recenzi jde nahlásit.',
  done: 'Hotovo',

  // Text on the stickers themselves
  stickerJduNa: 'JDU NA',
  stickerPivo: 'PIVO',
  stickerKdoJde: 'KDO JDE',
  stickerNaPivo: 'NA PIVO?',
  stickerBrand: 'NA PIVO',
  stickerSite: 'na-pivo.cz',
  stickerCount: (n: number) => `${n} ${czechPlural(n, PIVA)}`,
  stickerCountNoun: (n: number) => czechPlural(n, PIVA),
  stickerSince: (time: string) => `OD ${time}`,
  stickerToday: 'DNES',
  stickerSitting: 'DNES SEDÍM',
  stickerTotal: 'CELKEM',
  stickerTimes: (n: number) => `${n}×`,
};
