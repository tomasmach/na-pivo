import type { Pub } from '@/data/pubs';
import { t } from '@/i18n';

export type PubHoursTone = 'open' | 'closed' | 'unknown';

/** `HH:MM` straight out of a Europe/Prague ISO stamp — no `Intl`, see OpenStatusChip. */
export function hoursTimeFromIso(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const tIndex = iso.indexOf('T');
  if (tIndex === -1) return null;
  const hhmm = iso.slice(tIndex + 1, tIndex + 6);
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

/** Today's one-line hours status for a pub: "Otevřeno do 23:00" and its tone. */
export function pubHoursLine(pub: Pub): { label: string | null; tone: PubHoursTone } {
  const loading = pub.hoursStatus === 'loading' || pub.hoursStatus === 'pending';
  if (loading && pub.isOpenNow == null) return { label: null, tone: 'unknown' };

  const time = hoursTimeFromIso(pub.nextChange);
  if (pub.isOpenNow === true) {
    return { label: time ? t.compass.openUntil(time) : t.compass.openNow, tone: 'open' };
  }
  if (pub.isOpenNow === false) {
    return { label: time ? t.compass.closedUntil(time) : t.compass.closedNow, tone: 'closed' };
  }
  return { label: t.compass.hoursUnknown, tone: 'unknown' };
}
