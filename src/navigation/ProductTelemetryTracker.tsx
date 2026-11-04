import { useEffect, useRef } from 'react';
import { usePathname } from 'expo-router';

import { productScreenFromPathname, trackScreenViewed, type ProductScreenName } from '@/data/productTelemetry';

/**
 * Tracks coarse screen usage after account hydration. Dynamic route parameters
 * never leave the device; productTelemetry collapses them to fixed names first.
 */
export function ProductTelemetryTracker({ enabled }: { enabled: boolean }) {
  const pathname = usePathname();
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
