/**
 * Release notes that ship inside the app instead of coming from the backend.
 *
 * 2.1.0's Czech apology and 2.1.1's fixes must reach people who update even
 * offline, so they are bundled as full-screen pagers. releaseStore still owns
 * who sees them: fresh installs record the baseline silently, and an existing
 * install sees each note only after its version changes.
 */

import { locale, t } from '@/i18n';

import type { ReleaseNote } from './releaseNotesClient';

export function localReleaseNote(version: string): ReleaseNote | null {
  if (version === '2.1.0' && locale === 'cs') {
    return { version, title: '', items: [], pager: true };
  }
  if (version === '2.1.1') {
    const copy = t.whatsNew.fixed211;
    return {
      version,
      title: t.whatsNew.defaultTitle,
      items: [copy.slide1Title, copy.slide2Title, copy.slide3Title].map((text) => ({
        icon: '',
        text,
      })),
      pager: true,
    };
  }
  return null;
}
