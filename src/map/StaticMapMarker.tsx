import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Marker, type MapMarker, type MapMarkerProps } from 'react-native-maps';

const SnapshotRefreshContext = createContext<() => void>(() => undefined);

/**
 * Re-take the marker bitmap after content that does not change layout, such
 * as a remote avatar finishing its load or failing over to an initial.
 */
export function useMarkerSnapshotRefresh(): () => void {
  return useContext(SnapshotRefreshContext);
}

interface StaticMapMarkerProps extends Omit<MapMarkerProps, 'tracksViewChanges'> {
  /** A new value re-takes the bitmap: after the map changes size Google can lose the one it froze. */
  redraw?: number;
}

/** Remount with a new key whenever the marker's visual content changes. */
export function StaticMapMarker({ children, redraw = 0, ...props }: StaticMapMarkerProps) {
  const [tracking, setTracking] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const settleSnapshot = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setTracking(true);
    // Android snapshots before nested text/SVG finishes drawing. Freeze only
    // after layout has settled, otherwise it keeps an empty or partial bitmap.
    timer.current = setTimeout(() => setTracking(false), 160);
  }, []);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const marker = useRef<MapMarker>(null);
  useEffect(() => {
    if (redraw > 0) marker.current?.redraw();
  }, [redraw]);

  return (
    <Marker ref={marker} {...props} tracksViewChanges={tracking}>
      {/* Fabric must measure the whole marker, not a flattened inner circle. */}
      <View collapsable={false} onLayout={settleSnapshot}>
        <SnapshotRefreshContext.Provider value={settleSnapshot}>
          {children}
        </SnapshotRefreshContext.Provider>
      </View>
    </Marker>
  );
}
