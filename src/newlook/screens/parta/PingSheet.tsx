import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';

import { generateUuidV4 } from '@/data/account';
import { shareFriendPubActivity, updateFriendSettings } from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { resolvePubSearchResult, searchPubNames, type PubSearchResult } from '@/data/pubSearchClient';
import type { Pub } from '@/data/pubs';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { t } from '@/i18n';

import { Input } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, Row, Spinner, T } from '../../components/ui';
import { nvBack } from '../../navigation';
import { toast } from '../../ui/store';
import { C, s } from '../../theme';
import { currentCountPlace, useNvPlaceStore } from '../stamgast/placeStore';
import { CheckRow, useParty } from '../tour/TourRunScreens';
import { PickerRow } from './NovaPozvanka';
import { personName } from './partaModel';
import { usePartaStore } from './partaStore';

type Open = 'where' | 'whom' | null;

/** The pub the counter counts in, else the one the server last saw me sit in. */
function startingPub(): Pub | null {
  const place = currentCountPlace();
  if (place?.kind === 'pub') return place.pub;
  const me = usePartaStore.getState().dashboard?.myPresence;
  return me && me.lat != null && me.lng != null ? { id: '', name: me.pubName, lat: me.lat, lng: me.lng, city: me.pubCity } : null;
}

