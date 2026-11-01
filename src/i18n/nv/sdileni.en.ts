// English mirror of ./sdileni.cs.ts. Keys must match (en.test.ts).
import { englishPlural } from '../enHelpers';
import type { sdileniCs } from './sdileni.cs';

const BEERS = { one: 'BEER', other: 'BEERS' };

export const sdileniEn: typeof sdileniCs = {
  shareTitle: 'Share',
  whenLabel: "When you'll be there",
  now: 'Now',
  nowSticker: 'now',
  otherTime: 'Other time',
  toInstagram: 'Add to Instagram',
  sendLink: 'Send a link',
  saveSticker: 'Save the sticker',
  inInstagram: 'The sticker is in Instagram.',
  copied: 'The sticker is on your clipboard. Paste it into your story.',
  linkCopied: 'Link copied.',
  shareError: "The sticker couldn't be prepared. Try again.",

  inviteTitle: 'Invite your crew',
  stickerToInstagram: 'Sticker to Instagram',
  sendInvite: 'Send an invite',
  sendInviteSub: 'Friends get the invite in the app',
  publicLink: 'Share a public link',
  publicLinkSub: 'For anyone, even without the app',

  stickersTitle: 'Story sticker',
  kindTacek: 'Coaster',
  kindCedule: 'Sign',
  kindCislo: 'Big number',
  saveToPhotos: 'Save to Photos',
  shareElsewhere: 'Share elsewhere',

  consentTitle: 'Who sees what',
  consentBody: 'One setting for posted nights, ratings and photos. Change it here anytime.',
  shareAll: 'Share with everyone',
  shareAllOn: 'Everyone in Na pivo sees it',
  shareAllOff: 'Only your crew sees it',
  consentDay: 'A beer shows only the day, not the hour.',
  consentPrivate: 'Spending, location and individual beers stay yours.',
  consentReport: 'Every review can be reported.',
  done: 'Done',

  stickerJduNa: 'OFF FOR',
  stickerPivo: 'BEER',
  stickerKdoJde: "WHO'S UP",
  stickerNaPivo: 'FOR A BEER?',
  stickerBrand: 'NA PIVO',
  stickerSite: 'na-pivo.cz',
  stickerCount: (n: number) => `${n} ${englishPlural(n, BEERS)}`,
  stickerCountNoun: (n: number) => englishPlural(n, BEERS),
  stickerSince: (time: string) => `SINCE ${time}`,
  stickerToday: 'TODAY',
  stickerSitting: "TONIGHT I'M AT",
  stickerTotal: 'TOTAL',
  stickerTimes: (n: number) => `${n}×`,
};
