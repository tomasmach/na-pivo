import React from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haversineMeters } from '@/compass/distance';
import { geohash8 } from '@/data/geohash';
import { buildPubShareUrl } from '@/data/pubShareLink';
import { formatVolume, t } from '@/i18n';
import { calendarDaysBetween, eventDay, eventStartTime } from '@/pubPage/pubPageModel';
import { findFavoriteKey, usePubFavoritesStore } from '@/stores/pubFavoritesStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatPrice } from '@/utils/currency';
import { dateTimeFormat, numberFormat } from '@/utils/intlFormat';
import { openPubInMaps } from '@/utils/maps';

import { BackHeader, BottomFade, Screen } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { Button, D, Dot, IconButton, Press, ProgressRing, T } from '../../components/ui';
import { toast } from '../../ui/store';
import { C, SCREEN_X, s } from '../../theme';
import { distanceLabel } from './format';
import { GRAY_MAP } from './NvMap';
import { nvPubParams, showOnKompas, useKompasState } from './state';
import { usePubDetails, useParamPub, useRecentPosition } from './usePubPage';

const L = () => t.nv.kompas;

function Band() {
  return <View style={{ height: 10, backgroundColor: C.card }} />;
}

function Section({ title, meta, children }: { title: string; meta?: string; children: React.ReactNode }) {
  return (
    <View style={{ paddingTop: 20, paddingHorizontal: SCREEN_X, paddingBottom: 12 }}>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end', paddingBottom: 6 }]}>
        <T s={19} w={700}>
          {title}
        </T>
        {meta ? (
          <T s={14} c={C.muted}>
            {meta}
          </T>
        ) : null}
      </View>
      {children}
    </View>
  );
}

function Line({ title, sub, value, last, valueColor = C.white }: { title: string; sub?: string; value?: string; last?: boolean; valueColor?: string }) {
  return (
    <View style={[s.row, { minHeight: 64, gap: 12 }, !last && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
      <View style={[s.fill, { gap: 2 }]}>
        <T s={16} w={600}>
          {title}
        </T>
        {sub ? (
          <T s={14} c={C.muted}>
            {sub}
          </T>
        ) : null}
      </View>
      {value ? (
        <T s={15} w={valueColor === C.white ? 700 : 400} c={valueColor}>
          {value}
        </T>
      ) : null}
    </View>
  );
}

function AddLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={[s.row, { height: 52, gap: 8 }]}>
      <Icon name="plus" size={18} color={C.yellow} />
      <T s={16} w={700} c={C.yellow}>
        {label}
      </T>
    </Press>
  );
}

function verifiedLabel(iso: string | null | undefined, now: Date): string | undefined {
  const at = iso ? new Date(iso) : null;
  if (!at || !Number.isFinite(at.getTime())) return undefined;
  const days = calendarDaysBetween(at, now);
  if (days <= 0) return L().verifiedToday;
  if (days === 1) return L().verifiedYesterday;
  if (days < 7) return L().verifiedDaysAgo(days);
  if (days < 14) return L().verifiedLastWeek;
  return L().verifiedOn(dateTimeFormat({ day: 'numeric', month: 'numeric' }).format(at));
}

function eventWhen(event: Parameters<typeof eventDay>[0], now: Date): string {
  const day = eventDay(event, now);
  const time = eventStartTime(event);
  if (day.kind === 'running') return L().eventRunning;
  if (day.kind === 'today') return L().eventToday(time);
  if (day.kind === 'tomorrow') return L().eventTomorrow(time);
  return L().eventOn(dateTimeFormat({ weekday: 'short', day: 'numeric', month: 'numeric' }).format(day.date), time);
}

