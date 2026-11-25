
import { intlLocale } from '@/i18n';
import type { TourPlan } from './model';

/** "pá 2. 10. · 19:00 · Vinohradský pivovar": when and where the tour starts. */
export function inviteDetail(plan: Pick<TourPlan, 'scheduledDate' | 'scheduledTime' | 'stops'>): string {
  const day = plan.scheduledDate
    ? new Date(`${plan.scheduledDate}T12:00:00Z`).toLocaleDateString(intlLocale, { weekday: 'short', day: 'numeric', month: 'numeric', timeZone: 'UTC' })
    : null;
  return [day, plan.scheduledDate ? plan.scheduledTime?.slice(0, 5) : null, plan.stops[0]?.name].filter(Boolean).join(' · ');
}
