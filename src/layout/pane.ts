import { createContext, useContext } from 'react';

/** The four tabs, each with its own right-hand page stack on a wide window. */
export type BookTab = 'kompas' | 'stamgast' | 'parta' | 'profil';
export type PaneSide = 'primary' | 'secondary';

export interface PaneInfo {
  tab: BookTab;
  side: PaneSide;
}

/** Which half a component renders in; null outside a tab's spread (pushed routes, root modals). */
export const PaneContext = createContext<PaneInfo | null>(null);

export function usePane(): PaneInfo | null {
  return useContext(PaneContext);
}

/**
 * One amber button per window: the right half of a wide window is `quiet`, so
 * its primary buttons fall back to the secondary style.
 */
export type Tone = 'primary' | 'quiet';

export const ToneContext = createContext<Tone>('primary');

export function useTone(): Tone {
  return useContext(ToneContext);
}
