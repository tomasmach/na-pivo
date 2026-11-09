import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Image, ScrollView, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { fetchFriendBeerPhotos, fetchPartaPhotoFeed, type PartaFeedPhoto } from '@/data/beerPhotosClient';
import { useNowTick } from '@/friends/useNowTick';
import { t } from '@/i18n';
import { nvBack } from '@/newlook/navigation';
import { useAccountStore } from '@/stores/accountStore';
import { loadBeerPhotos, useBeerPhotosStore } from '@/stores/beerPhotosStore';

import { BackHeader, Screen } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { D, IconButton, Person, Press, SectionTitle, T } from '../../components/ui';
import { C, SCREEN_X, s } from '../../theme';
import { byMonth } from '../vycep/PhotoScreens';
import { personInitial } from './partaModel';
import { fromRemote, partaStripPhotos, photoWhen, type ViewerPhoto } from './photoModel';
import { useEdgeBleed } from '../../duo/paneContext';

/** The list the full-screen viewer swipes through; set right before opening it. */
const usePhotoViewer = create<{ photos: ViewerPhoto[] }>(() => ({ photos: [] }));

function openViewer(router: ReturnType<typeof useRouter>, photos: ViewerPhoto[], index: number) {
  usePhotoViewer.setState({ photos });
  router.push({ pathname: '/nv/fotky-party', params: { i: String(index) } });
}

/** The party's photos from the last week, mine included when the party sees them. */
function usePartaPhotos(): ViewerPhoto[] {
  const [feed, setFeed] = useState<PartaFeedPhoto[]>([]);
  const mine = useBeerPhotosStore((st) => st.photos);
  const profile = useAccountStore((st) => st.profile);
  const now = useNowTick();
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      void loadBeerPhotos(controller.signal);
      void fetchPartaPhotoFeed(controller.signal).then((next) => {
        if (!controller.signal.aborted && next) setFeed(next);
      });
      return () => controller.abort();
    }, []),
  );
  return useMemo(() => {
    const me = { initial: profile ? personInitial({ displayName: profile.displayName ?? '', nickname: profile.nickname ?? null }) : t.nv.parta.you.slice(0, 1), name: t.nv.parta.you, short: t.nv.parta.you };
    return partaStripPhotos(feed, mine, now, me);
  }, [feed, mine, now, profile]);
}

export function PartaPhotoStrip() {
  const router = useRouter();
  const photos = usePartaPhotos();
  const bleed = useEdgeBleed(SCREEN_X);
  if (photos.length === 0) return null;
  return (
    <View style={{ gap: 12 }}>
      <SectionTitle title={t.nv.parta.freshPhotos} action={t.nv.parta.lastSevenDays} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={bleed.style} contentContainerStyle={[bleed.contentStyle, { gap: 8 }]}>
        {photos.map((photo, i) => (
          <Press key={photo.key} onPress={() => openViewer(router, photos, i)} accessibilityRole="imagebutton" accessibilityLabel={`${photo.author.name}, ${photo.title}`}>
            <Image source={{ uri: photo.uri }} style={{ width: 100, height: 124, borderRadius: 16, backgroundColor: C.card }} />
            <View style={[s.row, { position: 'absolute', left: 6, bottom: 6, height: 26, borderRadius: 13, paddingLeft: 3, paddingRight: 9, gap: 5, backgroundColor: '#0A0A0AB3' }]}>
              <Person initial={photo.author.initial} size={20} />
              <T s={12} w={700} numberOfLines={1} style={{ maxWidth: 60 }}>
                {photo.author.short}
              </T>
            </View>
          </Press>
        ))}
      </ScrollView>
    </View>
  );
}

