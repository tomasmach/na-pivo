/**
 * Release notes that ship inside the app instead of coming from the backend.
 *
 * 2.1.0's Czech apology, 2.1.1's fixes and 2.2.0's features must reach people
 * who update even offline, so they are bundled as full-screen pagers.
 * releaseStore still owns who sees them: fresh installs record the baseline
 * silently, and an existing install sees each note only after its version
 * changes.
 */

import { locale, t } from '@/i18n';

import type { ReleaseNote } from './releaseNotesClient';

export function localReleaseNote(version: string): ReleaseNote | null {
  if (version === '2.1.0' && locale === 'cs') {
    return { version, title: '', items: [], pager: true };
  }
  if (version === '2.1.1') {
    const copy = t.whatsNew.fixed211;
    return pagerNote(version, [copy.slide1Title, copy.slide2Title, copy.slide3Title]);
  }
  if (version === '2.2.0') {
    const copy = t.whatsNew.v220;
    return pagerNote(version, [
      copy.slide1Title,
      copy.slide2Title,
      copy.slide3Title,
      copy.slide4Title,
    ]);
  }
  return null;
}

function pagerNote(version: string, titles: string[]): ReleaseNote {
  return {
    version,
    title: t.whatsNew.defaultTitle,
    items: titles.map((text) => ({ icon: '', text })),
    pager: true,
  };
}
