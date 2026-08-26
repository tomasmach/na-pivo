import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getBackendEndpoint } from '@/data/backendConfig';
import type { AmenityKey } from '@/data/amenities';
import { FALLBACK_XP_RULES } from '@/data/mapperXp';
import {
  fetchPubAmenities,
  submitAmenityVotesDetailed,
  type WireAmenityAggregate,
  type WireAmenityCompleteness,
} from '@/data/pubAmenitiesClient';
import {
  readPubAmenitiesSnapshot,
  writePubAmenitiesSnapshot,
} from '@/data/pubAmenitiesSnapshot';
import { buildAmenityVoteWire } from '@/data/pubAmenitiesSync';
import {
  buildAmenityRows,
  type AmenityRow,
} from '@/data/pubAmenitiesView';
import { pubIdentityKey } from '@/data/pubIdentity';
import { runPrivateAccountMutation } from '@/data/privateAccountBoundary';
import { t } from '@/i18n';
import { useAccountStore } from '@/stores/accountStore';
import {
  selectPubVotes,
  usePubAmenitiesStore,
  type AmenityVote,
} from '@/stores/pubAmenitiesStore';
import { useToastStore } from '@/stores/toastStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { fireLightImpactHaptic } from '@/utils/haptics';

const XP_COALESCE_MS = 600;

export interface PubAmenityMapping {
  rows: AmenityRow[];
  aggregatesResolved: boolean;
  backendConfigured: boolean;
  serverCompleteness: WireAmenityCompleteness | null;
  onVote: (row: AmenityRow, half: AmenityVote) => void;
}

/**
 * Controller for the redesigned detail's inline amenity voting. It keeps the
 * legacy mapper flow's optimistic store, offline queue, aggregate refresh and
 * Mapér XP behavior while letting the detail own only the row layout.
 */
