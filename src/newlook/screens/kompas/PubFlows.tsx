import React, { useCallback, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';

import { ensureLocationPermission } from '@/compass/permissions';
import { generateUuidV4 } from '@/data/account';
import { lookupAddedPubLocation } from '@/data/addedPubLocationClient';
import {
  cancelCommunityEvent,
  createCommunityEvent,
  decideCommunityJoinRequest,
  fetchCommunityEvents,
  type CommunityEvent,
} from '@/data/communityEventsClient';
import { submitPubEventSuggestion } from '@/data/pubEventsClient';
import { t } from '@/i18n';
import { dateTimeFormat } from '@/utils/intlFormat';
import { openPubInMaps } from '@/utils/maps';
import { formatEventDateTime, parseEventDateTime } from '../../../../app/suggest-pub-event';

import { BackHeader, Screen } from '../../components/chrome';
import { Field, Input, PageTitle, Stepper, Ticket } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Button, Card, D, IconButton, Kicker, Person, Row, Segmented, T, Toggle } from '../../components/ui';
import { dialog, toast } from '../../ui/store';
import { riseIn } from '../../motion';
import { C, s } from '../../theme';
import { useParamPub } from './usePubPage';

const L = () => t.nv.kompas;
const MEETUP_HOURS = 4;

function defaultEventTimes(): { starts: string; ends: string } {
  const start = new Date();
  start.setSeconds(0, 0);
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15);
  return { starts: formatEventDateTime(start), ends: formatEventDateTime(new Date(start.getTime() + 3 * 60 * 60 * 1000)) };
}

