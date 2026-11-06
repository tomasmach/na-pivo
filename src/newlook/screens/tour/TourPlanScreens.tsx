import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Share, TextInput, View, type ViewInstance } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { captureRef } from 'react-native-view-shot';

import { haversineMeters } from '@/compass/distance';
import { checkLocationPermission } from '@/compass/permissions';
import { geohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { cachedTourPubs, filterTourPubs, searchTourPubs, type TourPubSearchResult } from '@/data/tourPubSearch';
import { intlLocale, t } from '@/i18n';
import { usePubStore } from '@/stores/pubStore';
import { useToursStore } from '@/stores/toursStore';
import { CHALLENGE_MAX, samePub, validSchedule, type TourPlan, type TourResult } from '@/tours/model';
import { formatWalkDistance, walkingDistance, walkingLeg } from '@/tours/stopFacts';
import { pubCount, tourError } from '@/tours/TourChrome';
import { DEFAULT_TOUR_REGION } from '@/tours/TourMap';
import { shareTourLink } from '@/tours/tourInvites';
import { addDays, earliestMinutes, isPastDate, lastDay, minutesOf, pastLabel, suggestedTitle, timeOf, todayIn, weekday } from '@/tours/when';

import { BackHeader, Screen } from '../../components/chrome';
import { Input, PageTitle } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, Chip, D, IconButton, Kicker, Press, Row, Spinner, T, Tile } from '../../components/ui';
import { dialog, toast } from '../../ui/store';
import { C, display, s } from '../../theme';
import { StickerKdoJde } from '../sdileni/Stickers';
import { openEditor } from './TourListScreen';
import { TourMap } from './TourParts';
import { whenText } from './tourView';

const MAX_STOPS = 8;
const PRESETS = ['18:00', '19:00', '20:00', '21:00'];

function failed(result: TourResult) {
  if (!result.ok) toast({ kind: 'error', title: tourError(result.error) ?? t.tours.errors.network });
}

function NumberTile({ n }: { n: number }) {
  return (
    <View style={[{ width: 40, height: 40, borderRadius: 12, backgroundColor: C.control }, s.center]}>
      <D s={20} c={C.yellow}>
        {String(n)}
      </D>
    </View>
  );
}

function ChallengeLine({ text }: { text: string }) {
  return (
    <View style={[s.row, { gap: 6 }]}>
      <Icon name="flag" size={13} color={C.text2} />
      <T s={13} c={C.text2} style={s.fill}>
        {text}
      </T>
    </View>
  );
}

export function TourEditorScreen() {
  const router = useRouter();
  const draft = useToursStore((st) => st.draft);
  const hydrated = useToursStore((st) => st.hydrated);
  const tx = t.nv.tour;
  // Opened without a draft (a restored screen), the editor starts one instead of standing empty.
  useEffect(() => {
    void useToursStore.getState().hydrate().then(() => {
      if (!useToursStore.getState().draft) void useToursStore.getState().beginDraft();
    });
  }, []);
  if (!draft) {
    return (
      <Screen modal header={<EditorHeader title={tx.newTour} onClose={() => nvBack(router)} />}>
        {hydrated ? (
          <T s={15} c={C.text2}>
            {tourError(useToursStore.getState().error) ?? t.tours.loading}
          </T>
        ) : (
          <Spinner />
        )}
      </Screen>
    );
  }
  return <TourEditor key={draft.id} />;
}

function EditorHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <View style={[s.row, { justifyContent: 'space-between' }]}>
      <Kicker>{title}</Kicker>
      <IconButton icon="x" size={40} iconSize={18} onPress={onClose} label={t.tours.close} />
    </View>
  );
}

