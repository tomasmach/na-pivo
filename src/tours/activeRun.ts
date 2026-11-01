import { useEffect } from 'react';
import { useToursStore } from '@/stores/toursStore';
import type { TourRun } from './model';

/**
 * The tour being walked right now, or null. Every screen that shows or hides
 * something for a running tour reads it from here, so they agree.
 */
export function useActiveTourRun(): TourRun | null {
  useEffect(() => { void useToursStore.getState().hydrate(); }, []);
  return useToursStore((s) => s.activeRun);
}
