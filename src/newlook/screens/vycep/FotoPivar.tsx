import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, View, type StyleProp, type ViewStyle } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { create } from 'zustand';
import { nvBack } from '@/newlook/navigation';

import { reportProfileContent } from '@/data/auth';
import {
  addPhotoContestEntry,
  fetchPhotoContest,
  setPhotoContestRound,
  withdrawPhotoContestEntryById,
  type PhotoContestEntry,
  type PhotoContestSnapshot,
} from '@/data/photoContestClient';
import type { FriendProfile } from '@/data/friendsClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { t } from '@/i18n';
import { useAccountStore } from '@/stores/accountStore';
import { loadBeerPhotos, useBeerPhotosStore, type BeerPhotoLocal } from '@/stores/beerPhotosStore';
import { useVycepStore } from '@/stores/vycepStore';

import { BackHeader, Screen } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { D, T, Button, Kicker, Press, Segmented } from '../../components/ui';
import { NO_VALUE } from '../../format';
import { C, SCREEN_X, s } from '../../theme';
import { dialog, toast } from '../../ui/store';
import { openViewer } from '../parta/PartaPhotos';
import { personInitial } from '../parta/partaModel';
import type { ViewerPhoto } from '../parta/photoModel';
import { daysUntil } from './nightData';
import { useNvRouter } from '../../duo/details';
import { usePaneWidth } from '../../duo/pane';

function handleOf(account: FriendProfile): string {
  return account.nickname ? `@${account.nickname}` : account.displayName || t.nv.vycep.authorFallback;
}

function viewerPhoto(entry: PhotoContestEntry): ViewerPhoto {
  const name = entry.isMine ? t.nv.vycep.me : handleOf(entry.account);
  return {
    key: entry.id,
    uri: entry.imageUrl,
    title: entry.beerName || entry.pubName || t.nv.vycep.photoFallbackTitle,
    pubName: entry.beerName ? entry.pubName : '',
    // The entry carries when it joined the round, not when the photo was taken.
    takenAt: '',
    caption: entry.caption,
    visibility: 'public',
    author: { initial: personInitial(entry.account), name, short: name, id: entry.isMine ? undefined : entry.account.id },
  };
}

/** The round ranked by rundas, shared by the grid and the photo viewer opened from it. */
const useContestStore = create<{ snap: PhotoContestSnapshot | null; failed: boolean }>(() => ({ snap: null, failed: false }));

let contestGeneration = 0;

function loadContest(signal?: AbortSignal) {
  const generation = contestGeneration;
  void fetchPhotoContest(signal, { order: 'top' }).then((next) => {
    if (signal?.aborted || generation !== contestGeneration) return;
    useContestStore.setState((st) => ({ snap: next ?? st.snap, failed: !next }));
  });
}

function patchEntry(id: string, patch: Partial<PhotoContestEntry>) {
  useContestStore.setState(({ snap }) => ({ snap: snap && { ...snap, entries: snap.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) } }));
}

function toggleRound(entry: PhotoContestEntry) {
  if (entry.isMine) return;
  const on = !entry.myVote;
  trackUiInteraction('photo_contest_vote', 'submit');
  patchEntry(entry.id, { myVote: on, votes: Math.max(0, entry.votes + (on ? 1 : -1)) });
  void setPhotoContestRound(entry.id, on).then((res) => {
    trackUiInteraction('photo_contest_vote', res.ok ? 'success' : 'failure');
    patchEntry(entry.id, res.ok ? { myVote: res.myVote, votes: res.votes } : { myVote: entry.myVote, votes: entry.votes });
    if (!res.ok) toast({ kind: 'error', title: t.nv.vycep.roundError, icon: 'hand-platter' });
  });
}