function TourEditor() {
  const router = useRouter();
  const tx = t.nv.tour;
  const draft = useToursStore((st) => st.draft)!;
  const existing = useToursStore((st) => !!st.draft && (st.draft.revision > 0 || st.plans.some((p) => p.id === st.draft!.id)));
  const [title, setTitle] = useState(draft.title);
  const [reorder, setReorder] = useState(false);
  const saving = useRef(false);
  const pendingTitle = useRef<string | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTitle = useCallback(() => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = null;
    const value = pendingTitle.current;
    pendingTitle.current = null;
    if (value !== null) void useToursStore.getState().updateDraft({ title: value });
  }, []);
  useEffect(() => flushTitle, [flushTitle]);

  async function save(dropDate = false) {
    const current = useToursStore.getState().draft;
    if (saving.current || !current || current.stops.length < 2) return;
    if (!dropDate && isPastDate(current)) {
      dialog({
        title: t.tours.pastTitle,
        body: t.tours.pastMessage,
        actions: [
          { label: t.tours.saveWithoutDate, onPress: () => void save(true) },
          { label: t.tours.pickNewDate, kind: 'primary', onPress: () => router.push('/nv/tour-kdy') },
        ],
      });
      return;
    }
    saving.current = true;
    pendingTitle.current = null;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    const schedule = dropDate ? { scheduledDate: null, scheduledTime: null } : {};
    const name = title.trim() || suggestedTitle(dropDate ? { scheduledDate: null } : current);
    const updated = await useToursStore.getState().updateDraft({ title: name, ...schedule });
    if (!updated.ok) {
      saving.current = false;
      failed(updated);
      return;
    }
    const result = await useToursStore.getState().saveDraft();
    saving.current = false;
    if (!result.ok) {
      failed(result);
      return;
    }
    nvBack(router);
    toast({ kind: 'saved', title: tx.saved, sub: tx.savedSub, icon: 'route' });
  }

  function close() {
    flushTitle();
    const current = useToursStore.getState().draft;
    if (!current || (!current.stops.length && !current.title.trim())) {
      void useToursStore.getState().discardDraft();
      nvBack(router);
      return;
    }
    const savable = current.stops.length >= 2;
    dialog({
      title: savable ? t.tours.unsavedTitle : t.tours.discardDraftTitle,
      actions: [
        {
          label: t.tours.discard,
          kind: 'danger',
          onPress: () => void useToursStore.getState().discardDraft().then((r) => { if (r.ok) nvBack(router); else failed(r); }),
        },
        savable ? { label: t.tours.saveChanges, kind: 'primary', onPress: () => void save() } : { label: t.tours.stay, kind: 'primary' },
      ],
    });
  }

  const count = draft.stops.length;
  const when = isPastDate(draft) ? pastLabel(draft) : (whenText(draft) ?? t.tours.optional);
  const missing = count === 0 ? t.tours.needTwo : count === 1 ? t.tours.needOne : null;
  return (
    <Screen
      modal
      header={<EditorHeader title={existing ? t.tours.editTour : tx.newTour} onClose={close} />}
      footer={
        <View style={{ gap: 10 }}>
          <Button label={count >= MAX_STOPS ? t.tours.errors.stopLimit : tx.addPubs} icon="plus" kind="raised" disabled={count >= MAX_STOPS} onPress={() => router.push('/nv/tour-vyber')} />
          <Button label={existing ? t.tours.saveChanges : tx.save} icon="check" disabled={count < 2} onPress={() => void save()} />
        </View>
      }
      gap={14}
    >
      <View style={[s.row, { gap: 10, marginTop: -6 }]}>
        <TextInput
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            pendingTitle.current = value;
            if (titleTimer.current) clearTimeout(titleTimer.current);
            titleTimer.current = setTimeout(flushTitle, 300);
          }}
          onBlur={flushTitle}
          maxLength={60}
          placeholder={suggestedTitle(draft)}
          placeholderTextColor={C.muted}
          selectionColor={C.yellow}
          keyboardAppearance="dark"
          returnKeyType="done"
          accessibilityLabel={t.tours.name}
          style={[display(40), s.fill, { padding: 0 }]}
        />
        <Icon name="pencil" size={18} color={C.muted} />
      </View>
      <Press onPress={() => router.push('/nv/tour-kdy')} style={[s.row, { height: 56, borderRadius: 18, paddingHorizontal: 16, gap: 10, backgroundColor: C.card }]}>
        <Icon name="calendar" size={18} color={C.muted} />
        <T s={15} c={C.muted} style={s.fill}>
          {tx.when}
        </T>
        <T s={15} w={700} numberOfLines={1} c={draft.scheduledDate ? C.white : C.muted}>
          {when}
        </T>
        <Icon name="chevron-right" size={16} color={C.muted} />
      </Press>
      {count ? <TourMap stops={draft.stops} planning height={90} onExpand={() => router.push({ pathname: '/nv/tour-mapa', params: { draft: '1' } } as unknown as Href)} /> : null}
      <View style={[s.row, { justifyContent: 'space-between', paddingHorizontal: 4 }]}>
        <T s={17} w={700}>
          {tx.stopsOf(count, MAX_STOPS)}
        </T>
        {count > 1 ? (
          <Press onPress={() => setReorder(!reorder)} hitSlop={8}>
            <T s={15} w={600} c={C.yellow}>
              {reorder ? t.tours.reorderDone : tx.reorder}
            </T>
          </Press>
        ) : null}
      </View>
      {count ? (
        <Card>
          {draft.stops.map((st, i) => (
            <Row
              key={st.id}
              last={i === count - 1}
              leading={<NumberTile n={i + 1} />}
              title={st.name}
              sub={
                <View style={{ gap: 4 }}>
                  <T s={13} c={C.muted}>
                    {i === 0 ? tx.meetAt(draft.scheduledTime, st.address) : st.address}
                  </T>
                  {st.challenge ? <ChallengeLine text={st.challenge} /> : null}
                </View>
              }
              trailing={
                reorder ? (
                  <View style={[s.row, { gap: 6 }]}>
                    <IconButton icon="arrow-up" size={36} iconSize={16} color={i ? C.white : C.muted} label={`${t.tours.moveUp}: ${st.name}`} onPress={i ? () => void useToursStore.getState().moveStop(st.id, -1).then(failed) : undefined} />
                    <IconButton icon="arrow-down" size={36} iconSize={16} color={i < count - 1 ? C.white : C.muted} label={`${t.tours.moveDown}: ${st.name}`} onPress={i < count - 1 ? () => void useToursStore.getState().moveStop(st.id, 1).then(failed) : undefined} />
                  </View>
                ) : (
                  <Icon name="grip-vertical" size={18} color={C.muted} />
                )
              }
              onPress={reorder ? undefined : () => router.push({ pathname: '/nv/tour-akce', params: { stop: st.id } } as unknown as Href)}
            />
          ))}
        </Card>
      ) : null}
      {missing ? (
        <T s={13} c={C.muted}>
          {missing}
        </T>
      ) : null}
    </Screen>
  );
}