/** "Cinknout partě" from the Parta header, my row in Parta and the Štamgast counter. */
export function PingSheet() {
  const router = useRouter();
  const party = useParty();
  const [pub, setPub] = useState<Pub | null>(startingPub);
  const [open, setOpen] = useState<Open>(() => (pub ? null : 'where'));
  const [picked, setPicked] = useState<string[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<{ query: string; pubs: PubSearchResult[]; failed: boolean } | null>(null);
  const nearby = useNvPlaceStore((st) => st.candidates);

  const searching = query.trim().length >= 2;
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

  const friends = party?.friends ?? [];
  const chosen = (picked ?? friends.map((f) => f.id)).filter((id) => friends.some((f) => f.id === id));
  // The Profil switch updates Parta in memory but not the saved party, which is all there is offline.
  const storeGhost = usePartaStore((st) => st.dashboard?.settings?.ghostMode);
  const ghost = !!party?.ghost || !!storeGhost;
  const quiet = party === null ? t.nv.parta.pingPartyOffline : party && !friends.length ? t.nv.parta.pingNoFriends : null;

  const choosePub = (next: Pub) => {
    setPub(next);
    setQuery('');
    setOpen(null);
  };
  const toggle = (which: Open) => setOpen(open === which ? null : which);

  async function send() {
    if (!pub || !chosen.length || sending.current) return;
    sending.current = true;
    setBusy(true);
    const done = () => {
      sending.current = false;
      setBusy(false);
    };
    if (ghost) {
      const res = await updateFriendSettings({ ghostMode: false });
      if (!res.ok) {
        done();
        toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
        return;
      }
      usePartaStore.getState().setDashboard((d) => ({ ...d, settings: { ...d.settings, ghostMode: false } }));
    }
    // The server takes 200 characters of name and 128 of id; anything longer would be dropped for good.
    const target: Pub = { ...pub, name: pub.name.slice(0, 200), id: pub.id.length > 128 ? '' : pub.id };
    // Everyone picked means the whole party, as the server reads a missing list.
    const recipientIds = chosen.length === friends.length ? undefined : chosen;
    const message = note.trim();
    const clientId = generateUuidV4();
    const startedAt = new Date().toISOString();
    trackUiInteraction('parta_activity_share', 'submit');
    const res = await shareFriendPubActivity(target, message, clientId, recipientIds, startedAt);
    trackUiInteraction('parta_activity_share', res.ok || isRetriableFriendError(res) ? 'success' : 'failure');
    if (!res.ok && !isRetriableFriendError(res)) {
      done();
      toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
      return;
    }
    if (res.ok) {
      const who = !recipientIds ? undefined : recipientIds.length === 1 ? personName(friends.find((f) => f.id === recipientIds[0]) ?? null) : t.nv.parta.peopleN(recipientIds.length);
      toast({ kind: 'saved', title: t.nv.parta.pingedToast, sub: t.nv.parta.pingSentSub(target.name, who), icon: 'bell-ring' });
      void usePartaStore.getState().reload();
    } else {
      await enqueueFriendOp({ op: 'activity', clientId, payload: { pub: target, message, recipientIds, startedAt } });
      toast({ kind: 'offline', title: t.nv.parta.pingQueued, icon: 'cloud-off' });
    }
    nvBack(router);
  }

  const pubRows = searching ? results.map((r) => ({ key: r.id, title: r.name, sub: r.city || r.address || undefined, pick: () => void resolvePubSearchResult(r).then((resolved) => resolved && choosePub(resolved)) }))
    : nearby.slice(0, 4).map((c) => ({ key: c.pubKey, title: c.pub.name, sub: `${Math.round(c.distanceMeters)} m`, pick: () => choosePub(c.pub) }));

  return (
    <Sheet
      title={t.nv.parta.pingParty}
      footer={
        <Button
          label={ghost ? t.nv.parta.pingGhostSend : t.nv.parta.pingPartyShort}
          icon="bell-ring"
          height={56}
          disabled={!pub || !chosen.length || busy || !!quiet || party === undefined}
          onPress={() => void send()}
        />
      }
    >
      {ghost ? (
        <View style={[s.row, { gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 16, backgroundColor: C.yellowTint, borderWidth: 1, borderColor: C.yellowLine }]}>
          <Icon name="eye-off" size={18} color={C.yellow} />
          <T s={14} w={600} lh={1.35} style={s.fill}>
            {t.nv.parta.pingGhost}
          </T>
        </View>
      ) : null}
      <Card>
        <PickerRow icon="map-pin" label={t.nv.parta.where} value={pub?.name ?? t.nv.parta.pickPub} open={open === 'where'} onPress={() => toggle('where')} />
        {open === 'where' ? (
          <View style={{ gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.hairline }}>
            <Input value={query} onChangeText={setQuery} placeholder={t.nv.parta.pubSearchPlaceholder} icon="search" autoCorrect={false} />
            {searchFailed ? (
              <T s={13} c={C.muted}>
                {t.nv.parta.pubSearchFailed}
              </T>
            ) : null}
            {pubRows.map((r, i) => (
              <Row key={r.key} last={i === pubRows.length - 1} height={52} title={r.title} sub={r.sub} onPress={r.pick} />
            ))}
          </View>
        ) : null}
        <PickerRow
          icon="users"
          label={t.nv.parta.whom}
          value={party === undefined ? t.nv.parta.loading : chosen.length === friends.length ? t.nv.parta.wholePartyN(friends.length) : t.nv.parta.peopleN(chosen.length)}
          open={open === 'whom'}
          onPress={() => toggle('whom')}
          last={open !== 'whom' || !friends.length}
        />
        {open === 'whom'
          ? friends.map((friend, i) => {
              const selected = chosen.includes(friend.id);
              return (
                <CheckRow
                  key={friend.id}
                  friend={friend}
                  sub={friend.nickname ? `@${friend.nickname}` : ''}
                  selected={selected}
                  last={i === friends.length - 1}
                  // The last one stays picked: a ping to nobody has nothing to send.
                  onPress={() => setPicked(selected ? (chosen.length > 1 ? chosen.filter((id) => id !== friend.id) : chosen) : [...chosen, friend.id])}
                />
              );
            })
          : null}
      </Card>
      {party === undefined ? <Spinner /> : null}
      {quiet ? (
        <T s={14} c={C.muted} lh={1.4}>
          {quiet}
        </T>
      ) : null}
      {party && !friends.length ? <Button label={t.nv.parta.inviteFirst} icon="user-plus" kind="raised" onPress={() => router.replace('/nv/sprava-party')} /> : null}
      {!quiet ? <Input value={note} onChangeText={setNote} placeholder={t.nv.parta.pingNotePlaceholder} maxLength={160} icon="message-circle" /> : null}
    </Sheet>
  );
}
