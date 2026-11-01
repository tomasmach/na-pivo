import React, { useMemo } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polygon } from 'react-native-svg';

import { formatClock } from '@/counter/useAlcoholEstimate';
import { t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore } from '@/stores/tallyStore';
import { formatPrice } from '@/utils/currency';

import { BottomFade } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { Button, D, IconButton, Press, T } from '../../components/ui';
import { C, SCREEN_X, s } from '../../theme';
import { beerTally, dateOfDay, minutesBetween, nightOrdinal, nightsOf, previousNight } from './eveningData';
import { durationLabel } from './stamgastFormat';

const PAPER = '#F4F1E8';
const INK = '#141414';

function Zigzag({ width }: { width: number }) {
  const n = Math.round(width / 12);
  const step = width / n;
  const pts = [`0,0`, ...Array.from({ length: n }, (_, i) => `${i * step + step / 2},9 ${(i + 1) * step},0`)].join(' ');
  return (
    <Svg width={width} height={9}>
      <Polygon points={`${pts} ${width},0 0,0`} fill={PAPER} />
    </Svg>
  );
}

function Dashed() {
  return <View style={{ height: 1, borderTopWidth: 1, borderStyle: 'dashed', borderColor: '#14141440', marginVertical: 10 }} />;
}

/** "Dopito": the night's receipt, built from every sitting of that drinking day. */
export function UctenkaScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const copy = t.nv.stamgast;
  const { day } = useLocalSearchParams<{ day?: string }>();
  const current = useTallyStore((st) => st.current);
  const history = useTallyStore((st) => st.history);
  const currency = useSettingsStore((st) => st.priceCurrency);
  const nights = useMemo(() => nightsOf(current ? [current, ...history] : history), [current, history]);
  const night = (day ? nights.find((n) => n.day === day) : nights[0]) ?? null;
  const paperW = width - SCREEN_X * 2;
  const close = () => router.navigate('/nv/stamgast');

  if (!night) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 20 }}>
        <IconButton icon="x" onPress={close} label={copy.close} />
        <T s={16} c={C.text2}>
          {copy.receiptMissing}
        </T>
      </View>
    );
  }

  const d = dateOfDay(night.day);
  const before = previousNight(nights, night.day);
  const more = before ? night.beers - before.beers : 0;
  const beers = beerTally(night.sessions);
  const pubOfBeer = (name: string) => {
    const key = name.trim().toLocaleLowerCase();
    return night.sessions.filter((session) => session.drinks.some((drink) => drink.beerName.trim().toLocaleLowerCase() === key)).at(-1)?.pubName ?? '';
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 20, paddingBottom: 200 }} showsVerticalScrollIndicator={false}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <IconButton icon="x" onPress={close} label={copy.close} />
          <T s={15} w={700} c={C.muted}>
            {copy.done}
          </T>
        </View>
        <View>
          <View style={{ backgroundColor: PAPER, borderTopLeftRadius: 6, borderTopRightRadius: 6, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 18 }}>
            <View style={[s.row, { justifyContent: 'space-between' }]}>
              <D s={22} c={INK}>
                {copy.receiptBrand}
              </D>
              <T s={13} w={600} c="#14141499">
                {copy.nightNo(nightOrdinal(nights, night.day))}
              </T>
            </View>
            <T s={13} c="#14141499" style={{ marginTop: 6 }}>
              {copy.receiptDate(copy.weekdaysLong[d.getDay()], d.getDate(), d.getMonth() + 1, d.getFullYear())}
            </T>
            {more > 0 ? (
              <View style={{ position: 'absolute', right: 40, top: 46, transform: [{ rotate: '-8deg' }], backgroundColor: C.yellow, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5 }}>
                <T s={10} w={900} c={INK} style={{ letterSpacing: 1, textAlign: 'center' }}>
                  {copy.moreThanLast(more)}
                </T>
              </View>
            ) : null}
            <Dashed />
            {night.pubs.map((pub, i) => (
              <View key={`${pub.pubKey}:${i}`} style={[s.row, { justifyContent: 'space-between', paddingVertical: 6, gap: 12 }]}>
                <View style={s.fill}>
                  <T s={16} w={700} c={INK} numberOfLines={1}>
                    {pub.name}
                  </T>
                  <T s={12} c="#14141499">
                    {copy.timeRange(formatClock(new Date(pub.firstAt)), formatClock(new Date(pub.lastAt)))}
                  </T>
                </View>
                <D s={26} c={INK}>{`${pub.beers}×`}</D>
              </View>
            ))}
            <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 20 }]}>
              <T s={12} w={900} c={INK} style={{ letterSpacing: 2 }}>
                {copy.total}
              </T>
              <D s={52} lh={1} c={INK}>
                {copy.totalBeers(night.beers)}
              </D>
            </View>
            <View style={[s.row, { justifyContent: 'space-between', marginTop: 10 }]}>
              <T s={13} c="#141414B3">
                {copy.atTable}
              </T>
              <T s={13} w={800} c={INK}>
                {durationLabel(minutesBetween(night.startMs, night.endMs))}
              </T>
            </View>
            {night.priced ? (
              <View style={[s.row, { justifyContent: 'space-between', marginTop: 6 }]}>
                <T s={13} c="#141414B3">
                  {copy.spentPrivate}
                </T>
                <T s={13} w={800} c={INK}>
                  {formatPrice(night.spentCzk, currency)}
                </T>
              </View>
            ) : null}
            <T s={12} c="#14141499" style={{ marginTop: 14 }}>
              {copy.cheers}
            </T>
          </View>
          <Zigzag width={paperW} />
        </View>
        {beers.length ? (
          <View style={{ backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 16, paddingBottom: 6 }}>
            <View style={[s.row, { height: 52, justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
              <T s={17} w={700}>
                {copy.howWasIt}
              </T>
            </View>
            {beers.map((beer, i) => {
              const pubName = pubOfBeer(beer.name);
              return (
                <View key={beer.name} style={[s.row, { height: 58, gap: 10 }, i < beers.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
                  <View style={[s.fill, { gap: 2 }]}>
                    <T s={16} w={600} numberOfLines={1}>
                      {beer.name}
                    </T>
                    <T s={12} c={C.muted} numberOfLines={1}>
                      {copy.ratedSub(beer.count, pubName)}
                    </T>
                  </View>
                  <Press
                    haptic
                    onPress={() => router.push({ pathname: '/nv/hodnoceni', params: { id: beer.name, name: beer.name, pub: pubName } })}
                    style={[s.row, { height: 38, borderRadius: 19, paddingHorizontal: 12, gap: 6, backgroundColor: C.control }]}
                  >
                    <Icon name="star" size={16} color={C.yellow} />
                    <T s={15} w={700}>
                      {copy.rate}
                    </T>
                    <Icon name="chevron-right" size={14} color={C.text2} />
                  </Press>
                </View>
              );
            })}
          </View>
        ) : null}
      </ScrollView>
      <BottomFade height={210} />
      <View style={{ position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: Math.max(insets.bottom, 16) + 4, gap: 10 }}>
        <View style={[s.row, { gap: 10 }]}>
          <Button label={copy.sticker} icon="sticker" kind="raised" flex onPress={() => router.push({ pathname: '/nv/nalepky', params: { day: night.day } })} />
          <Button label={copy.edit} icon="pencil" kind="raised" style={{ paddingHorizontal: 20 }} onPress={() => router.push({ pathname: '/nv/dopsat', params: { day: night.day } })} />
        </View>
        <Button label={copy.postToVycep} icon="megaphone" height={56} onPress={() => router.push({ pathname: '/nv/vyvesit', params: { day: night.day } })} />
      </View>
    </View>
  );
}
