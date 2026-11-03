import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';

import { generateUuidV4 } from '@/data/account';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { createPartaPlan, fetchPlanDetail, updatePartaPlan, type PartaPlan, type PlanInput } from '@/data/partaPlansClient';
import { resolvePubSearchResult, searchPubNames, type PubSearchResult } from '@/data/pubSearchClient';
import type { Pub } from '@/data/pubs';
import { intlLocale, t } from '@/i18n';
import { useAccountStore } from '@/stores/accountStore';
import { usePartyGroupsStore } from '@/stores/partyGroupsStore';

import { Screen } from '../../components/chrome';
import { Input, Ticket } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Button, Card, Chip, ChipWrap, D, IconButton, Kicker, Row, Segmented, T } from '../../components/ui';
import { toast } from '../../ui/store';
import { clampToFuture } from '../../format';
import { C, s } from '../../theme';
import { personName, shortDay, ticketDay } from './partaModel';
import { usePartaStore } from './partaStore';

type Open = 'where' | 'when' | 'whom' | null;
type PlaceKindChoice = 'home' | 'pub';
const DAYS_AHEAD = 14;
function defaultWhen(now = new Date()): Date {
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 19, 0);
  if (now.getHours() >= 17) at.setDate(at.getDate() + 1);
  return at;
}

function withTime(day: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
}

function hhmm(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function PickerRow({ icon, label, value, open, onPress, last }: { icon: 'map-pin' | 'calendar' | 'users'; label: string; value: string; open: boolean; onPress: () => void; last?: boolean }) {
  return (
    <Row
      last={last}
      leading={<Icon name={icon} size={18} color={C.muted} />}
      title={<T s={15} c={C.muted}>{label}</T>}
      trailing={
        <T s={15} w={700} numberOfLines={1} style={{ maxWidth: 200 }}>
          {value}
        </T>
      }
      chevron={!open}
      onPress={onPress}
    />
  );
}

export function NovaPozvankaScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const editing = usePartaStore((st) => (id ? st.plans?.find((p) => p.id === id) ?? null : null));

  useEffect(() => {
    if (!id || editing) return;
    void fetchPlanDetail(id).then((detail) => {
      if (detail && detail !== 'gone') usePartaStore.getState().upsertPlan(detail.plan);
    });
  }, [id, editing]);

  if (id && !editing) {
    return (
      <Screen header={<IconButton icon="x" size={40} iconSize={18} onPress={() => nvBack(router)} label={t.nv.parta.close} />}>
        <T s={15} c={C.muted}>
          {t.nv.parta.loading}
        </T>
      </Screen>
    );
  }
  return <PlanForm key={editing?.id ?? 'new'} editing={editing} />;
}

function initialPlace(plan: PartaPlan | null): { kind: PlaceKindChoice; address: string; pub: Pub | null } {
  if (plan?.placeKind === 'pub' && plan.lat != null && plan.lng != null) {
    return { kind: 'pub', address: '', pub: { id: plan.externalId, name: plan.name, lat: plan.lat, lng: plan.lng, city: plan.city } };
  }
  return { kind: 'home', address: plan?.address ?? '', pub: null };
}

