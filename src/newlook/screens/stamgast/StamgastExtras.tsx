import React, { useRef, useState } from 'react';
import { Keyboard, Linking, View } from 'react-native';
import * as Location from 'expo-location';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ensureLocationPermission } from '@/compass/permissions';
import { formatClock } from '@/counter/useAlcoholEstimate';
import { useNowTick } from '@/friends/useNowTick';
import { intlLocale, t } from '@/i18n';
import { enablePubReminderNotifications } from '@/notifications/pubReminderNotifications';
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
import { Button, D, Kicker, Press, Row, T, Tile } from '../../components/ui';
import { C, s } from '../../theme';
import { toast } from '../../ui/store';
import { GRAY_MAP } from '../kompas/NvMap';

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
            nvBack(router);
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
        <Press onPress={() => nvBack(router)} style={{ alignItems: 'center', paddingBottom: 6 }}>
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
            useSettingsStore.getState().setPubReminderEnabled(result.ok);
            if (!result.ok) {
              setStep('denied');
              return;
            }
            nvBack(router);
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
