import React, { useEffect } from 'react';
import { View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useNvRouter } from '../../duo/details';
import { usePaneWidth } from '../../duo/pane';

import { haversineMeters } from '@/compass/distance';
import { geohash8 } from '@/data/geohash';
import { buildPubShareUrl } from '@/data/pubShareLink';
import { trackPubReach } from '@/data/pubReachClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { formatVolume, t } from '@/i18n';
import type { WeeklyHours } from '@/data/communityHours';
import { calendarDaysBetween, dayKeyOf, eventDay, eventStartTime, pubWallClock } from '@/pubPage/pubPageModel';
import { findFavoriteKey, usePubFavoritesStore } from '@/stores/pubFavoritesStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatPrice } from '@/utils/currency';
import { dateTimeFormat, numberFormat } from '@/utils/intlFormat';
import { openPubInMaps } from '@/utils/maps';

import { BackButton, BackHeader, PageActions, Screen } from '../../components/chrome';
import { Ghost } from '../../components/StatusCard';
import { Icon } from '../../components/Icon';
import { Button, D, Dot, IconButton, Press, ProgressRing, T } from '../../components/ui';
import { toast } from '../../ui/store';
import { fadeIn } from '../../motion';
import { C, SCREEN_X, s } from '../../theme';
import { distanceLabel, weekRows } from './format';
import { GRAY_MAP } from './NvMap';
import { openPubVerdict, verdictLabel } from '../stamgast/PubVerdict';
import { RegularsRow } from './Regulars';
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

const TAP_ROW_HEIGHT = 64;

