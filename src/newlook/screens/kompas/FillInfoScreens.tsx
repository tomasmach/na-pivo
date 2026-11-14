import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';

import { generateUuidV4 } from '@/data/account';
import { AMENITIES, type AmenityKey } from '@/data/amenities';
import { buildCommunityEntry } from '@/data/communityClient';
import {
  DAY_KEYS,
  computeOpenState,
  emptyWeeklyHours,
  BEER_VOLUME_MAX_ML,
  BEER_VOLUME_MIN_ML,
  historicalBeersAfterMenuReplacement,
  isAllowedBeerVolume,
  isSameBeerIdentity,
  normalizeBeerName,
  mergeBeerIntoMenu,
  normalizeEditableHoursInterval,
  parseOsmOpeningHoursToWeeklyHours,
  type CommunityBeer,
  type DayKey,
  type HoursInterval,
  type WeeklyHours,
} from '@/data/communityHours';
import { enqueuePubCommunity } from '@/data/communityQueue';
import { formatVolume, t } from '@/i18n';
import { dayKeyOf, pubWallClock } from '@/pubPage/pubPageModel';
import { useAccountStore } from '@/stores/accountStore';
import { isHoursOverrideCurrent, useCommunityStore } from '@/stores/communityStore';
import { selectPubVotes, usePubAmenitiesStore } from '@/stores/pubAmenitiesStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { formatPrice, getCurrencyRate, parsePriceInputToCzk } from '@/utils/currency';

import { BackHeader, Screen } from '../../components/chrome';
import { Field, FieldLabel, Input, PageTitle } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { T, Button, Card, Chip, ChipWrap, Dot, IconButton, Press, Row, Segmented, Toggle } from '../../components/ui';
import { NO_VALUE } from '../../format';
import { dialog, toast } from '../../ui/store';
import { C, s } from '../../theme';
import { useKompasState } from './state';
import { usePubDetails, useParamPub } from './usePubPage';

const L = () => t.nv.kompas;
const MAX_BEERS = 12;
const VOLUME_PRESETS = [300, 400, 500];
const DEFAULT_VOLUME_ML = 500;
const SMALL_VOLUME_ML = 300;

/** A beer being added (`index` null) or changed in the editor. `volume` null keeps a volume nobody filled in. */
type BeerDraft = {
  index: number | null;
  name: string;
  price: string;
  volume: number | 'custom' | null;
  customVolume: string;
  customUnit: VolumeUnit;
};
type VolumeUnit = 'l' | 'ml';

function newBeerDraft(): BeerDraft {
  return { index: null, name: '', price: '', volume: DEFAULT_VOLUME_ML, customVolume: '', customUnit: 'l' };
}

/** "0,47" or "0.47" in litres, "470" in millilitres; NaN when it is not a number. */
function customVolumeMl(text: string, unit: VolumeUnit): number {
  const value = text.trim() ? Number(text.trim().replace(',', '.')) : NaN;
  return Math.round(unit === 'l' ? value * 1000 : value);
}

function beerDraftOf(beer: CommunityBeer, index: number, currency: string): BeerDraft {
  const rate = getCurrencyRate(currency) ?? 1;
  const preset = beer.volumeMl === undefined || VOLUME_PRESETS.includes(beer.volumeMl);
  return {
    index,
    name: beer.name,
    price: beer.priceCzk ? String(Math.round((beer.priceCzk / rate) * 100) / 100) : '',
    volume: preset ? (beer.volumeMl ?? null) : 'custom',
    customVolume: preset ? '' : formatVolume(beer.volumeMl!).replace(/ l$/, ''),
    customUnit: 'l',
  };
}

/** The beer a draft describes, or null with the reason it cannot be saved yet. */
function readBeerDraft(draft: BeerDraft, currency: string): { beer: CommunityBeer | null; badPrice: boolean; badVolume: boolean } {
  const name = draft.name.trim().slice(0, 80);
  const priceCzk = draft.price.trim() ? parsePriceInputToCzk(draft.price, currency) : undefined;
  const volumeMl = draft.volume === 'custom' ? customVolumeMl(draft.customVolume, draft.customUnit) : (draft.volume ?? undefined);
  const badPrice = priceCzk === null;
  const badVolume = volumeMl !== undefined && !isAllowedBeerVolume(volumeMl);
  if (!name || badPrice || badVolume) return { beer: null, badPrice, badVolume: badVolume && draft.customVolume.trim() !== '' };
  return { beer: { name, ...(volumeMl !== undefined ? { volumeMl } : {}), ...(priceCzk != null ? { priceCzk } : {}) }, badPrice, badVolume };
}

