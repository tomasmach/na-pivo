import { useEffect, useMemo, useState } from 'react';

import { geohash8 } from '@/data/geohash';
import {
  fetchPubAmenities,
  type WireAmenityAggregate,
  type WirePubAmenities,
} from '@/data/pubAmenitiesClient';
import {
  readPubAmenitiesSnapshot,
  writePubAmenitiesSnapshot,
} from '@/data/pubAmenitiesSnapshot';
import type { Pub } from '@/data/pubs';

const BATCH_SIZE = 60;

interface AmenityDirectoryState {
  signature: string;
  byKey: Map<string, WireAmenityAggregate[]>;
}

function batches<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function mergeRemote(
  keyBatches: readonly (readonly string[])[],
  responses: readonly (WirePubAmenities[] | null)[],
  cached: ReadonlyMap<string, WireAmenityAggregate[]>,
): Map<string, WireAmenityAggregate[]> {
  const byKey = new Map(cached);
  responses.forEach((response, index) => {
    if (response == null) return;
    for (const key of keyBatches[index] ?? []) byKey.set(key, []);
    for (const pub of response ?? []) byKey.set(pub.cache_key, pub.amenities);
  });
  return byKey;
}

export function usePubAmenities(
  pubs: readonly Pub[],
): ReadonlyMap<string, WireAmenityAggregate[]> {
  const signature = useMemo(
    () => [...new Set(pubs.map((pub) => geohash8(pub.lat, pub.lng)))].join(','),
    [pubs],
  );
  const [state, setState] = useState<AmenityDirectoryState>({
    signature: '',
    byKey: new Map(),
  });

  useEffect(() => {
    if (!signature) return;
    const keys = signature.split(',');
    const keyBatches = batches(keys, BATCH_SIZE);
    const controller = new AbortController();
    let active = true;

    const load = async () => {
      const snapshots = await Promise.all(
        keys.map(async (key) => ({ key, cached: await readPubAmenitiesSnapshot(key) })),
      );
      if (!active || controller.signal.aborted) return;
      const byKey = new Map<string, WireAmenityAggregate[]>();
      for (const { key, cached } of snapshots) {
        if (cached) byKey.set(key, cached.amenities);
      }
      setState({ signature, byKey });

      const responses = await Promise.all(
        keyBatches.map((batch) => fetchPubAmenities(batch, controller.signal)),
      );
      if (!active || controller.signal.aborted) return;
      if (responses.every((response) => response == null)) return;
      const refreshed = mergeRemote(keyBatches, responses, byKey);
      setState({ signature, byKey: refreshed });
      for (const response of responses) {
        for (const pub of response ?? []) {
          void writePubAmenitiesSnapshot(pub.cache_key, {
            amenities: pub.amenities,
            completeness: pub.completeness,
            mapperCount: pub.mapper_count,
          });
        }
      }
    };
    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [signature]);

  return useMemo(
    () => (state.signature === signature ? state.byKey : new Map()),
    [signature, state],
  );
}
