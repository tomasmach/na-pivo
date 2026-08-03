/**
 * DESIGN MOCK — nights you have published, waiting at the top of the feed.
 *
 * Separate from `useLivePartyStore` on purpose: ending a night resets that
 * store, and the whole point of publishing is that the evening survives it. The
 * feed reads this first and the canned entries after, so a night you just posted
 * is the first thing you see when you land in Kocoviny.
 *
 * A mock. The real thing is a `PartyEvening` on the server, and this store is
 * the shape of what the client will keep locally while the post is in flight —
 * the offline rule (`AGENTS.md`) says a published night must not disappear
 * because the request has not landed yet.
 */

import { create } from 'zustand';

import type { FeedEntry } from '@/feed/mockFeed';

interface PublishedState {
  entries: FeedEntry[];
  publish: (entry: FeedEntry) => void;
  clear: () => void;
}

export const usePublishedStore = create<PublishedState>((set) => ({
  entries: [],
  publish: (entry) => set((s) => ({ entries: [entry, ...s.entries] })),
  clear: () => set({ entries: [] }),
}));
