import React, { useMemo, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';

import { isRetriableNightError, publishNight, type NightVisibility } from '@/data/nightsClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { enqueueNightOp } from '@/data/nightsQueue';
import { updateSharingPrefs } from '@/data/sharingPrefsClient';
import { t } from '@/i18n';
import { selectNeedsNickname, useAccountStore } from '@/stores/accountStore';
import { useBeerPhotosStore, type BeerPhotoLocal } from '@/stores/beerPhotosStore';
import { useTallyStore } from '@/stores/tallyStore';
import { useVycepStore } from '@/stores/vycepStore';
import { nightPublishPayload, type NightSummary } from '@/vycep/nightModel';

import { BackHeader, Screen } from '../../components/chrome';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, D, Press, T } from '../../components/ui';
import { C, s } from '../../theme';
import { dialog, toast } from '../../ui/store';
import { nightToPublish, routeLine, shortDay } from './nightData';

const HOUR = 60 * 60 * 1000;

function useNightToPublish(day?: string): NightSummary | null {
  const current = useTallyStore((st) => st.current);
  const history = useTallyStore((st) => st.history);
  const published = useVycepStore((st) => st.published);
  return useMemo(() => nightToPublish(current, history, published, day), [current, history, published, day]);
}

function useMe() {
  const profile = useAccountStore((st) => st.profile);
  const handle = profile?.nickname ? `@${profile.nickname}` : profile?.displayName || t.nv.vycep.me;
  return { handle, initial: handle.replace('@', '').charAt(0).toUpperCase(), nickname: profile?.nickname ?? null };
}

function photoUri(photo: BeerPhotoLocal): string | null {
  return photo.imageUrl ?? photo.localUri ?? null;
}

function PreviewCard({ night, photo, onPhoto, compact, mark, author }: { night: NightSummary | null; photo?: string | null; onPhoto?: () => void; compact?: boolean; mark?: string; author?: string }) {
  const me = useMe();
  const handle = author ?? me.handle;
  return (
    <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 12, borderWidth: 1, borderColor: C.hairline }}>
      <View style={[s.row, { gap: 12 }]}>
        <View style={[{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.control }, s.center]}>
          <T s={13} w={800} c={C.yellow}>
            {handle.replace('@', '').charAt(0).toUpperCase()}
          </T>
        </View>
        <View style={s.fill}>
          <T s={15} w={700}>
            {handle}
          </T>
          <T s={12} c={C.muted}>
            {night ? [night.city, shortDay(night.startedAt)].filter(Boolean).join(' · ') : ' '}
          </T>
        </View>
        {mark ? (
          <View style={{ borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3, backgroundColor: C.control }}>
            <T s={12} w={700} c={C.yellow}>
              {mark}
            </T>
          </View>
        ) : !compact ? (
          <T s={12} w={700} c={C.muted}>
            {t.nv.vycep.preview}
          </T>
        ) : null}
      </View>
      {compact ? null : photo ? (
        <Press onPress={onPhoto}>
          <Image source={{ uri: photo }} style={{ height: 120, borderRadius: 16, width: '100%' }} />
        </Press>
      ) : (
        <Press onPress={onPhoto} style={[{ height: 92, borderRadius: 16, borderWidth: 1.5, borderColor: C.lineBright, gap: 4 }, s.center]}>
          <Icon name="camera" size={20} color={C.yellow} />
          <T s={14} w={700}>
            {t.nv.vycep.addPhoto}
          </T>
          <T s={12} c={C.muted}>
            {t.nv.vycep.optional}
          </T>
        </Press>
      )}
      <View style={{ gap: 4 }}>
        <D s={compact ? 30 : 34} lh={1}>
          {t.nv.vycep.postBeers(night?.beerCount ?? 0)}
        </D>
        <T s={13} c={C.text2}>
          {night ? routeLine(night.pubNames, night.durationMinutes) : ' '}
        </T>
      </View>
      {compact ? (
        <View style={[s.row, { alignSelf: 'flex-start', height: 30, borderRadius: 15, paddingHorizontal: 10, gap: 6, backgroundColor: C.control }]}>
          <Icon name="hand-platter" size={14} color={C.yellow} />
          <T s={12} w={700}>
            {t.nv.vycep.roundLabel}
          </T>
        </View>
      ) : null}
    </View>
  );
}

