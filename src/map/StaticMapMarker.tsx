import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Marker, type MapMarkerProps } from 'react-native-maps';

const SnapshotRefreshContext = createContext<() => void>(() => undefined);

/**
 * Re-take the marker bitmap after content that does not change layout, such
 * as a remote avatar finishing its load or failing over to an initial.
 */
export function useMarkerSnapshotRefresh(): () => void {
  return useContext(SnapshotRefreshContext);
}

/** Remount with a new key whenever the marker's visual content changes. */
export function StaticMapMarker({ children, ...props }: Omit<MapMarkerProps, 'tracksViewChanges'>) {
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

  return (
    <Marker {...props} tracksViewChanges={tracking}>
      {/* Fabric must measure the whole marker, not a flattened inner circle. */}
      <View collapsable={false} onLayout={settleSnapshot}>
        <SnapshotRefreshContext.Provider value={settleSnapshot}>
          {children}
        </SnapshotRefreshContext.Provider>
      </View>
    </Marker>
  );
}
