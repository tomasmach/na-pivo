import React, { useMemo, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';

import { updateSharingPrefs } from '@/data/sharingPrefsClient';
import { getPubById } from '@/data/pubs';
import { intlLocale, t } from '@/i18n';
import { useBeerPhotosStore } from '@/stores/beerPhotosStore';
import { useTallyStore } from '@/stores/tallyStore';
import { useToursStore } from '@/stores/toursStore';
import { useVycepStore } from '@/stores/vycepStore';

import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, Chip, ChipWrap, D, IconButton, Press, Row, T, Tile, Toggle } from '../../components/ui';
import { C, s } from '../../theme';
import { clockTime, durationLabel, shortDay, useTonightOrLast } from '../vycep/nightData';
import { buildPubShareUrl } from '@/data/pubShareLink';
import { StickerCedule, StickerJduNaPivo, StickerKdoJde, StickerTacek, StickerUctenka, StickerVelkeCislo } from './Stickers';
import { useStickerShare } from './useStickerShare';

function Stage({ children, bg }: { children: React.ReactNode; bg?: string | null }) {
  return (
    <View style={[{ height: 260, borderRadius: 22, overflow: 'hidden', backgroundColor: '#2A2622' }, s.center]}>
      {bg ? (
        <Image source={{ uri: bg }} style={{ position: 'absolute', width: '100%', height: '100%' }} blurRadius={6} />
      ) : (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: 'radial-gradient(circle at 50% 40%, #4A4036 0%, #1E1B18 80%)' }} />
      )}
      {children}
    </View>
  );
}

/** The newest diary photo, the closest thing to "your story photo" behind the sticker. */
function useStageBackground(): string | null {
  const photo = useBeerPhotosStore((st) => st.photos[0]);
  return photo ? (photo.imageUrl ?? photo.localUri ?? null) : null;
}

const QUARTER = 15 * 60 * 1000;
const HALF_HOUR = 2 * QUARTER;
const DAYS_AHEAD = 14;

function nextSlots(now: Date, count: number): Date[] {
  const first = Math.ceil((now.getTime() + 1) / HALF_HOUR) * HALF_HOUR;
  return Array.from({ length: count }, (_, i) => new Date(first + i * HALF_HOUR));
}

/** Keeps a picked time on its own day and no earlier than the next quarter hour. */
function clampToFuture(at: Date, now = new Date()): Date {
  const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const dayEnd = dayStart + 24 * 60 * 60 * 1000 - QUARTER;
  const earliest = Math.ceil((now.getTime() + 1) / QUARTER) * QUARTER;
  return new Date(Math.min(dayEnd, Math.max(earliest, dayStart, at.getTime())));
}

function onDay(day: Date, at: Date): Date {
  return clampToFuture(new Date(day.getFullYear(), day.getMonth(), day.getDate(), at.getHours(), at.getMinutes()));
}

function hhmm(d: Date): string {
  return d.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' });
}

/** "19:15" today, "Čt 6. 11. 19:15" on another day. */
function whenText(at: Date, now = new Date()): string {
  return at.toDateString() === now.toDateString() ? hhmm(at) : `${shortDay(at.toISOString())} ${hhmm(at)}`;
}

