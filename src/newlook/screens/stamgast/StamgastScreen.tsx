import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated, { FadeInDown, ZoomIn } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomFade, LevelAvatar, useTabBarSpace } from '../../components/chrome';
import { Icon, type IconName } from '../../components/Icon';
import { Button, D, Press, Segmented, Stack, T, Tile } from '../../components/ui';
import { beerById, pubById } from '../../mock/data';
import { toast, useMock, useTonight } from '../../mock/store';
import { C, SCREEN_X, s, shadow } from '../../theme';
import { TOUR, nextStopIndex } from '../../mock/tour';
import { TourRunContent } from '../tour/TourScreens';
import { DiaryView } from './DiaryView';

export function StamgastScreen() {
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const tourActive = useMock((st) => st.tourActive);
  const stored = useMock((st) => st.stamgastMode);
  const set = useMock((st) => st.set);
  const mode = stored === 'tour' && !tourActive ? 'pocitat' : stored;
  const options: { key: 'pocitat' | 'denik' | 'tour'; label: string }[] = [
    { key: 'pocitat', label: 'Počítat' },
    { key: 'denik', label: 'Deník' },
    ...(tourActive ? [{ key: 'tour' as const, label: '• Tour' }] : []),
  ];
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={[s.row, { paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 12, zIndex: 2 }]}>
        <Segmented style={s.fill} options={options} value={mode} onChange={(k) => set({ stamgastMode: k })} />
        <LevelAvatar />
      </View>
      {mode === 'pocitat' ? (
        <CounterView />
      ) : mode === 'denik' ? (
        <DiaryView />
      ) : (
        <TourTab tabSpace={tabSpace} />
      )}
    </View>
  );
}

function TourTab({ tabSpace }: { tabSpace: number }) {
  const router = useRouter();
  const st = useMock();
  const next = nextStopIndex(st.tourStops);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SCREEN_X, paddingTop: 18, paddingBottom: tabSpace + 100 }}>
        <TourRunContent embedded />
      </ScrollView>
      <BottomFade height={tabSpace + 110} />
      <View style={[s.row, { position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: tabSpace + 12, gap: 10 }]}>
        {next >= 0 ? (
          <>
            <Button label={`Zapsat pivo na ${['jedničce', 'dvojce', 'trojce', 'čtyřce', 'pětce'][next]}`} icon="beer" flex height={56} onPress={() => st.addDrink()} />
            <Button label={TOUR.stops[next].walkShort.replace('asi ', '')} icon="navigation" kind="raised" height={56} onPress={() => router.push('/nv/tour-mapa')} />
          </>
        ) : (
          <Button label="Ukončit tour" icon="flag" flex height={56} onPress={() => router.push('/nv/tour-ukoncit')} />
        )}
      </View>
    </View>
  );
}

function Stat({ value, label, color = C.white, onPress }: { value: string; label: string; color?: string; onPress?: () => void }) {
  const body = (
    <View style={{ alignItems: 'center', gap: 1 }}>
      <T s={16} w={700} c={color}>
        {value}
      </T>
      <T s={12} c={C.dim}>
        {label}
      </T>
    </View>
  );
  return onPress ? (
    <Press onPress={onPress} hitSlop={8}>
      {body}
    </Press>
  ) : (
    body
  );
}

function QuickAction({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Press haptic onPress={onPress} accessibilityLabel={label} style={{ flex: 1, alignItems: 'center', gap: 8 }}>
      <View style={[{ width: 56, height: 56, borderRadius: 28, backgroundColor: C.control }, s.center, shadow.raised]}>
        <Icon name={icon} size={22} />
      </View>
      <T s={12} w={600} c={C.text2}>
        {label}
      </T>
    </Press>
  );
}

function sitting(first?: string) {
  if (!first) return '0 min';
  const [h, m] = first.split(':').map(Number);
  const now = new Date();
  let mins = now.getHours() * 60 + now.getMinutes() - (h * 60 + m);
  if (mins < 0 || mins > 600) mins = 85;
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
}

