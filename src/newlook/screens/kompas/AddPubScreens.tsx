
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';

import { haversineMeters } from '@/compass/distance';
import { ensureLocationPermission } from '@/compass/permissions';
import { generateUuidV4 } from '@/data/account';
import { lookupAddedPubLocation, type AddedPubLocation } from '@/data/addedPubLocationClient';
import { buildAddedPubEntry } from '@/data/addedPubsClient';
import { enqueueAddedPub, loadAddedPubSubmissions, retryAddedPub, syncOwnAddedPubs, type AddedPubSubmission } from '@/data/addedPubsQueue';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { clearPubsSnapshot, pubIdForCoords, upsertLocalPub } from '@/data/pubs';
import { resolvePubSearchResult, suggestPubsToAdd, type PubSearchResult } from '@/data/pubSearchClient';
import { t } from '@/i18n';
import { usePubStore } from '@/stores/pubStore';
import { dateTimeFormat } from '@/utils/intlFormat';

import { BackHeader, Glass, GlassButton, Screen } from '../../components/chrome';
import { Field, Input, PageTitle } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { ButtonPair } from '../../components/overlays';
import { Button, Card, Chip, D, Dot, Kicker, Press, Row, Spinner, T, Tile } from '../../components/ui';
import { toast } from '../../ui/store';
import { C, SCREEN_X, s } from '../../theme';
import { distanceLabel } from './format';
import { GRAY_MAP, nearRegion } from './NvMap';
import { useKompasState } from './state';
import { useRecentPosition } from './usePubPage';

const L = () => t.nv.kompas;

type Located = AddedPubLocation & { source: 'address' | 'gps' | 'pin' };

