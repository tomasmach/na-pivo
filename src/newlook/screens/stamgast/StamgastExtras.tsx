import React, { useEffect, useRef, useState } from 'react';
import { Image, Keyboard, Linking, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import * as Location from 'expo-location';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ensureLocationPermission } from '@/compass/permissions';
import { placeKey } from '@/counter/countDrink';
import { formatClock } from '@/counter/useAlcoholEstimate';
import { generateUuidV4 } from '@/data/account';
import { pickAndPrepareBeerPhoto } from '@/data/beerPhotoPicker';
import { enqueueBeerPhoto, persistBeerPhotoLocally } from '@/data/beerPhotosQueue';
import { useNowTick } from '@/friends/useNowTick';
import { intlLocale, t } from '@/i18n';
import { enablePubReminderNotifications } from '@/notifications/pubReminderNotifications';
import { selectIsSignedIn, selectNeedsNickname, useAccountStore } from '@/stores/accountStore';
import { useHomeTransitStore } from '@/stores/homeTransitStore';
import { useSettingsStore, type HomePoint } from '@/stores/settingsStore';
import { sessionCount, sessionTotalCzk, useTallyStore } from '@/stores/tallyStore';
import { formatDepartureTime, isUpcomingDeparture } from '@/transit/homeTransit';
import { geocodeHomeAddress } from '@/transit/homeGeocode';
import { homeTransitForCurrentEvening } from '@/transit/homeTransitSync';
import { formatPrice } from '@/utils/currency';

import { BackHeader, Screen } from '../../components/chrome';
import { Input, PageTitle } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, D, Dot, IconButton, Kicker, Press, Row, T, Tile } from '../../components/ui';
import { photo } from '../../mock/data';
import { useMock } from '../../mock/store';
import { C, SCREEN_X, font, s } from '../../theme';
import { dialog, toast } from '../../ui/store';
import { GRAY_MAP } from '../kompas/NvMap';
import { useCountPlace } from './placeStore';

const CZECHIA: Region = { latitude: 49.8175, longitude: 15.473, latitudeDelta: 4.5, longitudeDelta: 4.5 };
const STREET_DELTA = 0.014;

