import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, ScrollView, TextInput, View, useWindowDimensions } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { openSystemSettings } from '@/compass/permissions';
import { generateUuidV4 } from '@/data/account';
import { pickAndPrepareBeerPhoto } from '@/data/beerPhotoPicker';
import { deleteBeerPhoto, fetchBeerPhotos, type BeerPhoto, type BeerPhotoVisibility } from '@/data/beerPhotosClient';
import { deleteBeerPhotoLocalFile, enqueueBeerPhoto, persistBeerPhotoLocally, removeQueuedBeerPhoto } from '@/data/beerPhotosQueue';
import { fetchPhotoContest, fetchPhotoContestTeaser, type PhotoContestSnapshot } from '@/data/photoContestClient';
import { isContextPubKey } from '@/drinks/drinkTypes';
import { intlLocale, t } from '@/i18n';
import { loadBeerPhotos, useBeerPhotosStore, type BeerPhotoLocal } from '@/stores/beerPhotosStore';
import { useTallyStore } from '@/stores/tallyStore';
import { useVycepStore } from '@/stores/vycepStore';

import { BackHeader, Screen } from '../../components/chrome';
import { Icon, type IconName } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, D, IconButton, Press, Row, T, Tile } from '../../components/ui';
import { C, SCREEN_X, font, s } from '../../theme';
import { dialog, toast } from '../../ui/store';
import { daysUntil } from './nightData';

/** What the album, the beer gallery and the detail have in common. */
type PhotoItem = {
  key: string;
  id: string | null;
  uri: string | null;
  caption: string;
  pubName: string;
  beerName: string;
  takenAt: string;
  visibility: BeerPhotoVisibility;
  inContest: boolean;
  state?: 'upload' | 'failed';
  mine: boolean;
  local?: BeerPhotoLocal;
};

function fromLocal(photo: BeerPhotoLocal): PhotoItem {
  return {
    key: photo.id ?? photo.clientId,
    id: photo.id,
    uri: photo.imageUrl ?? photo.localUri ?? null,
    caption: photo.caption,
    pubName: photo.pubName,
    beerName: photo.beerName ?? '',
    takenAt: photo.takenAt || photo.createdAt,
    visibility: photo.visibility,
    inContest: photo.inContest,
    state: photo.syncState === 'pending' ? 'upload' : photo.syncState === 'failed' ? 'failed' : undefined,
    mine: true,
    local: photo,
  };
}

function fromRemote(photo: BeerPhoto, myIds: Set<string>): PhotoItem {
  return {
    key: photo.id,
    id: photo.id,
    uri: photo.imageUrl || null,
    caption: photo.caption,
    pubName: photo.pubName,
    beerName: photo.beerName ?? '',
    takenAt: photo.takenAt || photo.createdAt,
    visibility: photo.visibility,
    inContest: photo.inContest,
    mine: myIds.has(photo.id),
  };
}

/** The last beer gallery, so the detail can open someone else's photo. */
const galleryCache = new Map<string, PhotoItem>();