export function NavrhnoutAkciScreen() {
  const router = useRouter();
  const { pub } = useParamPub();
  const [defaults] = useState(defaultEventTimes);
  const [name, setName] = useState('');
  const [details, setDetails] = useState('');
  const [starts, setStarts] = useState(defaults.starts);
  const [ends, setEnds] = useState(defaults.ends);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientId] = useState(generateUuidV4);
  if (!pub) return null;

  const send = async () => {
    const startsAt = parseEventDateTime(starts);
    const endsAt = parseEventDateTime(ends);
    if (name.trim().length < 3 || !startsAt || !endsAt || endsAt <= startsAt || endsAt.getTime() <= Date.now()) {
      setError(L().eventInvalid);
      return;
    }
    setBusy(true);
    setError(null);
    const result = await submitPubEventSuggestion({
      clientId,
      name: pub.name,
      lat: pub.lat,
      lng: pub.lng,
      city: pub.city,
      externalId: pub.id || null,
      title: name.trim(),
      details: details.trim(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
    setBusy(false);
    if (result === 'ok') {
      nvBack(router);
      toast({ kind: 'saved', title: L().eventSent, sub: L().eventSentSub, icon: 'send' });
      return;
    }
    setError(result === 'auth-required' ? L().eventAuth : result === 'permanent-error' ? L().eventRejected : L().eventOffline);
  };

  return (
    <Screen header={<BackHeader />} footer={<Button label={L().eventSend} icon="send" disabled={name.trim().length < 3 || busy} onPress={() => void send()} />} gap={16}>
      <PageTitle kicker={pub.name} title={L().eventTitle} intro={L().eventIntro} />
      <Field label={L().eventName}>
        <Input value={name} onChangeText={setName} placeholder={L().eventNamePlaceholder} autoFocus maxLength={120} />
      </Field>
      <View style={[s.row, { gap: 10 }]}>
        <Field label={L().eventStart} style={s.fill}>
          <Input icon="calendar" value={starts} onChangeText={setStarts} keyboardType="numbers-and-punctuation" />
        </Field>
        <Field label={L().eventEnd} style={s.fill}>
          <Input icon="clock-4" value={ends} onChangeText={setEnds} keyboardType="numbers-and-punctuation" />
        </Field>
      </View>
      <Field label={L().eventDetails}>
        <Input multiline value={details} onChangeText={setDetails} placeholder={L().eventDetailsPlaceholder} maxLength={800} />
      </Field>
      {error ? (
        <T s={14} w={600} c={C.danger}>
          {error}
        </T>
      ) : null}
      <View style={[s.row, { gap: 10, alignItems: 'flex-start', paddingHorizontal: 4 }]}>
        <Icon name="shield-check" size={16} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          {L().eventReview}
        </T>
      </View>
    </Screen>
  );
}

function parseClock(value: string): { h: number; m: number } | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h < 24 && m < 60 ? { h, m } : null;
}

export function ZalozitSetkaniScreen() {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [day, setDay] = useState<'dnes' | 'zitra'>('zitra');
  const [time, setTime] = useState('18:00');
  const [seats, setSeats] = useState(6);
  const [address, setAddress] = useState('');
  const [adults, setAdults] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(generateUuidV4);
  const clock = parseClock(time);
  const ready = title.trim().length >= 3 && !!address.trim() && adults && !!clock && !busy;

  const open = async () => {
    if (!ready || !clock) return;
    setBusy(true);
    try {
      const permission = await ensureLocationPermission({ openSettingsIfDenied: true });
      if (permission !== 'granted') throw new Error('location');
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const here = await lookupAddedPubLocation({ lat: fix.coords.latitude, lng: fix.coords.longitude });
      if (!here) throw new Error('city');
      // The typed address places the table; the phone's position only finds the city.
      const placed = await lookupAddedPubLocation({ address: address.trim(), city: here.city });
      const starts = new Date();
      if (day === 'zitra') starts.setDate(starts.getDate() + 1);
      starts.setHours(clock.h, clock.m, 0, 0);
      const result = await createCommunityEvent({
        clientId,
        title: title.trim(),
        description: desc.trim(),
        city: here.city,
        areaLabel: '',
        exactAddress: address.trim(),
        lat: placed?.lat ?? fix.coords.latitude,
        lng: placed?.lng ?? fix.coords.longitude,
        startsAt: starts.toISOString(),
        endsAt: new Date(starts.getTime() + MEETUP_HOURS * 60 * 60 * 1000).toISOString(),
        capacity: seats,
      });
      if (!result.ok) {
        toast({ kind: 'error', title: result.detail, icon: 'circle-alert' });
        return;
      }
      setClientId(generateUuidV4());
      toast({ kind: 'saved', title: L().meetCreated, icon: 'house' });
      router.replace({ pathname: '/nv/moje-setkani', params: result.event ? { id: result.event.id } : {} });
    } catch {
      toast({ kind: 'error', title: L().meetNeedsPlace, icon: 'map-pin' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen header={<BackHeader icon="x" />} footer={<Button label={L().meetOpen} icon="house" disabled={!ready} onPress={() => void open()} />} gap={16}>
      <PageTitle kicker={L().meetKicker} title={L().meetTitle} />
      <Field label={L().meetName}>
        <Input value={title} onChangeText={setTitle} maxLength={120} placeholder={L().meetNamePlaceholder} />
      </Field>
      <Field label={L().meetWhat}>
        <Input value={desc} onChangeText={setDesc} multiline maxLength={800} />
      </Field>
      <Field label={L().meetWhen}>
        <View style={[s.row, { gap: 10 }]}>
          <Segmented
            style={{ flex: 1 }}
            height={48}
            options={[
              { key: 'dnes', label: L().today },
              { key: 'zitra', label: L().tomorrow },
            ]}
            value={day}
            onChange={setDay}
          />
          <Input icon="clock-4" value={time} onChangeText={setTime} style={{ width: 120 }} keyboardType="numbers-and-punctuation" />
        </View>
      </Field>
      {!clock ? (
        <T s={13} c={C.danger}>
          {L().meetBadTime}
        </T>
      ) : null}
      <View style={[s.row, { padding: 16, borderRadius: 20, backgroundColor: C.card }]}>
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={600}>
            {L().meetSeats}
          </T>
          <T s={13} c={C.muted}>
            {L().meetSeatsSub}
          </T>
        </View>
        <Stepper value={seats} onChange={setSeats} min={2} max={20} />
      </View>
      <Field label={L().meetAddress}>
        <Input icon="lock" value={address} onChangeText={setAddress} maxLength={300} placeholder={L().meetAddressPlaceholder} />
      </Field>
      <T s={13} c={C.muted} lh={1.4} style={{ marginTop: -6 }}>
        {L().meetAddressNote}
      </T>
      <Card>
        <Row last title={L().meetAdults} titleWeight={500} trailing={<Toggle value={adults} onChange={setAdults} />} />
      </Card>
      {busy ? <ActivityIndicator color={C.yellow} /> : null}
    </Screen>
  );
}

function dayParts(iso: string): { dayNum: string; dayName: string; time: string } {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return { dayNum: '', dayName: '', time: '' };
  const today = new Date();
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86_400_000);
  const weekday = dateTimeFormat({ weekday: 'long' }).format(at);
  const relative = days === 0 ? L().dayToday : days === 1 ? L().dayTomorrow : null;
  return {
    dayNum: String(at.getDate()),
    dayName: relative ? `${relative}, ${weekday}` : weekday,
    time: `${at.getHours()}:${String(at.getMinutes()).padStart(2, '0')}`,
  };
}

export function MojeSetkaniScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [event, setEvent] = useState<CommunityEvent | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [deciding, setDeciding] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await fetchCommunityEvents();
    if (!result.ok) {
      setFailed(true);
      setEvent((current) => current ?? null);
      return;
    }
    setFailed(false);
    const hosted = result.dashboard.hosted.filter((e) => e.status === 'upcoming' || e.status === 'live');
    setEvent(hosted.find((e) => e.id === id) ?? hosted[0] ?? null);
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const decide = async (requestId: string, action: 'approve' | 'reject') => {
    if (!event) return;
    setDeciding(requestId);
    const result = await decideCommunityJoinRequest(event.id, requestId, action);
    setDeciding(null);
    if (!result.ok) toast({ kind: 'error', title: result.detail, icon: 'circle-alert' });
    await load();
  };

  const cancel = () => {
    if (!event) return;
    dialog({
      title: L().meetCancelTitle,
      body: L().meetCancelBody,
      actions: [
        { label: L().keep },
        {
          label: L().cancelConfirm,
          kind: 'danger',
          onPress: () =>
            void cancelCommunityEvent(event.id).then((result) => {
              if (!result.ok) {
                toast({ kind: 'error', title: result.detail, icon: 'circle-alert' });
                return;
              }
              toast({ kind: 'saved', title: L().meetCancelled, icon: 'x' });
              nvBack(router);
            }),
        },
      ],
    });
  };

  if (event === undefined) {
    return (
      <Screen header={<BackHeader />}>
        <ActivityIndicator color={C.yellow} style={{ marginTop: 80 }} />
      </Screen>
    );
  }

  if (!event) {
    return (
      <Screen
        header={<BackHeader />}
        footer={failed ? <Button label={L().retry} icon="refresh-cw" onPress={() => void load()} /> : <Button label={L().meetStart} icon="house" onPress={() => router.replace('/nv/zalozit-setkani')} />}
      >
        <View style={{ marginTop: 100, gap: 14 }}>
          <D s={30}>{failed ? L().meetLoadFailed : L().meetNone}</D>
          {!failed ? (
            <T s={15} c={C.muted} lh={1.4}>
              {L().meetNoneBody}
            </T>
          ) : null}
        </View>
      </Screen>
    );
  }

  const waiting = event.joinRequests.filter((r) => r.status === 'pending');
  const parts = dayParts(event.startsAt);

  return (
    <Screen
      header={<BackHeader right={<IconButton icon="share" size={40} iconSize={18} label={L().share} onPress={() => router.push('/nv/nalepky')} />} />}
      footer={<Button label={L().meetCancel} icon="x" kind="raised" onPress={cancel} />}
      gap={18}
    >
      <Ticket
        big
        kicker={L().meetHosting}
        kickerIcon="house"
        dayNum={parts.dayNum}
        dayName={parts.dayName}
        time={parts.time}
        title={event.title}
        stub={
          <View style={[s.row, { gap: 8, paddingHorizontal: 4, height: 40 }]}>
            <Icon name="lock-open" size={16} color={C.muted} />
            <T s={14} w={600} c={C.text2} style={s.fill} numberOfLines={1}>
              {[event.exactAddress, event.areaLabel || event.city].filter((part, i, all) => part && (i === 0 || !all[0]?.includes(part))).join(', ')}
            </T>
            <T s={14} w={700}>
              {L().freeSpots(event.availableSpots)}
            </T>
          </View>
        }
      />
      <View style={{ gap: 8 }}>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          <Kicker>{L().meetRequests}</Kicker>
          {waiting.length ? (
            <T s={13} w={700} c={C.yellow}>
              {L().meetWaiting(waiting.length)}
            </T>
          ) : null}
        </View>
        <Card>
          {event.joinRequests.length ? (
            event.joinRequests.map((r, i) => {
              const name = r.account.displayName || r.account.nickname || L().guest;
              return (
                <View key={r.id} style={[{ paddingVertical: 14, gap: 10 }, i < event.joinRequests.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
                  <View style={[s.row, { gap: 12 }]}>
                    <Person initial={name.slice(0, 1).toUpperCase()} size={44} />
                    <View style={{ gap: 2 }}>
                      <T s={16} w={700}>
                        {name}
                      </T>
                      {r.account.nickname ? (
                        <T s={13} w={500} c={C.muted}>
                          {`@${r.account.nickname}`}
                        </T>
                      ) : null}
                    </View>
                  </View>
                  {r.message ? (
                    <T s={14} w={500} c={C.text2} lh={1.35}>
                      {`„${r.message}“`}
                    </T>
                  ) : null}
                  {r.status === 'approved' ? (
                    <T s={14} w={700} c={C.yellow}>
                      {L().approved}
                    </T>
                  ) : deciding === r.id ? (
                    <ActivityIndicator color={C.yellow} style={{ alignSelf: 'flex-start' }} />
                  ) : (
                    <View style={[s.row, { gap: 8 }]}>
                      <Button label={L().reject} kind="raised" height={40} flex onPress={() => void decide(r.id, 'reject')} />
                      <Button label={L().approve} icon="check" height={40} flex onPress={() => void decide(r.id, 'approve')} />
                    </View>
                  )}
                </View>
              );
            })
          ) : (
            <T s={15} c={C.muted} style={{ paddingVertical: 14 }}>
              {L().meetNoRequests}
            </T>
          )}
        </Card>
      </View>
    </Screen>
  );
}

export function PrichodScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ name?: string; lat?: string; lng?: string }>();
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  const canNavigate = Number.isFinite(lat) && Number.isFinite(lng) && !!params.lat && !!params.lng;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 16) + 4, paddingHorizontal: 12, gap: 20 }}>
      <Animated.View
        entering={riseIn}
        style={{ flex: 1, backgroundColor: C.yellow, borderRadius: 32, paddingTop: 24, paddingHorizontal: 24, paddingBottom: 28, justifyContent: 'space-between' }}
      >
        <View style={{ gap: 6 }}>
          <T s={12} w={800} c="#0A0A0AA6" style={{ letterSpacing: 1 }}>
            {L().welcome}
          </T>
          <D s={34} c={C.black}>
            {params.name ?? ''}
          </D>
        </View>
        <View style={{ gap: 14 }}>
          <View style={[{ width: 72, height: 72, borderRadius: 36, backgroundColor: C.black }, s.center]}>
            <Icon name="beer" size={34} color={C.yellow} />
          </View>
          <D s={132} lh={0.85} c={C.black}>
            {L().cheers}
          </D>
          <T s={20} w={700} c={C.black}>
            {L().oneForMe}
          </T>
        </View>
      </Animated.View>
      <View style={[s.row, { gap: 10, paddingHorizontal: 8 }]}>
        <Button label={L().backToKompas} icon="compass" flex onPress={() => router.navigate('/nv/kompas')} />
        {canNavigate ? (
          <Button label={L().openInMaps} icon="map" kind="raised" flex onPress={() => void openPubInMaps({ lat, lng, name: params.name })} />
        ) : null}
      </View>
    </View>
  );
}
