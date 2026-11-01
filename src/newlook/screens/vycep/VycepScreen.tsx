import React, { useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomFade, TabHeader, useTabBarSpace } from '../../components/chrome';
import { Icon, type IconName } from '../../components/Icon';
import { Button, D, Dot, Press, Segmented, T } from '../../components/ui';
import { FEED, photo, type FeedPost } from '../../mock/data';
import { dialog, toast, useMock } from '../../mock/store';
import { C, SCREEN_X, s } from '../../theme';

export function RundaButton({ count, given, onPress }: { count: number; given: boolean; onPress: () => void }) {
  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityLabel={given ? 'Vzít rundu zpět' : 'Dát rundu'}
      accessibilityState={{ selected: given }}
      style={[
        s.row,
        {
          alignSelf: 'flex-start',
          height: 36,
          borderRadius: 18,
          paddingHorizontal: 14,
          gap: 6,
          backgroundColor: given ? '#FFC40029' : 'transparent',
          borderWidth: 1,
          borderColor: given ? '#FFC40080' : C.hairline,
        },
      ]}
    >
      <Icon name="hand-platter" size={16} color={C.yellow} />
      <T s={14} w={600} c={given ? C.yellow : C.white}>{`Runda · ${count}`}</T>
    </Press>
  );
}

function Shortcut({ icon, title, sub, onPress }: { icon: IconName; title: string; sub: string; onPress: () => void }) {
  return (
    <Press onPress={onPress} style={{ width: 118, padding: 12, gap: 6, borderRadius: 18, backgroundColor: C.card }}>
      <Icon name={icon} size={16} color={C.yellow} />
      <View style={{ gap: 2 }}>
        <T s={14} w={700}>
          {title}
        </T>
        <T s={12} c={C.muted} numberOfLines={1}>
          {sub}
        </T>
      </View>
    </Press>
  );
}

function Post({ p }: { p: FeedPost }) {
  const [given, setGiven] = useState(false);
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 12 }}>
      <View style={[s.row, { gap: 12 }]}>
        <View style={[{ width: 36, height: 36, borderRadius: 18, backgroundColor: C.control }, s.center]}>
          <T s={14} w={800} c={C.yellow}>
            {p.initial}
          </T>
        </View>
        <View style={[s.fill, { gap: 1 }]}>
          <T s={16} w={700}>{`@${p.user}`}</T>
          <T s={12} c={C.muted}>{`${p.city} · ${p.when} · ${p.scope}`}</T>
        </View>
        <Press
          hitSlop={10}
          accessibilityLabel="Nahlásit"
          onPress={() =>
            dialog({
              title: 'Nahlásit noc?',
              body: `Mrknu na noc od @${p.user}. Když nesedí s pravidly, zmizí z Výčepu.`,
              actions: [{ label: 'Zpátky' }, { label: 'Nahlásit', kind: 'danger', onPress: () => toast({ kind: 'saved', title: 'Nahlášeno.', sub: 'Mrknu na to.', icon: 'flag' }) }],
            })
          }
        >
          <Icon name="flag" size={16} color={C.muted} />
        </Press>
      </View>
      {p.photo ? (
        <View>
          <Image source={photo(p.photo)} style={{ width: '100%', height: 170, borderRadius: 16 }} resizeMode="cover" />
          {p.rounds > 10 ? (
            <View style={[s.row, { position: 'absolute', left: 10, top: 10, height: 30, borderRadius: 15, paddingHorizontal: 10, gap: 6, backgroundColor: '#0A0A0AB3' }]}>
              <Icon name="trophy" size={14} color={C.yellow} />
              <T s={12} w={700}>
                Ve FotoPivaři
              </T>
            </View>
          ) : null}
        </View>
      ) : null}
      <View style={{ gap: 4 }}>
        <D s={40} lh={1}>{`${p.beers} piv`}</D>
        <T s={14} w={500} c={C.text2}>{`${p.route} · ${p.duration}`}</T>
      </View>
      <RundaButton count={p.rounds + (given ? 1 : 0)} given={given} onPress={() => setGiven(!given)} />
    </View>
  );
}

export function VycepScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tabSpace = useTabBarSpace();
  const [scope, setScope] = useState<'svet' | 'parta'>('svet');
  const shareMode = useMock((st) => st.shareMode);
  const feed = scope === 'svet' ? FEED : FEED.filter((f) => f.friend);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, gap: 16, paddingBottom: tabSpace + 30 }}>
        <TabHeader title="Výčep">
          <Button label="Vyvěsit noc" icon="plus" height={44} style={{ paddingHorizontal: 18 }} onPress={() => router.push(shareMode ? '/nv/vyvesit' : '/nv/prvni-vyveseni')} />
        </TabHeader>
        <Segmented
          height={38}
          options={[
            { key: 'svet', label: 'Svět' },
            { key: 'parta', label: 'Parta' },
          ]}
          value={scope}
          onChange={setScope}
        />
        <View style={{ padding: 16, gap: 12, borderRadius: 24, backgroundColor: '#FFC4000D', borderWidth: 1, borderColor: '#FFC40059' }}>
          <View style={[s.row, { gap: 8 }]}>
            <Dot />
            <T s={14} w={700} c={C.yellow}>
              {scope === 'svet' ? 'Posledních 7 dní ve světě' : 'Posledních 7 dní v partě'}
            </T>
          </View>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            {(scope === 'svet'
              ? [
                  ['214', 'vyvěšených nocí'],
                  ['689', 'piv'],
                  ['Praha', 'vede'],
                ]
              : [
                  ['9', 'vyvěšených nocí'],
                  ['31', 'piv'],
                  ['Marek', 'vede'],
                ]
            ).map(([v, l], i) => (
              <View key={l} style={{ gap: 2, alignItems: i === 2 ? 'flex-end' : 'flex-start', flex: i === 0 ? 1.4 : 1 }}>
                <D s={28} lh={1}>
                  {v}
                </D>
                <T s={12} c={C.muted}>
                  {l}
                </T>
              </View>
            ))}
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SCREEN_X }} contentContainerStyle={{ paddingHorizontal: SCREEN_X, gap: 8 }}>
          <Shortcut icon="camera" title="FotoPivař" sub="ještě 5 dní" onPress={() => router.push('/nv/fotopivar')} />
          <Shortcut icon="route" title="Tour de pub" sub="Žižkov · 5 hospod" onPress={() => router.push('/nv/tour')} />
          <Shortcut icon="trophy" title="Žebříčky" sub="4. v zemi" onPress={() => router.push('/nv/zebricky')} />
        </ScrollView>
        {feed.map((p) => (
          <Post key={p.id} p={p} />
        ))}
      </ScrollView>
      <BottomFade height={tabSpace + 40} />
    </View>
  );
}