function CounterView() {
  const router = useRouter();
  const tabSpace = useTabBarSpace();
  const { tonight, count, spent, last, lastBeer } = useTonight();
  const st = useMock();
  const pub = pubById(st.pubId);
  const prevCount = useRef(count);
  const [bump, setBump] = useState(0);

  useEffect(() => {
    if (count > prevCount.current) setBump((b) => b + 1);
    prevCount.current = count;
  }, [count]);

  const oneMore = () => {
    st.addDrink();
    const next = useMock.getState().tonight.length;
    if (next === 3) st.set({ stickerNudge: true });
  };

  const promile = st.promileEnabled ? '≈ 0,5 ‰' : 'Nastavit';

  return (
    <View style={{ flex: 1 }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: SCREEN_X, paddingTop: 20, gap: 20, paddingBottom: tabSpace + 100 }}>
        <View style={{ alignItems: 'center' }}>
          <Press
            haptic
            onPress={() => router.push('/nv/zmenit-misto')}
            style={[s.row, { height: 34, borderRadius: 17, paddingHorizontal: 14, gap: 6, backgroundColor: '#FFFFFF14' }]}
          >
            <Icon name={st.atHome || st.atFriend ? 'house' : 'map-pin'} size={15} color={C.yellow} />
            <T s={14} w={700}>
              {st.atFriend ? 'U Kláry doma' : st.atHome ? 'Doma / na chatě' : pub?.name ?? 'Kde sedíš?'}
            </T>
            <Icon name="chevron-down" size={15} color={C.text2} />
          </Press>
        </View>
        <View style={{ alignItems: 'center', gap: 4 }}>
          <Animated.View key={bump} entering={bump ? ZoomIn.springify().damping(12) : undefined}>
            <D s={120} lh={1} c={C.yellow} style={{ letterSpacing: -2 }} accessibilityLabel={`${count} piv dnes večer`}>
              {String(count)}
            </D>
          </Animated.View>
          <T s={17} w={600} c={C.text2}>
            {`${count === 1 ? 'pivo' : count >= 2 && count <= 4 ? 'piva' : 'piv'} ${st.atFriend ? 'u Kláry' : 'dnes večer'}`}
          </T>
          <View style={[s.row, { gap: 28, paddingTop: 8 }]}>
            {st.atFriend ? null : <Stat value={`${spent} Kč`} label="útrata" />}
            <Stat value={sitting(tonight[tonight.length - 1]?.time)} label="u stolu" />
            <Stat value={promile} label={st.promileEnabled ? 'odhad' : 'odhad ‰'} color={st.promileEnabled ? C.white : C.yellow} onPress={() => router.push('/nv/odhad')} />
          </View>
        </View>
        <View style={[s.row, { paddingTop: 4 }]}>
          <QuickAction icon="plus" label="Jiné pivo" onPress={() => router.push('/nv/zapis')} />
          <QuickAction icon="history" label="Dopsat" onPress={() => router.push('/nv/dopsat')} />
          <QuickAction icon="camera" label="Fotka" onPress={() => router.push('/nv/do-denicku')} />
          <QuickAction
            icon="circle-check"
            label="Dopito"
            onPress={() => {
              if (!count) {
                toast({ kind: 'info', title: 'Dneska ještě nic nepadlo.', icon: 'beer' });
                return;
              }
              st.endEvening();
              router.push('/nv/uctenka');
            }}
          />
        </View>
        {st.stickerNudge ? (
          <View style={[s.row, { gap: 12, padding: 12, borderRadius: 22, backgroundColor: '#FFC4000D', borderWidth: 1, borderColor: '#FFC40059' }]}>
            <View style={[{ width: 52, height: 52, borderRadius: 26, backgroundColor: C.white, borderWidth: 3, borderColor: C.yellow }, s.center]}>
              <T s={22} w={900} c={C.black} style={{ letterSpacing: 2 }}>
                III
              </T>
            </View>
            <View style={[s.fill, { gap: 2 }]}>
              <T s={15} w={700}>{`${count}. pivo. Hoď to na story?`}</T>
              <T s={12} c={C.muted}>
                Tácek je připravený
              </T>
            </View>
            <Press
              haptic
              onPress={() => {
                st.set({ stickerNudge: false });
                router.push('/nv/nalepky');
              }}
              style={{ height: 36, borderRadius: 18, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: C.white }}
            >
              <T s={14} w={800} c={C.black}>
                Nálepka
              </T>
            </Press>
            <Press onPress={() => st.set({ stickerNudge: false })} hitSlop={10} accessibilityLabel="Zavřít">
              <Icon name="x" size={16} color={C.muted} />
            </Press>
          </View>
        ) : null}
        {st.tourActive && st.tourBanner !== null ? (
          <View style={[s.row, { gap: 12, padding: 16, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.hairline }]}>
            <Icon name="route" size={18} color={C.yellow} />
            <T s={15} w={700} style={s.fill}>{`${count}. pivo, ${['jednička', 'dvojka', 'trojka', 'čtyřka', 'pětka'][st.tourBanner]} odškrtnutá`}</T>
            <Press
              onPress={() => {
                if (st.tourBanner !== null) st.markStop(st.tourBanner, 'todo');
                st.set({ tourBanner: null });
              }}
            >
              <T s={15} w={700} c={C.yellow}>
                Vrátit
              </T>
            </Press>
          </View>
        ) : null}
        {st.atFriend ? <FriendEveningCard /> : null}
        {st.homeSet && count > 0 && !st.atFriend ? <TransitCard /> : null}
        <View style={{ backgroundColor: C.card, borderRadius: 24, paddingTop: 4, paddingHorizontal: 16, paddingBottom: 8 }}>
          <View style={[s.row, { height: 50, justifyContent: 'space-between' }]}>
            <T s={16} w={700}>
              Dnešní piva
            </T>
            <T s={14} w={600} c={C.muted}>{`${spent} Kč`}</T>
          </View>
          {tonight.length ? (
            tonight.map((d, i) => (
              <Animated.View key={d.id} entering={i === 0 ? FadeInDown : undefined} style={[s.row, { height: 62, gap: 12 }]}>
                <Tile icon="beer" />
                <View style={[s.fill, { gap: 2 }]}>
                  <T s={15} w={600}>
                    {beerById(d.beerId)?.name}
                  </T>
                  <T s={13} c={C.muted}>{`${d.kind} · ${d.size}`}</T>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <T s={15} w={600}>{`${d.price} Kč`}</T>
                  <T s={12} c={C.muted}>
                    {d.time}
                  </T>
                </View>
              </Animated.View>
            ))
          ) : (
            <T s={14} c={C.muted} style={{ paddingVertical: 14 }}>
              Zatím nic. První pivo zapíšeš tlačítkem dole.
            </T>
          )}
          {tonight.length ? (
            <Press onPress={st.removeLastDrink} style={[s.row, { height: 44, gap: 8 }]}>
              <Icon name="undo-2" size={15} color={C.muted} />
              <T s={13} w={600} c={C.muted}>
                Vrátit poslední zápis
              </T>
            </Press>
          ) : null}
        </View>
      </ScrollView>
      <BottomFade height={tabSpace + 130} />
      {st.newBeerNudge ? (
        <Animated.View entering={FadeInDown} style={{ position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: tabSpace + 86 }}>
          <View style={[s.row, { padding: 14, paddingRight: 10, borderRadius: 22, backgroundColor: C.toast, borderWidth: 1, borderColor: '#FFFFFF1F', gap: 10 }, shadow.raised]}>
            <View style={[s.fill, { gap: 2 }]}>
              <T s={15} w={700}>
                Nové pivo do sbírky
              </T>
              <T s={13} c={C.muted}>
                38. různé · jak ti chutná?
              </T>
            </View>
            <Press
              haptic
              onPress={() => {
                const id = st.newBeerNudge;
                st.set({ newBeerNudge: null });
                router.push({ pathname: '/nv/hodnoceni', params: { id: id ?? 'bernard' } });
              }}
              style={[s.row, { height: 40, borderRadius: 20, paddingHorizontal: 14, gap: 6, backgroundColor: C.control }]}
            >
              <Icon name="star" size={16} color={C.yellow} />
              <T s={15} w={700}>
                Ohodnotit
              </T>
              <Icon name="chevron-right" size={14} color={C.text2} />
            </Press>
          </View>
        </Animated.View>
      ) : null}
      <View style={{ position: 'absolute', left: SCREEN_X, right: SCREEN_X, bottom: tabSpace + 12 }}>
        <Button height={60} label="Ještě jedno" sub={lastBeer ? `${lastBeer.name} · ${last?.size}` : 'Pilsner Urquell 12° · 0,5 l'} onPress={oneMore} />
      </View>
    </View>
  );
}

