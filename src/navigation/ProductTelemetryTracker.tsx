import { useEffect, useRef } from 'react';
import { usePathname } from 'expo-router';

import { productScreenFromPathname, trackScreenViewed, type ProductScreenName } from '@/data/productTelemetry';
import { useBookLayout } from '@/layout/bookLayout';
import { pagePathname, tabForPathname } from '@/layout/openDetail';
import { useBookStore } from '@/stores/bookStore';

/**
 * Tracks coarse screen usage after account hydration. Dynamic route parameters
 * never leave the device; productTelemetry collapses them to fixed names first.
 *
 * On a wide window the page in the tab's right half counts as if it were pushed
 * over the tab, so opening, going back and moving a pushed route into the half
 * read the same as on a phone.
 */
export function ProductTelemetryTracker({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
  const { wide } = useBookLayout();
  const tab = tabForPathname(pathname);
  const page = useBookStore((state) => (wide && tab ? state.pages[tab].at(-1) : undefined));
  const viewed = page ? pagePathname(page) : pathname;
  const previousPathnameRef = useRef<string | null>(null);
  const previousScreenRef = useRef<ProductScreenName | undefined>(undefined);

  useEffect(() => {
    if (!enabled || previousPathnameRef.current === viewed) return;
    previousPathnameRef.current = viewed;

    const screen = productScreenFromPathname(viewed);
    if (!screen) return;
    trackScreenViewed(screen, previousScreenRef.current);
    previousScreenRef.current = screen;
  }, [enabled, viewed]);

  return null;
}