export function usePubAmenityMapping({
  visible,
  pubKey,
  pubName,
}: {
  visible: boolean;
  pubKey: string;
  pubName: string;
}): PubAmenityMapping {
  const identityKey = useMemo(() => pubIdentityKey(pubKey, pubName), [pubKey, pubName]);
  const myVotes = usePubAmenitiesStore(selectPubVotes(identityKey));
  const setVote = usePubAmenitiesStore((state) => state.setVote);
  const showToast = useToastStore((state) => state.show);
  const applyMapperSnapshot = useAccountStore((state) => state.applyMapperSnapshot);
  const [resource, setResource] = useState<{
    identityKey: string;
    aggregates: WireAmenityAggregate[] | undefined;
    completeness: WireAmenityCompleteness | null;
  }>({ identityKey, aggregates: undefined, completeness: null });
  const currentResource = resource.identityKey === identityKey ? resource : null;
  const currentAggregates = currentResource?.aggregates;
  const currentCompleteness = currentResource?.completeness ?? null;

  useEffect(() => {
    if (!visible || !pubKey) return;
    let cancelled = false;
    const controller = new AbortController();

    void readPubAmenitiesSnapshot(identityKey).then((cached) => {
      if (cancelled || !cached) return;
      setResource({
        identityKey,
        aggregates: cached.amenities,
        completeness: cached.completeness,
      });
    });

    void fetchPubAmenities([pubKey], controller.signal, pubName).then((pubs) => {
      if (cancelled || !pubs) return;
      const pub = pubs.find((candidate) => candidate.cache_key === pubKey) ?? pubs[0];
      if (!pub) {
        setResource({ identityKey, aggregates: [], completeness: null });
        return;
      }
      setResource({
        identityKey,
        aggregates: pub.amenities,
        completeness: pub.completeness ?? null,
      });
      void writePubAmenitiesSnapshot(identityKey, {
        amenities: pub.amenities,
        completeness: pub.completeness,
        mapperCount: pub.mapper_count,
      });
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [identityKey, pubKey, pubName, visible]);

  const rows = useMemo(
    () => buildAmenityRows({ aggregates: currentAggregates, myVotes }),
    [currentAggregates, myVotes],
  );
  const backendConfigured = getBackendEndpoint('/v1/pub-amenities/votes') != null;

  const xpAccum = useRef({ count: 0, xp: 0 });
  const xpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushXpToast = useCallback(() => {
    const { count, xp } = xpAccum.current;
    xpAccum.current = { count: 0, xp: 0 };
    if (count === 0 || xp <= 0) return;
    showToast(t.mapPub.xpSession(count, xp));
  }, [showToast]);

  const scheduleXpToast = useCallback(() => {
    if (xpTimer.current) clearTimeout(xpTimer.current);
    xpTimer.current = setTimeout(() => {
      xpTimer.current = null;
      flushXpToast();
    }, XP_COALESCE_MS);
  }, [flushXpToast]);

  useEffect(
    () => () => {
      if (xpTimer.current) clearTimeout(xpTimer.current);
      flushXpToast();
    },
    [flushXpToast],
  );

  const onVote = useCallback(
    (row: AmenityRow, half: AmenityVote) => {
      if (useSettingsStore.getState().hapticEnabled) fireLightImpactHaptic();
      const next: AmenityVote | null = row.myValue === half ? null : half;
      const wasUnanswered = row.myValue == null;
      const clientUpdatedAt = new Date().toISOString();

      // The installed store subscriber persists this first, then flushes it.
      // The direct request below only enriches the live UI with aggregate + XP.
      setVote(identityKey, row.amenityKey as AmenityKey, next);

      if (next == null && !wasUnanswered) {
        showToast(t.mapPub.retracted);
      }

      if (!backendConfigured) {
        if (next != null && wasUnanswered) {
          const rules = useAccountStore.getState().profile?.mapper?.xpRules ?? FALLBACK_XP_RULES;
          xpAccum.current.count += 1;
          xpAccum.current.xp +=
            row.signalState === 'unmapped' || row.signalState === 'loading'
              ? rules.firstFact
              : rules.confirm;
          scheduleXpToast();
        }
        return;
      }

      const wire = buildAmenityVoteWire({
        pubKey,
        pubName,
        amenityKey: row.amenityKey as AmenityKey,
        value: next,
        clientUpdatedAt,
      });
      void runPrivateAccountMutation((scope) =>
        submitAmenityVotesDetailed([wire], scope.signal),
      ).then((result) => {
        if (result.status !== 'ok' || !result.body) return;
        const voteResult = result.body.results[0];
        const aggregate = voteResult?.aggregate;
        if (aggregate) {
          setResource((current) => ({
            identityKey,
            aggregates: mergeAggregate(
              current.identityKey === identityKey ? current.aggregates : undefined,
              aggregate,
            ),
            completeness:
              current.identityKey === identityKey ? current.completeness : null,
          }));
        }
        if (voteResult?.was_first_map && voteResult.xp_awarded > 0) {
          showToast(t.mapPub.xpFirstMapper(voteResult.xp_awarded));
        } else if (voteResult && voteResult.xp_awarded > 0) {
          xpAccum.current.count += 1;
          xpAccum.current.xp += voteResult.xp_awarded;
          scheduleXpToast();
        }

        const mapper = result.body.mapper;
        if (!mapper) return;
        applyMapperSnapshot({
          xp: mapper.xp,
          level: mapper.level,
          title: mapper.title,
          xpIntoLevel: mapper.xp_into_level,
          xpForNextLevel: mapper.xp_for_next_level,
          distinctMappedPubs: mapper.distinct_mapped_pubs,
          amenityVotesCount: mapper.amenity_votes_count,
          firstMapperCount: mapper.first_mapper_count,
          completedPubsCount: mapper.completed_pubs_count,
        });
      }).catch(() => undefined);
    },
    [
      applyMapperSnapshot,
      backendConfigured,
      identityKey,
      pubKey,
      pubName,
      scheduleXpToast,
      setVote,
      showToast,
    ],
  );

  return {
    rows,
    aggregatesResolved: currentAggregates !== undefined,
    backendConfigured,
    serverCompleteness: currentCompleteness,
    onVote,
  };
}

function mergeAggregate(
  current: WireAmenityAggregate[] | undefined,
  fresh: WireAmenityAggregate,
): WireAmenityAggregate[] {
  const base = current ?? [];
  const index = base.findIndex((aggregate) => aggregate.amenity_key === fresh.amenity_key);
  if (index < 0) return [...base, fresh];
  const next = base.slice();
  next[index] = fresh;
  return next;
}