function entryMenu(entry: PhotoContestEntry, onWithdraw?: () => void) {
  if (entry.isMine) {
    dialog({
      title: t.nv.vycep.withdrawTitle,
      body: t.nv.vycep.withdrawBody,
      actions: [
        { label: t.nv.vycep.back },
        {
          label: t.nv.vycep.withdrawConfirm,
          kind: 'danger',
          onPress: () => {
            onWithdraw?.();
            void withdrawPhotoContestEntryById(entry.id).then((res) => {
              if (!res.ok) {
                toast({ kind: 'error', title: res.detail, icon: 'trophy' });
                return;
              }
              toast({ kind: 'info', title: t.nv.vycep.withdrawn, icon: 'trophy' });
              loadContest();
              void loadBeerPhotos();
            });
          },
        },
      ],
    });
    return;
  }
  dialog({
    title: t.nv.vycep.reportPhotoTitle,
    body: t.nv.vycep.reportPhotoBody(handleOf(entry.account)),
    actions: [
      { label: t.nv.vycep.back },
      {
        label: t.nv.vycep.report,
        kind: 'danger',
        onPress: () =>
          void reportProfileContent({
            targetAccountId: entry.account.id,
            reason: 'inappropriate_photo',
            ...(entry.photoId ? { photoId: entry.photoId } : {}),
          }).then((res) =>
            res.ok
              ? toast({ kind: 'saved', title: t.nv.vycep.reported, sub: t.nv.vycep.reportedSub, icon: 'flag' })
              : toast({ kind: 'error', title: t.nv.vycep.reportError, icon: 'flag' }),
          ),
      },
    ],
  });
}

function RoundButton({ entry, large = false, style }: { entry: PhotoContestEntry; large?: boolean; style?: StyleProp<ViewStyle> }) {
  const height = large ? 40 : 32;
  return (
    <Press
      haptic
      hitSlop={large ? 4 : undefined}
      disabled={entry.isMine}
      accessibilityLabel={entry.myVote ? t.nv.vycep.roundTake : t.nv.vycep.roundGive}
      accessibilityState={{ selected: entry.myVote, disabled: entry.isMine }}
      onPress={() => toggleRound(entry)}
      style={[s.row, { height, borderRadius: height / 2, paddingHorizontal: large ? 14 : 10, gap: 6, backgroundColor: entry.myVote ? C.yellow : large ? C.control : C.onYellowMuted }, style]}
    >
      <Icon name="hand-platter" size={large ? 17 : 15} color={entry.myVote ? C.black : C.yellow} />
      <T s={large ? 16 : 14} w={800} c={entry.myVote ? C.black : C.white}>
        {entry.votes}
      </T>
    </Press>
  );
}

function ViewerRound({ id }: { id: string }) {
  const entry = useContestStore((st) => st.snap?.entries.find((e) => e.id === id));
  return entry ? <RoundButton entry={entry} large /> : null;
}

