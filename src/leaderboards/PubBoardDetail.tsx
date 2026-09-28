/**
 * PubBoardDetail — what opens when a pub on the Hospody board is tapped: the
 * same pub sheet the map and pub search show (hours, what is on tap), then
 * "Ukázat na mapě" asks which map. Ours stays in the app; Google Maps opens the
 * place outside it. The host owns showing our map.
 */

import { useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';

import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import { pubInfoFromPub } from '@/components/amenities/pubInfoContext';
import { ExternalLinkIcon, MapIcon } from '@/components/shared/IconGlyph';
import { MoreSheet } from '@/components/shared/MoreSheet';
import { geohash8 } from '@/data/geohash';
import { fetchPubHours } from '@/data/hoursClient';
import type { PubBoardEntry } from '@/data/pubBoardClient';
import type { Pub } from '@/data/pubs';
import { t } from '@/i18n';
import { useToastStore } from '@/stores/toastStore';
import { buildMapsUrl } from '@/utils/maps';

// One sheet leaves before the next arrives (§7.4).
const SHEET_DISMISS_MS = 260;

/** The same id the pub catalogue gives this place, so the map merges them. */
export function pubFromBoardEntry(entry: PubBoardEntry): Pub {
  return {
    id: `mapy:${entry.lat.toFixed(5)},${entry.lng.toFixed(5)}`,
    name: entry.name,
    lat: entry.lat,
    lng: entry.lng,
    city: entry.city || undefined,
  };
}

interface PubBoardDetailProps {
  /** The open pub; the host keeps it so the detail can fill it in. */
  pub: Pub | null;
  onPubChange: (update: (current: Pub | null) => Pub | null) => void;
  onShowOnOurMap: (pub: Pub) => void;
}

export function PubBoardDetail({ pub, onPubChange, onShowOnOurMap }: PubBoardDetailProps) {
  const [mapChoice, setMapChoice] = useState<Pub | null>(null);
  const choiceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pubId = pub?.id ?? null;

  useEffect(() => () => {
    if (choiceTimer.current) clearTimeout(choiceTimer.current);
  }, []);

  // Hours and the beer menu load after the sheet opens, as in pub search.
  useEffect(() => {
    if (!pub) return;
    const controller = new AbortController();
    const opened = pub;
    void fetchPubHours([opened], controller.signal).then((response) => {
      const details = response.get(opened.id);
      if (!details || controller.signal.aborted) return;
      onPubChange((current) => current?.id === opened.id ? {
        ...current,
        openingHours: details.openingHours,
        isOpenNow: details.isOpenNow,
        nextChange: details.nextChange,
        hoursStatus: details.status,
        communityHours: details.communityHours ?? undefined,
        beers: details.beers,
        historicalBeers: details.historicalBeers,
        beerMenuRotates: details.beerMenuRotates,
        beersUpdatedAt: details.beersUpdatedAt,
        hoursUpdatedAt: details.hoursUpdatedAt,
      } : current);
    });
    return () => controller.abort();
    // Refresh only when opening a different pub, not after filling it in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pubId]);

  const close = () => onPubChange(() => null);

  const askWhichMap = (target: Pub) => {
    close();
    if (choiceTimer.current) clearTimeout(choiceTimer.current);
    choiceTimer.current = setTimeout(() => {
      choiceTimer.current = null;
      setMapChoice(target);
    }, SHEET_DISMISS_MS);
  };

  const openGoogleMaps = (target: Pub) => {
    setMapChoice(null);
    void Linking.openURL(buildMapsUrl(target)).catch(() =>
      useToastStore.getState().show(t.leaderboards.googleMapsFailed),
    );
  };

  return (
    <>
      {pub ? (
        <MapPubSheet
          visible
          pubKey={geohash8(pub.lat, pub.lng)}
          pubName={pub.name}
          info={pubInfoFromPub(pub)}
          onClose={close}
          onRenamed={(name) => onPubChange((current) => (current ? { ...current, name } : current))}
          hoursLabel={
            typeof pub.isOpenNow === 'boolean'
              ? pub.isOpenNow
                ? t.compass.openNow
                : t.compass.closedNow
              : null
          }
          hoursTone={pub.isOpenNow === true ? 'open' : pub.isOpenNow === false ? 'closed' : 'unknown'}
          onShowMap={() => askWhichMap(pub)}
        />
      ) : null}
      <MoreSheet
        visible={mapChoice !== null}
        title={t.leaderboards.showOnMapTitle}
        onClose={() => setMapChoice(null)}
        rows={
          mapChoice
            ? [
                {
                  key: 'ours',
                  label: t.leaderboards.showOnOurMap,
                  icon: MapIcon,
                  onPress: () => {
                    setMapChoice(null);
                    onShowOnOurMap(mapChoice);
                  },
                },
                {
                  key: 'google',
                  label: t.leaderboards.showOnGoogle,
                  icon: ExternalLinkIcon,
                  onPress: () => openGoogleMaps(mapChoice),
                },
              ]
            : []
        }
      />
    </>
  );
}