export function PridatHospoduScreen() {
  const router = useRouter();
  const position = useRecentPosition();
  const bumpCatalogRevision = usePubStore((st) => st.bumpCatalogRevision);
  const [manual, setManual] = useState(false);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ term: string; items: PubSearchResult[] | null } | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');
  const [located, setLocated] = useState<Located | null>(null);
  const [locating, setLocating] = useState(false);
  const [lookupFailed, setLookupFailed] = useState(false);
  const request = useRef<AbortController | null>(null);
  const submitted = useRef(false);
  useEffect(() => () => request.current?.abort(), []);

  const term = q.trim();
  useEffect(() => {
    if (term.length < 3) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void suggestPubsToAdd(term, position, controller.signal).then((items) => {
        if (!controller.signal.aborted) setFound({ term, items });
      });
    }, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [position, term]);

  const lookup = useCallback(async (input: { address: string; city: string } | { lat: number; lng: number }, source: Located['source']) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLocating(true);
    setLookupFailed(false);
    const result = await lookupAddedPubLocation(input, controller.signal);
    if (controller.signal.aborted) return null;
    setLocating(false);
    setLookupFailed(!result);
    return result ? { ...result, source } : null;
  }, []);

  // The typed address is looked up once the user stops typing; a pin or GPS point stays as it is.
  useEffect(() => {
    if (!manual || located?.source === 'pin' || located?.source === 'gps') return;
    const a = address.trim();
    const c = city.trim();
    if (!a || !c) return;
    const timer = setTimeout(() => {
      void lookup({ address: a, city: c }, 'address').then((result) => {
        if (result) setLocated(result);
      });
    }, 700);
    return () => clearTimeout(timer);
    // located is read only to keep a pin; changing it must not trigger a lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, city, lookup, manual]);

  // A point aimed on the pin map comes back through the shared state.
  useFocusEffect(
    useCallback(() => {
      const pin = useKompasState.getState().pin;
      if (!pin) return;
      useKompasState.getState().set({ pin: null });
      setLocated({ lat: pin.lat, lng: pin.lng, address: address.trim(), city: city.trim(), source: 'pin' });
      setLookupFailed(false);
      void lookupAddedPubLocation(pin).then((result) => {
        if (!result) return;
        setCity((v) => v.trim() || result.city);
        setAddress((v) => v.trim() || result.address);
      });
    }, [address, city]),
  );

  const pick = async (result: PubSearchResult) => {
    Keyboard.dismiss();
    setOpening(result.id);
    const place = await resolvePubSearchResult(result);
    setOpening(null);
    setName(place?.name ?? result.name);
    setCity(place?.city ?? result.city ?? '');
    setAddress(place?.address ?? result.address ?? '');
    setManual(true);
    if (!place) return;
    const fromAddress = place.city && place.address ? { address: place.address, city: place.city } : { lat: place.lat, lng: place.lng };
    const found = await lookup(fromAddress, 'address');
    if (found) {
      setLocated(found);
      setCity(found.city);
      setAddress(found.address);
    }
  };

  const standingHere = async () => {
    trackUiInteraction('add_pub_location', 'select');
    const permission = await ensureLocationPermission({ openSettingsIfDenied: true });
    if (permission !== 'granted') {
      toast({ kind: 'error', title: L().addNoPosition, icon: 'locate-fixed' });
      return;
    }
    toast({ kind: 'saved', title: L().addTakingPosition, icon: 'locate-fixed' });
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const result = await lookup({ lat: fix.coords.latitude, lng: fix.coords.longitude }, 'gps');
      if (!result) return;
      setLocated(result);
      setCity(result.city);
      setAddress(result.address);
    } catch {
      setLocating(false);
      toast({ kind: 'error', title: L().addNoPosition, icon: 'locate-fixed' });
    }
  };

  const canSubmit = !!name.trim() && !!city.trim() && !!address.trim() && !!located && !locating;
  const add = () => {
    if (!canSubmit || !located || submitted.current) return;
    submitted.current = true;
    trackUiInteraction('add_pub_submit', 'submit');
    const clientId = generateUuidV4();
    const entry = {
      name: name.trim().slice(0, 200),
      lat: located.lat,
      lng: located.lng,
      city: city.trim(),
      address: address.trim(),
      ...(located.source === 'pin' ? { locationSource: 'map_pin' as const } : {}),
    };
    upsertLocalPub({ id: pubIdForCoords(entry.lat, entry.lng), name: entry.name, lat: entry.lat, lng: entry.lng, city: entry.city, address: entry.address, venueKind: 'pub', userAddedClientId: clientId });
    bumpCatalogRevision();
    void clearPubsSnapshot();
    void enqueueAddedPub(buildAddedPubEntry(entry, clientId)).then((state) => {
      trackUiInteraction('add_pub_submit', state === 'failed' || state === 'location-not-found' ? 'failure' : 'success');
      bumpCatalogRevision();
      if (state === 'synced') toast({ kind: 'saved', title: L().addThanks, icon: 'map-pin-plus' });
      else if (state === 'pending') toast({ kind: 'offline', title: L().addThanks, sub: L().addQueued, icon: 'cloud-upload' });
      else if (state === 'location-not-found') toast({ kind: 'error', title: L().addLocationMissing, icon: 'map-pin' });
      else toast({ kind: 'error', title: L().addRejected, icon: 'circle-alert' });
    });
    router.replace('/nv/moje-hospody');
  };

  if (!manual) {
    const results = term.length >= 3 && found?.term === term ? found.items : [];
    const searching = term.length >= 3 && found?.term !== term;
    return (
      <Screen
        header={
          <BackHeader
            onBack={() => {
              trackUiInteraction('add_pub_cancel', 'cancel');
              nvBack(router);
            }}
          />
        }
      >
        <PageTitle title={L().addTitle} intro={L().addIntro} />
        <Input
          icon="search"
          value={q}
          onChangeText={(next) => {
            setQ(next);
            setName(next);
          }}
          autoFocus
          height={52}
        />
        {searching ? <Spinner style={{ alignSelf: 'flex-start' }} /> : null}
        {results === null ? (
          <T s={14} c={C.muted}>
            {L().addSearchFailed}
          </T>
        ) : results.length ? (
          <View style={{ gap: 12 }}>
            <Kicker>{L().addNearby}</Kicker>
            <Card>
              {results.map((r, i) => (
                <Row
                  key={r.id}
                  last={i === results.length - 1}
                  leading={<Tile icon="map-pin" color={C.white} />}
                  title={r.name}
                  sub={r.location || [r.address, r.city].filter(Boolean).join(', ') || undefined}
                  trailing={
                    opening === r.id ? (
                      <Spinner />
                    ) : position && typeof r.lat === 'number' && typeof r.lng === 'number' ? (
                      <T s={14} w={600}>
                        {distanceLabel(haversineMeters(position, { lat: r.lat, lng: r.lng }))}
                      </T>
                    ) : null
                  }
                  onPress={() => void pick(r)}
                />
              ))}
            </Card>
          </View>
        ) : null}
        <Press onPress={() => setManual(true)} style={[s.row, { gap: 12, padding: 16, borderRadius: 20, backgroundColor: C.control }]}>
          <Icon name="pencil-line" size={22} color={C.white} />
          <View style={[s.fill, { gap: 2 }]}>
            <T s={16} w={700}>
              {L().addCantFind}
            </T>
            <T s={13} c={C.muted}>
              {L().addCantFindSub}
            </T>
          </View>
          <Icon name="chevron-right" size={18} color={C.muted} />
        </Press>
      </Screen>
    );
  }

  return (
    <Screen header={<BackHeader onBack={() => setManual(false)} />} footer={<Button label={L().addTitle} icon="plus" onPress={add} disabled={!canSubmit} />}>
      <PageTitle title={L().addTitle} intro={L().addManualIntro} />
      <View style={{ gap: 14 }}>
        <Field label={L().addName}>
          <Input value={name} onChangeText={setName} maxLength={200} />
        </Field>
        <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
          <Field label={L().addCity} style={{ width: 120 }}>
            <Input
              value={city}
              onChangeText={(v) => {
                setCity(v);
                if (located?.source === 'address') setLocated(null);
              }}
            />
          </Field>
          <Field label={L().addAddress} style={s.fill}>
            <Input
              value={address}
              onChangeText={(v) => {
                setAddress(v);
                if (located?.source === 'address') setLocated(null);
              }}
            />
          </Field>
        </View>
        {located || locating || lookupFailed ? (
          <View style={[s.row, { gap: 12, padding: 10, borderRadius: 20, backgroundColor: C.card }]}>
            <View style={{ width: 72, height: 72, borderRadius: 14, overflow: 'hidden', backgroundColor: C.control }}>
              {located ? (
                <>
                  <MapView
                    key={`${located.lat}-${located.lng}`}
                    provider={PROVIDER_GOOGLE}
                    style={{ flex: 1 }}
                    customMapStyle={GRAY_MAP}
                    initialRegion={{ latitude: located.lat, longitude: located.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
                    pointerEvents="none"
                    userInterfaceStyle="dark"
                  />
                  <View style={[{ position: 'absolute', left: 24, top: 24, width: 24, height: 24, borderRadius: 12, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
                    <Icon name="beer" size={12} color={C.black} />
                  </View>
                </>
              ) : (
                <View style={[s.fill, s.center]}>{locating ? <Spinner /> : <Icon name="map-pin" size={22} color={C.muted} />}</View>
              )}
            </View>
            <View style={[s.fill, { gap: 3 }]}>
              {located ? (
                <>
                  <View style={[s.row, { gap: 6 }]}>
                    <Icon name="circle-check" size={16} color={C.open} />
                    <T s={15} w={700}>
                      {L().addFoundOnMap}
                    </T>
                  </View>
                  <T s={13} w={500} c={C.muted}>
                    {[located.address || address.trim(), located.city || city.trim()].filter(Boolean).join(', ')}
                  </T>
                </>
              ) : (
                <T s={14} w={600} c={C.muted}>
                  {locating ? L().addLooking : L().addNotFoundOnMap}
                </T>
              )}
            </View>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 8 }}>
        <Kicker>{L().addWhenWrong}</Kicker>
        <Card>
          <Row
            leading={<Tile icon="locate-fixed" color={C.black} bg={C.yellow} size={36} radius={18} />}
            title={L().addStandingHere}
            titleWeight={700}
            sub={L().addStandingHereSub}
            chevron
            onPress={() => void standingHere()}
          />
          <Row
            last
            leading={<Tile icon="map-pin" bg="#FFFFFF0F" size={36} radius={18} />}
            title={L().addPin}
            titleWeight={700}
            chevron
            onPress={() => {
              trackUiInteraction('add_pub_location', 'tap');
              router.push({ pathname: '/nv/spendlik', params: located ? { lat: String(located.lat), lng: String(located.lng) } : {} });
            }}
          />
        </Card>
      </View>
    </Screen>
  );
}

export function SpendlikScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ lat?: string; lng?: string }>();
  const position = useRecentPosition();
  const mapRef = useRef<MapView>(null);
  const start = useMemo(() => {
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    return Number.isFinite(lat) && Number.isFinite(lng) && params.lat && params.lng ? { lat, lng } : null;
  }, [params.lat, params.lng]);
  const [center, setCenter] = useState<Region | null>(start ? nearRegion(start) : null);
  const centered = useRef(!!start);

  useEffect(() => {
    if (centered.current || !position) return;
    centered.current = true;
    mapRef.current?.animateToRegion(nearRegion(position), 0);
    setCenter(nearRegion(position));
  }, [position]);

  // The recent fix may be missing or stale, so the button asks for a fresh one then.
  const locate = async () => {
    let here = position;
    if (!here) {
      if ((await ensureLocationPermission({ openSettingsIfDenied: true })) !== 'granted') {
        toast({ kind: 'error', title: L().addNoPosition, icon: 'locate-fixed' });
        return;
      }
      try {
        const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        here = { lat: fix.coords.latitude, lng: fix.coords.longitude };
      } catch {
        toast({ kind: 'error', title: L().addNoPosition, icon: 'locate-fixed' });
        return;
      }
    }
    mapRef.current?.animateToRegion(nearRegion(here), 400);
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={{ flex: 1 }}
        customMapStyle={GRAY_MAP}
        initialRegion={start ? nearRegion(start) : position ? nearRegion(position) : { latitude: 49.85, longitude: 15.2, latitudeDelta: 3.6, longitudeDelta: 3.6 }}
        userInterfaceStyle="dark"
        showsPointsOfInterests={false}
        onRegionChangeComplete={setCenter}
      />
      <View pointerEvents="none" style={[{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }, s.center]}>
        <View style={{ alignItems: 'center', marginTop: -40 }}>
          <View style={[{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
            <Icon name="beer" size={22} color={C.black} />
          </View>
          <View style={{ width: 3, height: 26, backgroundColor: C.black }} />
          <View style={{ width: 14, height: 5, borderRadius: 3, backgroundColor: '#00000080' }} />
        </View>
      </View>
      <View style={[s.row, { position: 'absolute', top: insets.top + 4, left: SCREEN_X, right: SCREEN_X, gap: 10 }]}>
        <GlassButton icon="chevron-left" size={54} label={L().back} onPress={() => nvBack(router)} />
        <Glass style={[s.fill, s.row, { height: 54, borderRadius: 27, paddingHorizontal: 18, gap: 10 }]}>
          <Icon name="map-pin" size={18} color={C.yellow} />
          <T s={15} w={600}>
            {L().pinHint}
          </T>
        </Glass>
      </View>
      <View style={{ position: 'absolute', right: SCREEN_X - 4, bottom: insets.bottom + 88 }}>
        <GlassButton icon="locate-fixed" label={L().myLocation} onPress={() => void locate()} />
      </View>
      <View style={{ position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: Math.max(insets.bottom, 16) + 4 }}>
        <ButtonPair
          left={L().cancel}
          right={L().pinUse}
          rightIcon="check"
          onLeft={() => nvBack(router)}
          onRight={() => {
            // A zoomed-out country view is not an aimed pin.
            if (!center || center.latitudeDelta > 0.05) {
              toast({ kind: 'info', title: L().pinHint, icon: 'map-pin' });
              return;
            }
            trackUiInteraction('add_pub_location', 'submit');
            useKompasState.getState().set({ pin: { lat: center.latitude, lng: center.longitude } });
            nvBack(router);
            toast({ kind: 'saved', title: L().pinOk, icon: 'map-pin' });
          }}
        />
      </View>
    </View>
  );
}

export function MojeHospodyScreen() {
  const router = useRouter();
  const { city } = useLocalSearchParams<{ city?: string }>();
  const cityPubs = useKompasState((st) => st.cityPubs);
  if (city && cityPubs?.name === city) return <CityPubs name={cityPubs.name} pubs={cityPubs.pubs} />;
  return <AddedPubs onAdd={() => router.push('/nv/pridat-hospodu')} />;
}

function CityPubs({ name, pubs }: { name: string; pubs: NonNullable<ReturnType<typeof useKompasState.getState>['cityPubs']>['pubs'] }) {
  const router = useRouter();
  return (
    <Screen header={<BackHeader />}>
      <D s={44} accessibilityRole="header">
        {name}
      </D>
      <Card>
        {pubs.map((p, i) => (
          <Row
            key={p.cacheKey}
            last={i === pubs.length - 1}
            leading={<Tile icon="beer" />}
            title={p.name}
            titleWeight={700}
            sub={L().visits(p.visitCount, dateTimeFormat({ day: 'numeric', month: 'numeric' }).format(new Date(p.lastVisitedAt)))}
            chevron
            onPress={() => router.push({ pathname: '/nv/hospoda/[id]', params: { id: p.cacheKey, name: p.name, lat: String(p.lat), lng: String(p.lng) } })}
          />
        ))}
      </Card>
    </Screen>
  );
}

function AddedPubs({ onAdd }: { onAdd: () => void }) {
  const bumpCatalogRevision = usePubStore((st) => st.bumpCatalogRevision);
  const [rows, setRows] = useState<AddedPubSubmission[] | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const cached = await loadAddedPubSubmissions();
        if (!active) return;
        setRows(cached);
        await syncOwnAddedPubs();
        const fresh = await loadAddedPubSubmissions();
        if (active) setRows(fresh);
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  const retry = async (clientId: string) => {
    setRetrying(clientId);
    await retryAddedPub(clientId);
    setRows(await loadAddedPubSubmissions());
    bumpCatalogRevision();
    setRetrying(null);
  };

  const sorted = useMemo(() => [...(rows ?? [])].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)), [rows]);
  const synced = sorted.filter((r) => r.syncState === 'synced');

  return (
    <Screen header={<BackHeader />} footer={<Button label={L().addTitle} icon="plus" onPress={onAdd} />}>
      <D s={44} accessibilityRole="header">
        {L().myPubsTitle}
      </D>
      {rows === null ? (
        <Spinner style={{ marginTop: 40 }} />
      ) : sorted.length ? (
        <>
          <View style={[s.row, { gap: 16, padding: 18, borderRadius: 24, backgroundColor: C.card }]}>
            <D s={64} lh={0.9} c={C.yellow}>
              {String(synced.length)}
            </D>
            <View style={[s.fill, { gap: 4 }]}>
              <Kicker>{L().inKompas}</Kicker>
              {synced[0] ? (
                <T s={16} w={700} numberOfLines={1}>
                  {L().lastAdded(synced[0].name)}
                </T>
              ) : null}
            </View>
          </View>
          <View style={{ gap: 12 }}>
            <Kicker>{L().yourPubs}</Kicker>
            <Card>
              {sorted.map((p, i) => {
                const where = [p.city, p.address].filter(Boolean).join(' · ');
                const failed = p.syncState === 'failed';
                return (
                  <Row
                    key={p.client_id}
                    last={i === sorted.length - 1}
                    title={p.name}
                    titleWeight={700}
                    sub={
                      failed ? (
                        <View style={{ gap: 6 }}>
                          {where ? (
                            <T s={13} c={C.muted}>
                              {where}
                            </T>
                          ) : null}
                          <View style={[s.row, { gap: 5 }]}>
                            <Icon name="circle-alert" size={14} color={C.white} />
                            <T s={13} w={700}>
                              {L().failed}
                            </T>
                          </View>
                        </View>
                      ) : (
                        where || undefined
                      )
                    }
                    trailing={
                      p.syncState === 'pending' ? (
                        <View style={[s.row, { gap: 6 }]}>
                          <Icon name="cloud-upload" size={15} color={C.muted} />
                          <T s={14} c={C.muted}>
                            {L().waiting}
                          </T>
                        </View>
                      ) : failed ? (
                        retrying === p.client_id ? (
                          <Spinner />
                        ) : p.failureReason === 'location-not-found' ? null : (
                          <Chip label={L().retry} icon="rotate-cw" onPress={() => void retry(p.client_id)} />
                        )
                      ) : (
                        <View style={[s.row, { gap: 6 }]}>
                          <Dot color={C.yellow} />
                          <T s={14} w={600} c={C.yellow}>
                            {L().inKompas}
                          </T>
                        </View>
                      )
                    }
                  />
                );
              })}
            </Card>
          </View>
        </>
      ) : (
        <View style={{ marginTop: 120, gap: 18, paddingHorizontal: 8 }}>
          <Tile icon="map-pin-plus" size={64} radius={32} />
          <D s={30}>{L().myPubsEmptyTitle}</D>
          <T s={15} c={C.muted} lh={1.4} style={{ marginTop: -8 }}>
            {L().myPubsEmptyBody}
          </T>
        </View>
      )}
    </Screen>
  );
}
