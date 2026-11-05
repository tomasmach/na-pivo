import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';

import { AMENITIES, type AmenityKey } from '@/data/amenities';
import { POPULAR_BEER_BRANDS } from '@/data/beerSuggestionsClient';
import { geohash8 } from '@/data/geohash';
import { getAllLoadedPubs } from '@/data/pubs';
import { MAX_AMENITY_FILTERS, backendPubSearchFilterKey, pubMatchesPriceFilter } from '@/data/pubSearchFilters';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { t } from '@/i18n';
import { pubOpeningVerdict } from '@/map/mapModel';
import { usePubStore } from '@/stores/pubStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { openHomeInMaps } from '@/utils/maps';

import { ButtonPair, Sheet } from '../../components/overlays';
import { Card, Chip, ChipWrap, Row, T, Toggle } from '../../components/ui';
import type { IconName } from '../../components/Icon';
import { toast } from '../../ui/store';
import { C } from '../../theme';
import { setOpenOnly, setSurprise, toggleAmenityFilter, useKompasState } from './state';

const BEER_KEYS = ['pilsner-urquell', 'velkopopovicky-kozel', 'gambrinus', 'radegast', 'budweiser-budvar', 'staropramen'];
const BEER_CHIPS = BEER_KEYS.map((key) => POPULAR_BEER_BRANDS.find((b) => b.key === key)).filter((b) => b !== undefined);

const FUN: [AmenityKey, () => string, IconName][] = [
  ['game_darts', () => t.nv.kompas.categories.darts, 'target'],
  ['game_billiards', () => t.nv.kompas.billiards, 'circle-dot'],
  ['game_foosball', () => t.nv.kompas.foosball, 'goal'],
  ['atmosphere_sports_tv', () => t.nv.kompas.categories.sportsTv, 'tv'],
];

const PRACTICAL_ICONS: [AmenityKey, IconName][] = [
  ['payment_card', 'credit-card'],
  ['seating_barrier_free', 'accessibility'],
  ['practical_wifi', 'wifi'],
  ['practical_parking', 'car'],
  ['practical_vape_friendly', 'wind'],
];
const PRACTICAL = PRACTICAL_ICONS.map(([key, icon]) => ({ key, icon, label: AMENITIES.find((a) => a.key === key)?.label ?? key }));

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 12 }}>
      <T s={15} w={700} c={C.muted}>
        {title}
      </T>
      <ChipWrap>{children}</ChipWrap>
    </View>
  );
}

