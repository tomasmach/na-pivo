import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { loadMyRatings, type MyRatings } from './model';

/** My stars, reloaded whenever the screen comes back into view (after rating a beer). */
export function useMyRatings(): MyRatings {
  const [ratings, setRatings] = useState<MyRatings>(() => new Map());
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      void loadMyRatings(controller.signal).then((next) => {
        if (!controller.signal.aborted) setRatings(next);
      });
      return () => controller.abort();
    }, []),
  );
  return ratings;
}
