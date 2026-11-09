import type { BeerPhoto, BeerPhotoVisibility, PartaFeedPhoto } from '@/data/beerPhotosClient';
import { t } from '@/i18n';
import type { BeerPhotoLocal } from '@/stores/beerPhotosStore';

import { clock, personInitial, personName, shortDay } from './partaModel';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type ViewerPhoto = {
  key: string;
  uri: string;
  title: string;
  pubName: string;
  takenAt: string;
  caption: string;
  visibility: BeerPhotoVisibility;
  /** `id` makes the author open their profile from the viewer. */
  author: { initial: string; name: string; short: string; id?: string };
};

export function photoWhen(iso: string, now = new Date()): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) / 86_400_000);
  if (days === 0) return t.nv.parta.photoToday(clock(iso));
  if (days === 1) return t.nv.parta.photoYesterday(clock(iso));
  return shortDay(iso);
}

export function author(profile: { displayName: string; nickname: string | null }) {
  const name = personName(profile);
  return { initial: personInitial(profile), name, short: profile.displayName.trim().split(/\s+/)[0] || name };
}

export function fromRemote(photo: BeerPhoto, who: ViewerPhoto['author']): ViewerPhoto {
  return {
    key: photo.id,
    uri: photo.imageUrl,
    title: photo.beerName || photo.pubName || t.nv.vycep.photoFallbackTitle,
    pubName: photo.beerName ? photo.pubName : '',
    takenAt: photo.takenAt || photo.createdAt,
    caption: photo.caption,
    visibility: photo.visibility,
    author: who,
  };
}

export function fromMine(photo: BeerPhotoLocal, who: ViewerPhoto['author']): ViewerPhoto | null {
  const uri = photo.imageUrl ?? photo.localUri ?? null;
  if (!uri) return null;
  return {
    key: photo.id ?? photo.clientId,
    uri,
    title: photo.beerName || photo.pubName || t.nv.vycep.photoFallbackTitle,
    pubName: photo.beerName ? photo.pubName : '',
    takenAt: photo.takenAt || photo.createdAt,
    caption: photo.caption,
    visibility: photo.visibility,
    author: who,
  };
}

/** The strip in Parta: my photos the party sees and theirs, from the last week, newest first. */
export function partaStripPhotos(feed: PartaFeedPhoto[], mine: BeerPhotoLocal[], now: number, me: ViewerPhoto['author']): ViewerPhoto[] {
  const since = now - WEEK_MS;
  const own = mine
    .filter((p) => p.visibility !== 'private' && Date.parse(p.takenAt || p.createdAt) >= since)
    .map((p) => fromMine(p, me))
    .filter((p): p is ViewerPhoto => !!p);
  const theirs = feed.map((p) => fromRemote(p, author(p.account)));
  return [...own, ...theirs].sort((a, b) => Date.parse(b.takenAt) - Date.parse(a.takenAt));
}