export function PartaPhotoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { i } = useLocalSearchParams<{ i?: string }>();
  const photos = usePhotoViewer((st) => st.photos);
  const start = Math.min(Math.max(Number(i) || 0, 0), Math.max(photos.length - 1, 0));
  const [index, setIndex] = useState(start);
  const close = <IconButton icon="x" size={40} iconSize={18} bg="#0A0A0A99" onPress={() => nvBack(router)} label={t.nv.common.close} />;

  if (photos.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 6, paddingHorizontal: SCREEN_X, gap: 20 }}>
        {close}
        <T s={16} c={C.muted}>
          {t.nv.vycep.photoMissing}
        </T>
      </View>
    );
  }

  const imageH = height * 0.56;
  const dots = Array.from({ length: Math.min(photos.length, 7) }, (_, d) => Math.min(Math.max(index - 3, 0), Math.max(photos.length - 7, 0)) + d);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={start}
        getItemLayout={(_, n) => ({ length: width, offset: width * n, index: n })}
        keyExtractor={(p) => p.key}
        onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
        renderItem={({ item }) => (
          <View style={{ width }}>
            <Image source={{ uri: item.uri }} style={{ width, height: imageH, backgroundColor: C.card }} resizeMode="cover" />
            <View style={{ position: 'absolute', top: imageH - 140, left: 0, right: 0, height: 140, experimental_backgroundImage: `linear-gradient(180deg, ${C.bg}00 0%, ${C.bg} 100%)` }} />
            <View style={{ paddingHorizontal: SCREEN_X, gap: 12, marginTop: -44 }}>
              <View style={[s.row, { gap: 10 }]}>
                <Person initial={item.author.initial} size={32} />
                <T s={15} w={600}>
                  {item.author.name}
                </T>
              </View>
              <D s={34}>{item.title}</D>
              <T s={14} c={C.muted}>
                {[item.pubName, photoWhen(item.takenAt)].filter(Boolean).join(' · ')}
              </T>
              {item.caption ? (
                <T s={16} c={C.text2} lh={1.45}>
                  {item.caption}
                </T>
              ) : null}
              <View style={[s.row, { gap: 8 }]}>
                <Icon name={item.visibility === 'public' ? 'globe' : 'users'} size={14} color={C.muted} />
                <T s={13} c={C.muted}>
                  {item.visibility === 'public' ? t.nv.parta.seenByAll : t.nv.parta.seenByParta}
                </T>
              </View>
            </View>
          </View>
        )}
      />
      <View style={{ position: 'absolute', top: insets.top + 6, left: SCREEN_X }}>{close}</View>
      {photos.length > 1 ? (
        <View style={{ position: 'absolute', bottom: insets.bottom + 24, left: 0, right: 0, alignItems: 'center', gap: 10 }} pointerEvents="none">
          <View style={[s.row, { gap: 6 }]}>
            {dots.map((d) => (
              <View key={d} style={{ width: d === index ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: d === index ? C.yellow : '#FFFFFF40' }} />
            ))}
          </View>
          <T s={13} c={C.muted}>
            {t.nv.parta.photoPage(index + 1, photos.length)}
          </T>
        </View>
      ) : null}
    </View>
  );
}

function useFriendPhotos(id: string | undefined, name: string) {
  const [photos, setPhotos] = useState<ViewerPhoto[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    void fetchFriendBeerPhotos(id, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      setFailed(!next);
      const who = { initial: name.slice(0, 1).toUpperCase() || '?', name, short: name };
      setPhotos((next ?? []).map((p) => fromRemote(p, who)));
    });
    return () => controller.abort();
  }, [id, name]);
  return { photos, failed };
}

/** "Pivní fotky" on a friend's profile: the three newest and a way to all of them. */
export function FriendPhotosSection({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const { photos } = useFriendPhotos(id, name);
  if (!photos?.length) return null;
  return (
    <View style={{ gap: 12 }}>
      <SectionTitle title={t.nv.parta.beerPhotos} action={t.nv.parta.allPhotos(photos.length)} onAction={() => router.push({ pathname: '/nv/fotky-kamose', params: { id, name } })} />
      <View style={[s.row, { gap: 4, borderRadius: 16, overflow: 'hidden' }]}>
        {photos.slice(0, 3).map((photo, i) => (
          <Press key={photo.key} onPress={() => openViewer(router, photos, i)} style={{ flex: 1 }} accessibilityRole="imagebutton" accessibilityLabel={photo.title}>
            <Image source={{ uri: photo.uri }} style={{ width: '100%', aspectRatio: 1, backgroundColor: C.card }} />
          </Press>
        ))}
        {Array.from({ length: Math.max(0, 3 - photos.length) }, (_, i) => (
          <View key={`gap-${i}`} style={{ flex: 1 }} />
        ))}
      </View>
    </View>
  );
}

export function FriendPhotosScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { id, name = '' } = useLocalSearchParams<{ id?: string; name?: string }>();
  const { photos, failed } = useFriendPhotos(id, name);
  const size = (width - SCREEN_X * 2 - 8) / 3;
  const list = photos ?? [];
  return (
    <Screen header={<BackHeader />} gap={16}>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
        <D s={44}>{t.nv.parta.beerPhotos}</D>
        <T s={14} w={600} c={C.muted} style={{ marginBottom: 6 }}>
          {photos ? `${name.trim().split(/\s+/)[0]} · ${t.nv.vycep.photosCount(list.length)}` : ' '}
        </T>
      </View>
      {failed ? (
        <T s={15} c={C.muted}>
          {t.nv.vycep.photosLoadError}
        </T>
      ) : photos && list.length === 0 ? (
        <T s={15} c={C.muted}>
          {t.nv.vycep.photosEmpty}
        </T>
      ) : null}
      {byMonth(list).map((m) => (
        <View key={m.month} style={{ gap: 10 }}>
          <T s={15} w={700} c={C.text2}>
            {m.month}
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {m.photos.map((photo) => (
              <Press key={photo.key} onPress={() => openViewer(router, list, list.indexOf(photo))} accessibilityRole="imagebutton" accessibilityLabel={photo.title}>
                <Image source={{ uri: photo.uri }} style={{ width: size, height: size, borderRadius: 8, backgroundColor: C.card }} />
              </Press>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}