function PlanForm({ editing }: { editing: PartaPlan | null }) {
  const router = useRouter();
  const friends = usePartaStore((st) => st.dashboard?.friends ?? []);
  const groups = usePartyGroupsStore((st) => st.groups);
  const profile = useAccountStore((st) => st.profile);
  const clientId = useRef(generateUuidV4()).current;

  const [open, setOpen] = useState<Open>(null);
  const [kind, setKind] = useState<PlaceKindChoice>(() => initialPlace(editing).kind);
  const [address, setAddress] = useState(() => initialPlace(editing).address);
  const [pub, setPub] = useState<Pub | null>(() => initialPlace(editing).pub);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ query: string; pubs: PubSearchResult[]; failed: boolean } | null>(null);
  // null = "now": a plan without a time runs from when it was posted.
  const [when, setWhen] = useState<Date | null>(() => (editing ? (editing.scheduledFor ? new Date(editing.scheduledFor) : null) : defaultWhen()));
  const [audience, setAudience] = useState<'all' | string[]>('all');
  const [audienceTouched, setAudienceTouched] = useState(false);
  const [note, setNote] = useState(editing?.message ?? '');
  const [busy, setBusy] = useState(false);
  const searching = kind === 'pub' && query.trim().length >= 2;
  const results = searching && search?.query === query ? search.pubs : [];
  const searchFailed = searching && search?.query === query && search.failed;

  useEffect(() => {
    if (!searching) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchPubNames(query, controller.signal).then((res) => {
        if (controller.signal.aborted) return;
        setSearch({ query, pubs: res.pubs.slice(0, 5), failed: res.failed && res.pubs.length === 0 });
      });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searching, query]);

  const days = useMemo(() => {
    const today = new Date();
    return Array.from({ length: DAYS_AHEAD }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  }, []);

  const myName = personName(profile ? { displayName: profile.displayName, nickname: profile.nickname } : null);
  const title = kind === 'home' ? t.nv.parta.homePlaceMine : pub?.name ?? t.nv.parta.pickPub;
  const day = ticketDay((when ?? (editing && !editing.scheduledFor ? new Date(editing.startedAt) : new Date())).toISOString());
  const whenLabel = when ? t.nv.parta.whenLabel(shortDay(when.toISOString()), hhmm(when)) : t.nv.parta.whenNow;
  const pickDay = (d: Date) => setWhen(clampToFuture(withTime(d, hhmm(when ?? defaultWhen()))));
  const stepTime = (minutes: number) => setWhen(clampToFuture(new Date((when ?? defaultWhen()).getTime() + minutes * 60 * 1000)));
  const recipients = audience === 'all' ? undefined : audience;
  const whereLabel = kind === 'home' ? (address.trim() ? t.nv.parta.atMineAddress(address.trim()) : t.nv.parta.atMine) : pub?.name ?? t.nv.parta.pickPub;
  const whomLabel = audience === 'all' ? t.nv.parta.wholePartyN(friends.length) : t.nv.parta.peopleN(audience.length);
  const toggle = (which: Open) => setOpen((current) => (current === which ? null : which));

  const choosePeople = (ids: string[] | 'all') => {
    setAudienceTouched(true);
    setAudience(ids);
  };
  const toggleFriend = (friendId: string) => {
    const current = audience === 'all' ? [] : audience;
    choosePeople(current.includes(friendId) ? current.filter((x) => x !== friendId) : [...current, friendId]);
  };

  const send = async (sticker?: boolean) => {
    if (busy) return;
    if (kind === 'pub' && !pub) return toast({ kind: 'info', title: t.nv.parta.pickPub, icon: 'map-pin' });
    if (recipients && recipients.length === 0) return toast({ kind: 'info', title: t.nv.parta.pickSomeone, icon: 'users' });
    if (when && when.getTime() <= Date.now()) return toast({ kind: 'info', title: t.nv.parta.pickLaterTime, icon: 'calendar' });
    const input: PlanInput = {
      clientId,
      placeKind: kind,
      name: kind === 'home' ? t.nv.parta.homePlace(myName) : pub!.name,
      ...(kind === 'pub' ? { lat: pub!.lat, lng: pub!.lng, externalId: pub!.id, city: pub!.city ?? '' } : {}),
      address: kind === 'home' ? address.trim() : '',
      message: note.trim(),
      scheduledFor: when ? when.toISOString() : null,
      recipientIds: recipients,
    };
    setBusy(true);
    const done = (plan: PartaPlan | null | undefined, toastTitle: string, sub?: string) => {
      if (plan) usePartaStore.getState().upsertPlan(plan);
      if (sticker) router.replace('/nv/nalepky');
      else nvBack(router);
      toast({ kind: 'saved', title: toastTitle, sub, icon: 'send' });
    };
    if (editing) {
      const res = await updatePartaPlan(editing.id, { ...input, clientId: undefined, recipientIds: audienceTouched ? recipients : undefined });
      setBusy(false);
      if (res.ok) return done(res.detail?.plan, t.nv.parta.saved, t.nv.parta.savedSub);
      return toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
    }
    const res = await createPartaPlan(input);
    setBusy(false);
    if (res.ok) return done(res.detail?.plan, t.nv.parta.sent, recipients ? t.nv.parta.sentSubSome : t.nv.parta.sentSub);
    if (isRetriableFriendError(res)) {
      await enqueueFriendOp({
        op: 'activity',
        clientId,
        payload: {
          pub: kind === 'pub' && pub ? pub : { id: '', name: input.name, lat: 0, lng: 0 },
          message: input.message,
          scheduledFor: input.scheduledFor,
          recipientIds: recipients,
          place: { kind, address: input.address ?? '' },
        },
      });
      nvBack(router);
      return toast({ kind: 'offline', title: t.nv.parta.sentOffline, icon: 'cloud-off' });
    }
    toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
  };

  return (
    <Screen
      header={
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <D s={30}>{editing ? t.nv.parta.editTitle : t.nv.parta.newTitle}</D>
          <IconButton icon="x" size={40} iconSize={18} onPress={() => nvBack(router)} label={t.nv.parta.close} />
        </View>
      }
      footer={
        <View style={{ gap: 10 }}>
          {editing ? null : <Button label={t.nv.parta.sendSticker} icon="sticker" kind="raised" disabled={busy} onPress={() => void send(true)} />}
          <Button label={editing ? t.nv.parta.save : t.nv.parta.send} icon="send" disabled={busy} onPress={() => void send()} />
        </View>
      }
      gap={14}
    >
      <Kicker>{t.nv.parta.previewKicker}</Kicker>
      <Ticket
        kicker={t.nv.parta.fromYou}
        kickerIcon={kind === 'home' ? 'house' : 'beer'}
        dayNum={day.dayNum}
        dayName={day.dayName}
        time={day.time}
        title={title}
        quote={note.trim() || undefined}
        stub={
          <View style={[s.row, { gap: 6 }]}>
            {[t.nv.parta.rsvpGoing, t.nv.parta.rsvpMaybe, t.nv.parta.rsvpCant].map((l, i) => (
              <View key={l} style={[s.fill, s.row, { height: 40, borderRadius: 20, justifyContent: 'center', gap: 6, backgroundColor: C.control }]}>
                <Icon name={i === 0 ? 'check' : i === 1 ? 'circle-question-mark' : 'x'} size={16} />
                <T s={15} w={700}>
                  {l}
                </T>
              </View>
            ))}
          </View>
        }
      />
      <Card>
        <PickerRow icon="map-pin" label={t.nv.parta.where} value={whereLabel} open={open === 'where'} onPress={() => toggle('where')} />
        {open === 'where' ? (
          <View style={{ gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.hairline }}>
            <Segmented
              height={36}
              options={[
                { key: 'home', label: t.nv.parta.atMine },
                { key: 'pub', label: t.nv.parta.pub },
              ]}
              value={kind}
              onChange={setKind}
            />
            {kind === 'home' ? (
              <Input value={address} onChangeText={setAddress} placeholder={t.nv.parta.addressPlaceholder} maxLength={200} icon="house" />
            ) : (
              <>
                <Input value={query} onChangeText={setQuery} placeholder={t.nv.parta.pubSearchPlaceholder} icon="search" autoCorrect={false} />
                {searchFailed ? (
                  <T s={13} c={C.muted}>
                    {t.nv.parta.pubSearchFailed}
                  </T>
                ) : null}
                {results.map((r, i) => (
                  <Row
                    key={r.id}
                    last={i === results.length - 1}
                    height={52}
                    title={r.name}
                    sub={r.city || r.address || undefined}
                    onPress={() =>
                      void resolvePubSearchResult(r).then((resolved) => {
                        if (!resolved) return;
                        setPub(resolved);
                        setQuery('');
                        setOpen(null);
                      })
                    }
                  />
                ))}
              </>
            )}
          </View>
        ) : null}
        <PickerRow icon="calendar" label={t.nv.parta.when} value={whenLabel} open={open === 'when'} onPress={() => toggle('when')} />
        {open === 'when' ? (
          <View style={{ gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.hairline }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {editing ? <Chip plain label={t.nv.parta.whenNow} active={!when} onPress={() => setWhen(null)} /> : null}
              {days.map((d) => (
                <Chip
                  key={d.toDateString()}
                  plain
                  label={`${d.toLocaleDateString(intlLocale, { weekday: 'short' })} ${d.getDate()}. ${d.getMonth() + 1}.`}
                  active={!!when && d.toDateString() === when.toDateString()}
                  onPress={() => pickDay(d)}
                />
              ))}
            </ScrollView>
            <View style={[s.row, { gap: 12, justifyContent: 'center' }]}>
              <IconButton icon="minus" size={40} iconSize={18} label={t.tours.whenTimeDown} onPress={() => stepTime(-15)} />
              <D s={32}>{hhmm(when ?? defaultWhen())}</D>
              <IconButton icon="plus" size={40} iconSize={18} label={t.tours.whenTimeUp} onPress={() => stepTime(15)} />
            </View>
          </View>
        ) : null}
        <PickerRow icon="users" label={t.nv.parta.whom} value={whomLabel} open={open === 'whom'} onPress={() => toggle('whom')} />
        {open === 'whom' ? (
          <ChipWrap style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.hairline }}>
            <Chip label={t.nv.parta.wholeParty} active={audience === 'all'} onPress={() => choosePeople('all')} />
            {groups.map((g) => (
              <Chip key={g.id} label={g.name} icon="users" onPress={() => choosePeople(g.memberIds.filter((m) => friends.some((f) => f.id === m)))} />
            ))}
            {friends.map((f) => (
              <Chip key={f.id} label={personName(f)} active={audience !== 'all' && audience.includes(f.id)} onPress={() => toggleFriend(f.id)} />
            ))}
          </ChipWrap>
        ) : null}
        <Row
          last
          leading={<Icon name="message-circle" size={18} color={C.muted} />}
          title={<T s={15} c={C.muted}>{t.nv.parta.note}</T>}
          trailing={
            <Input
              value={note}
              onChangeText={setNote}
              placeholder={t.nv.parta.notePlaceholder}
              maxLength={160}
              height={36}
              focusRing={false}
              style={{ width: 190, backgroundColor: 'transparent', borderWidth: 0, paddingHorizontal: 0 }}
            />
          }
        />
      </Card>
      {kind === 'home' ? (
        <View style={[s.row, { gap: 8 }]}>
          <Icon name="lock" size={14} color={C.muted} />
          <T s={13} c={C.muted} style={s.fill}>
            {t.nv.parta.addressLock}
          </T>
        </View>
      ) : null}
    </Screen>
  );
}
