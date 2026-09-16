/**
 * Release notes that ship inside the app instead of coming from the backend.
 *
 * 2.1.0 brought the simple app back after the 2.0 redesign. The apology for
 * that has to reach everyone who updated, including people opening the app
 * offline in a pub, so it is bundled here and rendered as a full-screen pager
 * (ReleasePagerModal) rather than fetched. releaseStore still owns WHO sees
 * it: a fresh install records the baseline silently and never gets a note,
 * only an install whose last seen version differs from the running one does.
 *
 * Czech only for now: an English UI falls through to the regular backend note.
 */

import { locale } from '@/i18n';

import type { ReleaseNote } from './releaseNotesClient';

export const LOCAL_PAGER_VERSION = '2.1.0';

export function localReleaseNote(version: string): ReleaseNote | null {
  if (version !== LOCAL_PAGER_VERSION || locale !== 'cs') return null;
  return { version, title: '', items: [], pager: true };
}
