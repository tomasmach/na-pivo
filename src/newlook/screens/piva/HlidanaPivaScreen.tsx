import React, { useCallback, useState } from 'react';
import { Linking, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { BackHeader, Screen } from '../../components/chrome';
import { PageTitle } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { StatusCard } from '../../components/StatusCard';
import { Card, Dot, IconButton, Press, Row, T, Tile } from '../../components/ui';
import { toast } from '../../ui/store';
import { C, s } from '../../theme';
import { syncBeerWatchLocation } from '@/beerWatch/beerWatchLocation';
import { BEER_WATCH_RADII } from '@/data/beerWatchClient';
import { t } from '@/i18n';
import { notificationsDenied } from '@/notifications/beerWatchPush';
import { useBeerWatchStore } from '@/stores/beerWatchStore';

import { fmtDistance } from './model';
import { Loading } from './states';

export function HlidanaPivaScreen() {
  const w = t.nv.piva.watches;
  const watches = useBeerWatchStore((st) => st.watches);
  const radiusM = useBeerWatchStore((st) => st.radiusM);
  const loaded = useBeerWatchStore((st) => st.loaded);
  const [failed, setFailed] = useState(false);
  const [alertsOff, setAlertsOff] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setFailed(false);
    void useBeerWatchStore
      .getState()
      .refresh()
      .then((ok) => {
        if (!alive) return;
        setFailed(!ok);
        if (ok) void syncBeerWatchLocation();
      });
    void notificationsDenied().then((off) => alive && setAlertsOff(off));
    return () => {
      alive = false;
    };
  }, []);
  useFocusEffect(load);

  const setRadius = (meters: number) => {
    if (meters === radiusM) return;
    void useBeerWatchStore
      .getState()
      .setRadius(meters)
      .then((ok) => {
        if (!ok) toast({ kind: 'error', title: t.beerWatch.radiusFailed });
      });
  };

  const stop = (productKey: string, name: string) =>
    void useBeerWatchStore
      .getState()
      .unwatch(productKey)
      .then((ok) => toast(ok ? { kind: 'info', title: w.stopped(name), icon: 'bell-off' } : { kind: 'error', title: t.beerWatch.failedToast }));

  const km = radiusM / 1000;
  return (
    <Screen header={<BackHeader />} gap={16}>
      <PageTitle title={w.title} />
      {alertsOff ? (
        <View style={[s.row, { gap: 12, padding: 16, borderRadius: 20, backgroundColor: C.card, alignItems: 'flex-start' }]}>
          <Icon name="bell-off" size={20} color={C.yellow} />
          <View style={[s.fill, { gap: 10 }]}>
            <T s={15} w={700}>
              {w.alertsOff}
            </T>
            <Press onPress={() => void Linking.openSettings()} style={{ alignSelf: 'flex-start', height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: C.control }}>
              <T s={13} w={700}>
                {w.openSettings}
              </T>
            </Press>
          </View>
        </View>
      ) : null}
      <T s={15} w={700} c={C.muted}>
        {w.howFar}
      </T>
      <View style={[s.row, { height: 46, borderRadius: 23, padding: 3, backgroundColor: C.tintSoft }]}>
        {BEER_WATCH_RADII.map((m) => (
          <Press key={m} haptic onPress={() => setRadius(m)} style={[s.fill, s.center, { alignSelf: 'stretch', borderRadius: 20 }, radiusM === m && { backgroundColor: C.white }]}>
            <T s={15} w={radiusM === m ? 800 : 600} c={radiusM === m ? C.black : C.text2}>
              {w.km(m / 1000)}
            </T>
          </Press>
        ))}
      </View>
      {!loaded && !failed ? (
        <Loading />
      ) : failed && !loaded ? (
        <StatusCard text={t.beerWatch.loadFailed} action={t.nv.piva.retry} onAction={load} />
      ) : watches.length ? (
        <>
          <T s={15} w={700} c={C.muted}>
            {w.watching(watches.length)}
          </T>
          <Card>
            {watches.map((watch, i) => (
              <Row
                key={watch.productKey}
                last={i === watches.length - 1}
                leading={<Tile icon="beer" color={C.white} />}
                title={watch.name}
                titleWeight={700}
                sub={
                  watch.nearest ? (
                    <View style={[s.row, { gap: 6 }]}>
                      <Dot color={C.yellow} />
                      <T s={13} w={500} c={C.text2} numberOfLines={1} style={s.fill}>
                        {w.onTap(watch.nearest.pubName, fmtDistance(watch.nearest.distanceM))}
                      </T>
                    </View>
                  ) : (
                    w.nowhere(km)
                  )
                }
                trailing={<IconButton icon="bell-ring" size={36} iconSize={16} label={w.stop} onPress={() => stop(watch.productKey, watch.name)} />}
              />
            ))}
          </Card>
          <T s={13} c={C.muted} lh={1.4}>
            {w.footer}
          </T>
        </>
      ) : (
        <StatusCard text={w.empty} />
      )}
    </Screen>
  );
}