function Choice({ title, sub, on, icon, onPress }: { title: string; sub: string; on: boolean; icon?: 'globe' | 'users'; onPress: () => void }) {
  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityState={{ selected: on }}
      style={{ flex: icon ? 1 : undefined, padding: 14, gap: 6, borderRadius: 18, backgroundColor: on ? C.tint : C.card, borderWidth: on ? 1.5 : 1, borderColor: on ? C.white : C.hairline }}
    >
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        {icon ? <Icon name={icon} size={22} color={on ? C.yellow : C.text2} /> : <T s={16} w={700}>{title}</T>}
        <View style={[{ width: 24, height: 24, borderRadius: 12, borderWidth: on ? 0 : 1.5, borderColor: C.muted, backgroundColor: on ? C.white : 'transparent' }, s.center]}>
          {on ? <Icon name="check" size={14} color={C.black} /> : null}
        </View>
      </View>
      {icon ? (
        <T s={16} w={700}>
          {title}
        </T>
      ) : null}
      <T s={13} c={C.muted}>
        {sub}
      </T>
    </Press>
  );
}

/** A diary photo taken during the night (or right now, after "Přidat fotku"). */
function useNightPhoto(night: NightSummary | null, since: number): BeerPhotoLocal | null {
  const photos = useBeerPhotosStore((st) => st.photos);
  return useMemo(() => {
    if (!night) return null;
    const from = Date.parse(night.startedAt) - HOUR;
    const to = Date.parse(night.endedAt) + 3 * HOUR;
    return (
      photos.find((photo) => {
        const at = Date.parse(photo.takenAt);
        return photoUri(photo) && ((at >= from && at <= to) || at >= since);
      }) ?? null
    );
  }, [night, photos, since]);
}

const DAY_PARAM = /^\d{4}-\d{2}-\d{2}$/;