export function FotoPivarScreen() {
  const router = useNvRouter();
  const width = usePaneWidth();
  const { snap, failed } = useContestStore();
  useFocusEffect(
    useCallback(() => {
      const controller = new AbortController();
      loadContest(controller.signal);
      return () => controller.abort();
    }, []),
  );
  useEffect(
    () => () => {
      contestGeneration += 1;
      useContestStore.setState({ snap: null, failed: false });
    },
    [],
  );
  const parta = useVycepStore((st) => st.shareDefault) === 'friends';
  const myId = useAccountStore((st) => st.profile?.id ?? null);
  const [tab, setTab] = useState<'nove' | 'vedou'>('nove');
  const [ended, setEnded] = useState(false);
  const col = (width - SCREEN_X * 2 - 10) / 2;

  const ranked = useMemo(() => snap?.entries ?? [], [snap]);
  const entries = useMemo(
    () => (tab === 'vedou' ? ranked : [...ranked].sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
    [ranked, tab],
  );
  const mine = ranked.filter((e) => e.isMine);
  const best = mine[0] ?? null;
  const days = snap?.contest ? daysUntil(snap.contest.periodEnd) : null;

  const openEntry = (entry: PhotoContestEntry) =>
    openViewer(router, entries.map(viewerPhoto), entries.indexOf(entry), {
      besideAuthor: (photo) => <ViewerRound id={photo.key} />,
      menu: {
        label: t.nv.vycep.entryMenu,
        onPress: (photo, close) => {
          const current = useContestStore.getState().snap?.entries.find((e) => e.id === photo.key);
          if (current) entryMenu(current, close);
        },
      },
    });

  if (ended) {
    const last = snap?.lastResults ?? null;
    const result = last?.myResult ?? null;
    const [first, ...rest] = last?.winners ?? [];
    return (
      <Screen footer={<Button label={t.nv.vycep.nextRound} onPress={() => setEnded(false)} />} gap={16} padTop={0}>
        <BackHeader onBack={() => setEnded(false)} />
        <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
          <D s={44}>{t.nv.vycep.contestTitle}</D>
          {last ? (
            <T s={15} w={700} c={C.muted} style={{ marginBottom: 6 }}>
              {t.nv.vycep.roundEnded}
            </T>
          ) : null}
        </View>
        {!last ? (
          <T s={15} c={C.muted}>
            {t.nv.vycep.noLastRound}
          </T>
        ) : (
          <>
            {result?.entered ? (
              <View style={[s.row, { gap: 14 }]}>
                <D s={80} lh={0.9} c={C.yellow}>
                  {result.rank ? `${result.rank}.` : NO_VALUE}
                </D>
                <View style={[s.fill, { gap: 2 }]}>
                  <T s={18} w={700}>
                    {result.rank ? t.nv.vycep.podium[result.rank - 1] : t.nv.vycep.noPodium}
                  </T>
                  <T s={13} c={C.muted}>
                    {t.nv.vycep.resultSub(result.votes, result.xpAwarded)}
                  </T>
                </View>
              </View>
            ) : null}
            {first ? (
              <>
                <View>
                  <Image source={{ uri: first.imageUrl }} style={{ width: '100%', height: 250, borderRadius: 22, backgroundColor: C.card }} />
                  <View style={[s.row, { position: 'absolute', left: 10, top: 10, height: 30, borderRadius: 15, paddingHorizontal: 10, gap: 6, backgroundColor: C.onYellowMuted }]}>
                    <Icon name="trophy" size={14} color={C.yellow} />
                    <T s={12} w={700}>
                      {t.nv.vycep.winnerBadge}
                    </T>
                  </View>
                </View>
                <View style={[s.row, { justifyContent: 'space-between', marginTop: -6 }]}>
                  <View style={s.fill}>
                    <T s={15} w={700}>
                      {t.nv.vycep.winner(1, first.account.id === myId ? t.nv.vycep.me : handleOf(first.account))}
                    </T>
                    {first.caption ? (
                      <T s={12} c={C.muted} numberOfLines={1}>
                        {first.caption}
                      </T>
                    ) : null}
                  </View>
                  <T s={15} w={800}>
                    {t.nv.vycep.rounds(first.votes)}
                  </T>
                </View>
              </>
            ) : null}
            <View style={[s.row, { gap: 10 }]}>
              {rest.map((w) => {
                const me = w.account.id === myId;
                return (
                  <View key={w.rank} style={{ flex: 1, gap: 6 }}>
                    <Image source={{ uri: w.imageUrl }} style={{ width: '100%', height: 110, borderRadius: 18, borderWidth: me ? 2 : 0, borderColor: C.yellow, backgroundColor: C.card }} />
                    <View style={[s.row, { justifyContent: 'space-between' }]}>
                      <T s={13} w={700} c={C.text2} numberOfLines={1} style={s.fill}>
                        {t.nv.vycep.winner(w.rank, me ? t.nv.vycep.me : handleOf(w.account))}
                      </T>
                      <T s={12} c={C.muted}>
                        {t.nv.vycep.rounds(w.votes)}
                      </T>
                    </View>
                  </View>
                );
              })}
            </View>
          </>
        )}
      </Screen>
    );
  }

  return (
    <Screen
      footer={parta ? <Button label={t.nv.vycep.enter} icon="plus" onPress={() => router.push('/nv/prihlasit-fotku')} /> : <Button label={t.nv.vycep.shoot} icon="camera" onPress={() => router.push('/nv/do-denicku')} />}
      gap={16}
      padTop={0}
    >
      <BackHeader />
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
        <D s={44}>{t.nv.vycep.contestTitle}</D>
        <Press onPress={() => setEnded(true)} style={[s.row, { gap: 6, marginBottom: 6 }]}>
          <Icon name="trophy" size={16} color={C.yellow} />
          <T s={15} w={600}>
            {t.nv.vycep.lastRound}
          </T>
        </Press>
      </View>
      <View style={[s.row, { gap: 14 }]}>
        <D s={80} lh={0.9} c={C.yellow}>
          {days === null ? NO_VALUE : String(days)}
        </D>
        <View style={[s.fill, { gap: 2 }]}>
          <T s={18} w={700}>
            {t.nv.vycep.daysLeft(days ?? 0)}
          </T>
          <T s={13} c={C.muted}>
            {t.nv.vycep.contestHint}
          </T>
        </View>
      </View>
      <Press onPress={() => (parta ? router.push('/nv/sdileni-souhlas') : router.push('/nv/pivni-fotky'))} style={[s.row, { gap: 12, padding: 10, paddingRight: 14, borderRadius: 20, backgroundColor: C.card }]}>
        {parta || mine.length === 0 ? (
          <View style={[{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.control }, s.center]}>
            <Icon name={parta ? 'users' : 'camera'} size={20} color={C.yellow} />
          </View>
        ) : (
          <View style={s.row}>
            {mine.slice(0, 3).map((e, i) => (
              <Image key={e.id} source={{ uri: e.imageUrl }} style={{ width: 40, height: 44, borderRadius: 10, marginLeft: i ? -12 : 0, borderWidth: 2, borderColor: C.card, backgroundColor: C.control }} />
            ))}
          </View>
        )}
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            {parta ? t.nv.vycep.partaOnly : mine.length ? t.nv.vycep.myPhotos(mine.length) : t.nv.vycep.myNone}
          </T>
          <T s={12} c={C.muted}>
            {parta ? t.nv.vycep.partaOnlySub : best ? t.nv.vycep.myBest(best.votes, ranked.indexOf(best) + 1) : t.nv.vycep.myNoneSub}
          </T>
        </View>
        <Icon name="chevron-right" size={16} color={C.muted} />
      </Press>
      <Segmented
        height={38}
        options={[
          { key: 'nove', label: t.nv.vycep.tabNew },
          { key: 'vedou', label: t.nv.vycep.tabTop },
        ]}
        value={tab}
        onChange={setTab}
      />
      {failed && !snap ? (
        <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 12 }}>
          <T s={15} w={600}>
            {t.nv.vycep.contestLoadError}
          </T>
          <Button label={t.nv.vycep.retry} kind="raised" height={44} onPress={() => loadContest()} />
        </View>
      ) : snap && entries.length === 0 ? (
        <T s={15} c={C.muted}>
          {t.nv.vycep.contestEmpty}
        </T>
      ) : null}
      <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
        {[0, 1].map((c) => (
          <View key={c} style={{ width: col, gap: 14 }}>
            {entries
              .filter((_, i) => i % 2 === c)
              .map((e, i) => {
                const h = (c + i) % 2 ? 170 : 210;
                const sub = [e.beerName, e.pubName].filter(Boolean).join(' · ') || e.caption;
                const name = e.isMine ? t.nv.vycep.me : handleOf(e.account);
                return (
                  <View key={e.id} style={{ gap: 6 }}>
                    <View>
                      <Press onPress={() => openEntry(e)} accessibilityRole="imagebutton" accessibilityLabel={name}>
                        <Image source={{ uri: e.imageUrl }} style={{ width: col, height: h, borderRadius: 20, backgroundColor: C.card }} />
                      </Press>
                      <Press hitSlop={8} accessibilityLabel={t.nv.vycep.entryMenu} onPress={() => entryMenu(e)} style={[{ position: 'absolute', right: 10, top: 10, width: 28, height: 28, borderRadius: 14, backgroundColor: C.onYellowMuted }, s.center]}>
                        <Icon name="ellipsis" size={14} />
                      </Press>
                      <RoundButton entry={e} style={{ position: 'absolute', left: 10, bottom: 10 }} />
                    </View>
                    <Press
                      disabled={e.isMine}
                      onPress={() => router.push({ pathname: '/nv/kamos/[id]', params: { id: e.account.id } })}
                      accessibilityRole={e.isMine ? undefined : 'button'}
                      style={{ alignSelf: 'flex-start', maxWidth: '100%' }}
                    >
                      <T s={14} w={700} numberOfLines={1}>
                        {name}
                      </T>
                    </Press>
                    {sub ? (
                      <T s={12} c={C.muted} numberOfLines={2} style={{ marginTop: -4 }}>
                        {sub}
                      </T>
                    ) : null}
                  </View>
                );
              })}
          </View>
        ))}
      </View>
    </Screen>
  );
}