type Center = { latitude: number; longitude: number };
const pubIdentity = (pub: Pub) => ({ pubId: pub.id, cacheKey: geohash8(pub.lat, pub.lng), name: pub.name });

export function TourVyberScreen() {
  const router = useRouter();
  const tx = t.nv.tour;
  const { replace } = useLocalSearchParams<{ replace?: string }>();
  const draft = useToursStore((st) => st.draft);
  const stops = useMemo(() => draft?.stops ?? [], [draft]);
  const replaceStop = replace ? stops.find((st) => st.id === replace) : undefined;
  const reportedPubIds = usePubStore((st) => st.reportedPubIds);
  const reportedCacheKeys = usePubStore((st) => st.reportedCacheKeys);
  const [query, setQuery] = useState('');
  const [pubs, setPubs] = useState<Pub[]>([]);
  const [status, setStatus] = useState<TourPubSearchResult['status']>('ok');
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [userCenter, setUserCenter] = useState<Center | null>(null);
  const busy = useRef(false);
  // The rows stay around one stop while picking, so a tapped pub keeps its place.
  const [anchorId] = useState(() => (replace ? stops[Math.max(0, stops.findIndex((st) => st.id === replace) - 1)]?.id : stops[stops.length - 1]?.id) ?? null);
  const anchor = stops.find((st) => st.id === anchorId) ?? (replace ? undefined : stops[stops.length - 1]);
  const center: Center = anchor ? { latitude: anchor.lat, longitude: anchor.lon } : (userCenter ?? DEFAULT_TOUR_REGION);
  const browsing = query.trim().length < 2;

  // A tour without stops starts where the walker is, if location is already allowed. Never asks here.
  useEffect(() => {
    if (stops.length) return;
    let alive = true;
    void (async () => {
      try {
        if ((await checkLocationPermission()) !== 'granted') return;
        const fix = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 });
        if (fix && alive) setUserCenter({ latitude: fix.coords.latitude, longitude: fix.coords.longitude });
      } catch {
        // Without a fix the default area stays.
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const known = useMemo(() => stops.map((st) => ({ id: st.pubId, name: st.name, lat: st.lat, lng: st.lon, address: st.address })), [stops]);
  const lat = center.latitude;
  const lon = center.longitude;
  const searchKey = `${query}|${lat}|${lon}`;
  const loading = loadedKey !== searchKey;
  useEffect(() => {
    const controller = new AbortController();
    const text = query.trim();
    const timer = setTimeout(() => {
      void (async () => {
        if (browsing) {
          const cached = await cachedTourPubs('', known);
          if (!controller.signal.aborted) setPubs(cached);
        }
        const result = await searchTourPubs({ query: browsing ? '' : text, center: { latitude: lat, longitude: lon }, area: browsing, signal: controller.signal, known });
        if (controller.signal.aborted || result.status === 'cancelled') return;
        setLoadedKey(`${query}|${lat}|${lon}`);
        setStatus(result.status);
        setPubs((previous) => (browsing ? [...result.pubs, ...previous] : result.pubs));
      })();
    }, browsing ? 0 : 350);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
    // `known` changes with every pick; the list should not reload then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, browsing, lat, lon]);

  const anchored = !!anchor;
  const allowed = useMemo(() => filterTourPubs(pubs, { reportedPubIds, reportedCacheKeys }), [pubs, reportedPubIds, reportedCacheKeys]);
  const inTour = (pub: Pub) => stops.findIndex((st) => st.id !== replaceStop?.id && samePub(st, pubIdentity(pub)));
  const rows = useMemo(() => {
    const seen = new Set<string>();
    const unique = allowed.filter((pub) => {
      const { cacheKey, name } = pubIdentity(pub);
      const place = `${cacheKey}|${name.trim().toLocaleLowerCase()}`;
      if (seen.has(pub.id) || seen.has(place)) return false;
      seen.add(pub.id);
      seen.add(place);
      return true;
    });
    const from = { lat, lng: lon };
    // Suggestions after a stop stay within a walk; farther pubs still come up by search.
    const ranked = browsing ? unique.map((pub) => ({ pub, meters: haversineMeters(from, pub) })).filter(({ meters }) => !anchored || meters <= 3000).sort((a, b) => a.meters - b.meters).map(({ pub }) => pub) : unique;
    return ranked.slice(0, 30);
  }, [allowed, browsing, lat, lon, anchored]);

  async function toggle(pub: Pub) {
    if (busy.current) return;
    const store = useToursStore.getState();
    busy.current = true;
    try {
      if (replaceStop) {
        const result = await store.replaceStop(replaceStop.id, pub);
        if (result.ok) nvBack(router);
        else failed(result);
        return;
      }
      const index = inTour(pub);
      if (index < 0 && stops.length >= MAX_STOPS) {
        toast({ kind: 'info', title: t.tours.pickerFull, icon: 'route' });
        return;
      }
      failed(index < 0 ? await store.addStop(pub) : await store.removeStop(stops[index].id));
    } finally {
      busy.current = false;
    }
  }

  const kicker = replaceStop ? t.tours.replaceStop : !browsing ? null : anchor ? t.tours.nearStop(stops.indexOf(anchor) + 1) : userCenter ? tx.nearYou : null;
  return (
    <Screen
      header={
        <View style={[s.row, { gap: 10 }]}>
          <IconButton icon="chevron-left" size={44} iconSize={18} onPress={() => nvBack(router)} label={t.tours.back} />
          <View style={s.fill}>
            <Input icon="search" placeholder={tx.searchPubs} height={46} value={query} onChangeText={setQuery} autoCorrect={false} returnKeyType="search" />
          </View>
        </View>
      }
      footer={
        <View style={{ gap: 12 }}>
          {!replaceStop && stops.length ? (
            <View style={[s.row, { gap: 8 }]}>
              {stops.slice(-3).map((st) => (
                <Press
                  key={st.id}
                  onPress={() => void useToursStore.getState().removeStop(st.id).then(failed)}
                  accessibilityLabel={t.tours.removeChipA11y(st.name)}
                  style={[s.row, { height: 36, borderRadius: 18, paddingLeft: 6, paddingRight: 10, gap: 8, backgroundColor: C.card, borderWidth: 1, borderColor: C.hairline, flexShrink: 1 }]}
                >
                  <View style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.control }, s.center]}>
                    <T s={12} w={800} c={C.yellow}>
                      {String(stops.indexOf(st) + 1)}
                    </T>
                  </View>
                  <T s={13} w={600} numberOfLines={1} style={{ maxWidth: 90 }}>
                    {st.name}
                  </T>
                  <Icon name="x" size={13} color={C.muted} />
                </Press>
              ))}
            </View>
          ) : null}
          <Button label={replaceStop ? t.tours.back : t.tours.pickerDone(pubCount(stops.length))} onPress={() => nvBack(router)} />
        </View>
      }
      gap={16}
    >
      <TourMap stops={stops} height={200} />
      {kicker ? <Kicker>{kicker}</Kicker> : null}
      {status === 'cached' ? (
        <T s={13} c={C.muted}>
          {t.tours.searchOffline}
        </T>
      ) : null}
      {rows.length ? (
        <Card>
          {rows.map((pub, i) => {
            const index = inTour(pub);
            const on = index >= 0;
            const minutes = anchor && !on ? walkingLeg(anchor, { lat: pub.lat, lon: pub.lng }).minutes : null;
            const beers = (pub.beers ?? []).map((beer) => beer.name).filter(Boolean).slice(0, 2).join(', ');
            const sub = [minutes ? t.tours.walkMinutes(minutes) : null, beers || null].filter(Boolean).join(' · ') || pub.address || pub.city || '';
            return (
              <Row
                key={pub.id}
                last={i === rows.length - 1}
                leading={
                  on ? (
                    <View style={[{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.yellow }, s.center]}>
                      <T s={14} w={800} c={C.black}>
                        {String(index + 1)}
                      </T>
                    </View>
                  ) : (
                    <View style={[{ width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, borderColor: C.text2 }, s.center]}>
                      <Icon name={replaceStop ? 'repeat' : 'plus'} size={16} />
                    </View>
                  )
                }
                title={pub.name}
                titleWeight={700}
                sub={sub}
                chevron
                onPress={() => void toggle(pub)}
              />
            );
          })}
        </Card>
      ) : loading ? (
        <Spinner />
      ) : (
        <T s={15} c={C.text2} lh={1.4}>
          {status === 'error' ? t.tours.searchError : t.tours.searchEmpty}
        </T>
      )}
    </Screen>
  );
}

const WEEKS = 5;

export function TourKdySheet() {
  const router = useRouter();
  const tx = t.nv.tour;
  const draft = useToursStore((st) => st.draft);
  const tz = draft?.timezone ?? 'Europe/Prague';
  const today = todayIn(tz);
  const last = lastDay(tz);
  const monday = addDays(today, -weekday(today));
  const [offset, setOffset] = useState(() => {
    const picked = draft?.scheduledDate;
    if (!picked || picked < today) return 0;
    return Math.max(0, Math.floor((Date.parse(`${picked}T12:00:00Z`) - Date.parse(`${monday}T12:00:00Z`)) / (7 * 86400000)) - (WEEKS - 1));
  });
  const [day, setDay] = useState<string | null>(draft?.scheduledDate && draft.scheduledDate >= today ? draft.scheduledDate : null);
  const [time, setTime] = useState<string | null>(draft?.scheduledTime ?? null);
  const [custom, setCustom] = useState(() => !!draft?.scheduledTime && !PRESETS.includes(draft.scheduledTime));
  const start = addDays(monday, offset * 7);
  const end = addDays(start, WEEKS * 7 - 1);
  const month = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(intlLocale, { month: 'long', timeZone: 'UTC' });
  const capital = (text: string) => text.charAt(0).toLocaleUpperCase(intlLocale) + text.slice(1);
  const monthLabel = month(start) === month(end) ? capital(month(start)) : tx.monthRange(capital(month(start)), month(end));
  const earliest = day ? earliestMinutes(day, tz) : 0;
  const dayNames = Array.from({ length: 7 }, (_, i) => new Date(`${addDays(monday, i)}T12:00:00Z`).toLocaleDateString(intlLocale, { weekday: 'short', timeZone: 'UTC' }));

  async function apply(patch: Pick<TourPlan, 'scheduledDate' | 'scheduledTime'>) {
    if (!draft) return;
    if (!validSchedule({ ...draft, ...patch })) {
      toast({ kind: 'error', title: patch.scheduledTime ? t.tours.whenDst : t.tours.errors.date });
      return;
    }
    const result = await useToursStore.getState().updateDraft(patch);
    if (result.ok) nvBack(router);
    else failed(result);
  }

  const shift = (minutes: number) => {
    const current = minutesOf(time ?? '20:00') + minutes;
    setTime(timeOf(Math.min(23 * 60 + 45, Math.max(earliest ?? 0, current))));
  };
  const timeTooEarly = !!time && earliest !== null && minutesOf(time) < earliest;
  return (
    <Sheet title={t.tours.whenTitle} scroll={false}>
      <View style={[s.row, { justifyContent: 'space-between', marginTop: -6 }]}>
        <T s={16} w={700}>
          {monthLabel}
        </T>
        <View style={[s.row, { gap: 8 }]}>
          <IconButton icon="chevron-up" size={32} iconSize={16} color={offset ? C.white : C.muted} label={t.tours.whenEarlierWeeks} onPress={offset ? () => setOffset(offset - 1) : undefined} />
          <IconButton icon="chevron-down" size={32} iconSize={16} color={end < last ? C.white : C.muted} label={t.tours.whenLaterWeeks} onPress={end < last ? () => setOffset(offset + 1) : undefined} />
        </View>
      </View>
      <View style={{ gap: 4 }}>
        <View style={s.row}>
          {dayNames.map((d) => (
            <T key={d} s={12} w={600} c={C.muted} style={{ flex: 1, textAlign: 'center' }}>
              {d.charAt(0).toLocaleUpperCase(intlLocale) + d.slice(1)}
            </T>
          ))}
        </View>
        {Array.from({ length: WEEKS }, (_, wi) => (
          <View key={wi} style={s.row}>
            {Array.from({ length: 7 }, (_, di) => {
              const iso = addDays(start, wi * 7 + di);
              const out = iso < today || iso > last || (iso === today && earliestMinutes(iso, tz) === null);
              const isToday = iso === today;
              const on = day === iso;
              return (
                <Press key={iso} disabled={out} onPress={() => setDay(iso)} accessibilityLabel={out ? `${iso}, ${t.tours.whenUnavailable}` : iso} style={[{ flex: 1, height: 46 }, s.center]}>
                  <View style={[{ width: 40, height: 40, borderRadius: 20 }, s.center, on && { backgroundColor: C.yellow }]}>
                    <T s={16} w={on || isToday ? 800 : 500} c={on ? C.black : out ? '#FFFFFF4D' : isToday ? C.yellow : C.white}>
                      {String(Number(iso.slice(8)))}
                    </T>
                  </View>
                </Press>
              );
            })}
          </View>
        ))}
      </View>
      <View style={{ height: 1, backgroundColor: C.hairline }} />
      <T s={16} w={700}>
        {tx.time}
      </T>
      <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
        {PRESETS.map((preset) => (
          <Chip
            key={preset}
            label={preset}
            plain
            active={!custom && time === preset}
            onPress={() => {
              setCustom(false);
              setTime(time === preset && !custom ? null : preset);
            }}
            height={38}
            style={{ paddingHorizontal: 12 }}
          />
        ))}
        <Chip
          label={custom && time ? time : t.tours.whenOtherTime}
          plain
          active={custom}
          onPress={() => {
            setCustom(true);
            if (!time) setTime('20:00');
          }}
          height={38}
          style={{ paddingHorizontal: 12 }}
        />
      </View>
      {custom ? (
        <View style={[s.row, { gap: 12, justifyContent: 'center' }]}>
          <IconButton icon="minus" size={40} iconSize={18} label={t.tours.whenTimeDown} onPress={() => shift(-15)} />
          <D s={32}>{time ?? '20:00'}</D>
          <IconButton icon="plus" size={40} iconSize={18} label={t.tours.whenTimeUp} onPress={() => shift(15)} />
        </View>
      ) : null}
      {timeTooEarly ? (
        <T s={13} c={C.muted}>
          {t.tours.errors.date}
        </T>
      ) : null}
      <Button label={t.tours.whenDone} disabled={!day || timeTooEarly} onPress={() => void apply({ scheduledDate: day, scheduledTime: day ? time : null })} />
      <Press onPress={() => void apply({ scheduledDate: null, scheduledTime: null })} style={{ alignItems: 'center', paddingBottom: 4 }}>
        <T s={15} w={700} c={C.text2}>
          {t.tours.whenClear}
        </T>
      </Press>
    </Sheet>
  );
}

/** Actions for one stop of the draft (`stop`), or for a saved plan (`plan`). */
export function TourAkceSheet() {
  const { stop, plan } = useLocalSearchParams<{ stop?: string; plan?: string }>();
  return plan ? <PlanActions id={plan} /> : <StopActions id={stop ?? ''} />;
}

function StopActions({ id }: { id: string }) {
  const router = useRouter();
  const draft = useToursStore((st) => st.draft);
  const index = draft?.stops.findIndex((st) => st.id === id) ?? -1;
  const st = index >= 0 ? draft!.stops[index] : undefined;
  if (!st) return <Sheet title={t.tours.errors.unavailable} scroll={false}>{null}</Sheet>;
  return (
    <Sheet title={st.name} scroll={false}>
      <T s={15} c={C.text2} style={{ marginTop: -10 }}>
        {t.nv.tour.stopAt(index + 1, st.address)}
      </T>
      <Card>
        <Row leading={<Icon name="flag" size={18} />} title={st.challenge ? t.tours.editChallenge : t.tours.addChallenge} chevron onPress={() => router.replace({ pathname: '/nv/tour-vyzva', params: { stop: st.id } } as unknown as Href)} />
        <Row leading={<Icon name="repeat" size={18} />} title={t.tours.replaceStop} chevron onPress={() => router.replace({ pathname: '/nv/tour-vyber', params: { replace: st.id } } as unknown as Href)} />
        <Row
          last
          leading={<Icon name="trash-2" size={18} />}
          title={t.tours.removeStop}
          onPress={() => {
            void useToursStore.getState().removeStop(st.id).then((result) => {
              if (!result.ok) return failed(result);
              nvBack(router);
              toast({ kind: 'info', title: t.nv.tour.stopRemoved(st.name), icon: 'trash-2' });
            });
          }}
        />
      </Card>
      <Press onPress={() => nvBack(router)} style={{ alignItems: 'center', paddingBottom: 6 }}>
        <T s={15} w={700} c={C.text2}>
          {t.tours.cancel}
        </T>
      </Press>
    </Sheet>
  );
}

function PlanActions({ id }: { id: string }) {
  const router = useRouter();
  const plan = useToursStore((st) => st.plans.find((p) => p.id === id));
  const walking = useToursStore((st) => st.activeRun?.planId === id);
  const [busy, setBusy] = useState(false);
  if (!plan) return <Sheet title={t.tours.errors.unavailable} scroll={false}>{null}</Sheet>;
  const own = !plan.source && !plan.publicSource;
  const publication = plan.publication;
  const rows: { icon: React.ComponentProps<typeof Icon>['name']; title: string; onPress: () => void; danger?: boolean }[] = [];
  if (!plan.source && !walking) rows.push({ icon: 'pencil', title: t.tours.editTour, onPress: () => { nvBack(router); void openEditor(router, id); } });
  if (own && publication?.status !== 'hidden')
    rows.push({ icon: 'globe', title: publication?.status === 'active' ? t.tours.updatePublic : t.tours.publishPublic, onPress: () => router.replace({ pathname: '/nv/tour-zverejnit', params: { id } } as unknown as Href) });
  if (own && publication?.status === 'active')
    rows.push({ icon: 'share', title: t.tours.sharePublic, onPress: () => void Share.share({ message: publication.url }).catch(() => undefined) });
  if (!plan.source)
    rows.push({
      icon: 'link',
      title: t.tours.shareLink,
      onPress: () => {
        setBusy(true);
        void shareTourLink(id).then((error) => {
          setBusy(false);
          if (error) toast({ kind: 'error', title: error });
        });
      },
    });
  if (plan.source) rows.push({ icon: 'refresh-cw', title: t.tours.checkUpdate, onPress: () => router.replace({ pathname: '/nv/tour-verejna', params: { token: plan.source!.token } } as unknown as Href) });
  rows.push({
    icon: 'copy',
    title: t.tours.repeat,
    onPress: () =>
      void useToursStore.getState().copyPlan(id).then((result) => {
        if (!result.ok) return failed(result);
        nvBack(router);
        toast({ kind: 'saved', title: t.nv.tour.copyReady, icon: 'copy' });
      }),
  });
  if (own && publication && publication.status !== 'unpublished')
    rows.push({
      icon: 'eye-off',
      title: t.tours.unpublish,
      onPress: () =>
        dialog({
          title: t.tours.unpublishTitle,
          body: t.tours.unpublishMessage,
          actions: [{ label: t.tours.cancel }, { label: t.tours.unpublish, kind: 'danger', onPress: () => void useToursStore.getState().unpublishPublic(id).then((r) => { if (r.ok) nvBack(router); else failed(r); }) }],
        }),
    });
  if (!walking)
    rows.push({
      icon: 'trash-2',
      title: t.tours.delete,
      danger: true,
      onPress: () =>
        dialog({
          title: t.tours.deleteTitle,
          body: t.tours.deleteMessage,
          actions: [
            { label: t.tours.cancel },
            {
              label: t.tours.delete,
              kind: 'danger',
              onPress: () =>
                void useToursStore.getState().deletePlan(id).then((r) => {
                  if (!r.ok) return failed(r);
                  router.dismissTo('/nv/tour');
                }),
            },
          ],
        }),
    });
  return (
    <Sheet title={plan.title} scroll={false}>
      <Card>
        {rows.map((row, i) => (
          <Row key={row.title} last={i === rows.length - 1} leading={<Icon name={row.icon} size={18} color={row.danger ? C.danger : C.white} />} title={row.title} titleColor={row.danger ? C.danger : C.white} chevron={!row.danger} onPress={busy ? undefined : row.onPress} />
        ))}
      </Card>
      <Press onPress={() => nvBack(router)} style={{ alignItems: 'center', paddingBottom: 6 }}>
        <T s={15} w={700} c={C.text2}>
          {t.tours.cancel}
        </T>
      </Press>
    </Sheet>
  );
}

export function TourVyzvaSheet() {
  const router = useRouter();
  const { stop } = useLocalSearchParams<{ stop: string }>();
  const draft = useToursStore((st) => st.draft);
  const index = draft?.stops.findIndex((st) => st.id === stop) ?? -1;
  const st = index >= 0 ? draft!.stops[index] : undefined;
  const [text, setText] = useState(st?.challenge ?? '');
  if (!st) return <Sheet title={t.tours.errors.unavailable} scroll={false}>{null}</Sheet>;
  return (
    <Sheet title={t.tours.challenge} scroll={false}>
      <View style={[s.row, { gap: 12, marginTop: -6 }]}>
        <NumberTile n={index + 1} />
        <View style={s.fill}>
          <T s={16} w={600}>
            {st.name}
          </T>
          <T s={13} c={C.muted}>
            {t.nv.tour.stopAt(index + 1, st.address)}
          </T>
        </View>
      </View>
      <Input multiline value={text} onChangeText={setText} autoFocus maxLength={CHALLENGE_MAX} placeholder={t.nv.tour.challengePlaceholder} />
      <View style={[s.row, { gap: 8 }]}>
        <Icon name="lightbulb" size={14} color={C.muted} />
        <T s={13} c={C.muted} style={s.fill}>
          {t.tours.challengeHint}
        </T>
        <T s={13} c={C.muted}>
          {t.tours.challengeCount(text.length, CHALLENGE_MAX)}
        </T>
      </View>
      <Button
        label={t.tours.saveChallenge}
        onPress={() =>
          void useToursStore.getState().setChallenge(st.id, text).then((result) => {
            if (!result.ok) return failed(result);
            nvBack(router);
            toast({ kind: 'saved', title: t.nv.tour.challengeSaved, icon: 'flag' });
          })
        }
      />
    </Sheet>
  );
}

type PublishFailure = Extract<TourResult, { ok: false }>;

function publishFailureText(failure: PublishFailure, plan: TourPlan): string {
  const e = t.tours.errors;
  const name = failure.stop !== undefined ? plan.stops[failure.stop]?.name : undefined;
  if (failure.error === 'text_rejected') return name && failure.field === 'challenge' ? e.publicChallenge(name) : failure.field === 'title' ? e.publicTitle(plan.title) : e.publicText;
  if (failure.error === 'unknown_pub' && name) return e.publicUnknownPub(name);
  if (failure.error === 'hidden_pub' && name) return e.publicHiddenPub(name);
  if (failure.error === 'limit') return e.publicLimit(failure.limit ?? 10);
  if (failure.error === 'throttled') return e.publicThrottled;
  if (failure.error === 'network') return e.publicNetwork;
  return tourError(failure.error) ?? e.publicNetwork;
}

export function TourZverejnitScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const plan = useToursStore((st) => st.plans.find((p) => p.id === id));
  const busy = useToursStore((st) => st.busy);
  const [failure, setFailure] = useState<PublishFailure | null>(null);
  useEffect(() => () => useToursStore.getState().clearError(), []);
  if (!plan) {
    return (
      <Screen header={<BackHeader />}>
        <T s={15} c={C.text2}>
          {t.tours.errors.unavailable}
        </T>
      </Screen>
    );
  }
  const current = plan;
  const updating = current.publication?.status === 'active';
  const challenges = current.stops.filter((st) => st.challenge).length;
  async function publish() {
    setFailure(null);
    const result = await useToursStore.getState().publishPublic(current.id);
    if (result.ok) {
      nvBack(router);
      toast({ kind: 'saved', title: t.nv.tour.published, icon: 'globe' });
    } else setFailure(result);
  }
  const fix = !failure
    ? null
    : failure.error === 'sign_in'
      ? { label: t.tours.signIn, onPress: () => router.push('/nv/prihlaseni') }
      : failure.error === 'nickname' || failure.error === 'profile_private'
        ? { label: failure.error === 'nickname' ? t.tours.pickNickname : t.tours.openPrivacy, onPress: () => router.push(failure.error === 'nickname' ? '/nv/upravit-profil' : '/nv/nastaveni') }
        : ['text_rejected', 'unknown_pub', 'hidden_pub', 'duplicate'].includes(failure.error)
          ? { label: t.tours.editTour, onPress: () => { nvBack(router); void openEditor(router, current.id); } }
          : null;
  return (
    <Screen
      header={<BackHeader />}
      footer={
        <View style={{ gap: 14 }}>
          <Press onPress={() => void Linking.openURL(t.tours.rulesUrl).catch(() => undefined)} accessibilityRole="link">
            <T s={13} c={C.muted} style={{ textAlign: 'center' }}>
              {t.tours.rulesPrefix}
              <T s={13} w={700} c={C.yellow}>
                {t.tours.rulesLink}
              </T>
              {t.tours.rulesSuffix}
            </T>
          </Press>
          {fix ? <Button label={fix.label} onPress={fix.onPress} /> : <Button label={updating ? t.tours.updatePublic : t.tours.publishAction} icon="globe" disabled={busy} onPress={() => void publish()} />}
        </View>
      }
      gap={14}
    >
      <PageTitle title={updating ? t.tours.updatePublic : t.tours.publishPublic} />
      {failure ? (
        <View style={[s.row, { gap: 10, alignItems: 'flex-start', padding: 14, borderRadius: 18, backgroundColor: C.card }]}>
          <Icon name="circle-alert" size={16} color={C.danger} />
          <T s={14} c={C.text2} lh={1.4} style={s.fill}>
            {publishFailureText(failure, current)}
          </T>
        </View>
      ) : null}
      <Kicker>{t.tours.seenByAll}</Kicker>
      <Card>
        <Row leading={<Icon name="type" size={18} color={C.yellow} />} title={t.tours.seenTitle(current.title)} />
        <Row leading={<Icon name="route" size={18} color={C.yellow} />} title={t.tours.seenStops(pubCount(current.stops.length), formatWalkDistance(walkingDistance(current.stops)))} />
        {challenges ? <Row leading={<Icon name="flag" size={18} color={C.yellow} />} title={t.tours.seenChallenges(challenges)} /> : null}
        <Row last leading={<Icon name="circle-user" size={18} color={C.yellow} />} title={t.tours.seenProfile} />
      </Card>
      <Kicker>{t.tours.notSeenByOthers}</Kicker>
      <Card>
        <Row leading={<Icon name="eye-off" size={18} color={C.muted} />} title={t.tours.hiddenMeetup} />
        <Row last leading={<Icon name="eye-off" size={18} color={C.muted} />} title={t.tours.hiddenPrivate} />
      </Card>
      <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
        <Icon name="info" size={15} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          {t.tours.publishNameNote}
        </T>
      </View>
      <View style={[s.row, { gap: 10, alignItems: 'flex-start' }]}>
        <Icon name="undo-2" size={15} color={C.muted} />
        <T s={13} c={C.muted} lh={1.4} style={s.fill}>
          {t.tours.publishUndoNote}
        </T>
      </View>
    </Screen>
  );
}

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <View style={[{ height: 260, borderRadius: 22, overflow: 'hidden', backgroundColor: '#2A2622' }, s.center]}>
      <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: 'radial-gradient(circle at 50% 40%, #4A4036 0%, #1E1B18 80%)' }} />
      {children}
    </View>
  );
}