function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const text = d.toLocaleDateString(intlLocale, { month: 'long', year: 'numeric' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function byMonth<P extends { takenAt: string }>(items: P[]): { month: string; photos: P[] }[] {
  const groups: { month: string; photos: P[] }[] = [];
  for (const item of items) {
    const month = monthLabel(item.takenAt);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.photos.push(item);
    else groups.push({ month, photos: [item] });
  }
  return groups;
}

function useContestTeaser() {
  const [snap, setSnap] = useState<PhotoContestSnapshot | null>(null);
  useEffect(() => {
    let live = true;
    void fetchPhotoContestTeaser().then((next) => {
      if (live) setSnap(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return snap;
}

export function PivniFotkyScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { beer, name } = useLocalSearchParams<{ beer?: string; name?: string }>();
  const beerMode = !!(beer || name);
  const mine = useBeerPhotosStore((st) => st.photos);
  const [gallery, setGallery] = useState<{ items: PhotoItem[]; total: number } | null>(null);
  const [failed, setFailed] = useState(false);
  const contest = useContestTeaser();
  const size = (width - SCREEN_X * 2 - 8) / 3;

  useEffect(() => {
    void loadBeerPhotos();
  }, []);

  useEffect(() => {
    if (!beerMode) return;
    let live = true;
    void fetchBeerPhotos({ key: beer, name }).then((res) => {
      if (!live) return;
      if (!res) {
        setFailed(true);
        return;
      }
      const myIds = new Set(useBeerPhotosStore.getState().photos.map((p) => p.id).filter((id): id is string => !!id));
      const items = res.photos.map((p) => fromRemote(p, myIds));
      for (const item of items) galleryCache.set(item.key, item);
      setGallery({ items, total: res.total });
      setFailed(false);
    });
    return () => {
      live = false;
    };
  }, [beer, beerMode, name]);

  const items = beerMode ? (gallery?.items ?? []) : mine.map(fromLocal);
  const total = beerMode ? (gallery?.total ?? 0) : mine.length;
  const days = contest?.contest ? daysUntil(contest.contest.periodEnd) : null;
  const myEntries = contest?.myEntryIds?.length ?? 0;

  return (
    <Screen header={<BackHeader />} footer={<Button label={t.nv.vycep.shoot} icon="camera" onPress={() => router.push('/nv/do-denicku')} />} gap={16}>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
        <D s={44}>{t.nv.vycep.photosTitle}</D>
        <T s={14} w={600} c={C.muted} style={{ marginBottom: 6 }}>
          {beerMode && !gallery ? ' ' : t.nv.vycep.photosCount(total)}
        </T>
      </View>
      <Press onPress={() => router.push('/nv/fotopivar')} style={[s.row, { gap: 12, padding: 14, borderRadius: 20, backgroundColor: C.card }]}>
        <Tile icon="trophy" />
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            {t.nv.vycep.contestTitle}
          </T>
          <T s={13} c={C.muted}>
            {days === null ? ' ' : t.nv.vycep.photosContestSub(days, myEntries)}
          </T>
        </View>
        <Icon name="chevron-right" size={16} color={C.muted} />
      </Press>
      {failed ? (
        <T s={15} c={C.muted}>
          {t.nv.vycep.photosLoadError}
        </T>
      ) : (beerMode ? gallery !== null : true) && items.length === 0 ? (
        <T s={15} c={C.muted}>
          {t.nv.vycep.photosEmpty}
        </T>
      ) : null}
      {byMonth(items).map((m) => (
        <View key={m.month} style={{ gap: 10 }}>
          <T s={15} w={700} c={C.text2}>
            {m.month}
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
            {m.photos.map((p) => (
              <Press key={p.key} onPress={() => router.push({ pathname: '/nv/fotka/[n]', params: { n: p.key } })}>
                {p.uri ? <Image source={{ uri: p.uri }} style={{ width: size, height: size, borderRadius: 8 }} /> : <View style={{ width: size, height: size, borderRadius: 8, backgroundColor: C.card }} />}
                {p.state ? (
                  <View style={[s.row, { position: 'absolute', left: 8, bottom: 8, height: 26, borderRadius: 13, paddingHorizontal: 9, gap: 5, backgroundColor: C.onYellowMuted }]}>
                    <Icon name={p.state === 'upload' ? 'upload' : 'rotate-cw'} size={12} color={p.state === 'upload' ? C.white : C.yellow} />
                    <T s={11} w={700} c={p.state === 'upload' ? C.white : C.yellow}>
                      {p.state === 'upload' ? t.nv.vycep.uploading : t.nv.vycep.failed}
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

const VISIBILITY: Record<BeerPhotoVisibility, [IconName, () => string]> = {
  public: ['globe', () => t.nv.vycep.photoVisWorld],
  friends: ['users', () => t.nv.vycep.photoVisParta],
  private: ['lock', () => t.nv.vycep.photoVisPrivate],
};

export function DetailFotkyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { n } = useLocalSearchParams<{ n: string }>();
  const { height } = useWindowDimensions();
  const own = useBeerPhotosStore((st) => st.photos.find((p) => p.id === n || p.clientId === n) ?? null);
  const photo = own ? fromLocal(own) : (galleryCache.get(n) ?? null);
  const [contest, setContest] = useState<{ votes: number; rank: number; days: number } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!photo?.inContest || !photo.id) return;
    let live = true;
    const photoId = photo.id;
    void fetchPhotoContest(undefined, { order: 'top' }).then((snap) => {
      if (!live || !snap?.contest) return;
      const index = snap.entries.findIndex((e) => e.photoId === photoId);
      if (index >= 0) setContest({ votes: snap.entries[index].votes, rank: index + 1, days: daysUntil(snap.contest.periodEnd) });
    });
    return () => {
      live = false;
    };
  }, [photo?.id, photo?.inContest]);

  const remove = useCallback(async () => {
    const local = photo?.local;
    if (!local || busy) return;
    setBusy(true);
    try {
      if (local.syncState === 'synced' && local.id) {
        const res = await deleteBeerPhoto(local.id);
        if (!res.ok) {
          toast({ kind: 'error', title: t.nv.vycep.deleteError, icon: 'trash-2' });
          return;
        }
        useBeerPhotosStore.getState().removePhoto(local.id);
      } else {
        await removeQueuedBeerPhoto(local.clientId);
        deleteBeerPhotoLocalFile(local.clientId);
        useBeerPhotosStore.getState().removePhoto(local.clientId);
      }
      nvBack(router);
      toast({ kind: 'info', title: t.nv.vycep.deleted, icon: 'trash-2' });
    } finally {
      setBusy(false);
    }
  }, [busy, photo?.local, router]);

  const back = (
    <IconButton icon="chevron-left" size={40} iconSize={18} bg="#0A0A0A99" onPress={() => nvBack(router)} label={t.nv.vycep.photoBack} />
  );

  if (!photo) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 6, paddingHorizontal: SCREEN_X, gap: 20 }}>
        {back}
        <T s={16} c={C.muted}>
          {t.nv.vycep.photoMissing}
        </T>
      </View>
    );
  }

  const day = photo.takenAt ? new Date(photo.takenAt).toLocaleDateString(intlLocale, { weekday: 'long', day: 'numeric', month: 'numeric' }) : '';
  const [visIcon, visText] = VISIBILITY[photo.visibility];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView bounces={false} contentContainerStyle={{ paddingBottom: insets.bottom + 30 }}>
        {photo.uri ? <Image source={{ uri: photo.uri }} style={{ width: '100%', height: height * 0.56 }} resizeMode="cover" /> : <View style={{ width: '100%', height: height * 0.56, backgroundColor: C.card }} />}
        <View style={{ position: 'absolute', top: height * 0.56 - 140, left: 0, right: 0, height: 140, experimental_backgroundImage: `linear-gradient(180deg, ${C.bg}00 0%, ${C.bg} 100%)` }} />
        <View style={{ paddingHorizontal: SCREEN_X, gap: 12, marginTop: -40 }}>
          {photo.inContest ? (
            <View style={[s.row, { alignSelf: 'flex-start', height: 30, borderRadius: 15, paddingHorizontal: 12, gap: 6, backgroundColor: C.yellowTint, borderWidth: 1, borderColor: C.yellowLine }]}>
              <Icon name="trophy" size={14} color={C.yellow} />
              <T s={13} w={700} c={C.yellow}>
                {t.nv.vycep.inContest}
              </T>
            </View>
          ) : null}
          <D s={34}>{photo.beerName || photo.pubName || t.nv.vycep.photoFallbackTitle}</D>
          <T s={14} c={C.muted}>
            {[photo.beerName ? photo.pubName : '', day].filter(Boolean).join(' · ')}
          </T>
          {photo.caption ? (
            <T s={16} c={C.text2} lh={1.45}>
              {photo.caption}
            </T>
          ) : null}
          {photo.inContest && contest ? (
            <View style={[s.row, { gap: 12, padding: 16, borderRadius: 20, backgroundColor: C.card }]}>
              <View style={[s.fill, { gap: 2 }]}>
                <T s={14} w={700}>
                  {t.nv.vycep.fightsLine}
                </T>
                <T s={13} c={C.muted}>
                  {t.nv.vycep.fightsSub(contest.votes, contest.rank, contest.days)}
                </T>
              </View>
              <Press onPress={() => router.push('/nv/fotopivar')} style={{ height: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: 'center', backgroundColor: C.control }}>
                <T s={14} w={700}>
                  {t.nv.vycep.open}
                </T>
              </Press>
            </View>
          ) : null}
          {photo.mine ? (
            <View style={[s.row, { gap: 8 }]}>
              <Icon name={visIcon} size={14} color={C.muted} />
              <T s={13} c={C.muted}>
                {visText()}
              </T>
            </View>
          ) : null}
        </View>
      </ScrollView>
      <View style={[s.row, { position: 'absolute', top: insets.top + 6, left: SCREEN_X, right: SCREEN_X, justifyContent: 'space-between' }]}>
        {back}
        {photo.local ? (
          <IconButton
            icon="trash-2"
            size={40}
            iconSize={18}
            bg="#0A0A0A99"
            label={t.nv.vycep.deleteLabel}
            onPress={() =>
              dialog({
                title: t.nv.vycep.deleteTitle,
                body: t.nv.vycep.deleteBody,
                actions: [{ label: t.nv.vycep.keep }, { label: t.nv.vycep.deleteConfirm, kind: 'danger', onPress: () => void remove() }],
              })
            }
          />
        ) : null}
      </View>
    </View>
  );
}

/** The beer and pub of the sitting in progress, newest drink first. */
function useSittingTags() {
  const current = useTallyStore((st) => st.current);
  return useMemo(() => {
    const drinks = [...(current?.drinks ?? [])].sort((a, b) => b.at.localeCompare(a.at));
    const beerName = drinks.find((d) => !d.drinkType || d.drinkType === 'beer')?.beerName?.trim() || null;
    const pub = current && !isContextPubKey(current.pubKey) && current.pubName.trim()
      ? { key: current.pubKey, name: current.pubName.trim(), city: current.pubCity ?? '' }
      : null;
    return { beerName, pub };
  }, [current]);
}

export function DoDenickuSheet() {
  const router = useRouter();
  const { contest } = useLocalSearchParams<{ contest?: string }>();
  const shareDefault = useVycepStore((st) => st.shareDefault);
  const tags = useSittingTags();
  const [uri, setUri] = useState<string | null>(null);
  const [withBeer, setWithBeer] = useState(true);
  const [withPub, setWithPub] = useState(true);
  const [caption, setCaption] = useState('');
  const saving = useRef(false);
  const picking = useRef(false);

  const forContest = contest === '1' || shareDefault === 'public';
  const visibility: BeerPhotoVisibility = shareDefault === 'public' ? 'public' : 'friends';
  const visText = shareDefault === 'public' ? t.nv.vycep.visWorld : forContest ? t.nv.vycep.visContest : t.nv.vycep.visParta;

  const shoot = useCallback(
    async (closeOnCancel: boolean) => {
      if (picking.current) return;
      picking.current = true;
      try {
        const picked = await pickAndPrepareBeerPhoto('camera');
        if (picked.status === 'picked') {
          setUri(picked.uri);
          return;
        }
        if (picked.status === 'denied') toast({ kind: 'error', title: t.nv.vycep.permissionCamera, icon: 'camera' });
        if (picked.status === 'error') toast({ kind: 'error', title: t.nv.vycep.pickError, icon: 'camera' });
        if (picked.status === 'denied-permanent') {
          dialog({
            title: t.nv.vycep.diaryTitle,
            body: t.nv.vycep.permissionBlocked,
            actions: [{ label: t.nv.vycep.back }, { label: t.nv.vycep.openSettings, kind: 'primary', onPress: () => void openSystemSettings() }],
          });
        }
        if (closeOnCancel) nvBack(router);
      } finally {
        picking.current = false;
      }
    },
    [router],
  );

  useEffect(() => {
    void shoot(true);
    // The camera opens once, right when the sheet does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!uri || saving.current) return;
    saving.current = true;
    const clientId = generateUuidV4();
    const localUri = await persistBeerPhotoLocally(uri, clientId);
    const pub = withPub ? tags.pub : null;
    const completion = enqueueBeerPhoto({
      clientId,
      localUri,
      caption: caption.trim(),
      ...(pub ? { pubCacheKey: pub.key, pubName: pub.name, pubCity: pub.city } : {}),
      ...(withBeer && tags.beerName ? { beerName: tags.beerName } : {}),
      visibility,
      takenAt: new Date().toISOString(),
      enterContest: forContest,
      contestMode: 'add',
    });
    nvBack(router);
    toast({ kind: 'saved', title: t.nv.vycep.diarySaved, sub: forContest ? t.nv.vycep.diarySavedContest : undefined, icon: 'camera' });
    if (!forContest) return;
    void completion.then(() => {
      const saved = useBeerPhotosStore.getState().photos.find((p) => p.clientId === clientId);
      if (saved?.syncState === 'synced' && !saved.inContest) toast({ kind: 'error', title: t.nv.vycep.contestEntryFailed, icon: 'trophy' });
    });
  };

  return (
    <Sheet title={t.nv.vycep.diaryTitle} top={230} footer={<Button label={t.nv.vycep.diarySave} disabled={!uri} onPress={() => void save()} />}>
      <Press onPress={() => void shoot(false)} style={{ height: 250, borderRadius: 22, overflow: 'hidden', backgroundColor: C.card }}>
        {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
        <View style={[s.row, { position: 'absolute', left: 10, bottom: 10, height: 34, borderRadius: 17, paddingHorizontal: 12, gap: 6, backgroundColor: C.onYellowMuted }]}>
          <Icon name="camera" size={15} />
          <T s={13} w={700}>
            {uri ? t.nv.vycep.retake : t.nv.vycep.shoot}
          </T>
        </View>
      </Press>
      <View>
        <Row
          leading={<Icon name="beer" size={18} color={C.text2} />}
          title={<T s={12} c={C.muted}>{t.nv.vycep.beerLabel}</T>}
          sub={<T s={15} w={700}>{withBeer && tags.beerName ? t.nv.vycep.beerLast(tags.beerName) : t.nv.vycep.beerNone}</T>}
          onPress={tags.beerName ? () => setWithBeer(!withBeer) : undefined}
        />
        <Row
          leading={<Icon name="map-pin" size={18} color={C.text2} />}
          title={<T s={12} c={C.muted}>{t.nv.vycep.pubLabel}</T>}
          sub={<T s={15} w={700}>{withPub && tags.pub ? tags.pub.name : t.nv.vycep.pubNone}</T>}
          onPress={tags.pub ? () => setWithPub(!withPub) : undefined}
        />
        <Row
          last
          leading={<Icon name="pencil" size={18} color={C.text2} />}
          title={<T s={12} c={C.muted}>{t.nv.vycep.captionLabel}</T>}
          sub={
            <TextInput
              value={caption}
              onChangeText={setCaption}
              maxLength={280}
              placeholder={t.nv.vycep.captionPlaceholder}
              placeholderTextColor={C.muted}
              selectionColor={C.yellow}
              keyboardAppearance="dark"
              style={[font(15, 400, C.white), { padding: 0 }]}
            />
          }
        />
      </View>
      <View style={[s.row, { gap: 8 }]}>
        <Icon name={visibility === 'public' || forContest ? 'globe' : 'users'} size={15} color={C.muted} />
        <T s={13} c={C.muted} style={s.fill}>
          {visText}
        </T>
        <Press onPress={() => router.push('/nv/sdileni-souhlas')}>
          <T s={13} w={700}>
            {t.nv.vycep.change}
          </T>
        </Press>
      </View>
    </Sheet>
  );
}