export function VyvesitSheet() {
  const router = useRouter();
  const param = useLocalSearchParams<{ day?: string }>().day;
  const day = typeof param === 'string' && DAY_PARAM.test(param) ? param : undefined;
  const night = useNightToPublish(day);
  const hanging = useVycepStore((st) => (day && night ? st.published[night.clientKey] : undefined));
  const me = useMe();
  const autopublish = useVycepStore((st) => st.nightAutopublish);
  const shareDefault = useVycepStore((st) => st.shareDefault);
  const [openedAt] = useState(() => Date.now());
  const candidate = useNightPhoto(night, openedAt);
  const [withPhoto, setWithPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const initial: NightVisibility = autopublish === 'public' || autopublish === 'friends' ? autopublish : shareDefault;
  const [scope, setScope] = useState<'all' | 'parta'>(initial === 'public' ? 'all' : 'parta');

  if (!night) {
    return (
      <Sheet title={t.nv.vycep.publishTitle} scroll={false} footer={<Button label={t.nv.vycep.logBeer} icon="plus" onPress={() => router.replace('/nv/stamgast')} />}>
        <View style={{ gap: 6 }}>
          <T s={17} w={700}>
            {t.nv.vycep.nothingTitle}
          </T>
          <T s={14} c={C.muted} lh={1.4}>
            {t.nv.vycep.nothingBody}
          </T>
        </View>
      </Sheet>
    );
  }

  if (hanging) {
    return (
      <Sheet title={t.nv.vycep.publishTitle} scroll={false} footer={<Button label={t.nv.vycep.back} kind="raised" onPress={() => nvBack(router)} />}>
        <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
          <Icon name="circle-check" size={18} color={C.yellow} />
          <View style={[s.fill, { gap: 4 }]}>
            <T s={13} w={700} c={C.muted}>
              {[shortDay(night.startedAt), t.nv.vycep.postBeers(night.beerCount)].join(' · ')}
            </T>
            <T s={16} w={700}>
              {t.nv.vycep.alreadyTitle}
            </T>
            <T s={14} c={C.muted} lh={1.4}>
              {hanging.visibility === 'public' ? t.nv.vycep.alreadyWorld : t.nv.vycep.alreadyParta}
            </T>
          </View>
        </View>
      </Sheet>
    );
  }

  const photo = withPhoto && candidate ? candidate : null;

  const publish = () => {
    if (busy) return;
    const visibility: NightVisibility = scope === 'all' ? 'public' : 'friends';
    if (visibility === 'public' && !me.nickname) {
      dialog({ title: t.nv.vycep.nicknameTitle, body: t.nv.vycep.nicknameBody, actions: [{ label: t.nv.vycep.back }] });
      return;
    }
    const payload = { ...nightPublishPayload(night, visibility), ...(photo ? { photoIds: [photo.id ?? photo.clientId] } : {}) };
    trackUiInteraction('night_publish', 'submit');
    setBusy(true);
    void publishNight(payload).then((res) => {
      setBusy(false);
      trackUiInteraction('night_publish', res.ok || isRetriableNightError(res) ? 'success' : 'failure');
      if (!res.ok && !isRetriableNightError(res)) {
        toast({ kind: 'error', title: res.detail, icon: 'megaphone' });
        return;
      }
      if (!res.ok) void enqueueNightOp({ op: 'publish', payload });
      useVycepStore.getState().markPublished(night.clientKey, visibility);
      router.dismissTo('/nv/vycep');
      toast(res.ok ? { kind: 'saved', title: t.nv.vycep.published, icon: 'megaphone' } : { kind: 'offline', title: t.nv.vycep.publishQueued, icon: 'megaphone' });
    });
  };

  return (
    <Sheet title={t.nv.vycep.publishTitle} top={150} footer={<Button label={scope === 'all' ? t.nv.vycep.publishWorld : t.nv.vycep.publishParta} disabled={busy} onPress={publish} />}>
      <PreviewCard
        night={night}
        photo={photo ? photoUri(photo) : null}
        onPhoto={() => {
          if (photo) setWithPhoto(false);
          else if (candidate) setWithPhoto(true);
          else {
            setWithPhoto(true);
            router.push('/nv/do-denicku');
          }
        }}
      />
      <View style={[s.row, { gap: 10 }]}>
        <Choice icon="globe" title={t.nv.vycep.choiceWorld} sub={t.nv.vycep.choiceWorldSub} on={scope === 'all'} onPress={() => setScope('all')} />
        <Choice icon="users" title={t.nv.vycep.choiceParta} sub={t.nv.vycep.choicePartaSub} on={scope === 'parta'} onPress={() => setScope('parta')} />
      </View>
      <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
        <Icon name="lock" size={15} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          {t.nv.vycep.privacyNote}
        </T>
      </View>
    </Sheet>
  );
}

// Someone with no night yet sees how somebody else's night hangs, so the ask still shows the Výčep.
const SAMPLE_NIGHT: NightSummary = {
  clientKey: 'sample',
  drinkingDay: '',
  startedAt: '',
  endedAt: '',
  beerCount: 6,
  wineCount: 0,
  softDrinkCount: 0,
  shotCount: 0,
  pubNames: [...t.nv.vycep.askSamplePubs],
  city: t.nv.vycep.askSampleCity,
  durationMinutes: 190,
};

function NightStack({ night, mark }: { night: NightSummary | null; mark?: string }) {
  return (
    <View style={{ height: 236, justifyContent: 'flex-end' }}>
      {t.nv.vycep.firstDecor.map((u, i) => (
        <View key={u} style={{ position: 'absolute', top: i * 30, left: 34 - i * 16, right: 34 - i * 16, height: 80, borderRadius: 22, backgroundColor: i ? '#1A1A1A' : '#121212', borderWidth: 1, borderColor: C.hairline, paddingHorizontal: 14, paddingVertical: 8 }}>
          <T s={13} w={700} c={C.muted}>
            {u}
          </T>
        </View>
      ))}
      {night ? <PreviewCard night={night} compact mark={mark} /> : <PreviewCard night={SAMPLE_NIGHT} compact author={t.nv.vycep.askSampleAuthor} />}
    </View>
  );
}

/** The one-time ask after the update: post every finished night, rating and photo to the whole world. */
export function VerejneNociScreen() {
  const router = useRouter();
  const night = useNightToPublish();
  const me = useMe();
  const needsNickname = useAccountStore(selectNeedsNickname);
  const shareDefault = useVycepStore((st) => st.shareDefault);
  const autopublish = useVycepStore((st) => st.nightAutopublish);
  const answered = useRef(false);

  const yes = () => {
    if (answered.current) return;
    answered.current = true;
    if (shareDefault !== 'public' || autopublish !== 'public') void updateSharingPrefs({ shareDefault: 'public', nightAutopublish: 'public' });
    // The world feed hides nights without a nickname, so ask for one right away.
    if (needsNickname) router.replace('/nv/dokoncit-ucet');
    else nvBack(router);
  };
  const no = () => {
    if (answered.current) return;
    answered.current = true;
    nvBack(router);
  };

  return (
    <Screen
      footer={
        <View>
          <Button label={t.nv.vycep.askYes} onPress={yes} />
          <Press onPress={no} style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 4 }} hitSlop={{ top: 6, bottom: 10, left: 40, right: 40 }}>
            <T s={13} w={600} c={C.muted}>
              {t.nv.vycep.askNo}
            </T>
          </Press>
        </View>
      }
      gap={16}
    >
      <NightStack night={night} mark={me.nickname ? t.nv.vycep.askYou : undefined} />
      <View style={{ gap: 10, marginTop: 12 }}>
        <T s={14} w={700} c={C.yellow}>
          {t.nv.vycep.askKicker}
        </T>
        <D s={44}>{t.nv.vycep.askTitle}</D>
        <T s={16} c={C.text2} lh={1.45}>
          {t.nv.vycep.askBody}
        </T>
      </View>
      <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
        <Icon name="lock" size={15} color={C.muted} />
        <T s={14} c={C.text2} lh={1.4} style={s.fill}>
          {t.nv.vycep.askPrivate}
        </T>
      </View>
    </Screen>
  );
}