export function SdiletHospoduSheet() {
  const params = useLocalSearchParams<{ id?: string; name?: string; lat?: string; lng?: string }>();
  const sittingAt = useTallyStore((st) => st.current?.pubName ?? null);
  const pub = useMemo(() => {
    const loaded = params.id ? getPubById(params.id) : null;
    if (loaded) return { name: loaded.name, lat: loaded.lat, lng: loaded.lng };
    const lat = Number(params.lat);
    const lng = Number(params.lng);
    const name = params.name ?? sittingAt ?? '';
    return Number.isFinite(lat) && Number.isFinite(lng) && params.lat && params.lng ? { name, lat, lng } : { name, lat: null, lng: null };
  }, [params.id, params.lat, params.lng, params.name, sittingAt]);
  const slots = useMemo(() => nextSlots(new Date(), 2), []);
  const [time, setTime] = useState<Date | null>(slots[0]);
  const [custom, setCustom] = useState<Date | null>(null);
  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: DAYS_AHEAD }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  }, []);
  const { ref: stickerRef, onLayout, busy, toInstagram, saveToPhotos, copyLink } = useStickerShare();
  const when = [time ? whenText(time) : t.nv.sdileni.nowSticker, pub.name].filter(Boolean).join(' · ');
  const customOn = !!custom && time?.getTime() === custom.getTime();
  const pickCustom = (at: Date) => {
    setCustom(at);
    setTime(at);
  };

  return (
    <Sheet title={t.nv.sdileni.shareTitle} top={150}>
      <Stage>
        <View style={{ transform: [{ rotate: '-4deg' }] }}>
          <View ref={stickerRef} collapsable={false} onLayout={onLayout}>
            <StickerJduNaPivo when={when} />
          </View>
        </View>
      </Stage>
      <View style={{ gap: 10 }}>
        <T s={14} w={600} c={C.muted}>
          {t.nv.sdileni.whenLabel}
        </T>
        <ChipWrap>
          <Chip label={t.nv.sdileni.now} active={time === null} onPress={() => setTime(null)} />
          {slots.map((slot) => (
            <Chip key={slot.getTime()} label={hhmm(slot)} active={!customOn && time?.getTime() === slot.getTime()} onPress={() => setTime(slot)} />
          ))}
          <Chip
            label={custom ? whenText(custom) : t.nv.sdileni.otherTime}
            icon="clock-4"
            active={customOn}
            onPress={() => pickCustom(clampToFuture(custom ?? new Date(slots[slots.length - 1].getTime() + HALF_HOUR)))}
          />
        </ChipWrap>
        {customOn && custom ? (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {days.map((d) => (
                <Chip
                  key={d.toDateString()}
                  plain
                  label={`${d.toLocaleDateString(intlLocale, { weekday: 'short' })} ${d.getDate()}. ${d.getMonth() + 1}.`}
                  active={d.toDateString() === custom.toDateString()}
                  onPress={() => pickCustom(onDay(d, custom))}
                />
              ))}
            </ScrollView>
            <View style={[s.row, { gap: 12, justifyContent: 'center' }]}>
              <IconButton icon="minus" size={40} iconSize={18} label={t.tours.whenTimeDown} onPress={() => pickCustom(clampToFuture(new Date(custom.getTime() - QUARTER)))} />
              <D s={32}>{hhmm(custom)}</D>
              <IconButton icon="plus" size={40} iconSize={18} label={t.tours.whenTimeUp} onPress={() => pickCustom(clampToFuture(new Date(custom.getTime() + QUARTER)))} />
            </View>
          </>
        ) : null}
      </View>
      <Button label={t.nv.sdileni.toInstagram} icon="send" disabled={busy} onPress={toInstagram} />
      <View style={[s.row, { gap: 10 }]}>
        <Button
          label={t.nv.sdileni.sendLink}
          icon="link"
          kind="raised"
          flex
          disabled={busy || pub.lat === null || pub.lng === null}
          onPress={() => {
            if (pub.lat !== null && pub.lng !== null) copyLink(buildPubShareUrl({ name: pub.name, lat: pub.lat, lng: pub.lng }));
          }}
        />
        <Button label={t.nv.sdileni.saveSticker} icon="download" kind="raised" flex disabled={busy} onPress={saveToPhotos} />
      </View>
    </Sheet>
  );
}

export function TourPozvatSheet() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const plan = useToursStore((st) => st.plans.find((p) => p.id === id) ?? st.draft ?? st.plans[0] ?? null);
  const { ref: stickerRef, onLayout, busy, toInstagram, copyLink } = useStickerShare();
  const when = plan?.scheduledDate
    ? [shortDay(`${plan.scheduledDate}T12:00:00`), plan.scheduledTime].filter(Boolean).join(' ')
    : '';
  const where = [plan?.title, when].filter(Boolean).join(' · ');

  return (
    <Sheet title={t.nv.sdileni.inviteTitle} top={290} scroll={false}>
      <Stage>
        <View ref={stickerRef} collapsable={false} onLayout={onLayout} style={{ padding: 8 }}>
          <StickerKdoJde where={where} />
        </View>
      </Stage>
      <Button label={t.nv.sdileni.stickerToInstagram} icon="send" disabled={busy} onPress={toInstagram} />
      <Card>
        <Row
          leading={<Tile icon="user-plus" />}
          title={t.nv.sdileni.sendInvite}
          titleWeight={700}
          sub={t.nv.sdileni.sendInviteSub}
          chevron
          onPress={() => router.replace(plan ? { pathname: '/nv/tour-cinknout', params: { id: plan.id } } : '/nv/tour-cinknout')}
        />
        <Row
          last
          leading={<Tile icon="link" />}
          title={t.nv.sdileni.publicLink}
          titleWeight={700}
          sub={t.nv.sdileni.publicLinkSub}
          chevron
          onPress={() => {
            if (plan?.share?.url) copyLink(plan.share.url);
            else router.replace(plan ? { pathname: '/nv/tour-zverejnit', params: { id: plan.id } } : '/nv/tour-zverejnit');
          }}
        />
      </Card>
    </Sheet>
  );
}