function intervalsLabel(intervals: HoursInterval[]): string {
  return intervals.length ? intervals.map(([a, b]) => `${a}–${b}`).join(', ') : L().closed;
}

function sameHours(a: WeeklyHours, b: WeeklyHours): boolean {
  return DAY_KEYS.every((d) => JSON.stringify(a[d]) === JSON.stringify(b[d]));
}

export function DoplnitInfoScreen() {
  const router = useRouter();
  const { tab: initialTab } = useLocalSearchParams<{ tab?: string }>();
  const { key, pub: opened } = useParamPub();
  const details = usePubDetails(opened, key);
  const { pub } = details;
  const currency = useSettingsStore((st) => st.priceCurrency);
  const override = useCommunityStore((st) => (key ? st.overrides[key] : undefined));
  const setOverride = useCommunityStore((st) => st.setOverride);
  const myVotes = usePubAmenitiesStore(selectPubVotes(details.identityKey));
  const setVote = usePubAmenitiesStore((st) => st.setVote);
  const [tab, setTab] = useState<'oteviracka' | 'piva' | 'vybaveni'>(initialTab === 'piva' ? 'piva' : 'oteviracka');

  const startHours = useMemo<WeeklyHours>(
    () =>
      (isHoursOverrideCurrent(override, pub?.hoursUpdatedAt) ? override?.hours : undefined) ??
      pub?.communityHours ??
      parseOsmOpeningHoursToWeeklyHours(pub?.openingHours) ??
      emptyWeeklyHours(),
    [override, pub?.hoursUpdatedAt, pub?.communityHours, pub?.openingHours],
  );
  const draft = useKompasState((st) => (st.hoursDraft?.key === key ? st.hoursDraft.hours : null));
  const hours = draft ?? startHours;
  // The draft starts once the server answered, so later answers never wipe the user's edits.
  useEffect(() => {
    if (!details.hoursLoaded || useKompasState.getState().hoursDraft?.key === key) return;
    useKompasState.getState().set({ hoursDraft: { key, hours: startHours } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [details.hoursLoaded, key]);
  useEffect(() => () => useKompasState.getState().set({ hoursDraft: null, menuScan: null }), []);
  const setHours = (next: WeeklyHours) => useKompasState.getState().set({ hoursDraft: { key, hours: next } });

  const [rotating, setRotating] = useState<boolean | null>(null);
  const [beers, setBeers] = useState<CommunityBeer[] | null>(null);
  const [form, setForm] = useState<BeerDraft | null>(null);
  const currentBeers = details.taps;
  const shownBeers = beers ?? currentBeers;
  const menuRotates = rotating ?? pub?.beerMenuRotates ?? false;
  const hoursTouched = !sameHours(hours, startHours);
  const beersTouched = beers !== null || rotating !== null;
  const history = (pub?.historicalBeers ?? []).filter((h) => !shownBeers.some((b) => isSameBeerIdentity(b, h))).slice(0, 6);

  const normalized = useMemo<WeeklyHours | null>(() => {
    const next = emptyWeeklyHours();
    for (const day of DAY_KEYS) {
      for (const interval of hours[day]) {
        const n = normalizeEditableHoursInterval(interval);
        if (!n) return null;
        next[day].push(n);
      }
    }
    return next;
  }, [hours]);
  const hoursKnown = DAY_KEYS.some((d) => hours[d].length > 0);
  const open = normalized && hoursKnown ? computeOpenState(normalized) : null;
  const nextAt = open?.nextChange?.slice(11, 16) ?? null;
  const today = dayKeyOf(pubWallClock(new Date()));

  if (!pub) return null;

  const addBeer = (beer: CommunityBeer) => {
    setBeers([...shownBeers.filter((b) => !isSameBeerIdentity(b, beer)), beer].slice(0, MAX_BEERS));
  };
  const formBeer = form ? readBeerDraft(form, currency).beer : null;
  // An add form opened and left empty is not a draft, so it must not block saving the rest.
  const blankAdd = form?.index === null && !form.name.trim() && !form.price.trim();
  const withForm = (): CommunityBeer[] => {
    if (!form || !formBeer) return shownBeers;
    if (form.index === null) return [...shownBeers.filter((b) => !isSameBeerIdentity(b, formBeer)), formBeer].slice(0, MAX_BEERS);
    // The changed beer keeps its place and takes over another row it now matches.
    return shownBeers.map((b, i) => (i === form.index ? formBeer : b)).filter((b, i) => i === form.index || !isSameBeerIdentity(b, formBeer));
  };
  const saveForm = () => {
    if (!formBeer) return;
    setBeers(withForm());
    setForm(null);
  };
  const editing = form?.index != null ? shownBeers[form.index] : undefined;
  const canAddSmall =
    !!editing &&
    shownBeers.length < MAX_BEERS &&
    editing.volumeMl !== SMALL_VOLUME_ML &&
    !shownBeers.some((b) => b.volumeMl === SMALL_VOLUME_ML && normalizeBeerName(b.name) === normalizeBeerName(editing.name));
  const addSmall = () => {
    if (!editing || form?.index == null) return;
    const at = form.index + 1;
    setBeers([...shownBeers.slice(0, at), { name: editing.name, volumeMl: SMALL_VOLUME_ML }, ...shownBeers.slice(at)]);
    setForm(null);
  };
  const removeBeer = (beer: CommunityBeer) =>
    dialog({
      title: L().removeBeer,
      body: beer.name,
      actions: [
        { label: L().reportBack },
        {
          label: L().removeBeer,
          kind: 'danger',
          onPress: () => {
            setBeers(shownBeers.filter((b) => b !== beer));
            setForm(null);
          },
        },
      ],
    });

  const scanMenu = () => {
    const add = (scanned: CommunityBeer[]) => {
      submit(undefined, scanned.reduce<CommunityBeer[]>((list, beer) => mergeBeerIntoMenu(list, beer), shownBeers));
      setBeers(null);
      toast({ kind: 'saved', title: t.nv.stamgast.boardDone, icon: 'list-plus' });
    };
    const open = (source: 'camera' | 'library') => {
      useKompasState.getState().set({ menuScan: { known: shownBeers, add } });
      router.push({ pathname: '/nv/vyfot', params: { mode: 'listek', source } });
    };
    dialog({
      title: t.contribute.scanMenu.sheetTitle,
      actions: [
        { label: t.contribute.scanMenu.camera, kind: 'primary', onPress: () => open('camera') },
        { label: t.contribute.scanMenu.library, kind: 'raised', onPress: () => open('library') },
      ],
    });
  };

  const save = () => {
    const sendHours = hoursTouched && normalized ? normalized : undefined;
    // A beer still open in the form counts as written, so the big Save never drops it.
    const sendBeers = formBeer ? withForm() : beersTouched ? shownBeers : undefined;
    if (sendHours || sendBeers) {
      submit(sendHours, sendBeers);
      toast({ kind: 'saved', title: L().savedThanks, icon: 'map-pin-plus' });
    }
    nvBack(router);
  };

  function submit(sendHours: WeeklyHours | undefined, sendBeers: CommunityBeer[] | undefined) {
    if (!pub) return;
    const entry = buildCommunityEntry(
      {
        externalId: pub.id || null,
        name: pub.name,
        lat: pub.lat,
        lng: pub.lng,
        city: pub.city,
        hours: sendHours,
        hoursBase: startHours,
        beers: sendBeers,
        beersBase: currentBeers,
        beerMenuRotates: sendBeers && rotating !== null ? rotating : undefined,
      },
      generateUuidV4(),
    );
    setOverride(key, {
      hours: sendHours,
      beers: sendBeers,
      historicalBeers: sendBeers ? historicalBeersAfterMenuReplacement(currentBeers, sendBeers, pub.historicalBeers ?? []) : undefined,
      beerMenuRotates: sendBeers ? menuRotates : undefined,
    });
    void enqueuePubCommunity(entry).then((response) => {
      if (!response) return;
      const m = response.mapper;
      if (m) {
        useAccountStore.getState().applyMapperSnapshot({
          xp: m.xp,
          level: m.level,
          title: m.title,
          xpIntoLevel: m.xp_into_level,
          xpForNextLevel: m.xp_for_next_level,
          distinctMappedPubs: m.distinct_mapped_pubs,
          amenityVotesCount: m.amenity_votes_count,
          firstMapperCount: m.first_mapper_count,
          completedPubsCount: m.completed_pubs_count,
        });
      }
      if (response.xpAwarded > 0) toast({ kind: 'xp', title: L().xpGained(response.xpAwarded), xp: response.xpAwarded });
    });
  }

  return (
    <Screen
      header={<BackHeader />}
      footer={
        tab === 'vybaveni' ? undefined : (
          <View style={{ gap: 14 }}>
            <View style={[s.row, { justifyContent: 'center', gap: 6 }]}>
              <Icon name="users" size={14} color={C.muted} />
              <T s={13} c={C.muted}>
                {L().seenByOthers}
              </T>
            </View>
            <Button label={L().save} onPress={save} disabled={(hoursTouched && !normalized) || (!!form && !formBeer && !blankAdd)} />
          </View>
        )
      }
      gap={16}
    >
      <PageTitle kicker={pub.name} title={L().fillTitle} />
      <Segmented
        height={38}
        options={[
          { key: 'oteviracka', label: L().tabHours },
          { key: 'piva', label: L().tabBeers },
          { key: 'vybaveni', label: L().tabAmenities },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'oteviracka' ? (
        <>
          {open ? (
            <View style={[s.row, { gap: 6 }]}>
              <Dot color={open.isOpenNow ? C.open : C.muted} />
              <T s={15} w={600} c={open.isOpenNow ? C.open : C.muted}>
                {open.isOpenNow
                  ? nextAt
                    ? L().openNowUntil(nextAt)
                    : L().openNowNoEnd
                  : nextAt
                    ? L().closedNowUntil(nextAt)
                    : L().closedNowNoEnd}
              </T>
            </View>
          ) : hoursKnown ? null : (
            <View style={[s.row, { gap: 6 }]}>
              <Dot color={C.muted} />
              <T s={15} w={600} c={C.muted}>
                {L().hoursUnknown}
              </T>
            </View>
          )}
          <Card>
            {DAY_KEYS.map((day, i) => (
              <Press
                key={day}
                onPress={() => {
                  if (!draft) setHours(hours);
                  router.push({ pathname: '/nv/oteviracka-den', params: { day } });
                }}
              >
                <View style={[s.row, { height: 48, gap: 10 }, i < DAY_KEYS.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
                  <T s={16} w={day === today ? 800 : 500} style={s.fill}>
                    {L().days[day]}
                  </T>
                  <T s={15} w={hours[day].length ? 700 : 500} c={hours[day].length ? C.white : C.muted}>
                    {hoursKnown ? intervalsLabel(hours[day]) : NO_VALUE}
                  </T>
                  <Icon name="chevron-right" size={16} color={C.muted} />
                </View>
              </Press>
            ))}
          </Card>
          <View style={s.row}>
            <Chip
              label={L().sameAllWeek}
              icon="copy"
              onPress={() => {
                const source = DAY_KEYS.find((d) => hours[d].length > 0);
                if (!source) return;
                const next = emptyWeeklyHours();
                for (const d of DAY_KEYS) next[d] = hours[source].map((x) => [...x] as HoursInterval);
                setHours(next);
                toast({ kind: 'saved', title: L().copiedWeek(L().days[source]), icon: 'copy' });
              }}
            />
          </View>
        </>
      ) : tab === 'piva' ? (
        <>
          <FieldLabel>{L().tapsHow}</FieldLabel>
          <View style={[s.row, { gap: 10 }]}>
            <Chip label={L().tapsFixed} active={!menuRotates} onPress={() => setRotating(false)} style={{ flex: 1, justifyContent: 'center', height: 42, borderRadius: 21 }} />
            <Chip label={L().tapsRotating} icon="refresh-cw" active={menuRotates} onPress={() => setRotating(true)} style={{ flex: 1, justifyContent: 'center', height: 42, borderRadius: 21 }} />
          </View>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={19} w={700}>
              {L().tapsTitle}
            </T>
            <Press onPress={scanMenu} disabled={!details.hoursLoaded} style={[s.row, { gap: 6, opacity: details.hoursLoaded ? 1 : 0.4 }]}>
              <Icon name="camera" size={16} color={C.yellow} />
              <T s={15} w={600} c={C.yellow}>
                {L().snapMenu}
              </T>
            </Press>
          </View>
          <Card>
            {shownBeers.map((b, i) =>
              form?.index === i ? (
                <BeerForm
                  key={`${b.name}-${b.volumeMl ?? ''}`}
                  draft={form}
                  currency={currency}
                  onChange={setForm}
                  onSave={saveForm}
                  onCancel={() => setForm(null)}
                  onRemove={() => removeBeer(b)}
                  onAddSmall={canAddSmall ? addSmall : undefined}
                />
              ) : (
                <Row
                  key={`${b.name}-${b.volumeMl ?? ''}`}
                  title={b.name}
                  sub={b.volumeMl ? formatVolume(b.volumeMl) : undefined}
                  onPress={() => setForm(beerDraftOf(b, i, currency))}
                  trailing={
                    b.priceCzk ? (
                      <T s={15} w={700}>
                        {formatPrice(b.priceCzk, currency)}
                      </T>
                    ) : (
                      <T s={15} c={C.muted}>
                        {L().priceMissing}
                      </T>
                    )
                  }
                />
              ),
            )}
            {form?.index === null ? (
              <BeerForm draft={form} currency={currency} onChange={setForm} onSave={saveForm} />
            ) : shownBeers.length < MAX_BEERS ? (
              <Press onPress={() => setForm(newBeerDraft())} style={[s.row, { height: 56, gap: 12 }]}>
                <View style={[{ width: 32, height: 32, borderRadius: 16, backgroundColor: C.yellow }, s.center]}>
                  <Icon name="plus" size={18} color={C.black} />
                </View>
                <T s={16} w={700} c={C.yellow}>
                  {L().addBeer}
                </T>
              </Press>
            ) : null}
          </Card>
          <T s={13} c={C.muted} style={{ marginTop: -6 }}>
            {L().onlyCurrent}
          </T>
          {history.length ? (
            <>
              <FieldLabel>{L().previously}</FieldLabel>
              <ChipWrap>
                {history.map((h) => (
                  <Chip key={`${h.name}-${h.volumeMl ?? ''}`} label={h.name} icon="plus" onPress={() => addBeer(h)} />
                ))}
              </ChipWrap>
            </>
          ) : null}
        </>
      ) : (
        <>
          <T s={13} c={C.muted}>
            {L().amenitiesHint}
          </T>
          <Card>
            {AMENITIES.map((a, i) => {
              const vote = myVotes?.[a.key as AmenityKey]?.vote ?? null;
              return (
                <Row
                  key={a.key}
                  last={i === AMENITIES.length - 1}
                  title={a.label}
                  trailing={
                    <View style={[s.row, { gap: 6 }]}>
                      <Chip label={L().amenityYes} active={vote === 'yes'} onPress={() => setVote(details.identityKey, a.key, vote === 'yes' ? null : 'yes')} />
                      <Chip label={L().amenityNo} active={vote === 'no'} onPress={() => setVote(details.identityKey, a.key, vote === 'no' ? null : 'no')} />
                    </View>
                  }
                />
              );
            })}
          </Card>
        </>
      )}
      {tab === 'piva' && !shownBeers.length && !form ? <Button label={L().firstBeer} kind="raised" onPress={() => setForm(newBeerDraft())} /> : null}
    </Screen>
  );
}

function BeerForm({
  draft,
  currency,
  onChange,
  onSave,
  onCancel,
  onRemove,
  onAddSmall,
}: {
  draft: BeerDraft;
  currency: string;
  onChange: (draft: BeerDraft) => void;
  onSave: () => void;
  onCancel?: () => void;
  onRemove?: () => void;
  onAddSmall?: () => void;
}) {
  const { beer, badPrice, badVolume } = readBeerDraft(draft, currency);
  const set = (patch: Partial<BeerDraft>) => onChange({ ...draft, ...patch });
  const adding = draft.index === null;
  return (
    <View style={[{ gap: 12, paddingVertical: 12 }, !adding && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
      <View style={[s.row, { gap: 10, alignItems: 'flex-end' }]}>
        <Field label={L().beerName} style={s.fill}>
          <Input value={draft.name} onChangeText={(name) => set({ name })} autoFocus={adding} maxLength={80} returnKeyType="next" />
        </Field>
        <Field label={L().beerPriceLabel} style={{ width: 92 }}>
          <Input value={draft.price} onChangeText={(price) => set({ price })} keyboardType="decimal-pad" autoFocus={!adding} onSubmitEditing={onSave} />
        </Field>
      </View>
      <ChipWrap>
        {VOLUME_PRESETS.map((ml) => (
          <Chip key={ml} label={formatVolume(ml)} active={draft.volume === ml} onPress={() => set({ volume: ml })} />
        ))}
        <Chip label={L().volumeOther} active={draft.volume === 'custom'} onPress={() => set({ volume: 'custom' })} />
      </ChipWrap>
      {draft.volume === 'custom' ? (
        <View style={[s.row, { gap: 10, alignItems: 'flex-end' }]}>
          <Field label={L().volumeCustomLabel} style={{ width: 140 }}>
            <Input
              value={draft.customVolume}
              onChangeText={(v) => set({ customVolume: v.replace(/[^0-9.,]/g, '') })}
              keyboardType="decimal-pad"
              maxLength={6}
              autoFocus
            />
          </Field>
          <Segmented
            height={48}
            style={{ width: 120 }}
            options={[
              { key: 'l', label: 'l' },
              { key: 'ml', label: 'ml' },
            ]}
            value={draft.customUnit}
            onChange={(customUnit) => set({ customUnit })}
          />
        </View>
      ) : null}
      {badPrice || badVolume ? (
        <T s={13} c={C.danger}>
          {badPrice ? L().invalidPrice : L().invalidVolume(formatVolume(BEER_VOLUME_MIN_ML), formatVolume(BEER_VOLUME_MAX_ML))}
        </T>
      ) : null}
      {adding ? (
        <Button label={L().addBeer} icon="plus" kind="raised" height={44} disabled={!beer} onPress={onSave} />
      ) : (
        <>
          <View style={[s.row, { gap: 10 }]}>
            <Button label={L().cancel} kind="raised" height={44} flex onPress={onCancel} />
            <Button label={L().done} kind="raised" height={44} flex disabled={!beer} onPress={onSave} />
            <IconButton
              icon="trash-2"
              size={44}
              iconSize={18}
              color={C.muted}
              bg="transparent"
              style={{ borderWidth: 1, borderColor: C.hairline }}
              label={L().removeBeer}
              onPress={onRemove}
            />
          </View>
          {onAddSmall ? (
            <View style={s.row}>
              <Chip label={L().addSmallBeer(formatVolume(SMALL_VOLUME_ML))} icon="plus" onPress={onAddSmall} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

export function OtevirackaDenSheet() {
  const router = useRouter();
  const { day: dayParam } = useLocalSearchParams<{ day?: string }>();
  const day: DayKey = (DAY_KEYS as readonly string[]).includes(dayParam ?? '') ? (dayParam as DayKey) : 'fr';
  const draft = useKompasState((st) => st.hoursDraft);
  const [intervals, setIntervals] = useState<HoursInterval[]>(() => draft?.hours[day].map((x) => [...x] as HoursInterval) ?? []);
  const closed = intervals.length === 0;
  const valid = intervals.every((x) => normalizeEditableHoursInterval(x) !== null);
  const setAt = (i: number, which: 0 | 1, value: string) =>
    setIntervals(intervals.map((x, j) => (j === i ? ((which === 0 ? [value, x[1]] : [x[0], value]) as HoursInterval) : x)));
  const done = () => {
    if (!draft || !valid) return;
    const next = { ...draft.hours, [day]: intervals.map((x) => normalizeEditableHoursInterval(x) ?? x) };
    useKompasState.getState().set({ hoursDraft: { key: draft.key, hours: next } });
    nvBack(router);
  };
  return (
    <Sheet title={L().dayTitle(L().daysLower[day])} scroll={false}>
      {intervals.map((x, i) => (
        <View key={i} style={[s.row, { gap: 10, alignItems: 'flex-end' }]}>
          <Field label={L().from} style={s.fill}>
            <Input value={x[0]} onChangeText={(v) => setAt(i, 0, v)} keyboardType="numbers-and-punctuation" />
          </Field>
          <Field label={L().to} style={s.fill}>
            <Input value={x[1]} onChangeText={(v) => setAt(i, 1, v)} keyboardType="numbers-and-punctuation" />
          </Field>
          <IconButton
            icon="trash-2"
            size={48}
            iconSize={18}
            color={C.muted}
            bg="transparent"
            style={{ borderWidth: 1, borderColor: C.hairline }}
            label={L().deleteTime}
            onPress={() => setIntervals(intervals.filter((_, j) => j !== i))}
          />
        </View>
      ))}
      {!valid ? (
        <T s={13} c={C.danger}>
          {L().invalidTime}
        </T>
      ) : null}
      {intervals.length < 3 ? (
        <View style={s.row}>
          <Chip label={L().addTime} icon="plus" onPress={() => setIntervals([...intervals, closed ? ['11:00', '23:00'] : ['17:00', '23:00']])} />
        </View>
      ) : null}
      <Card>
        <Row last title={L().closed} titleWeight={500} trailing={<Toggle value={closed} onChange={(v) => setIntervals(v ? [] : [['11:00', '23:00']])} />} />
      </Card>
      <Button label={L().done} onPress={done} disabled={!valid} />
    </Sheet>
  );
}