export function PubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { key, pub: opened } = useParamPub();
  const details = usePubDetails(opened, key);
  const { pub } = details;
  const position = useRecentPosition();
  const currency = useSettingsStore((st) => st.priceCurrency);
  const favoriteKey = usePubFavoritesStore((st) => (pub ? findFavoriteKey(st.favorites, geohash8(pub.lat, pub.lng), pub) : undefined));

  if (!pub) {
    return (
      <Screen header={<BackHeader />}>
        <D s={36}>{L().pubMissingTitle}</D>
        <T s={15} c={C.muted} lh={1.4}>
          {L().pubMissingBody}
        </T>
      </Screen>
    );
  }

  const fav = Boolean(favoriteKey);
  const distance = position ? haversineMeters(position, pub) : null;
  const hours = details.hours;
  const params = nvPubParams(pub);
  const area = pub.city || pub.address || '';
  const toggleFavorite = () => {
    const store = usePubFavoritesStore.getState();
    if (favoriteKey) store.toggleFavorite(favoriteKey, pub);
    else store.saveFavorite(geohash8(pub.lat, pub.lng), { name: pub.name, lat: pub.lat, lng: pub.lng, city: pub.city, externalId: pub.id || undefined });
    toast({ kind: 'saved', title: fav ? L().favoriteRemoved : L().favoriteAdded, icon: 'heart' });
  };
  const guide = () => {
    // The compass watches the arrival, so walking in still ends with "Na zdraví".
    useKompasState.getState().pick(pub);
    const sub = distance != null ? L().guideSub(pub.name, distanceLabel(distance)) : pub.name;
    toast({ kind: 'info', title: L().guideTitle, sub, icon: 'navigation' });
    void openPubInMaps(pub);
  };
  const verified = details.taps.length ? verifiedLabel(pub.beersUpdatedAt, details.now) : undefined;
  const ratingValue =
    typeof pub.rating === 'number' && pub.rating > 0
      ? numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(pub.rating)
      : null;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 140 }}>
        <View style={{ paddingHorizontal: SCREEN_X, gap: 18, paddingBottom: 24 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <IconButton icon="chevron-left" size={40} iconSize={18} onPress={() => nvBack(router)} label={L().back} />
            <View style={[s.row, { gap: 10 }]}>
              <IconButton icon="heart" size={40} iconSize={18} color={fav ? C.yellow : C.white} label={fav ? L().favoriteRemove : L().favoriteAdd} onPress={toggleFavorite} />
              <IconButton
                icon="share"
                size={40}
                iconSize={18}
                label={L().share}
                onPress={() => router.push({ pathname: '/nv/sdilet-hospodu', params: { ...params, url: buildPubShareUrl(pub) } })}
              />
              <IconButton icon="ellipsis" size={40} iconSize={18} label={L().more} onPress={() => router.push({ pathname: '/nv/nesedi', params })} />
            </View>
          </View>
          <View style={{ gap: 6 }}>
            <D s={44} accessibilityRole="header">
              {pub.name}
            </D>
            <View style={[s.row, { gap: 6, flexWrap: 'wrap' }]}>
              <Dot color={hours.tone === 'open' ? C.open : C.muted} size={7} />
              <T s={15} w={600} c={hours.tone === 'open' ? C.open : C.muted}>
                {hours.tone === 'open' ? (hours.until ? L().openUntil(hours.until) : L().openNow) : hours.tone === 'closed' ? L().closedNow : L().hoursUnknown}
              </T>
              {distance != null || area ? (
                <T s={15} c={C.muted}>
                  {L().distanceArea(distance != null ? distanceLabel(distance) : '', area)}
                </T>
              ) : null}
            </View>
          </View>
          <Press onPress={() => showOnKompas(router, pub)} style={{ height: 112, borderRadius: 20, overflow: 'hidden', backgroundColor: C.card }}>
            <MapView
              provider={PROVIDER_GOOGLE}
              style={{ flex: 1 }}
              customMapStyle={GRAY_MAP}
              initialRegion={{ latitude: pub.lat, longitude: pub.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
              scrollEnabled={false}
              zoomEnabled={false}
              rotateEnabled={false}
              pitchEnabled={false}
              pointerEvents="none"
              userInterfaceStyle="dark"
            >
              <Marker coordinate={{ latitude: pub.lat, longitude: pub.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                <View style={[{ width: 38, height: 38, borderRadius: 19, backgroundColor: C.yellow, borderWidth: 2, borderColor: C.black }, s.center]}>
                  <Icon name="beer" size={18} color={C.black} />
                </View>
              </Marker>
            </MapView>
            <View style={[s.row, { position: 'absolute', right: 10, bottom: 12, height: 34, borderRadius: 17, paddingHorizontal: 12, gap: 6, backgroundColor: '#0A0A0AD9', borderWidth: 1, borderColor: '#FFFFFF1F' }]}>
              <Icon name="map" size={15} color={C.yellow} />
              <T s={13} w={700}>
                {L().showOnMap}
              </T>
            </View>
          </Press>
          <View style={[s.row, { gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, backgroundColor: C.card }]}>
            <View style={{ width: 40, height: 40 }}>
              <ProgressRing size={40} progress={Math.max(0.02, details.mappedPercent / 100)} stroke={4} track={C.hairline} />
            </View>
            <View style={[s.fill, { gap: 2 }]}>
              <T s={16} w={700}>
                {L().mapped(details.mappedPercent)}
              </T>
              <T s={13} c={C.muted}>
                {L().mappedSub}
              </T>
            </View>
            <Press haptic onPress={() => router.push({ pathname: '/nv/doplnit-info', params })} style={[{ height: 36, borderRadius: 18, paddingHorizontal: 14, backgroundColor: C.control }, s.center]}>
              <T s={14} w={700} c={C.yellow}>
                {L().fill}
              </T>
            </Press>
          </View>
        </View>
        <Band />
        <Section title={L().onTap} meta={verified}>
          {details.taps.length ? (
            details.taps.map((tap, i) => (
              <Press key={`${tap.name}-${tap.volumeMl ?? ''}`} onPress={() => router.push({ pathname: '/nv/pivo/[id]', params: { id: '-', name: tap.name } })}>
                <Line
                  title={tap.name}
                  sub={tap.volumeMl ? formatVolume(tap.volumeMl) : undefined}
                  value={tap.priceCzk ? formatPrice(tap.priceCzk, currency) : undefined}
                  last={i === details.taps.length - 1}
                />
              </Press>
            ))
          ) : !details.hoursLoaded ? (
            <ActivityIndicator color={C.yellow} style={{ alignSelf: 'flex-start', paddingVertical: 14 }} />
          ) : (
            <>
              <T s={16} c={C.text2} style={{ paddingVertical: 10 }}>
                {L().noTaps}
              </T>
              <AddLink label={L().addTaps} onPress={() => router.push({ pathname: '/nv/doplnit-info', params: { ...params, tab: 'piva' } })} />
            </>
          )}
        </Section>
        <Band />
        <Section title={L().events}>
          {details.events.map((event) => (
            <Line key={event.id} title={event.title} sub={eventWhen(event, details.now)} />
          ))}
          <AddLink label={L().suggestEvent} onPress={() => router.push({ pathname: '/nv/navrhnout-akci', params })} />
        </Section>
        <Band />
        <Section title={L().about}>
          {details.beersLastWeek ? <Line title={L().lastWeekBeers(details.beersLastWeek)} sub={L().lastWeekBeersSub} /> : null}
          {ratingValue ? (
            <Line
              title={L().rating(ratingValue, numberFormat().format(pub.ratingCount ?? 0))}
              sub="Firmy.cz"
              last={!details.visit}
            />
          ) : null}
          {details.visit ? (
            <Line
              title={L().visits(details.visit.visitCount, dateTimeFormat({ day: 'numeric', month: 'numeric' }).format(new Date(details.visit.lastVisitedAt)))}
              sub={L().onlyForYou}
              last
            />
          ) : null}
        </Section>
      </ScrollView>
      <BottomFade height={184} />
      <View style={[s.row, { position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: Math.max(insets.bottom, 16) + 4, gap: 10 }]}>
        <Button label={L().guideMe} icon="navigation" flex onPress={guide} />
        <IconButton icon="compass" size={52} iconSize={23} color={C.yellow} label={L().showOnCompass} onPress={() => showOnKompas(router, pub)} />
      </View>
    </View>
  );
}