function Line({ title, sub, value, last, valueColor = C.white }: { title: string; sub?: string; value?: string; last?: boolean; valueColor?: string }) {
  return (
    <View style={[s.row, { minHeight: TAP_ROW_HEIGHT, gap: 12 }, !last && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
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

function VisitLine({ pubKey, name, visitCount, lastVisitedAt }: { pubKey: string; name: string; visitCount: number; lastVisitedAt: string }) {
  const router = useRouter();
  const verdict = usePubRatingsStore((st) => st.ratings[pubKey]?.verdict);
  const title = L().visits(visitCount, dateTimeFormat({ day: 'numeric', month: 'numeric' }).format(new Date(lastVisitedAt)));
  return (
    <Press onPress={() => openPubVerdict(router, pubKey, name, title)} accessibilityRole="button" style={[s.row, { minHeight: TAP_ROW_HEIGHT, gap: 12 }]}>
      <View style={[s.fill, { gap: 2 }]}>
        <T s={16} w={600}>
          {title}
        </T>
        <T s={14} c={C.muted}>
          {verdict ? t.pubDetail.privateVerdict(verdictLabel(verdict)) : L().onlyForYou}
        </T>
      </View>
      {verdict ? (
        <View style={[s.center, { width: 36, height: 36, borderRadius: 18 }, verdict === 'like' ? { backgroundColor: C.yellowTint, borderWidth: 1, borderColor: C.yellowStrong } : { backgroundColor: C.control }]}>
          <Icon name={verdict === 'like' ? 'thumbs-up' : 'thumbs-down'} size={16} color={verdict === 'like' ? C.yellow : C.muted} />
        </View>
      ) : null}
      <Icon name="chevron-right" size={16} color={C.muted} />
    </Press>
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

function WeekHours({ week, now }: { week: WeeklyHours; now: Date }) {
  const rows = weekRows(week, dayKeyOf(pubWallClock(now)));
  return (
    <View>
      {rows.map((row, i) => {
        const days = row.from === row.to ? L().daysShort[row.from] : `${L().daysShort[row.from]}–${L().daysShort[row.to]}`;
        const w = row.today ? 800 : 500;
        return (
          <View key={row.from} style={[s.row, { minHeight: 44, gap: 12 }, i < rows.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
            <T s={16} w={w} style={s.fill}>
              {row.today ? `${days} · ${L().hoursToday}` : days}
            </T>
            <T s={15} w={w} c={row.intervals.length ? C.white : C.muted}>
              {row.intervals.length ? row.intervals.join(', ') : L().closed}
            </T>
          </View>
        );
      })}
    </View>
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
  const router = useNvRouter();
  const mapWidth = usePaneWidth();
  const { key, pub: opened } = useParamPub();
  const details = usePubDetails(opened, key);
  const { pub } = details;
  const position = useRecentPosition();
  const currency = useSettingsStore((st) => st.priceCurrency);
  const favoriteKey = usePubFavoritesStore((st) => (pub ? findFavoriteKey(st.favorites, geohash8(pub.lat, pub.lng), pub) : undefined));
  const reachKey = pub ? geohash8(pub.lat, pub.lng) : null;
  useEffect(() => {
    if (reachKey) trackPubReach('detail_view', reachKey);
  }, [reachKey]);

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
  // Building the params parks the pub in the hand-off store, which must not happen while rendering.
  const params = () => nvPubParams(pub);
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
    openPubInMaps(pub).catch(() => toast({ kind: 'error', title: L().navigationFailed, icon: 'navigation' }));
  };
  const verified = details.taps.length ? verifiedLabel(pub.beersUpdatedAt, details.now) : undefined;
  const ratingValue =
    typeof pub.rating === 'number' && pub.rating > 0
      ? numberFormat({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(pub.rating)
      : null;

  const header = (
    <View pointerEvents="box-none" style={[s.row, { justifyContent: 'space-between' }]}>
      <BackButton onPress={() => nvBack(router)} label={L().back} />
      <PageActions
        actions={[
          { icon: 'heart', label: fav ? L().favoriteRemove : L().favoriteAdd, color: fav ? C.yellow : C.white, onPress: toggleFavorite },
          { icon: 'share', label: L().share, onPress: () => router.push({ pathname: '/nv/sdilet-hospodu', params: { ...params(), url: buildPubShareUrl(pub) } }) },
          {
            icon: 'ellipsis',
            label: L().more,
            // In the iPhone Duo's overflow sheet a plain "Další" would say nothing.
            menuLabel: L().wrongTitle,
            onPress: () => {
              trackUiInteraction('compass_report_open');
              router.push({ pathname: '/nv/nesedi', params: params() });
            },
          },
        ]}
      />
    </View>
  );
  const footer = (
    <View style={[s.row, { gap: 10 }]}>
      <Button label={L().guideMe} icon="navigation" flex onPress={guide} />
      <IconButton icon="compass" size={52} iconSize={23} color={C.yellow} label={L().showOnCompass} onPress={() => showOnKompas(router, pub)} />
    </View>
  );

  return (
    <Screen header={header} footer={footer} gap={0} padTop={14} contentStyle={{ paddingHorizontal: 0 }}>
      <View style={{ paddingHorizontal: SCREEN_X, gap: 18, paddingBottom: 24 }}>
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
            // Rebuilt when the iPhone Duo folds or opens: Google drops the pin and the centre on a resize.
            key={mapWidth}
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
          <View style={[s.row, { position: 'absolute', right: 10, bottom: 12, height: 34, borderRadius: 17, paddingHorizontal: 12, gap: 6, backgroundColor: '#0A0A0AD9', borderWidth: 1, borderColor: C.line }]}>
            <Icon name="map" size={15} color={C.yellow} />
            <T s={13} w={700}>
              {L().showOnMap}
            </T>
          </View>
        </Press>
        <RegularsRow pubKey={key} name={pub.name} />
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
          <Press haptic onPress={() => router.push({ pathname: '/nv/doplnit-info', params: params() })} style={[{ height: 36, borderRadius: 18, paddingHorizontal: 14, backgroundColor: C.control }, s.center]}>
            <T s={14} w={700} c={C.yellow}>
              {L().fill}
            </T>
          </Press>
        </View>
      </View>
      <Band />
      <Section title={L().onTap} meta={verified}>
        {details.taps.length ? (
          <Animated.View entering={fadeIn}>
            {details.taps.map((tap, i) => (
              <Press key={`${tap.name}-${tap.volumeMl ?? ''}`} onPress={() => router.push({ pathname: '/nv/pivo/[id]', params: { id: '-', name: tap.name } })}>
                <Line
                  title={tap.name}
                  sub={tap.volumeMl ? formatVolume(tap.volumeMl) : undefined}
                  value={tap.priceCzk ? formatPrice(tap.priceCzk, currency) : undefined}
                  last={i === details.taps.length - 1}
                />
              </Press>
            ))}
          </Animated.View>
        ) : !details.hoursLoaded ? (
          // One tap row high, the shortest answer the menu can have.
          <Ghost height={TAP_ROW_HEIGHT - 12} radius={14} style={{ marginVertical: 6 }} />
        ) : (
          <Animated.View entering={fadeIn}>
            <T s={16} c={C.text2} style={{ paddingVertical: 10 }}>
              {L().noTaps}
            </T>
            <AddLink label={L().addTaps} onPress={() => router.push({ pathname: '/nv/doplnit-info', params: { ...params(), tab: 'piva' } })} />
          </Animated.View>
        )}
      </Section>
      <Band />
      <Section title={L().events}>
        {details.events.map((event) => (
          <Line key={event.id} title={event.title} sub={eventWhen(event, details.now)} />
        ))}
        <AddLink label={L().suggestEvent} onPress={() => router.push({ pathname: '/nv/navrhnout-akci', params: params() })} />
      </Section>
      <Band />
      <Section title={L().tabHours}>
        {details.week ? (
          <WeekHours week={details.week} now={details.now} />
        ) : pub.openingHours?.trim() ? (
          <T s={16} c={C.text2} style={{ paddingVertical: 10 }}>
            {pub.openingHours}
          </T>
        ) : !details.hoursLoaded ? (
          <Ghost height={TAP_ROW_HEIGHT - 12} radius={14} style={{ marginVertical: 6 }} />
        ) : (
          <Animated.View entering={fadeIn}>
            <T s={16} c={C.text2} style={{ paddingVertical: 10 }}>
              {L().hoursUnknown}
            </T>
            <AddLink label={L().addHours} onPress={() => router.push({ pathname: '/nv/doplnit-info', params: params() })} />
          </Animated.View>
        )}
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
        {details.visit ? <VisitLine pubKey={details.visit.cacheKey} name={pub.name} visitCount={details.visit.visitCount} lastVisitedAt={details.visit.lastVisitedAt} /> : null}
      </Section>
    </Screen>
  );
}