function photoUri(photo: BeerPhotoLocal): string | null {
  return photo.imageUrl ?? photo.localUri ?? null;
}

export function PrihlasitFotkuSheet() {
  const router = useRouter();
  const width = usePaneWidth();
  const photos = useBeerPhotosStore((st) => st.photos);
  const choosable = (p: BeerPhotoLocal) => p.syncState === 'synced' && !!p.id && !p.inContest;
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const size = (width - SCREEN_X * 2 - 12) / 3;
  const selected = photos.find((p) => p.clientId === sel) ?? photos.find(choosable) ?? null;

  useEffect(() => {
    void loadBeerPhotos();
  }, []);

  const enter = () => {
    if (!selected?.id || !choosable(selected) || busy) return;
    trackUiInteraction('photo_contest_enter', 'submit');
    setBusy(true);
    void addPhotoContestEntry(selected.id).then((res) => {
      setBusy(false);
      trackUiInteraction('photo_contest_enter', res.ok ? 'success' : 'failure');
      if (!res.ok) {
        toast({ kind: 'error', title: res.detail, icon: 'trophy' });
        return;
      }
      void loadBeerPhotos();
      nvBack(router);
      toast({ kind: 'saved', title: t.nv.vycep.entered, sub: t.nv.vycep.enteredSub, icon: 'trophy' });
    });
  };

  return (
    <Sheet title={t.nv.vycep.enterTitle} top={350} footer={<Button label={t.nv.vycep.enterCta} disabled={!selected || !choosable(selected) || busy} onPress={enter} />}>
      <T s={14} c={C.text2} lh={1.4} style={{ marginTop: -14 }}>
        {t.nv.vycep.enterBody}
      </T>
      <Button label={t.nv.vycep.shootNew} icon="camera" kind="raised" height={48} onPress={() => router.replace({ pathname: '/nv/do-denicku', params: { contest: '1' } })} />
      <Kicker>{t.nv.vycep.fromDiary}</Kicker>
      {photos.length === 0 ? (
        <T s={14} c={C.muted}>
          {t.nv.vycep.diaryEmpty}
        </T>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {photos.map((p) => {
          const on = selected?.clientId === p.clientId;
          const uri = photoUri(p);
          const badge = p.syncState === 'pending' ? t.nv.vycep.uploading : p.syncState === 'failed' ? t.nv.vycep.failed : p.inContest ? t.nv.vycep.alreadyIn : null;
          return (
            <Press key={p.clientId} disabled={!choosable(p)} onPress={() => setSel(p.clientId)}>
              {uri ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 12, borderWidth: on ? 3 : 0, borderColor: C.yellow, opacity: choosable(p) ? 1 : 0.6 }} /> : <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: C.card }} />}
              {on ? (
                <View style={[{ position: 'absolute', right: 6, top: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.yellow }, s.center]}>
                  <Icon name="check" size={13} color={C.black} />
                </View>
              ) : null}
              {badge ? (
                <View style={[s.row, { position: 'absolute', left: 6, bottom: 6, height: 24, borderRadius: 12, paddingHorizontal: 8, gap: 4, backgroundColor: C.onYellowMuted }]}>
                  <Icon name={p.inContest ? 'trophy' : p.syncState === 'failed' ? 'rotate-cw' : 'cloud-upload'} size={11} color={p.syncState === 'failed' ? C.yellow : C.white} />
                  <T s={10} w={700}>
                    {badge}
                  </T>
                </View>
              ) : null}
            </Press>
          );
        })}
      </View>
    </Sheet>
  );
}