export function DomovskyBodScreen() {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const saved = useSettingsStore((st) => st.homePoint);
  const mapRef = useRef<MapView>(null);
  const [address, setAddress] = useState('');
  const [point, setPoint] = useState<HomePoint | null>(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const moveTo = (next: HomePoint) => {
    setPoint(next);
    setError('');
    mapRef.current?.animateToRegion({ latitude: next.lat, longitude: next.lng, latitudeDelta: STREET_DELTA, longitudeDelta: STREET_DELTA }, 300);
  };

  const find = async () => {
    const query = address.trim();
    if (!query) {
      setError(t.homePoint.emptyQueryError);
      return;
    }
    if (busy) return;
    setBusy(true);
    Keyboard.dismiss();
    try {
      const found = await geocodeHomeAddress(query, new AbortController().signal);
      if (found) moveTo(found);
      else setError(t.homePoint.notFoundError);
    } catch {
      setError(t.homePoint.searchFailedError);
    } finally {
      setBusy(false);
    }
  };

  const locate = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if ((await ensureLocationPermission()) !== 'granted') {
        setError(t.homePoint.permissionDenied);
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      moveTo({ lat: position.coords.latitude, lng: position.coords.longitude });
    } catch {
      setError(t.addPub.locationUnavailable);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<BackHeader />}
      footer={
        <Button
          label={copy.homeSave}
          disabled={!point}
          onPress={() => {
            if (!point) return;
            useSettingsStore.getState().setHomePoint(point);
            router.back();
            toast({ kind: 'saved', title: copy.homeSaved, sub: copy.homeSavedSub, icon: 'house' });
          }}
        />
      }
      gap={16}
    >
      <PageTitle title={copy.homeTitle} />
      <T s={16} w={500} c={C.text2} style={{ marginTop: -8 }}>
        {copy.homeQuestion}
      </T>
      <View style={[s.row, { minHeight: 58, borderRadius: 18, paddingHorizontal: 14, gap: 12, backgroundColor: C.card, borderWidth: 1, borderColor: error ? C.danger : '#FFFFFF14' }]}>
        <Icon name="house" size={18} color={C.muted} />
        <View style={s.fill}>
          <T s={12} c={C.muted}>
            {copy.homeAddress}
          </T>
          <Input
            value={address}
            onChangeText={(value) => {
              setAddress(value);
              setError('');
            }}
            onSubmitEditing={() => void find()}
            returnKeyType="search"
            height={24}
            focusRing={false}
            style={{ backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0, minHeight: 24 }}
          />
        </View>
      </View>
      {error ? (
        <T s={14} w={500} c={C.danger} style={{ marginTop: -8 }}>
          {error}
        </T>
      ) : null}
      <View style={[s.row, { gap: 10 }]}>
        <Button label={copy.homeFind} icon="search" kind="raised" flex height={48} disabled={busy} onPress={() => void find()} />
        <Button label={copy.homeMine} icon="locate-fixed" kind="raised" flex height={48} disabled={busy} onPress={() => void locate()} />
      </View>
      <View style={{ height: 300, borderRadius: 24, overflow: 'hidden', borderWidth: 1, borderColor: C.hairline }}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={{ flex: 1 }}
          customMapStyle={GRAY_MAP}
          initialRegion={saved ? { latitude: saved.lat, longitude: saved.lng, latitudeDelta: STREET_DELTA, longitudeDelta: STREET_DELTA } : CZECHIA}
          userInterfaceStyle="dark"
          onPress={(event) => moveTo({ lat: event.nativeEvent.coordinate.latitude, lng: event.nativeEvent.coordinate.longitude })}
          onRegionChangeComplete={(region, details) => {
            if (details?.isGesture && point) setPoint({ lat: region.latitude, lng: region.longitude });
          }}
        />
        {point ? (
          <View pointerEvents="none" style={[{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 }, s.center]}>
            <View style={[{ width: 64, height: 64, borderRadius: 32, backgroundColor: '#FFC40033' }, s.center]}>
              <View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
                <Icon name="house" size={18} color={C.black} />
              </View>
            </View>
          </View>
        ) : null}
      </View>
      <T s={15} w={600}>
        {copy.homeAdjust}
      </T>
      <T s={13} c={C.muted} lh={1.45}>
        {copy.homePrivacy}
      </T>
    </Screen>
  );
}

const WATCH_INFO: Record<string, { name: string; where?: string }> = {
  unetice: { name: 'Únětické 12°', where: 'na čepu U Pinkasů · 1,8 km' },
  raptor: { name: 'Matuška Raptor 15°', where: 'na čepu Pivovarský klub · 3,4 km' },
  samuraj: { name: 'Kocour Samuraj 12°' },
  bernard: { name: 'Bernard Černý 12°' },
};

/** "Až sedneš do hospody, cinknu ti." The offer, then what the phone will ask for. */
export function PripominkySheet() {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const [step, setStep] = useState<'offer' | 'perms' | 'denied'>('offer');
  const [busy, setBusy] = useState(false);
  if (step === 'offer') {
    return (
      <Sheet closeIcon={false} top={470} scroll={false}>
        <View style={[{ width: 64, height: 64, borderRadius: 18, backgroundColor: C.control }, s.center]}>
          <Icon name="bell-ring" size={28} color={C.yellow} />
        </View>
        <View style={{ gap: 10 }}>
          <Kicker>{copy.remindKicker}</Kicker>
          <D s={38}>{copy.remindTitle}</D>
          <T s={15} c={C.text2} lh={1.45}>
            {copy.remindBody}
          </T>
        </View>
        <Button label={copy.remindShow} onPress={() => setStep('perms')} />
        <Press onPress={() => router.back()} style={{ alignItems: 'center', paddingBottom: 6 }}>
          <T s={15} w={700} c={C.text2}>
            {copy.remindLater}
          </T>
        </Press>
      </Sheet>
    );
  }
  return (
    <Sheet closeIcon={false} top={340} scroll={false}>
      <View style={{ gap: 10 }}>
        <D s={30}>{copy.remindPermsTitle}</D>
        <T s={15} c={step === 'denied' ? C.danger : C.text2} lh={1.45}>
          {step === 'denied' ? copy.remindDenied : copy.remindPermsBody}
        </T>
      </View>
      <View>
        <Row leading={<Tile icon="bell" color={C.white} size={36} />} title={copy.remindNotif} titleWeight={700} sub={copy.remindNotifSub} />
        <Row leading={<Tile icon="map-pin" color={C.white} size={36} />} title={copy.remindAlways} titleWeight={700} sub={copy.remindAlwaysSub} />
        <Row last leading={<Tile icon="shield-check" color={C.white} size={36} />} title={copy.remindNoTrack} titleWeight={700} sub={copy.remindNoTrackSub} />
      </View>
      {step === 'denied' ? (
        <Button label={copy.openSettings} onPress={() => void Linking.openSettings()} />
      ) : (
        <Button
          label={copy.remindEnable}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            const result = await enablePubReminderNotifications();
            setBusy(false);
            if (!result.ok) {
              setStep('denied');
              return;
            }
            router.back();
            toast({ kind: 'saved', title: copy.remindOn, sub: copy.remindOnSub, icon: 'bell-ring' });
          }}
        />
      )}
      <Press onPress={() => setStep('offer')} style={{ alignItems: 'center', paddingBottom: 6 }}>
        <T s={15} w={700} c={C.text2}>
          {copy.back}
        </T>
      </Press>
    </Sheet>
  );
}

