import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';

import {
  fetchCommunityEvents,
  leaveCommunityEvent,
  reportCommunityEvent,
  requestCommunityEventJoin,
  type CommunityEvent,
} from '@/data/communityEventsClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { intlLocale, t } from '@/i18n';

import { BackHeader, Screen } from '../../components/chrome';
import { Input, PageTitle, Ticket } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Button, Card, D, Dot, IconButton, Kicker, Row, Segmented, T } from '../../components/ui';
import { dialog, toast } from '../../ui/store';
import { C, s } from '../../theme';
import { ticketDay } from './partaModel';
import { usePartaStore } from './partaStore';

function hostName(event: CommunityEvent): string {
  return event.host.nickname ? `@${event.host.nickname}` : event.host.displayName || t.communityEvents.hostFallback;
}

function distance(event: CommunityEvent): string {
  return event.distanceBand ? t.communityEvents.distance[event.distanceBand] : '';
}

/** Discovery uses a position only when the phone already allows it; this screen never asks. */
async function knownPosition(): Promise<{ lat: number; lng: number } | undefined> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return undefined;
    const fix = await Location.getLastKnownPositionAsync();
    return fix ? { lat: fix.coords.latitude, lng: fix.coords.longitude } : undefined;
  } catch {
    return undefined;
  }
}

type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: 'error'; detail: string; auth: boolean };

function useMeetups() {
  const meetups = usePartaStore((st) => st.meetups);
  const [state, setState] = useState<LoadState>(meetups ? { kind: 'ready' } : { kind: 'loading' });
  const load = useCallback(async () => {
    if (!usePartaStore.getState().meetups) setState({ kind: 'loading' });
    const result = await fetchCommunityEvents(await knownPosition());
    if (result.ok) {
      usePartaStore.getState().setMeetups(result.dashboard);
      setState({ kind: 'ready' });
    } else {
      setState({ kind: 'error', detail: result.detail, auth: result.code === 'auth' });
    }
  }, []);
  return { meetups, state, load };
}

function DayTile({ event, mine }: { event: CommunityEvent; mine?: boolean }) {
  const date = new Date(event.startsAt);
  return (
    <View style={[{ width: 46, height: 50, borderRadius: 14, backgroundColor: mine ? '#FFC40026' : C.control }, s.center]}>
      <T s={10} w={800} c={mine ? C.yellow : C.muted}>
        {date.toLocaleDateString(intlLocale, { weekday: 'short' }).replace('.', '').toLocaleUpperCase(intlLocale)}
      </T>
      <D s={22} lh={1} c={mine ? C.yellow : C.white}>
        {String(date.getDate())}
      </D>
    </View>
  );
}

function Message({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ paddingVertical: 24, gap: 12, alignItems: 'center' }}>
      <T s={14} c={C.muted} style={{ textAlign: 'center' }}>
        {text}
      </T>
      {action ? <Button label={action} kind="raised" height={42} onPress={onAction} /> : null}
    </View>
  );
}

export function PivoUNekohoScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'okoli' | 'moje'>('okoli');
  const { meetups, state, load } = useMeetups();
  useEffect(() => {
    void load();
  }, [load]);

  const mine = [...(meetups?.hosted ?? []), ...(meetups?.joined ?? [])];
  const list = tab === 'okoli' ? meetups?.nearby ?? [] : mine;

  return (
    <Screen header={<BackHeader />} footer={<Button label={t.nv.parta.createMeetup} icon="house" onPress={() => router.push('/nv/zalozit-setkani')} />} gap={16}>
      <PageTitle kicker={t.nv.parta.meetupsKicker} title={t.nv.parta.meetupsTitle} />
      <Segmented
        height={38}
        options={[
          { key: 'okoli', label: t.nv.parta.nearby },
          { key: 'moje', label: t.nv.parta.mine },
        ]}
        value={tab}
        onChange={setTab}
      />
      <View style={[s.row, { gap: 10, alignItems: 'flex-start', paddingHorizontal: 4 }]}>
        <Icon name="shield-check" size={16} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          {t.nv.parta.safety}
        </T>
      </View>
      {state.kind === 'error' && !meetups ? (
        <Message
          text={state.detail}
          action={state.auth ? t.nv.parta.signIn : t.nv.parta.retry}
          onAction={state.auth ? () => router.push('/nv/prihlaseni') : () => void load()}
        />
      ) : state.kind === 'loading' && !meetups ? (
        <Message text={t.nv.parta.loading} />
      ) : list.length === 0 ? (
        <Message text={tab === 'okoli' ? t.nv.parta.nothingNearby : t.nv.parta.nothingMine} />
      ) : (
        <Card>
          {list.map((m, i) => {
            const hosted = m.isHost;
            const time = ticketDay(m.startsAt).time;
            const pending = m.joinRequests.filter((r) => r.status === 'pending').length;
            return (
              <Row
                key={m.id}
                last={i === list.length - 1}
                height={84}
                leading={<DayTile event={m} mine={tab === 'moje'} />}
                title={m.title}
                titleWeight={700}
                sub={
                  tab === 'moje' ? (
                    hosted ? (pending ? t.nv.parta.youHost(pending) : t.nv.parta.youHostNone) : m.membershipStatus === 'pending' ? t.nv.parta.waiting : t.nv.parta.joinedMeetup
                  ) : (
                    <View style={{ gap: 2 }}>
                      <T s={13} c={C.text2}>
                        {[time, m.areaLabel, distance(m)].filter(Boolean).join(' · ')}
                      </T>
                      {m.membershipStatus === 'pending' ? (
                        <View style={[s.row, { gap: 6 }]}>
                          <Dot />
                          <T s={13} w={700}>
                            {t.nv.parta.waiting}
                          </T>
                        </View>
                      ) : (
                        <T s={13} c={C.muted}>
                          {`${t.nv.parta.spots(m.availableSpots)} · ${t.nv.parta.hostedBy(hostName(m))}`}
                        </T>
                      )}
                    </View>
                  )
                }
                chevron
                onPress={() =>
                  hosted
                    ? router.push({ pathname: '/nv/moje-setkani', params: { id: m.id } })
                    : router.push({ pathname: '/nv/setkani', params: { id: m.id } })
                }
              />
            );
          })}
        </Card>
      )}
    </Screen>
  );
}

