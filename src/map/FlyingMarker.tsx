import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Marker, type MapMarker, type MapMarkerProps } from 'react-native-maps';
import { DURATION, EASE_ENTER } from '@/newlook/motion';

import { useMarkerSnapshot } from './StaticMapMarker';

type Point = { lat: number; lng: number };
type Props = Omit<MapMarkerProps, 'coordinate' | 'tracksViewChanges'> & {
  at: Point;
  /** Where the marker starts its first flight; without it the marker appears where it rests. */
  from: Point | null;
  snapshot: string;
  /** Whether a person can see this spot; a flight nobody sees is skipped. */
  seen: (at: Point) => boolean;
  /** Jumps to `at` instead of flying there. */
  still: boolean;
};

/**
 * A marker that flies to `at` whenever `at` changes. The flight moves the native marker with
 * commands, so no frame of it re-renders React or commits the view tree.
 */
export function FlyingMarker({ at, from, snapshot, seen, still, children, ...props }: Props) {
  const marker = useRef<MapMarker>(null);
  const [rest, setRest] = useState(() => (from && (seen(from) || seen(at)) ? { lat: from.lat, lng: from.lng } : { lat: at.lat, lng: at.lng }));
  const here = useRef(rest);
  const { tracking, onLayout } = useMarkerSnapshot(snapshot);

  const { lat, lng } = at;
  useEffect(() => {
    const begin = here.current;
    if (begin.lat === lat && begin.lng === lng) return;
    const flies = !still && (seen(begin) || seen({ lat, lng }));
    const ease = EASE_ENTER.factory();
    let startedAt: number | null = null;
    let frame = requestAnimationFrame(function step(time) {
      startedAt ??= time;
      const progress = flies ? Math.min(1, (time - startedAt) / DURATION.base) : 1;
      const eased = ease(progress);
      here.current = progress < 1 ? { lat: begin.lat + (lat - begin.lat) * eased, lng: begin.lng + (lng - begin.lng) * eased } : { lat, lng };
      marker.current?.setCoordinates({ latitude: here.current.lat, longitude: here.current.lng });
      if (progress < 1) frame = requestAnimationFrame(step);
      else setRest(here.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [lat, lng, seen, still]);

  return (
    <Marker {...props} ref={marker} coordinate={{ latitude: rest.lat, longitude: rest.lng }} tracksViewChanges={tracking}>
      {/* Fabric must measure the whole marker, not a flattened inner circle. */}
      <View collapsable={false} onLayout={onLayout}>
        {children}
      </View>
    </Marker>
  );
}
