import React, { useMemo, useState } from 'react';
import { TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';

import { countDrink, placeKey, type CountPlace } from '@/counter/countDrink';
import { cautiousCeil, formatClock, formatPromile, formatZeroAt, isMorning, useAlcoholEstimate } from '@/counter/useAlcoholEstimate';
import { decodeGeohash8 } from '@/data/geohash';
import type { Pub } from '@/data/pubs';
import { BODY_LIMITS, drinkAbv, isBodyValueValid, type BodyProfile, type BodySex } from '@/drinks/alcoholEstimate';
import { isContextPubKey } from '@/drinks/drinkTypes';
import { useNowTick } from '@/friends/useNowTick';
import { intlLocale, t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore, type TallyDrink } from '@/stores/tallyStore';
import { deleteSessionDrink, renameSessionDrinks } from '@/myBeers/drinkEdits';
import { formatPrice } from '@/utils/currency';

import { BackHeader, Screen } from '../../components/chrome';
import { Field, Input } from '../../components/forms';
import { Icon, type IconName } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, Chip, ChipWrap, D, IconButton, Press, Row, Segmented, T } from '../../components/ui';
import { C, font, s } from '../../theme';
import { dialog, toast } from '../../ui/store';
import { beerTally, dateOfDay, dayKeyOf, dayString, hourlyTempo, minutesBetween, nightsOf } from './eveningData';
import { nightDayLabel, servingLine } from './stamgastFormat';
import { useBackfillPick, useCountPlace } from './placeStore';

