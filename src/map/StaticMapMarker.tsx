import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Marker, type MapMarkerProps } from 'react-native-maps';

/**
 * Lets a marker follow its view only until the view settles. `snapshot` changes whenever the
 * marker's content does, so its picture is taken again.
 */
export function useMarkerSnapshot(snapshot?: string) {
  const [tracking, setTracking] = useState(true);
  const [taken, setTaken] = useState(snapshot);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (taken !== snapshot) {
    setTaken(snapshot);
    setTracking(true);
  }

  // Android snapshots before nested text/SVG finishes drawing. Freeze only
  // after layout has settled, otherwise it keeps an empty or partial bitmap.
  const settle = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setTracking(false), 160);
  }, []);

  const onLayout = useCallback(() => {
    setTracking(true);
    settle();
  }, [settle]);

  useEffect(() => {
    settle();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [settle, snapshot]);

  return { tracking, onLayout };
}

/** Remount with a new key whenever the marker's visual content changes. */
export function StaticMapMarker({ children, ...props }: Omit<MapMarkerProps, 'tracksViewChanges'>) {
  const { tracking, onLayout } = useMarkerSnapshot();
  return (
    <Marker {...props} tracksViewChanges={tracking}>
      {/* Fabric must measure the whole marker, not a flattened inner circle. */}
      <View collapsable={false} onLayout={onLayout}>
        {children}
      </View>
    </Marker>
  );
}