/** "Žižkovský tah · so 20:00": what the sticker says about the plan. */
function stickerWhere(plan: TourPlan): string {
  if (!plan.scheduledDate) return plan.title;
  const day = new Date(`${plan.scheduledDate}T12:00:00Z`).toLocaleDateString(intlLocale, { weekday: 'short', timeZone: 'UTC' });
  return [plan.title, [day, plan.scheduledTime].filter(Boolean).join(' ')].join(' · ');
}

export function TourPozvatSheet() {
  const router = useRouter();
  const tx = t.nv.tour;
  const { id } = useLocalSearchParams<{ id: string }>();
  const plan = useToursStore((st) => st.plans.find((p) => p.id === id));
  const sticker = useRef<ViewInstance>(null);
  const [busy, setBusy] = useState<'sticker' | 'link' | null>(null);
  if (!plan) return <Sheet title={t.tours.errors.unavailable} scroll={false}>{null}</Sheet>;

  async function copySticker() {
    setBusy('sticker');
    try {
      const base64 = await captureRef(sticker, { format: 'png', quality: 1, result: 'base64' });
      await Clipboard.setImageAsync(base64);
      toast({ kind: 'saved', title: t.vycep.storyCopied, icon: 'send' });
    } catch {
      toast({ kind: 'error', title: t.vycep.storyShareError });
    } finally {
      setBusy(null);
    }
  }
  async function shareLink() {
    setBusy('link');
    const error = await shareTourLink(plan!.id);
    setBusy(null);
    if (error) toast({ kind: 'error', title: error });
  }
  return (
    <Sheet title={tx.inviteTitle} scroll={false}>
      <Stage>
        <View ref={sticker} collapsable={false} style={{ padding: 14 }}>
          <StickerKdoJde where={stickerWhere(plan)} />
        </View>
      </Stage>
      <Button label={tx.stickerToInstagram} icon="send" disabled={!!busy} onPress={() => void copySticker()} />
      {!plan.source ? (
        <Card>
          <Row leading={<Tile icon="user-plus" />} title={tx.sendInvite} titleWeight={700} sub={tx.sendInviteSub} chevron onPress={() => router.replace({ pathname: '/nv/tour-cinknout', params: { plan: plan.id } } as unknown as Href)} />
          <Row last leading={<Tile icon="link" />} title={tx.shareLink} titleWeight={700} sub={busy === 'link' ? t.tours.loading : tx.shareLinkSub} chevron onPress={busy ? undefined : () => void shareLink()} />
        </Card>
      ) : null}
    </Sheet>
  );
}

