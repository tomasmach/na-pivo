import { createContext, useContext } from 'react';

/**
 * Where a piece of UI is laid out. `single` is a whole screen (a phone, the
 * folded Duo, a screen over the tabs), `left` and `right` the halves of a tab
 * on the open book.
 */
export interface Pane {
  tab: string | null;
  side: 'single' | 'left' | 'right';
  width: number;
}

const PaneContext = createContext<Pane | null>(null);
export const PaneProvider = PaneContext.Provider;

export function usePane(): Pane | null {
  return useContext(PaneContext);
}