export function SetkaniScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { meetups, state, load } = useMeetups();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const event = [...(meetups?.nearby ?? []), ...(meetups?.joined ?? []), ...(meetups?.hosted ?? [])].find((m) => m.id === id) ?? null;

  useEffect(() => {
    if (!event) void load();
  }, [event, load]);

  if (!event) {
    return (
      <Screen header={<BackHeader />}>
        <Message
          text={state.kind === 'loading' ? t.nv.parta.loading : state.kind === 'error' ? state.detail : t.nv.parta.meetupGone}
          action={state.kind === 'error' ? t.nv.parta.retry : undefined}
          onAction={() => void load()}
        />
      </Screen>
    );
  }

  const day = ticketDay(event.startsAt);
  const membership = event.membershipStatus;
  const asked = membership === 'pending' || membership === 'approved';

  const join = () => {
    trackUiInteraction('community_join_request', 'submit');
    setBusy(true);
    void requestCommunityEventJoin(event.id, message.trim()).then(async (res) => {
      setBusy(false);
      trackUiInteraction('community_join_request', res.ok ? 'success' : 'failure');
      if (!res.ok) return toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
      toast({ kind: 'saved', title: t.nv.parta.requestToast, sub: t.nv.parta.requestToastSub, icon: 'hand' });
      await load();
    });
  };
  const leave = () => {
    const target = membership === 'approved' ? 'community_leave' : 'community_cancel_request';
    trackUiInteraction(target, target === 'community_leave' ? 'submit' : 'cancel');
    setBusy(true);
    void leaveCommunityEvent(event.id).then(async (res) => {
      setBusy(false);
      trackUiInteraction(target, res.ok ? 'success' : 'failure');
      if (!res.ok) return toast({ kind: 'error', title: res.detail, icon: 'circle-alert' });
      await load();
    });
  };

  return (
    <Screen
      header={
        <BackHeader
          right={
            event.isHost ? undefined : (
              <IconButton
                icon="flag"
                size={40}
                iconSize={18}
                label={t.nv.parta.report}
                onPress={() =>
                  dialog({
                    title: t.nv.parta.reportTitle,
                    body: t.nv.parta.reportBody,
                    actions: [
                      { label: t.nv.parta.back },
                      {
                        label: t.nv.parta.report,
                        kind: 'danger',
                        onPress: () => {
                          trackUiInteraction('community_report', 'submit');
                          void reportCommunityEvent(event.id).then((res) => {
                            trackUiInteraction('community_report', res.ok ? 'success' : 'failure');
                            toast(
                              res.ok
                                ? { kind: 'saved', title: t.nv.parta.reported, sub: t.nv.parta.reportedSub, icon: 'flag' }
                                : { kind: 'error', title: res.detail, icon: 'circle-alert' },
                            );
                          });
                        },
                      },
                    ],
                  })
                }
              />
            )
          }
        />
      }
      footer={
        event.isHost ? undefined : membership === 'approved' ? (
          <Button label={t.nv.parta.leaveMeetup} icon="x" kind="raised" disabled={busy} onPress={leave} />
        ) : asked ? (
          <Button label={t.nv.parta.requestSent} icon="check" kind="raised" disabled={busy} onPress={leave} />
        ) : (
          <Button label={t.nv.parta.askSpot} icon="hand" disabled={busy} onPress={join} />
        )
      }
      gap={16}
    >
      <Ticket
        big
        kicker={t.nv.parta.hostKicker(hostName(event))}
        kickerIcon="house"
        dayNum={day.dayNum}
        dayName={day.dayName}
        time={day.time}
        title={event.title}
        quote={event.description || undefined}
        stub={
          <View style={[s.row, { gap: 8, height: 40, paddingHorizontal: 4 }]}>
            <Icon name="map-pin" size={16} color={C.muted} />
            <T s={14} w={600} c={C.text2} style={s.fill}>
              {[event.areaLabel, distance(event)].filter(Boolean).join(' · ')}
            </T>
            <T s={14} w={700}>
              {t.nv.parta.spots(event.availableSpots)}
            </T>
          </View>
        }
      />
      <View style={[s.row, { gap: 12, padding: 16, borderRadius: 20, backgroundColor: C.card }]}>
        <Icon name={event.exactAddress ? 'map-pin' : 'lock'} size={22} color={event.exactAddress ? C.yellow : C.text2} />
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            {event.exactAddress ? t.nv.parta.address : t.nv.parta.addressAfter}
          </T>
          <T s={13} c={C.muted}>
            {event.exactAddress ?? t.nv.parta.addressAfterSub}
          </T>
        </View>
      </View>
      {event.isHost || asked ? null : (
        <View style={{ gap: 8 }}>
          <Kicker>{t.nv.parta.messageKicker}</Kicker>
          <Input value={message} onChangeText={setMessage} placeholder={t.nv.parta.messagePlaceholder} maxLength={240} />
        </View>
      )}
      <View style={[s.row, { gap: 10, alignItems: 'flex-start', paddingHorizontal: 4 }]}>
        <Icon name="shield-check" size={16} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          {t.nv.parta.safetyLong}
        </T>
      </View>
    </Screen>
  );
}
