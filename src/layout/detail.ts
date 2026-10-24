import { createContext, useContext } from 'react';
import { useLocalSearchParams } from 'expo-router';

import type { PageEntry } from '@/stores/bookStore';

/** Navigation for a page shown in the right half instead of as a pushed route. */
export interface PaneNav {
  back: () => void;
  push: (entry: PageEntry) => void;
  replace: (entry: PageEntry) => void;
  /** Empties this half and shows the compass tab, which aims at the focused pub. */
  showCompass: () => void;
}

export interface DetailContextValue {
  params: Record<string, string>;
  nav: PaneNav;
}

export const DetailContext = createContext<DetailContextValue | null>(null);

/** The page's params: from the right-half entry, else from the pushed route. */
export function useDetailParams<T extends Record<string, string | string[] | undefined>>(): T {
  const routeParams = useLocalSearchParams<T>();
  const detail = useContext(DetailContext);
  return detail ? (detail.params as T) : routeParams;
}

/** Set while the page sits in the right half; null for a pushed route. */
export function useDetailNav(): PaneNav | null {
  return useContext(DetailContext)?.nav ?? null;
}