function FriendEveningCard() {
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 12 }}>
      <View style={[s.row, { gap: 8 }]}>
        <Icon name="house" size={18} color={C.yellow} />
        <T s={17} w={700} style={s.fill}>
          Večer u Kláry
        </T>
        <T s={13} w={600} c={C.muted}>
          od 19:00
        </T>
      </View>
      <View style={[s.row, { gap: 12 }]}>
        <Stack initials={['K', 'J', 'T']} />
        <T s={14} c={C.text2} style={s.fill}>
          Jsi tu s Klárou a Jirkou. Petra a Marek dorazí.
        </T>
      </View>
      <View style={[s.row, { gap: 8, borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 10 }]}>
        <Icon name="lock" size={13} color={C.muted} />
        <T s={12} c={C.muted}>
          Zbytek party vidí jen „U někoho doma“.
        </T>
      </View>
    </View>
  );
}

function TransitCard() {
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 12 }}>
      <View style={[s.row, { gap: 12, alignItems: 'flex-start' }]}>
        <Tile icon="tram-front" color={C.white} />
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            Poslední přímý spoj domů
          </T>
          <T s={13} c={C.muted}>
            Tramvaj 22 · Národní třída → Vinohradská vodárna
          </T>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <D s={28} lh={1}>
            23:52
          </D>
          <T s={13} w={700} c={C.white}>
            za 38 min
          </T>
        </View>
      </View>
      <View style={[s.row, { justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: C.hairline, paddingTop: 10 }]}>
        <T s={11} c={C.muted}>
          Bez nočních linek · ROPID, CC BY 4.0
        </T>
        <View style={[s.row, { gap: 4 }]}>
          <T s={13} w={700}>
            Kudy domů v IDOS
          </T>
          <Icon name="arrow-up-right" size={14} />
        </View>
      </View>
    </View>
  );
}