export function FiltrySheet() {
  const router = useRouter();
  const L = t.nv.kompas;
  const st = useKompasState();
  const { filters } = st;
  const openOnly = useSettingsStore((s) => s.hideClosedPubs);
  const surprise = useSettingsStore((s) => s.mode === 'surprise');
  const reportedIds = usePubStore((s) => s.reportedPubIds);
  const reportedKeys = usePubStore((s) => s.reportedCacheKeys);
  // The catalogue in memory answers only for the server filters it was loaded with;
  // a new beer or amenity is counted after the next search, not guessed here.
  const [openedWithKey] = React.useState(() => backendPubSearchFilterKey(filters));
  const countKnown = backendPubSearchFilterKey(filters) === openedWithKey;
  const count = useMemo(() => {
    if (!countKnown) return null;
    return getAllLoadedPubs().filter(
      (pub) =>
        pub.venueKind !== 'not_pub' &&
        !reportedIds.includes(pub.id) &&
        !reportedKeys.includes(geohash8(pub.lat, pub.lng)) &&
        (filters.includeOtherPlaces || pub.discoveryKind === undefined || pub.discoveryKind === 'pub') &&
        !(openOnly && pubOpeningVerdict(pub) === false) &&
        pubMatchesPriceFilter(pub, filters.priceMinCzk, filters.priceMaxCzk),
    ).length;
  }, [countKnown, filters, openOnly, reportedIds, reportedKeys]);
  const homePoint = useSettingsStore((s) => s.homePoint);
  const toggleAmenity = (key: AmenityKey) => {
    if (!toggleAmenityFilter(key)) toast({ kind: 'info', title: L.amenityLimit(MAX_AMENITY_FILTERS), icon: 'sliders-horizontal' });
  };
  const navigateHome = () => {
    if (!homePoint) {
      router.push('/nv/domovsky-bod');
      return;
    }
    nvBack(router);
    openHomeInMaps(homePoint).catch(() => toast({ kind: 'error', title: L.navigationFailed, icon: 'navigation' }));
  };
  const garden = filters.amenityKeys.includes('seating_garden');
  const stands = filters.includeOtherPlaces === true;
  return (
    <Sheet
      title={L.filtersTitle}
      footer={
        <ButtonPair
          left={L.cancel}
          right={count === null ? L.showPubsUnknown : count ? L.showPubs(count) : L.nothingFits}
          onLeft={() => nvBack(router)}
          onRight={() => {
            trackUiInteraction('compass_filters_apply', 'submit');
            nvBack(router);
          }}
        />
      }
    >
      <Card>
        <Row
          title={L.openOnly}
          sub={L.openOnlySub}
          trailing={
            <Toggle
              value={openOnly}
              onChange={(on) => {
                trackUiInteraction('settings_hide_closed', on ? 'toggle_on' : 'toggle_off');
                setOpenOnly(on);
              }}
            />
          }
        />
        <Row
          title={L.surprise}
          sub={L.surpriseSub}
          trailing={
            <Toggle
              value={surprise}
              onChange={(on) => {
                trackUiInteraction(on ? 'compass_mode_surprise' : 'compass_mode_nearest', 'select');
                setSurprise(on);
              }}
            />
          }
        />
        <Row
          last
          title={L.navigateHome}
          trailing={homePoint ? undefined : <T s={15} c={C.muted}>{L.homeUnset}</T>}
          chevron
          onPress={navigateHome}
        />
      </Card>
      <Group title={L.beerGroup}>
        {BEER_CHIPS.map((brand) => (
          <Chip
            key={brand.key}
            label={brand.key === 'pilsner-urquell' ? brand.label : brand.short}
            active={filters.beerBrand?.key === brand.key}
            onPress={() => st.setFilters({ beerBrand: filters.beerBrand?.key === brand.key ? null : { key: brand.key, label: brand.label } })}
          />
        ))}
        {filters.beerBrand && !BEER_KEYS.includes(filters.beerBrand.key) ? (
          <Chip label={filters.beerBrand.label} active onPress={() => st.setFilters({ beerBrand: null })} />
        ) : null}
        <Chip label={L.otherBeer} icon="search" onPress={() => router.push('/nv/hledani')} />
      </Group>
      <Group title={L.priceGroup}>
        {[50, 60, 70].map((p) => (
          <Chip key={p} label={L.maxPriceChip(p)} active={filters.priceMaxCzk === p} onPress={() => st.setFilters({ priceMaxCzk: filters.priceMaxCzk === p ? null : p })} />
        ))}
      </Group>
      <Group title={L.funGroup}>
        {FUN.map(([key, label, icon]) => {
          const on = filters.amenityKeys.includes(key);
          return <Chip key={key} label={label()} icon={on ? 'check' : icon} active={on} onPress={() => toggleAmenity(key)} />;
        })}
      </Group>
      <Group title={L.placesGroup}>
        <Chip label={L.categories.garden} icon={garden ? 'check' : 'trees'} active={garden} onPress={() => toggleAmenity('seating_garden')} />
        <Chip label={L.standsAndCamps} icon={stands ? 'check' : 'tent'} active={stands} onPress={() => st.setFilters({ includeOtherPlaces: !stands })} />
      </Group>
      <Group title={L.practicalGroup}>
        {PRACTICAL.map(({ key, icon, label }) => {
          const on = filters.amenityKeys.includes(key);
          return <Chip key={key} label={label} icon={on ? 'check' : icon} active={on} onPress={() => toggleAmenity(key)} />;
        })}
      </Group>
    </Sheet>
  );
}