export function PrvniVyveseniScreen() {
  const router = useRouter();
  const fromSettings = useLocalSearchParams<{ from?: string }>().from === 'nastaveni';
  const night = useNightToPublish();
  const autopublish = useVycepStore((st) => st.nightAutopublish);
  const [mode, setMode] = useState<'manual' | 'all' | 'parta'>(autopublish === 'public' ? 'all' : autopublish === 'friends' ? 'parta' : 'manual');
  return (
    <Screen
      footer={
        <Button
          label={fromSettings ? t.nv.vycep.firstSave : t.nv.vycep.publishCta}
          icon={fromSettings ? 'check' : 'megaphone'}
          onPress={() => {
            void updateSharingPrefs({ nightAutopublish: mode === 'manual' ? 'off' : mode === 'all' ? 'public' : 'friends' });
            if (fromSettings) nvBack(router);
            else router.replace('/nv/vyvesit');
          }}
        />
      }
      header={<BackHeader />}
      gap={16}
    >
      <NightStack night={night} />
      <View style={{ gap: 10, marginTop: 12 }}>
        {fromSettings ? null : (
          <T s={14} w={700} c={C.yellow}>
            {t.nv.vycep.firstKicker}
          </T>
        )}
        <D s={44}>{t.nv.vycep.firstTitle}</D>
        <T s={16} c={C.text2} lh={1.45}>
          {t.nv.vycep.firstBody}
        </T>
      </View>
      <View style={{ gap: 8, marginTop: 8 }}>
        <Choice title={t.nv.vycep.firstManual} sub={t.nv.vycep.firstManualSub} on={mode === 'manual'} onPress={() => setMode('manual')} />
        <Choice title={t.nv.vycep.firstWorld} sub={t.nv.vycep.firstWorldSub} on={mode === 'all'} onPress={() => setMode('all')} />
        <Choice title={t.nv.vycep.firstParta} sub={t.nv.vycep.firstPartaSub} on={mode === 'parta'} onPress={() => setMode('parta')} />
      </View>
    </Screen>
  );
}
