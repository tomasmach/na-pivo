import { useEffect, useRef } from 'react';
import { usePathname } from 'expo-router';

import { productScreenFromPathname, trackScreenViewed, type ProductScreenName } from '@/data/productTelemetry';
import { detailPathname, useDetailStore } from '@/newlook/duo/detailStore';

const TAB_PATH = /^\/nv\/(kompas|vycep|stamgast|piva|parta)$/;

/**
 * Tracks coarse screen usage after account hydration. Dynamic route parameters
 * never leave the device; productTelemetry collapses them to fixed names first.
 */
export function ProductTelemetryTracker({ enabled }: { enabled: boolean }) {
  const routePathname = usePathname();
  // On the iPhone Duo a pub, friend or profile opens as a page of the tab without changing the route.
  const tab = TAB_PATH.exec(routePathname)?.[1];
  const page = useDetailStore((st) => (tab ? st.pages[tab]?.at(-1) : undefined));
  const pathname = page ? detailPathname(page) : routePathname;
  const previousPathnameRef = useRef<string | null>(null);
  const previousScreenRef = useRef<ProductScreenName | undefined>(undefined);

  useEffect(() => {
    if (!enabled || previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;

    const screen = productScreenFromPathname(pathname);
    if (!screen) return;
    trackScreenViewed(screen, previousScreenRef.current);
    previousScreenRef.current = screen;
  }, [enabled, pathname]);

  return null;
}