const ALBUM: { month: string; photos: { n: number; state?: 'upload' | 'failed' }[] }[] = [
  {
    month: 'Říjen 2026',
    photos: [{ n: 1, state: 'upload' }, { n: 2, state: 'failed' }, { n: 3 }, { n: 4 }, { n: 5 }, { n: 6 }],
  },
  { month: 'Září 2026', photos: [{ n: 7 }, { n: 9 }, { n: 10 }, { n: 13 }, { n: 12 }] },
];

export function PivniFotkyScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const size = (width - SCREEN_X * 2 - 8) / 3;
  return (
    <Screen header={<BackHeader />} footer={<Button label="Vyfotit pivo" icon="camera" onPress={() => router.push('/nv/do-denicku')} />} gap={16}>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
        <D s={44}>Pivní fotky</D>
        <T s={14} w={600} c={C.muted} style={{ marginBottom: 6 }}>
          24 fotek
        </T>
      </View>
      <Press onPress={() => router.push('/nv/fotopivar')} style={[s.row, { gap: 12, padding: 14, borderRadius: 20, backgroundColor: C.card }]}>
        <Tile icon="trophy" />
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            FotoPivař
          </T>
          <T s={13} c={C.muted}>
            Kolo běží ještě 5 dní · 3 tvoje fotky v kole
          </T>
        </View>
        <Icon name="chevron-right" size={16} color={C.muted} />
      </Press>
      {ALBUM.map((m) => (
        <View key={m.month} style={{ gap: 10 }}>
          <T s={15} w={700} c={C.text2}>
            {m.month}
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {m.photos.map((p) => (
              <Press key={p.n} onPress={() => router.push({ pathname: '/nv/fotka/[n]', params: { n: String(p.n) } })}>
                <Image source={photo(p.n)} style={{ width: size, height: size, borderRadius: 8 }} />
                {p.state ? (
                  <View style={[s.row, { position: 'absolute', left: 8, bottom: 8, height: 26, borderRadius: 13, paddingHorizontal: 9, gap: 5, backgroundColor: '#0A0A0AB3' }]}>
                    <Icon name={p.state === 'upload' ? 'upload' : 'rotate-cw'} size={12} color={p.state === 'upload' ? C.white : C.yellow} />
                    <T s={11} w={700} c={p.state === 'upload' ? C.white : C.yellow}>
                      {p.state === 'upload' ? 'Nahrává se' : 'Nenahráno'}
                    </T>
                  </View>
                ) : null}
              </Press>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

export function DetailFotkyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { n } = useLocalSearchParams<{ n: string }>();
  const { height } = useWindowDimensions();
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        <Image source={photo(Number(n) || 5)} style={{ width: '100%', height: height * 0.56 }} resizeMode="cover" />
        <View style={{ position: 'absolute', top: height * 0.56 - 140, left: 0, right: 0, height: 140, experimental_backgroundImage: `linear-gradient(180deg, ${C.bg}00 0%, ${C.bg} 100%)` }} />
        <View style={{ paddingHorizontal: SCREEN_X, gap: 12, marginTop: -40 }}>
          <View style={[s.row, { alignSelf: 'flex-start', height: 30, borderRadius: 15, paddingHorizontal: 12, gap: 6, backgroundColor: '#FFC40029', borderWidth: 1, borderColor: '#FFC40080' }]}>
            <Icon name="trophy" size={14} color={C.yellow} />
            <T s={13} w={700} c={C.yellow}>
              Ve FotoPivaři
            </T>
          </View>
          <D s={34}>Pilsner Urquell 12°</D>
          <T s={14} c={C.muted}>
            U Pinkasů · pátek 23. 10.
          </T>
          <T s={16} c={C.text2} lh={1.45}>
            Tankový, pěna jak smetana. Na tenhle jsem se těšil celej tejden.
          </T>
          <View style={[s.row, { gap: 12, padding: 16, borderRadius: 20, backgroundColor: C.card }]}>
            <View style={[s.fill, { gap: 2 }]}>
              <T s={14} w={700}>
                Tahle fotka právě bojuje o FotoPivaře.
              </T>
              <T s={13} c={C.muted}>
                12 rund · 4. místo · ještě 5 dní
              </T>
            </View>
            <Press onPress={() => router.push('/nv/fotopivar')} style={{ height: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: 'center', backgroundColor: C.control }}>
              <T s={14} w={700}>
                Otevřít
              </T>
            </Press>
          </View>
          <View style={[s.row, { gap: 8 }]}>
            <Icon name="globe" size={14} color={C.muted} />
            <T s={13} c={C.muted}>
              Uvidí všichni · v soutěži ji vidí každý
            </T>
          </View>
        </View>
      </ScrollView>
      <View style={[s.row, { position: 'absolute', top: insets.top + 6, left: SCREEN_X, right: SCREEN_X, justifyContent: 'space-between' }]}>
        <IconButton icon="chevron-left" size={40} iconSize={18} bg="#0A0A0A99" onPress={() => router.back()} label="Zpět" />
        <IconButton
          icon="trash-2"
          size={40}
          iconSize={18}
          bg="#0A0A0A99"
          label="Smazat fotku"
          onPress={() =>
            dialog({
              title: 'Smazat fotku?',
              body: 'Zmizí z alba i ze soutěže. Tohle vrátit neumím.',
              actions: [
                { label: 'Nechat' },
                {
                  label: 'Smazat',
                  kind: 'danger',
                  onPress: () => {
                    router.back();
                    toast({ kind: 'info', title: 'Fotka je pryč.', icon: 'trash-2' });
                  },
                },
              ],
            })
          }
        />
      </View>
    </View>
  );
}

type PhotoAudience = 'private' | 'friends' | 'contest';

export function DoDenickuSheet() {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const place = useCountPlace();
  const current = useTallyStore((st) => st.current);
  const [uri, setUri] = useState<string | null>(null);
  const [shot, setShot] = useState(0);
  const lastBeer = [...(current?.drinks ?? [])].reverse().find((d) => (d.drinkType ?? 'beer') === 'beer');
  const [caption, setCaption] = useState(lastBeer?.beerName ?? '');
  const [audience, setAudience] = useState<PhotoAudience>('private');
  const pub = current && !current.pubKey.startsWith('ctx:') ? { pubKey: current.pubKey, name: current.pubName, city: current.pubCity } : place?.kind === 'pub' ? { pubKey: placeKey(place), name: place.pub.name, city: place.pub.city } : null;

  useEffect(() => {
    let cancelled = false;
    void pickAndPrepareBeerPhoto('camera').then((picked) => {
      if (cancelled) return;
      if (picked.status === 'picked') setUri(picked.uri);
      else if (!uri) {
        if (picked.status !== 'cancelled') toast({ kind: 'error', title: t.contribute.scanMenu.permissionDenied, icon: 'camera' });
        router.back();
      }
    });
    return () => {
      cancelled = true;
    };
    // One camera per tap on "Vyfotit znovu".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shot]);

  const nextAudience = () => {
    const account = useAccountStore.getState();
    const contestAllowed = selectIsSignedIn(account) && !selectNeedsNickname(account);
    if (audience === 'friends' && !contestAllowed) toast({ kind: 'info', title: copy.photoNeedNickname, icon: 'trophy' });
    setAudience(audience === 'private' ? 'friends' : audience === 'friends' && contestAllowed ? 'contest' : 'private');
  };

  const save = async () => {
    if (!uri) return;
    const clientId = generateUuidV4();
    const localUri = await persistBeerPhotoLocally(uri, clientId);
    void enqueueBeerPhoto({
      clientId,
      localUri,
      caption: caption.trim(),
      ...(pub ? { pubCacheKey: pub.pubKey, pubName: pub.name, ...(pub.city ? { pubCity: pub.city } : {}) } : {}),
      visibility: audience === 'private' ? 'private' : 'friends',
      takenAt: new Date().toISOString(),
      enterContest: audience === 'contest',
    });
    router.back();
    toast({ kind: 'saved', title: copy.photoSaved, ...(audience === 'contest' ? { sub: copy.photoContestSub } : {}), icon: 'camera' });
  };

  return (
    <Sheet title={copy.photoTitle} top={230} footer={<Button label={copy.photoSave} disabled={!uri} onPress={() => void save()} />}>
      <View style={{ height: 250, borderRadius: 22, overflow: 'hidden', backgroundColor: C.card }}>
        {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
        <Press onPress={() => setShot((n) => n + 1)} style={[s.row, { position: 'absolute', left: 10, bottom: 10, height: 34, borderRadius: 17, paddingHorizontal: 12, gap: 6, backgroundColor: '#0A0A0AB3' }]}>
          <Icon name="camera" size={15} />
          <T s={13} w={700}>
            {copy.photoRetake}
          </T>
        </Press>
      </View>
      <View>
        <Row leading={<Icon name="beer" size={18} color={C.text2} />} title={<T s={12} c={C.muted}>{copy.photoBeer}</T>} sub={<T s={15} w={700}>{lastBeer ? copy.photoLastBeer(lastBeer.beerName) : copy.photoNone}</T>} />
        <Row leading={<Icon name="map-pin" size={18} color={C.text2} />} title={<T s={12} c={C.muted}>{copy.photoPub}</T>} sub={<T s={15} w={700}>{pub?.name ?? copy.photoNone}</T>} />
        <Row
          last
          leading={<Icon name="pencil" size={18} color={C.text2} />}
          title={<T s={12} c={C.muted}>{copy.photoCaption}</T>}
          sub={
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder={copy.photoCaptionHint}
              placeholderTextColor={C.text2}
              keyboardAppearance="dark"
              selectionColor={C.yellow}
              maxLength={280}
              style={[font(15, 600), { padding: 0 }]}
            />
          }
        />
      </View>
      <View style={[s.row, { gap: 8 }]}>
        <Icon name={audience === 'private' ? 'lock' : audience === 'friends' ? 'users' : 'globe'} size={15} color={C.muted} />
        <T s={13} c={C.muted} style={s.fill}>
          {audience === 'private' ? copy.photoPrivate : audience === 'friends' ? copy.photoFriends : copy.photoPublic}
        </T>
        <Press onPress={nextAudience} hitSlop={8}>
          <T s={13} w={700}>
            {copy.change.replace('· ', '')}
          </T>
        </Press>
      </View>
    </Sheet>
  );
}

/** What the app shows outside itself: lock screen, Live Activity and notifications, from the live evening. */
export function NotifPreviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const copy = t.nv.stamgast;
  const { kind } = useLocalSearchParams<{ kind?: string }>();
  const current = useTallyStore((st) => st.current);
  const currency = useSettingsStore((st) => st.priceCurrency);
  useHomeTransitStore((st) => st.departure);
  const now = useNowTick();
  const departure = homeTransitForCurrentEvening();
  const upcoming = isUpcomingDeparture(departure, now) ? departure : null;
  const count = sessionCount(current);
  const lastBeer = [...(current?.drinks ?? [])].reverse().find((d) => (d.drinkType ?? 'beer') === 'beer');
  const pubName = current && !current.pubKey.startsWith('ctx:') ? current.pubName : null;
  const date = new Date(now);
  const n =
    kind === 'hospoda'
      ? pubName
        ? { title: t.notifications.pubReminderTitle(pubName), body: t.notifications.pubReminderBody }
        : null
      : kind === 'cep'
        ? null
        : upcoming
          ? { title: t.notifications.homeTransitTitle, body: t.notifications.homeTransitBody(upcoming.line ?? '', formatDepartureTime(upcoming.departsAtMs), upcoming.fromStopName) }
          : null;
  const live = kind !== 'hospoda' && kind !== 'cep' && count > 0 && current;
  return (
    <Press
      onPress={() => router.replace(kind === 'cep' ? '/nv/hlidana-piva' : '/nv/stamgast')}
      style={{ flex: 1, paddingTop: insets.top + 6, paddingHorizontal: 16, paddingBottom: insets.bottom + 10, experimental_backgroundImage: 'linear-gradient(180deg, #33405F 0%, #1A1F33 100%)' }}
    >
      <View style={{ alignItems: 'center' }}>
        <T s={20} w={700} c="#F2F2F7">
          {date.toLocaleDateString(intlLocale, { weekday: 'long', day: 'numeric', month: 'long' })}
        </T>
        <T s={96} w={800} c="#F2F2F7" style={{ fontFamily: undefined, fontWeight: '700', lineHeight: 104 }}>
          {formatClock(date)}
        </T>
      </View>
      <View style={{ flex: 1 }} />
      {live ? (
        <View style={[s.row, { padding: 14, gap: 14, borderRadius: 26, backgroundColor: '#0A0A0AF2', marginBottom: 14 }]}>
          <View style={{ alignItems: 'center', width: 60 }}>
            <D s={84} lh={0.95} c={C.yellow}>
              {String(count)}
            </D>
            <T s={13} w={700}>
              {copy.liveBeers(count)}
            </T>
          </View>
          <View style={[s.fill, { gap: 8 }]}>
            <View style={[s.row, { justifyContent: 'space-between', gap: 8 }]}>
              <T s={17} w={700} numberOfLines={1} style={s.fill}>
                {current.pubName}
              </T>
              <T s={15} w={700}>
                {formatPrice(sessionTotalCzk(current), currency)}
              </T>
            </View>
            {lastBeer ? (
              <T s={12} c={C.muted} numberOfLines={1}>
                {copy.liveLogged(lastBeer.beerName, formatClock(new Date(lastBeer.at)))}
              </T>
            ) : null}
            <View style={[s.row, { height: 38, borderRadius: 19, justifyContent: 'center', gap: 6, backgroundColor: C.yellow }]}>
              <Icon name="plus" size={16} color={C.black} />
              <T s={15} w={800} c={C.black}>
                {copy.oneMore}
              </T>
            </View>
            {upcoming ? (
              <View style={[s.row, { gap: 6 }]}>
                <Icon name="tram-front" size={12} color={C.muted} />
                <T s={11} c={C.muted} style={s.fill} numberOfLines={1}>
                  {copy.liveHome(formatDepartureTime(upcoming.departsAtMs), upcoming.fromStopName)}
                </T>
                <T s={11} c={C.muted}>
                  {copy.liveIn}
                </T>
                <T s={12} w={800}>
                  {t.homeTransit.leavesIn(Math.ceil((upcoming.departsAtMs - now) / 60000)).replace(/^\S+\s/, '')}
                </T>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      <View style={[s.row, { padding: 14, gap: 12, borderRadius: 24, backgroundColor: '#5A5F6E99', alignItems: 'flex-start' }]}>
        <View style={[{ width: 38, height: 38, borderRadius: 9, backgroundColor: C.black }, s.center]}>
          <Icon name="beer" size={20} color={C.yellow} />
        </View>
        <View style={[s.fill, { gap: 2 }]}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={12} w={500} c="#FFFFFFB3">
              {copy.appName}
            </T>
            <T s={12} c="#FFFFFF99">
              {copy.now}
            </T>
          </View>
          {n ? (
            <>
              <T s={15} w={700} c="#FFFFFF">
                {n.title}
              </T>
              <T s={14} c="#FFFFFFE6" lh={1.35}>
                {n.body}
              </T>
            </>
          ) : (
            <T s={14} c="#FFFFFFE6" lh={1.35}>
              {copy.notifNothing}
            </T>
          )}
        </View>
      </View>
    </Press>
  );
}
