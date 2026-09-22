import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { checkLocationPermission } from '@/compass/permissions';
import type { LatLng } from '@/compass/distance';
import { getAllLoadedPubs, hydratePubsSnapshot } from '@/data/pubs';
import type { WireVisit } from '@/data/visitsClient';
import { loadVisitsSnapshot, subscribeVisitsBoundary, visitsSnapshotGeneration } from '@/data/visitsSnapshot';
import { useAccountStore } from '@/stores/accountStore';
import { usePubStore } from '@/stores/pubStore';
import { allSessionsNewestFirst, useTallyStore } from '@/stores/tallyStore';
import { buildPubSuggestions } from './pubSuggestions';

const POSITION_MAX_AGE_MS = 5 * 60 * 1000;

/** Read existing catalogue/history and a recent OS fix. Opening search never
 * requests permission, starts discovery, or spends an external search call. */
export function usePubSuggestions() {
  const [pubs, setPubs] = useState(getAllLoadedPubs);
  const [cachedVisits, setCachedVisits] = useState<WireVisit[]>([]);
  const [privateDataAvailable, setPrivateDataAvailable] = useState(true);
  const [position, setPosition] = useState<LatLng | null>(null);
  const current = useTallyStore((state) => state.current);
  const history = useTallyStore((state) => state.history);
  const diary = useAccountStore((state) => state.diarySnapshot?.accountId === state.session?.accountId
    ? state.diarySnapshot : null);
  const catalogRevision = usePubStore((state) => state.catalogRevision);
  const reportedIds = usePubStore((state) => state.reportedPubIds);
  const reportedKeys = usePubStore((state) => state.reportedCacheKeys);

  useEffect(() => {
    let active = true;
    void hydratePubsSnapshot().then(() => { if (active) setPubs(getAllLoadedPubs()); });
    return () => { active = false; };
  }, [catalogRevision]);

  useEffect(() => {
    let active = true;
    const generation = visitsSnapshotGeneration();
    const unsubscribe = subscribeVisitsBoundary(() => {
      setPrivateDataAvailable(false);
      setCachedVisits([]);
    });
    void loadVisitsSnapshot().then((visits) => {
      if (active && generation === visitsSnapshotGeneration()) setCachedVisits(visits);
    });
    return () => { active = false; unsubscribe(); };
  }, []);

  useFocusEffect(useCallback(() => {
    let active = true;
    let request = 0;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      const serial = ++request;
      clearTimeout(expiry);
      setPosition(null);
      try {
        if (await checkLocationPermission() !== 'granted') return;
        const fix = await Location.getLastKnownPositionAsync({ maxAge: POSITION_MAX_AGE_MS, requiredAccuracy: 100 });
        if (!active || serial !== request || AppState.currentState !== 'active' || !fix) return;
        const remaining = POSITION_MAX_AGE_MS - (Date.now() - fix.timestamp);
        if (remaining <= 0 || remaining > POSITION_MAX_AGE_MS) return;
        setPosition({ lat: fix.coords.latitude, lng: fix.coords.longitude });
        expiry = setTimeout(() => setPosition(null), remaining);
      } catch {
        // Suggestions from private history remain useful without GPS.
      }
    };
    void refresh();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
      else { request += 1; clearTimeout(expiry); setPosition(null); }
    });
    return () => { active = false; request += 1; clearTimeout(expiry); subscription.remove(); };
  }, []));

  const suggestions = useMemo(() => buildPubSuggestions({
    pubs,
    localSessions: privateDataAvailable ? allSessionsNewestFirst(current, history) : [],
    serverVisits: privateDataAvailable ? diary?.data.visits ?? cachedVisits : [],
    position,
    reportedIds,
    reportedKeys,
  }), [pubs, current, history, diary, cachedVisits, privateDataAvailable, position, reportedIds, reportedKeys]);

  return { ...suggestions, pubs };
}