function Counter({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const copy = t.nv.stamgast;
  return (
    <View style={[s.row, { gap: 10 }]}>
      <IconButton icon="minus" size={30} iconSize={14} onPress={() => onChange(Math.max(0, value - 1))} label={copy.minus} />
      <D s={24} lh={1} style={{ minWidth: 14, textAlign: 'center' }}>
        {String(value)}
      </D>
      <IconButton icon="plus" size={30} iconSize={14} onPress={() => onChange(value + 1)} label={copy.plus} />
    </View>
  );
}

function useAllNights() {
  const current = useTallyStore((st) => st.current);
  const history = useTallyStore((st) => st.history);
  return useMemo(() => {
    const sessions = current ? [current, ...history] : history;
    return { sessions, nights: nightsOf(sessions) };
  }, [current, history]);
}

function parseClock(value: string): { h: number; m: number } | null {
  const match = /^(\d{1,2})[:.](\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  return h <= 23 && m <= 59 ? { h, m } : null;
}

/** A clock time on a drinking day: hours before the 04:00 cutoff belong to the next calendar day. */
function atOnDay(day: string, clock: { h: number; m: number }): Date {
  const base = dateOfDay(day);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + (clock.h < 4 ? 1 : 0), clock.h, clock.m);
}

/** A pub of an earlier evening, rebuilt from its geohash cell like the counter's stand-in. */
function pubFromSession(pubKey: string, name: string, externalId?: string, city?: string): Pub {
  const { lat, lng } = decodeGeohash8(pubKey);
  return { id: externalId ?? `tally:${pubKey}`, name, lat, lng, ...(city ? { city } : {}) };
}

/** The currency sign alone, for the price column. */
function currencySign(currency: Parameters<typeof formatPrice>[1]): string {
  return formatPrice(0, currency).replace(/[\d\s.,]/g, '');
}

type PlaceChoice = { id: string; label: string; icon?: IconName; place: CountPlace };
type BeerRow = { key: string; name: string; n: number; price: string };

const BACKFILL_DAYS = 60;

export function DopsatSheet() {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const { day } = useLocalSearchParams<{ day?: string }>();
  const fromDiary = !!day && /^\d{4}-\d{2}-\d{2}$/.test(day);
  const now = useNowTick();
  const today = dayKeyOf(new Date(now));
  const { sessions, nights } = useAllNights();
  const live = useCountPlace();
  const picked = useBackfillPick((st) => st.pub);
  const currency = useSettingsStore((st) => st.priceCurrency);
  const [date, setDate] = useState(fromDiary ? (day as string) : today);
  const [from, setFrom] = useState('19:00');
  const [to, setTo] = useState('');
  const [scope, setScope] = useState<'me' | 'parta'>('me');

  const places = useMemo<PlaceChoice[]>(() => {
    const out: PlaceChoice[] = [];
    if (live?.kind === 'pub') out.push({ id: placeKey(live), label: live.pub.name, icon: 'navigation', place: live });
    for (const session of sessions) {
      if (out.length >= 3) break;
      if (isContextPubKey(session.pubKey) || out.some((p) => p.id === session.pubKey)) continue;
      out.push({
        id: session.pubKey,
        label: session.pubName,
        icon: 'history',
        place: { kind: 'pub', pub: pubFromSession(session.pubKey, session.pubName, session.pubExternalId, session.pubCity) },
      });
    }
    if (picked) {
      const pickedPlace: CountPlace = { kind: 'pub', pub: picked };
      if (!out.some((p) => p.id === placeKey(pickedPlace))) out.push({ id: placeKey(pickedPlace), label: picked.name, icon: 'map-pin', place: pickedPlace });
    }
    out.push({ id: 'none', label: copy.noPub, place: { kind: 'outside', context: 'other' } });
    return out;
  }, [copy.noPub, live, picked, sessions]);

  const night = nights.find((n) => n.day === date);
  const [placeId, setPlaceId] = useState<string | null>(() =>
    night?.pubs[0] && !isContextPubKey(night.pubs[0].pubKey) ? night.pubs[0].pubKey : live?.kind === 'pub' ? placeKey(live) : null,
  );
  const pickedId = picked ? placeKey({ kind: 'pub', pub: picked }) : null;
  const chosen = places.find((p) => p.id === placeId) ?? places.find((p) => p.id === pickedId) ?? places.find((p) => p.id === 'none');

  const [rows, setRows] = useState<BeerRow[]>(() => {
    const top = beerTally(sessions)[0];
    return [{ key: 'r0', name: top?.name ?? '', n: 1, price: typeof top?.last.priceCzk === 'number' ? String(top.last.priceCzk) : '' }];
  });

  const fromClock = parseClock(from);
  const toClock = to.trim() ? parseClock(to) : null;
  const start = fromClock ? atOnDay(date, fromClock) : null;
  const end = toClock ? atOnDay(date, toClock) : null;
  // The tick is a minute behind at most; a minute of slack keeps "right now" valid.
  const latest = now + 60000;
  const err = date > today || !start || start.getTime() > latest || (!!to.trim() && (!end || end < start || end.getTime() > latest));
  const total = rows.reduce((a, r) => a + (r.name.trim() ? r.n : 0), 0);

  const save = () => {
    if (err || !start || !total || !chosen) return;
    const target = chosen.place;
    const span = end ? end.getTime() - start.getTime() : (total - 1) * 30 * 60000;
    const step = total > 1 ? span / (total - 1) : 0;
    let i = 0;
    for (const row of rows) {
      const name = row.name.trim();
      if (!name) continue;
      const price = Number(row.price);
      for (let k = 0; k < row.n; k++) {
        const at = new Date(Math.min(start.getTime() + step * i, Date.now())).toISOString();
        countDrink(
          target,
          {
            name,
            drinkType: 'beer',
            ...(price > 0 && price <= 1000 ? { priceCzk: Math.round(price) } : {}),
            ...(target.kind === 'pub' ? { volumeMl: 500 } : {}),
          },
          { at },
        );
        i += 1;
      }
    }
    useBackfillPick.getState().set(null);
    nvBack(router);
    toast({
      kind: 'saved',
      title: copy.savedTitle,
      sub: copy.savedSub(nightDayLabel(date), total, target.kind === 'pub' ? target.pub.name : copy.noPubLower),
      at: 'bottom',
    });
    if (scope === 'parta') router.push({ pathname: '/nv/vyvesit', params: { day: date } });
  };

  /** Tap walks back one day; past the backfill window it wraps to today. */
  const stepDay = () => {
    const d = dateOfDay(date);
    const prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1, 12);
    setDate(Date.now() - prev.getTime() > BACKFILL_DAYS * 86400000 ? today : dayString(prev));
  };

  return (
    <Sheet title={copy.backfillTitle} top={150} footer={<Button label={copy.backfillSave} disabled={err || !total} onPress={save} />}>
      <T s={16} c={C.text2} style={{ marginTop: -12 }}>
        {copy.backfillIntro}
      </T>
      <View style={{ gap: 8 }}>
        <View style={[s.row, { gap: 10, alignItems: 'flex-end' }]}>
          <View style={{ flex: 1.6, gap: 8 }}>
            <T s={12} w={800} c={err ? C.danger : C.muted} style={{ letterSpacing: 1 }}>
              {copy.date}
            </T>
            <Press
              onPress={stepDay}
              style={[s.row, { height: 48, borderRadius: 16, paddingHorizontal: 14, gap: 10, backgroundColor: err ? '#FF6B5E14' : C.card, borderWidth: 1, borderColor: err ? C.danger : '#FFFFFF14' }]}
            >
              <Icon name="calendar" size={16} color={err ? C.danger : C.text2} />
              <T s={15} w={600}>
                {nightDayLabel(date)}
              </T>
            </Press>
          </View>
          <Field label={copy.from} style={s.fill}>
            <Input value={from} onChangeText={setFrom} keyboardType="numbers-and-punctuation" />
          </Field>
          <Field label={copy.to} style={s.fill}>
            <Input value={to} onChangeText={setTo} placeholder={copy.optional} keyboardType="numbers-and-punctuation" />
          </Field>
        </View>
        {err ? (
          <View style={[s.row, { gap: 6 }]}>
            <Icon name="circle-alert" size={15} color={C.danger} />
            <T s={14} w={500} c={C.danger}>
              {copy.dateError}
            </T>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 12 }}>
        <T s={15} w={700} c={C.muted}>
          {copy.where}
        </T>
        <ChipWrap>
          {places.map((p) => (
            <Chip key={p.id} label={p.label} icon={chosen?.id === p.id ? undefined : p.icon} active={chosen?.id === p.id} onPress={() => setPlaceId(p.id)} />
          ))}
          <Chip label={copy.otherPub} icon="search" active={false} onPress={() => router.push({ pathname: '/nv/zmenit-misto', params: { target: 'dopsat' } })} />
        </ChipWrap>
      </View>
      <View style={{ gap: 12 }}>
        <T s={15} w={700} c={C.muted}>
          {copy.beers}
        </T>
        <View style={{ backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 16, paddingBottom: 8 }}>
          <View style={[s.row, { height: 40, borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
            <T s={11} w={800} c={C.muted} style={[s.fill, { letterSpacing: 1 }]}>
              {copy.colBeer}
            </T>
            <T s={11} w={800} c={C.muted} style={{ width: 100, textAlign: 'center', letterSpacing: 1 }}>
              {copy.colCount}
            </T>
            <T s={11} w={800} c={C.muted} style={{ width: 80, textAlign: 'right', letterSpacing: 1 }}>
              {copy.colPrice}
            </T>
          </View>
          {rows.map((r, i) => (
            <View key={r.key} style={[s.row, { height: 62, borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
              <View style={[s.fill, { gap: 2 }]}>
                <TextInput
                  value={r.name}
                  onChangeText={(name) => setRows(rows.map((x, j) => (j === i ? { ...x, name } : x)))}
                  placeholder={copy.beerName}
                  placeholderTextColor={C.muted}
                  keyboardAppearance="dark"
                  selectionColor={C.yellow}
                  style={[font(15, 700), { padding: 0 }]}
                />
                <T s={12} c={C.muted}>
                  {chosen?.place.kind === 'pub' ? servingLine({ volumeMl: 500 }, true) : copy.noPubLower}
                </T>
              </View>
              <View style={{ width: 106, alignItems: 'center' }}>
                <Counter value={r.n} onChange={(n) => setRows(rows.map((x, j) => (j === i ? { ...x, n } : x)))} />
              </View>
              <View style={[s.row, { width: 76, height: 40, borderRadius: 12, paddingHorizontal: 10, backgroundColor: C.control, borderWidth: 1, borderColor: '#FFFFFF14' }]}>
                <TextInput
                  value={r.price}
                  onChangeText={(price) => setRows(rows.map((x, j) => (j === i ? { ...x, price: price.replace(/[^0-9]/g, '') } : x)))}
                  keyboardType="number-pad"
                  keyboardAppearance="dark"
                  style={[font(14, 600), { flex: 1, textAlign: 'right', padding: 0 }]}
                />
                <T s={14} w={600} c={r.price ? C.white : C.muted}>
                  {` ${currencySign(currency)}`}
                </T>
              </View>
            </View>
          ))}
          <Press onPress={() => setRows([...rows, { key: `r${Date.now()}`, name: '', n: 1, price: '' }])} style={[s.row, { height: 56, gap: 12 }]}>
            <View style={[{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.yellow }, s.center]}>
              <Icon name="plus" size={18} color={C.black} />
            </View>
            <T s={16} w={700} c={C.yellow}>
              {copy.addBeer}
            </T>
          </Press>
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <T s={14} c={C.muted}>
          {copy.olderPrivate}
        </T>
        <View style={[s.row, { height: 42, borderRadius: 21, padding: 3, backgroundColor: '#FFFFFF12' }]}>
          {(
            [
              ['me', copy.onlyMe, 'lock'],
              ['parta', copy.parta, 'users'],
            ] as const
          ).map(([k, label, icon]) => (
            <Press key={k} onPress={() => setScope(k)} style={[s.fill, s.row, { alignSelf: 'stretch', justifyContent: 'center', gap: 6, borderRadius: 18 }, scope === k && { backgroundColor: C.white }]}>
              <Icon name={icon} size={15} color={scope === k ? C.black : C.text2} />
              <T s={15} w={scope === k ? 800 : 600} c={scope === k ? C.black : C.text2}>
                {label}
              </T>
            </Press>
          ))}
        </View>
      </View>
    </Sheet>
  );
}

function drinkActions(router: ReturnType<typeof useRouter>, day: string, startedAt: string, drink: TallyDrink, lastOne: boolean) {
  const old = t.myBeers;
  const remove = () => {
    if (deleteSessionDrink(startedAt, drink.id) && lastOne) nvBack(router);
  };
  dialog({
    title: drink.beerName,
    actions: [
      { label: old.editDrinkCancel },
      { label: t.nv.stamgast.renameDrink, kind: 'raised', onPress: () => router.push({ pathname: '/nv/opravit-pivo', params: { day, id: drink.id } }) },
      {
        label: old.deleteDrinkConfirm,
        kind: 'danger',
        onPress: () =>
          dialog({
            title: old.deleteDrinkTitle,
            body: old.deleteDrinkBody,
            actions: [{ label: old.deleteDrinkCancel }, { label: old.deleteDrinkConfirm, kind: 'danger', onPress: remove }],
          }),
      },
    ],
  });
}

/** Renames one logged drink of a past or running evening. */
export function OpravitPivoSheet() {
  const router = useRouter();
  const old = t.myBeers;
  const { day, id } = useLocalSearchParams<{ day: string; id: string }>();
  const { nights } = useAllNights();
  const session = nights.find((n) => n.day === day)?.sessions.find((x) => x.drinks.some((d) => d.id === id));
  const drink = session?.drinks.find((d) => d.id === id);
  const [name, setName] = useState(drink?.beerName ?? '');
  if (!session || !drink) return null;
  const next = name.trim();
  return (
    <Sheet title={old.editDrinkTitle} top={560} scroll={false}>
      <Input value={name} onChangeText={setName} placeholder={old.editDrinkPlaceholder} autoFocus />
      <Button
        label={old.editDrinkSave}
        disabled={!next || next === drink.beerName}
        onPress={() => {
          renameSessionDrinks(session.startedAt, [drink], next);
          nvBack(router);
        }}
      />
    </Sheet>
  );
}

export function EveningDetailScreen() {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const { id } = useLocalSearchParams<{ id: string }>();
  const { nights } = useAllNights();
  const currency = useSettingsStore((st) => st.priceCurrency);
  const night = nights.find((n) => n.day === id);
  if (!night) {
    return (
      <Screen header={<BackHeader />}>
        <T s={16} c={C.text2}>
          {copy.eveningMissing}
        </T>
      </Screen>
    );
  }
  const d = dateOfDay(night.day);
  const tempo = hourlyTempo(night);
  const peak = tempo.reduce((best, h) => (h.count > best.count ? h : best), { hour: 0, count: 0 });
  const sessionOf = new Map(night.sessions.flatMap((session) => session.drinks.map((drink) => [drink.id, session] as const)));
  const minutes = minutesBetween(night.startMs, night.endMs);
  const share = () => router.push({ pathname: '/nv/vyvesit', params: { day: night.day } });
  return (
    <Screen
      header={<BackHeader right={<IconButton icon="share" size={40} iconSize={18} label={copy.share} onPress={share} />} />}
      footer={
        <View style={[s.row, { gap: 10 }]}>
          <Button label={copy.postToVycep} icon="megaphone" flex onPress={share} />
          <Button label={copy.edit} icon="pencil" kind="raised" style={{ paddingHorizontal: 18 }} onPress={() => router.push({ pathname: '/nv/dopsat', params: { day: night.day } })} />
        </View>
      }
    >
      <View style={{ gap: 8 }}>
        <D s={44}>{copy.eveningTitle(copy.weekdaysLong[d.getDay()], d.getDate(), d.getMonth() + 1)}</D>
        <T s={15} w={500} c={C.text2}>
          {night.pubs.map((p) => p.name).join(copy.pubSep)}
        </T>
      </View>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        {(
          [
            [String(night.beers), copy.statBeers(night.beers), C.yellow],
            [night.priced ? formatPrice(night.spentCzk, currency) : copy.dash, copy.statSpent, C.white],
            [copy.durationShort(Math.floor(minutes / 60), minutes % 60), copy.statTable, C.white],
          ] as const
        ).map(([v, l, c]) => (
          <View key={l} style={{ gap: 2 }}>
            <D s={36} lh={1} c={c}>
              {v}
            </D>
            <T s={12} c={C.muted}>
              {l}
            </T>
          </View>
        ))}
      </View>
      {tempo.length > 1 ? (
        <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 14 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={15} w={700}>
              {copy.tempo}
            </T>
            <T s={13} c={C.muted}>
              {copy.tempoPeak(peak.count, peak.hour)}
            </T>
          </View>
          <View style={[s.row, { gap: 8, height: 76, alignItems: 'flex-end' }]}>
            {tempo.map((h, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                <View
                  style={{
                    width: '100%',
                    height: h.count ? Math.min(52, 26 * h.count) : 4,
                    borderRadius: 6,
                    backgroundColor: h.count && h.count === peak.count ? C.white : h.count ? '#FFFFFF4D' : C.control,
                  }}
                />
                <T s={11} c={C.muted}>
                  {copy.hourLabel(h.hour)}
                </T>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <T s={19} w={700}>
        {copy.whatPoured}
      </T>
      <Card>
        {night.drinks.map((drink, i, arr) => {
          const session = sessionOf.get(drink.id);
          const inPub = !!session && !isContextPubKey(session.pubKey);
          return (
            <Row
              key={drink.id}
              last={i === arr.length - 1}
              onPress={session ? () => drinkActions(router, night.day, session.startedAt, drink, arr.length === 1) : undefined}
              leading={
                <T s={13} c={C.muted} style={{ width: 38 }}>
                  {formatClock(new Date(drink.at))}
                </T>
              }
              title={drink.beerName}
              titleWeight={700}
              sub={[session?.pubName, servingLine(drink, inPub)].filter(Boolean).join(' · ')}
              trailing={
                typeof drink.priceCzk === 'number' ? (
                  <T s={15} w={700}>
                    {formatPrice(drink.priceCzk, currency)}
                  </T>
                ) : null
              }
            />
          );
        })}
      </Card>
    </Screen>
  );
}

function abvLabel(abv: number): string {
  return abv.toLocaleString(intlLocale, { maximumFractionDigits: 1 });
}

function BodySetup({ initial, onDone }: { initial: BodyProfile | null; onDone: () => void }) {
  const copy = t.nv.stamgast;
  const [sex, setSex] = useState<BodySex>(initial?.sex ?? 'male');
  const [age, setAge] = useState(initial ? String(initial.age) : '');
  const [height, setHeight] = useState(initial ? String(initial.heightCm) : '');
  const [weight, setWeight] = useState(initial ? String(initial.weightKg) : '');
  const valid = isBodyValueValid('age', Number(age)) && isBodyValueValid('heightCm', Number(height)) && isBodyValueValid('weightKg', Number(weight));
  const confirm = () => {
    if (!valid) return;
    const settings = useSettingsStore.getState();
    settings.setBodyProfile({ sex, age: Number(age), heightCm: Number(height), weightKg: Number(weight) });
    settings.setAlcoholEstimateHidden(false);
    onDone();
  };
  const fields = [
    [copy.age, age, setAge, copy.ageUnit, BODY_LIMITS.age],
    [copy.height, height, setHeight, copy.heightUnit, BODY_LIMITS.heightCm],
    [copy.weight, weight, setWeight, copy.weightUnit, BODY_LIMITS.weightKg],
  ] as const;
  return (
    <Sheet title={copy.odhadTitle} top={190} footer={<Button label={copy.odhadConfirm} disabled={!valid} onPress={confirm} />}>
      <T s={16} c={C.text2} lh={1.4} style={{ marginTop: -6 }}>
        {copy.odhadIntro}
      </T>
      <View style={{ gap: 12 }}>
        <T s={15} w={700} c={C.muted}>
          {copy.sex}
        </T>
        <Segmented
          height={44}
          options={[
            { key: 'male', label: copy.male },
            { key: 'female', label: copy.female },
          ]}
          value={sex}
          onChange={setSex}
        />
      </View>
      <Card>
        {fields.map(([label, value, setValue, unit, limits], i) => (
          <Row
            key={label}
            last={i === fields.length - 1}
            title={label}
            titleWeight={500}
            trailing={
              <View style={[s.row, { height: 36, borderRadius: 12, paddingHorizontal: 12, gap: 4, backgroundColor: C.control }]}>
                <TextInput
                  value={value}
                  onChangeText={(v) => setValue(v.replace(/[^0-9]/g, '').slice(0, 3))}
                  keyboardType="number-pad"
                  keyboardAppearance="dark"
                  selectionColor={C.yellow}
                  placeholder={String(Math.round((limits.min + limits.max) / 2))}
                  placeholderTextColor={C.muted}
                  style={[font(20, 800), { minWidth: 40, textAlign: 'right', padding: 0 }]}
                />
                <T s={13} c={C.muted}>
                  {unit}
                </T>
              </View>
            }
          />
        ))}
      </Card>
      <View style={[s.row, { gap: 8 }]}>
        <Icon name="lock" size={15} color={C.muted} />
        <T s={14} c={C.muted}>
          {copy.notSent}
        </T>
      </View>
      <View style={[s.row, { gap: 12, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: C.hairline, alignItems: 'flex-start' }]}>
        <Icon name="triangle-alert" size={18} color={C.text2} />
        <T s={14} c={C.text2} lh={1.4} style={s.fill}>
          {copy.odhadWarning}
        </T>
      </View>
    </Sheet>
  );
}

export function OdhadSheet() {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const profile = useSettingsStore((st) => st.bodyProfile);
  const { estimate, nowMs } = useAlcoholEstimate();
  const [editing, setEditing] = useState(false);

  if (!profile || editing) return <BodySetup initial={profile} onDone={() => setEditing(false)} />;

  const morning = !!estimate && isMorning(estimate);
  const live = !morning;
  const grouped = new Map<string, { n: number; abv: number }>();
  for (const drink of estimate?.drinks ?? []) {
    const entry = grouped.get(drink.beerName) ?? { n: 0, abv: drinkAbv(drink) };
    entry.n += 1;
    grouped.set(drink.beerName, entry);
  }
  const big = !estimate ? formatPromile(0) : morning ? formatClock(estimate.zeroAt) : formatPromile(estimate.now);
  const sexLabel = profile.sex === 'male' ? copy.male : copy.female;

  return (
    <Sheet
      title={copy.odhadTitle}
      top={live ? 130 : 330}
      footer={
        live ? (
          <Button
            label={copy.odhadOff}
            kind="raised"
            onPress={() => {
              const settings = useSettingsStore.getState();
              settings.setBodyProfile(null);
              settings.setAlcoholEstimateHidden(true);
              nvBack(router);
            }}
          />
        ) : undefined
      }
    >
      <View style={[s.row, { alignItems: 'flex-end', gap: 8, marginTop: -6 }]}>
        <D s={96} lh={0.95} c={C.yellow}>
          {big}
        </D>
        {live ? (
          <T s={34} w={700} style={{ marginBottom: 6 }}>
            ‰
          </T>
        ) : null}
      </View>
      <T s={15} c={C.text2} style={{ marginTop: -10 }}>
        {!estimate
          ? copy.odhadNothing
          : morning
            ? copy.odhadZeroAt(formatZeroAt(estimate.zeroAt, nowMs))
            : copy.odhadNow(formatPromile(estimate.low), formatPromile(estimate.high))}
      </T>
      {estimate ? (
        <Card>
          {morning ? (
            <Row last leading={<Icon name="sunrise" size={20} />} title={copy.odhadMorning(formatPromile(cautiousCeil(estimate.high)))} titleWeight={700} sub={copy.odhadMorningSub} />
          ) : (
            <>
              {estimate.rising ? (
                <Row
                  leading={<Icon name="trending-up" size={20} />}
                  title={copy.odhadRising(formatPromile(estimate.rising.promile), formatClock(estimate.rising.at))}
                  titleWeight={700}
                  sub={copy.odhadRisingSub}
                />
              ) : null}
              <Row last leading={<Icon name="moon" size={20} />} title={copy.odhadZero(formatZeroAt(estimate.zeroAt, nowMs))} titleWeight={700} sub={copy.odhadZeroSub} />
            </>
          )}
        </Card>
      ) : null}
      <T s={15} w={700} c={C.muted}>
        {copy.odhadCounts}
      </T>
      <View>
        {[...grouped.entries()].map(([name, g]) => (
          <Row key={name} title={copy.odhadDrink(g.n, name)} titleWeight={700} sub={copy.odhadAbv(abvLabel(g.abv))} />
        ))}
        <Row
          last
          title={copy.odhadProfile(sexLabel, profile.age, profile.heightCm, profile.weightKg)}
          titleWeight={700}
          sub={copy.odhadProfileSub}
          trailing={
            <Press onPress={() => setEditing(true)} style={[s.row, { gap: 4 }]}>
              <T s={14} w={700}>
                {copy.edit}
              </T>
              <Icon name="chevron-right" size={14} color={C.text2} />
            </Press>
          }
        />
      </View>
      <T s={13} c={C.muted} lh={1.4}>
        {copy.odhadFooter}
      </T>
    </Sheet>
  );
}