type Kind = 'tacek' | 'cedule' | 'cislo' | 'uctenka';
const KINDS: Kind[] = ['tacek', 'cedule', 'cislo', 'uctenka'];

export function NalepkySheet() {
  const { kind: initial } = useLocalSearchParams<{ kind?: string }>();
  const night = useTonightOrLast();
  const sittingAt = useTallyStore((st) => st.current?.pubName ?? null);
  const bg = useStageBackground();
  const { ref: stickerRef, onLayout, busy, toInstagram, shareImage, saveToPhotos } = useStickerShare();
  const [kind, setKind] = useState<Kind>(KINDS.includes(initial as Kind) ? (initial as Kind) : 'tacek');

  const summary = night?.summary;
  const count = summary?.beerCount ?? 0;
  const pub = sittingAt ?? summary?.pubNames[summary.pubNames.length - 1] ?? '';
  const since = summary ? clockTime(summary.startedAt) : '';
  const receiptFooter = [durationLabel(summary?.durationMinutes), summary?.city].filter(Boolean).join(' · ');
  const kinds: [Kind, string][] = [
    ['tacek', t.nv.sdileni.kindTacek],
    ['cedule', t.nv.sdileni.kindCedule],
    ['cislo', t.nv.sdileni.kindCislo],
  ];

  return (
    <Sheet title={t.nv.sdileni.stickersTitle} top={130} scroll={false}>
      <Stage bg={bg}>
        <View ref={stickerRef} collapsable={false} onLayout={onLayout} style={{ padding: 8 }}>
          {kind === 'tacek' ? (
            <StickerTacek pub={pub} count={count} since={since} />
          ) : kind === 'cedule' ? (
            <StickerCedule pub={pub} count={count} since={since} />
          ) : kind === 'uctenka' ? (
            <StickerUctenka date={summary ? shortDay(summary.startedAt) : ''} lines={night?.perPub ?? []} total={count} footer={receiptFooter} />
          ) : (
            <StickerVelkeCislo count={count} label={t.nv.sdileni.stickerToday} route={summary?.pubNames.join(' → ') ?? pub} />
          )}
        </View>
      </Stage>
      <View style={[s.row, { gap: 8 }]}>
        {kinds.map(([k, label]) => {
          const on = kind === k;
          return (
            <Press key={k} haptic onPress={() => setKind(k)} style={[s.fill, s.center, { height: 46, borderRadius: 16, backgroundColor: on ? C.tint : C.card, borderWidth: on ? 1.5 : 1, borderColor: on ? C.white : C.hairline }]}>
              <T s={14} w={on ? 800 : 600}>
                {label}
              </T>
            </Press>
          );
        })}
      </View>
      <Button label={t.nv.sdileni.toInstagram} icon="send" disabled={busy} onPress={toInstagram} />
      <View style={[s.row, { gap: 10 }]}>
        <Button label={t.nv.sdileni.saveToPhotos} icon="download" kind="raised" flex disabled={busy} onPress={saveToPhotos} />
        <Button label={t.nv.sdileni.shareElsewhere} icon="share" kind="raised" flex disabled={busy} onPress={shareImage} />
      </View>
    </Sheet>
  );
}

/** One permission for nights, ratings and photos (redesign decision "Sdílení"). */
export function SdileniSouhlasSheet() {
  const router = useRouter();
  const shareDefault = useVycepStore((st) => st.shareDefault);
  const [all, setAll] = useState(shareDefault === 'public');
  return (
    <Sheet title={t.nv.sdileni.consentTitle} top={330} scroll={false}>
      <T s={15} c={C.text2} lh={1.45} style={{ marginTop: -8 }}>
        {t.nv.sdileni.consentBody}
      </T>
      <Card>
        <Row last title={t.nv.sdileni.shareAll} sub={all ? t.nv.sdileni.shareAllOn : t.nv.sdileni.shareAllOff} trailing={<Toggle value={all} onChange={setAll} />} />
      </Card>
      <View style={{ gap: 10 }}>
        {(
          [
            ['calendar', t.nv.sdileni.consentDay],
            ['eye-off', t.nv.sdileni.consentPrivate],
            ['flag', t.nv.sdileni.consentReport],
          ] as const
        ).map(([icon, text]) => (
          <View key={text} style={[s.row, { gap: 10 }]}>
            <Icon name={icon} size={16} color={C.muted} />
            <T s={14} c={C.text2} style={s.fill}>
              {text}
            </T>
          </View>
        ))}
      </View>
      <Button
        label={t.nv.sdileni.done}
        onPress={() => {
          void updateSharingPrefs({ shareDefault: all ? 'public' : 'friends' });
          nvBack(router);
        }}
      />
    </Sheet>
  );
}
