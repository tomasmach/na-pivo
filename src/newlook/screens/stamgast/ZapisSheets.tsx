import React, { useEffect, useMemo, useState } from 'react';
import { Image, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { placeKey, type CountPlace } from '@/counter/countDrink';
import { normalizeBeerName, type CommunityBeer } from '@/data/communityHours';
import { scanBeerLabel, type ScannedLabel } from '@/data/beerLabelScanClient';
import { fetchNearbyBeers, type NearbyBeer } from '@/data/beersNearbyClient';
import { suggestBeerBrands, type BeerBrandSuggestion } from '@/data/beerSuggestionsClient';
import { pickAndPrepareMenuPhoto } from '@/data/menuPhotoPicker';
import { scanMenuPhoto } from '@/data/menuScanClient';
import type { Pub } from '@/data/pubs';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { isContextPubKey, type DrinkType, type ServingType } from '@/drinks/drinkTypes';
import { formatVolume, intlLocale, t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTallyStore } from '@/stores/tallyStore';
import { formatPrice } from '@/utils/currency';

import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Input } from '../../components/forms';
import { Button, Chip, D, IconButton, Kicker, Press, Row, Segmented, Spinner, T, Tile } from '../../components/ui';
import { C, SCREEN_X, font, s } from '../../theme';
import { toast } from '../../ui/store';
import { distanceLabel } from '../kompas/format';
import { useKompasState } from '../kompas/state';
import { myRating } from '../piva/model';
import { useMyRatings } from '../piva/useMyRatings';
import { logDrink } from './counterActions';
import { beerTally, drinkTally } from './eveningData';
import { OUTSIDE_ICON, useBackfillPick, useCountPlace, useNvPlaceStore } from './placeStore';
import { addBeersToMenu, usePubMenu } from './pubMenu';

type Kind = 'pivo' | 'vino' | 'nealko' | 'panak';
const OUTSIDE_CHOICES = ['private', 'outdoors'] as const;
type HomeServing = 'lahvac' | 'plech' | 'jinak';

const KIND_TYPE: Record<Kind, DrinkType> = { pivo: 'beer', vino: 'wine', nealko: 'soft_drink', panak: 'shot' };
// Same servings as the default tiles, so a typed drink still counts in the alcohol estimate.
const CUSTOM_VOLUME_ML: Record<Exclude<Kind, 'pivo'>, number> = { vino: 200, nealko: 500, panak: 40 };
const HOME_SERVING: Record<HomeServing, { servingType: ServingType; volumeMl?: number }> = {
  lahvac: { servingType: 'bottle', volumeMl: 500 },
  plech: { servingType: 'can', volumeMl: 500 },
  jinak: { servingType: 'plastic_bottle' },
};

type Option = {
  id: string;
  name: string;
  meta: string;
  badge?: string;
  fresh?: boolean;
  sizes: CommunityBeer[];
  servingType?: ServingType;
};

function useAllSessions() {
  const current = useTallyStore((st) => st.current);
  const history = useTallyStore((st) => st.history);
  return useMemo(() => (current ? [current, ...history] : history), [current, history]);
}

function BeerTile({ o, on, rating, onPress }: { o: Option; on: boolean; rating: number | null; onPress: () => void }) {
  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityState={{ selected: on }}
      accessibilityLabel={[o.name, rating ? t.nv.stamgast.myRatingA11y(rating) : null, o.badge, o.meta].filter(Boolean).join(', ')}
      style={{
        flex: 1,
        height: 104,
        padding: 14,
        borderRadius: 20,
        justifyContent: 'space-between',
        backgroundColor: on ? C.white : C.card,
        borderWidth: 1,
        borderColor: on ? C.white : C.hairline,
      }}
    >
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <Icon name="beer" size={20} color={on ? C.black : C.yellow} />
        <View style={[s.row, { gap: 6 }]}>
          {o.badge ? (
            <View style={{ paddingHorizontal: 8, height: 22, borderRadius: 11, justifyContent: 'center', backgroundColor: on ? '#0A0A0A14' : C.control }}>
              <T s={11} w={700} c={on ? C.black : C.text2}>
                {o.badge}
              </T>
            </View>
          ) : null}
          {on ? (
            <View style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: C.black }, s.center]}>
              <Icon name="check" size={14} color={C.white} />
            </View>
          ) : null}
        </View>
      </View>
      <View style={{ gap: 4 }}>
        <T s={16} w={700} c={on ? C.black : C.white} numberOfLines={1}>
          {o.name}
        </T>
        <View style={[s.row, { gap: 6 }]}>
          {rating ? (
            <View style={[s.row, { height: 22, borderRadius: 11, paddingHorizontal: 7, gap: 3, backgroundColor: on ? '#0A0A0A14' : '#FFFFFF14' }]}>
              <Icon name="star" size={11} color={on ? C.black : C.yellow} fill={on ? C.black : C.yellow} />
              <T s={12} w={800} c={on ? C.black : C.white}>
                {String(rating)}
              </T>
            </View>
          ) : null}
          <T s={12} w={500} c={on ? '#0A0A0A99' : C.muted} numberOfLines={1} style={{ flexShrink: 1 }}>
            {o.meta}
          </T>
        </View>
      </View>
    </Press>
  );
}

function AddTile({ label, sub, on, onPress }: { label: string; sub: string; on?: boolean; onPress: () => void }) {
  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityState={{ selected: !!on }}
      style={{ flex: 1, height: 104, padding: 14, borderRadius: 20, justifyContent: 'space-between', borderWidth: 1.5, borderColor: on ? C.white : C.lineStrong }}
    >
      <View style={[{ width: 26, height: 26, borderRadius: 13, backgroundColor: C.yellow }, s.center]}>
        <Icon name="plus" size={16} color={C.black} />
      </View>
      <View style={{ gap: 2 }}>
        <T s={16} w={700}>
          {label}
        </T>
        <T s={12} c={C.muted}>
          {sub}
        </T>
      </View>
    </Press>
  );
}

function SizeCard({ title, sub, on, onPress, icon }: { title: string; sub: string; on: boolean; onPress: () => void; icon?: boolean }) {
  return (
    <Press haptic onPress={onPress} style={[{ flex: 1, height: 56, borderRadius: 16, backgroundColor: on ? C.white : C.card, borderWidth: 1, borderColor: on ? C.white : C.hairline }, s.center]}>
      <T s={16} w={800} c={on ? C.black : C.white}>
        {title}
      </T>
      <View style={[s.row, { gap: 4 }]}>
        <T s={12} c={on ? '#0A0A0A99' : C.muted}>
          {sub}
        </T>
        {icon ? <Icon name="pencil" size={11} color={on ? '#0A0A0A99' : C.muted} /> : null}
      </View>
    </Press>
  );
}

function groupMenu(menu: readonly CommunityBeer[]): Map<string, CommunityBeer[]> {
  const groups = new Map<string, CommunityBeer[]>();
  for (const beer of menu) {
    const key = normalizeBeerName(beer.name);
    groups.set(key, [...(groups.get(key) ?? []), beer].sort((a, b) => (a.volumeMl ?? 9999) - (b.volumeMl ?? 9999)));
  }
  return groups;
}

export function ZapisSheet() {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const params = useLocalSearchParams<{ added?: string; price?: string; volume?: string }>();
  const place = useCountPlace();
  const pub = place?.kind === 'pub' ? place.pub : null;
  const home = place?.kind === 'outside';
  const currency = useSettingsStore((st) => st.priceCurrency);
  const sessions = useAllSessions();
  const menu = usePubMenu(pub);
  const ratings = useMyRatings();
  const money = (czk: number) => formatPrice(czk, currency);
  const [kind, setKind] = useState<Kind>('pivo');
  const [homeServing, setHomeServing] = useState<HomeServing>('lahvac');
  const [volume, setVolume] = useState<number | null>(null);
  const [typedPrice, setTypedPrice] = useState('');
  /** A wine, soft drink or shot typed by hand; null while a tile is picked. */
  const [custom, setCustom] = useState<string | null>(null);
  const customName = custom?.trim() ?? '';

  const options = useMemo<Option[]>(() => {
    const key = place ? placeKey(place) : '';
    const added = params.added?.trim();
    const addedSize: CommunityBeer | null = added
      ? {
          name: added,
          ...(Number(params.price) > 0 ? { priceCzk: Number(params.price) } : {}),
          ...(Number(params.volume) > 0 ? { volumeMl: Number(params.volume) } : {}),
        }
      : null;
    if (kind !== 'pivo') {
      const defaults: Record<Exclude<Kind, 'pivo'>, [string, number][]> = {
        vino: [[copy.wineWhite, 200], [copy.wineRed, 200]],
        nealko: [[copy.softBirell, 500], [copy.softKofola, 500]],
        panak: [[copy.shotFernet, 40], [copy.shotSlivovice, 40]],
      };
      const logged = drinkTally(sessions, KIND_TYPE[kind]).map<Option>((d) => ({
        id: normalizeBeerName(d.name),
        name: d.name,
        meta: [d.last.volumeMl ? formatVolume(d.last.volumeMl) : null, typeof d.last.priceCzk === 'number' ? money(d.last.priceCzk) : null].filter(Boolean).join(' · '),
        sizes: [{ name: d.name, ...(d.last.volumeMl ? { volumeMl: d.last.volumeMl } : {}), ...(typeof d.last.priceCzk === 'number' && !home ? { priceCzk: d.last.priceCzk } : {}) }],
      }));
      const fallback = defaults[kind]
        .filter(([name]) => !logged.some((o) => o.id === normalizeBeerName(name)))
        .map<Option>(([name, ml]) => ({ id: normalizeBeerName(name), name, meta: formatVolume(ml), sizes: [{ name, volumeMl: ml }] }));
      return [...logged, ...fallback].slice(0, 5);
    }
    if (home) {
      const list = beerTally(sessions, (_d, session) => isContextPubKey(session.pubKey)).slice(0, 5).map<Option>((b) => ({
        id: normalizeBeerName(b.name),
        name: b.name,
        meta: copy.timesLogged(t.counter.servingTypeLabel(b.last.servingType ?? 'bottle').toLowerCase(), b.count),
        sizes: [{ name: b.name }],
        servingType: b.last.servingType,
      }));
      if (addedSize && !list.some((o) => o.id === normalizeBeerName(addedSize.name))) {
        list.push({ id: normalizeBeerName(addedSize.name), name: addedSize.name, meta: copy.badgeNew, sizes: [addedSize], fresh: true });
      }
      return list;
    }
    const lastHere = beerTally(sessions, (_d, session) => session.pubKey === key)[0];
    const groups = groupMenu(menu.beers);
    const list: Option[] = [...groups.entries()].map(([id, sizes]) => {
      const prices = sizes.map((b) => b.priceCzk).filter((p): p is number => typeof p === 'number');
      const meta = prices.length === 0 ? '' : prices.length > 1 ? copy.fromPrice(money(Math.min(...prices))) : money(prices[0]);
      return {
        id,
        name: sizes[0].name.trim(),
        meta,
        sizes,
        ...(lastHere && normalizeBeerName(lastHere.name) === id ? { badge: copy.badgeLastTime } : {}),
      };
    });
    if (addedSize) {
      const id = normalizeBeerName(addedSize.name);
      const existing = list.find((o) => o.id === id);
      if (!existing) {
        list.push({
          id,
          name: addedSize.name,
          meta: typeof addedSize.priceCzk === 'number' ? copy.onTap(money(addedSize.priceCzk)) : '',
          badge: copy.badgeNew,
          fresh: true,
          sizes: [addedSize],
        });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, home, menu.beers, params.added, params.price, params.volume, place, sessions, currency]);

  const [sel, setSel] = useState<string | null>(params.added ? normalizeBeerName(params.added) : null);
  // Back from "Přidat pivo" or the camera, this sheet gets the picked beer as a new param.
  const [seenAdded, setSeenAdded] = useState(params.added);
  if (params.added !== seenAdded) {
    setSeenAdded(params.added);
    if (params.added) setSel(normalizeBeerName(params.added));
  }
  const selected = useMemo<Option | null>(() => {
    if (kind === 'pivo' || custom === null) return options.find((o) => o.id === sel) ?? options[0] ?? null;
    return customName ? { id: normalizeBeerName(customName), name: customName, meta: '', sizes: [{ name: customName, volumeMl: CUSTOM_VOLUME_ML[kind] }] } : null;
  }, [custom, customName, kind, options, sel]);
  const nameMissing = kind !== 'pivo' && custom !== null && !customName;

  const sizeChoices = useMemo(() => {
    if (!selected || home || kind !== 'pivo') return [];
    const byVolume = new Map<number, CommunityBeer>();
    for (const size of selected.sizes) if (size.volumeMl) byVolume.set(size.volumeMl, size);
    if (byVolume.size === 0) {
      byVolume.set(300, { name: selected.name, volumeMl: 300 });
      byVolume.set(500, { name: selected.name, volumeMl: 500, ...(typeof selected.sizes[0]?.priceCzk === 'number' ? { priceCzk: selected.sizes[0].priceCzk } : {}) });
    }
    return [...byVolume.values()].slice(0, 3);
  }, [home, kind, selected]);

  const chosenSize =
    sizeChoices.find((size) => size.volumeMl === volume) ?? sizeChoices.find((size) => size.volumeMl === 500) ?? sizeChoices[0] ?? selected?.sizes[0] ?? null;
  const typed = Number(typedPrice.replace(',', '.'));
  const price = typeof chosenSize?.priceCzk === 'number' ? chosenSize.priceCzk : typed > 0 && typed <= 1000 ? Math.round(typed) : undefined;
  const needsPrice = !!pub && !!selected && kind === 'pivo' && typeof chosenSize?.priceCzk !== 'number';

  const homeLabel = {
    lahvac: `${copy.bottle.toLowerCase()} ${formatVolume(500)}`,
    plech: `${copy.can.toLowerCase()} ${formatVolume(500)}`,
    jinak: copy.otherServing.toLowerCase(),
  }[homeServing];
  const sizeLabel =
    home && kind === 'pivo'
      ? homeLabel
      : kind === 'pivo'
        ? `${copy.draft} ${chosenSize?.volumeMl ? formatVolume(chosenSize.volumeMl) : ''}`.trim()
        : chosenSize?.volumeMl
          ? formatVolume(chosenSize.volumeMl)
          : '';
  const footerSub = nameMissing
    ? copy.customNameMissing
    : selected
    ? [selected.name, sizeLabel, typeof price === 'number' && !home ? money(price) : null].filter(Boolean).join(' · ')
    : undefined;

  const save = () => {
    if (!place) {
      router.push('/nv/zmenit-misto');
      return;
    }
    if (!selected) return;
    trackUiInteraction('counter_drink_form_submit', 'submit');
    const serving = home && kind === 'pivo' ? HOME_SERVING[homeServing] : null;
    logDrink(
      place,
      {
        name: selected.name,
        drinkType: KIND_TYPE[kind],
        ...(typeof price === 'number' ? { priceCzk: price } : {}),
        ...(serving ? serving : chosenSize?.volumeMl ? { volumeMl: chosenSize.volumeMl } : {}),
      },
      menu.beers,
      { silentTap: true },
    );
    nvBack(router);
  };

  const rows: (Option | null)[][] = [];
  const withAdd: (Option | null)[] = [...options, null];
  for (let i = 0; i < withAdd.length; i += 2) rows.push(withAdd.slice(i, i + 2));

  return (
    <Sheet
      title={copy.whatDrink}
      top={140}
      footer={<Button testID="drink-save" height={60} label={kind === 'pivo' ? copy.logBeer : copy.logOther[kind]} sub={footerSub} disabled={!selected} haptic={!place} onPress={save} />}
    >
      <Press onPress={() => router.push('/nv/zmenit-misto')} style={[s.row, { gap: 6, marginTop: -8 }]}>
        <Icon name={place?.kind === 'outside' ? OUTSIDE_ICON[place.context] : 'map-pin'} size={16} color={C.yellow} />
        <T s={15} w={700} numberOfLines={1} style={{ flexShrink: 1 }}>
          {place ? (place.kind === 'outside' ? t.counter.outsideLabel(place.context) : place.pub.name) : copy.placeUnknown}
        </T>
        <T s={15} c={C.muted}>
          {copy.change}
        </T>
      </Press>
      <Segmented
        height={40}
        options={[
          { key: 'pivo', label: copy.kindBeer },
          { key: 'vino', label: copy.kindWine },
          { key: 'nealko', label: copy.kindSoft },
          { key: 'panak', label: copy.kindShot },
        ]}
        value={kind}
        onChange={(k) => {
          setKind(k);
          setSel(null);
          setCustom(null);
          setVolume(null);
          setTypedPrice('');
        }}
      />
      <View style={{ gap: 10 }}>
        {menu.loading && options.length === 0 ? <Spinner /> : null}
        {rows.map((r, i) => (
          <View key={i} style={[s.row, { gap: 10 }]}>
            {r.map((o) =>
              o === null ? (
                kind === 'pivo' ? (
                  <AddTile key="__add" label={copy.addBeer} sub={home ? copy.addBeerHome : copy.addBeerPub} onPress={() => router.push('/nv/pridat-pivo')} />
                ) : (
                  <AddTile key="__add" label={copy.customTile[kind]} sub={copy.customTileSub} on={custom !== null} onPress={() => setCustom(custom ?? '')} />
                )
              ) : (
                <BeerTile
                  key={o.id}
                  o={o}
                  on={custom === null && o.id === selected?.id}
                  rating={kind === 'pivo' ? myRating(ratings, o.name) : null}
                  onPress={() => {
                    setSel(o.id);
                    setCustom(null);
                    setVolume(null);
                    setTypedPrice('');
                    if (o.servingType === 'can') setHomeServing('plech');
                  }}
                />
              ),
            )}
            {r.length === 1 ? <View style={s.fill} /> : null}
          </View>
        ))}
      </View>
      {kind !== 'pivo' && custom !== null ? (
        <Input
          testID="drink-custom-name"
          value={custom}
          onChangeText={setCustom}
          placeholder={copy.customPlaceholder[kind]}
          maxLength={80}
          autoFocus
          returnKeyType="done"
        />
      ) : null}
      {kind === 'pivo' && (home || sizeChoices.length > 0) ? (
        <View style={{ gap: 12 }}>
          <Kicker>{home ? copy.howHome : copy.howMuch}</Kicker>
          <View style={[s.row, { gap: 10 }]}>
            {home ? (
              <>
                <SizeCard title={copy.bottle} sub={formatVolume(500)} on={homeServing === 'lahvac'} onPress={() => setHomeServing('lahvac')} />
                <SizeCard title={copy.can} sub={formatVolume(500)} on={homeServing === 'plech'} onPress={() => setHomeServing('plech')} />
                <SizeCard title={copy.otherServing} sub={copy.otherServingSub} on={homeServing === 'jinak'} onPress={() => setHomeServing('jinak')} />
              </>
            ) : (
              sizeChoices.map((size) => (
                <SizeCard
                  key={size.volumeMl}
                  title={size.volumeMl ? formatVolume(size.volumeMl) : ''}
                  sub={typeof size.priceCzk === 'number' ? money(size.priceCzk) : copy.priceUnknown}
                  icon={typeof size.priceCzk !== 'number'}
                  on={size.volumeMl === chosenSize?.volumeMl}
                  onPress={() => {
                    setVolume(size.volumeMl ?? null);
                    setTypedPrice('');
                  }}
                />
              ))
            )}
          </View>
        </View>
      ) : null}
      {needsPrice ? (
        <View style={[s.row, { height: 48, borderRadius: 16, paddingHorizontal: 14, gap: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.tint }]}>
          <T s={15} w={600} c={C.muted} style={s.fill}>
            {copy.priceLabel}
          </T>
          <TextInput
            testID="drink-price"
            value={typedPrice}
            onChangeText={setTypedPrice}
            keyboardType="number-pad"
            keyboardAppearance="dark"
            placeholder={copy.priceUnknown}
            placeholderTextColor={C.muted}
            selectionColor={C.yellow}
            style={[font(16, 700), { minWidth: 60, textAlign: 'right', padding: 0 }]}
          />
        </View>
      ) : null}
      {pub && selected?.fresh && typeof price === 'number' ? (
        <View style={[s.row, { gap: 10 }]}>
          <Icon name="list-plus" size={18} color={C.yellow} />
          <T s={14} c={C.text2} style={s.fill}>{copy.addToMenu(selected.name, pub.name)}</T>
        </View>
      ) : null}
    </Sheet>
  );
}

export function PridatPivoSheet() {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const place = useCountPlace();
  const home = place?.kind === 'outside';
  const pub = place?.kind === 'pub' ? place.pub : null;
  const currency = useSettingsStore((st) => st.priceCurrency);
  const sessions = useAllSessions();
  const [q, setQ] = useState('');
  const [near, setNear] = useState<{ state: 'loading' | 'failed' | 'ok'; beers: NearbyBeer[] }>({ state: 'loading', beers: [] });
  const [found, setFound] = useState<{ query: string; list: BeerBrandSuggestion[] }>({ query: '', list: [] });

  useEffect(() => {
    if (!pub) return undefined;
    const controller = new AbortController();
    void fetchNearbyBeers({ lat: pub.lat, lng: pub.lng }, controller.signal).then((result) => {
      if (!controller.signal.aborted) setNear(result.ok ? { state: 'ok', beers: result.beers } : { state: 'failed', beers: [] });
    });
    return () => controller.abort();
  }, [pub]);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const area = pub ? { lat: pub.lat, lng: pub.lng, radiusKm: 3 } : null;
      void suggestBeerBrands(query, controller.signal, 6, '', area).then((list) => {
        if (!controller.signal.aborted) setFound({ query, list });
      });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [pub, q]);

  const often = beerTally(sessions, (_d, session) => (home ? isContextPubKey(session.pubKey) : !isContextPubKey(session.pubKey))).slice(0, 4);
  const pick = (name: string, size?: { priceCzk?: number; volumeMl?: number }) =>
    router.dismissTo({
      pathname: '/nv/zapis',
      params: { added: name, ...(size?.priceCzk ? { price: String(size.priceCzk) } : {}), ...(size?.volumeMl ? { volume: String(size.volumeMl) } : {}) },
    });
  const match = (name: string) => !q || name.toLocaleLowerCase(intlLocale).includes(q.trim().toLocaleLowerCase(intlLocale));
  const nearShown = near.beers.filter((b) => match(b.name)).slice(0, 6);
  const plusIcon = <Icon name="plus" size={20} color={C.text2} />;
  const tile = <Tile icon="beer" bg={C.control} radius={18} size={36} />;

  return (
    <Sheet top={140} closeIcon={false} scroll>
      <View style={[s.row, { gap: 12, marginTop: -4 }]}>
        <IconButton icon="chevron-left" size={40} iconSize={18} onPress={() => nvBack(router)} label={copy.back} />
        <D s={30}>{copy.addBeer}</D>
      </View>
      <View style={[s.row, { height: 52, borderRadius: 18, paddingHorizontal: 16, gap: 10, backgroundColor: C.control, borderWidth: 1, borderColor: C.tint }]}>
        <Icon name="search" size={18} color={C.text2} />
        <TextInput testID="beer-search" value={q} onChangeText={setQ} placeholder={copy.searchBeer} placeholderTextColor={C.muted} keyboardAppearance="dark" selectionColor={C.yellow} style={[font(16, 500), { flex: 1, padding: 0 }]} />
      </View>
      <Press
        onPress={() => {
          if (!home) trackUiInteraction('counter_menu_scan_open');
          router.push({ pathname: '/nv/vyfot', params: { mode: home ? 'etiketa' : 'tabule' } });
        }}
        style={[s.row, { gap: 12, padding: 14, borderRadius: 20, backgroundColor: C.card, borderWidth: 1, borderColor: C.hairline }]}>
        <Tile icon="camera" color={C.black} bg={C.yellow} size={36} radius={18} />
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            {home ? copy.snapLabel : copy.snapBoard}
          </T>
          <T s={13} c={C.muted}>
            {home ? copy.snapLabelSub : copy.snapBoardSub}
          </T>
        </View>
        <Icon name="chevron-right" size={18} color={C.muted} />
      </Press>
      {q.trim().length >= 2 ? (
        <View style={{ gap: 4 }}>
          <Kicker>{copy.fromCatalogue}</Kicker>
          {(found.query === q.trim() ? found.list : []).map((b) => (
            <Row key={`${b.kind ?? 'x'}:${b.slug}`} leading={tile} title={b.name} titleWeight={700} sub={b.brandName && b.brandName !== b.name ? b.brandName : undefined} trailing={plusIcon} onPress={() => pick(b.name)} />
          ))}
          <Row last leading={tile} title={copy.addTyped(q.trim())} titleWeight={700} trailing={plusIcon} onPress={() => pick(q.trim())} />
        </View>
      ) : null}
      {pub ? (
        <View style={{ gap: 4 }}>
          <Kicker>{copy.nearbyTaps}</Kicker>
          {near.state === 'loading' ? (
            <T s={13} c={C.muted}>
              {copy.nearbyLoading}
            </T>
          ) : near.state === 'failed' ? (
            <T s={13} c={C.muted}>
              {copy.nearbyFailed}
            </T>
          ) : (
            nearShown.map((b, i) => (
              <Row
                key={`${b.name}:${b.pubCacheKey}`}
                last={i === nearShown.length - 1}
                leading={tile}
                title={b.name}
                titleWeight={700}
                sub={[
                  b.pubName,
                  typeof b.priceCzk === 'number' ? formatPrice(b.priceCzk, currency) : null,
                  // The distance is measured from the pub you sit in, so it means nothing for that pub itself.
                  b.pubName === pub.name ? null : distanceLabel(b.distanceMeters),
                ].filter(Boolean).join(' · ')}
                trailing={plusIcon}
                onPress={() => pick(b.name, { volumeMl: b.volumeMl })}
              />
            ))
          )}
        </View>
      ) : null}
      {often.filter((b) => match(b.name)).length ? (
        <View style={{ gap: 4 }}>
          <Kicker>{home ? copy.yourBottles : copy.drinkMost}</Kicker>
          {often
            .filter((b) => match(b.name))
            .map((b, i, arr) => (
              <Row
                key={b.name}
                last={i === arr.length - 1}
                leading={tile}
                title={b.name}
                titleWeight={700}
                sub={
                  home
                    ? copy.inDiaryServing(
                        [b.last.servingType ? t.counter.servingTypeLabel(b.last.servingType).toLowerCase() : null, b.last.volumeMl ? formatVolume(b.last.volumeMl) : null].filter(Boolean).join(' '),
                        b.count,
                      )
                    : copy.inDiary(b.count)
                }
                trailing={plusIcon}
                onPress={() => pick(b.name, { volumeMl: b.last.volumeMl })}
              />
            ))}
        </View>
      ) : null}
    </Sheet>
  );
}

function scanFailureMessage(status: string): string {
  const scan = t.contribute.scanMenu;
  return status === 'daily-cap'
    ? scan.dailyCapToast
    : status === 'rate-limited'
      ? scan.rateLimitedToast
      : status === 'unavailable'
        ? scan.unavailableToast
        : status === 'bad-image'
          ? scan.badImageToast
          : scan.errorToast;
}

type Phase = { step: 'shooting' } | { step: 'reading' } | { step: 'label'; beer: ScannedLabel } | { step: 'board'; missing: CommunityBeer[] } | { step: 'failed'; message: string };

/**
 * Camera for "Vyfoť etiketu" (home), "Vyfoť tabuli" (pub) or the menu photo of
 * "Doplnit info" (`listek`), which hands the confirmed beers back to that screen.
 */
export function VyfotScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const copy = t.nv.stamgast;
  const { mode, source } = useLocalSearchParams<{ mode?: string; source?: string }>();
  const label = mode === 'etiketa';
  const fill = mode === 'listek';
  const place = useCountPlace();
  const pub = place?.kind === 'pub' ? place.pub : null;
  const menu = usePubMenu(label || fill ? null : pub);
  const [uri, setUri] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: 'shooting' });
  const [checked, setChecked] = useState<boolean[]>([]);
  const [serving, setServing] = useState<'lahvac' | 'plech'>('lahvac');
  const [attempt, setAttempt] = useState(0);
  const currency = useSettingsStore((st) => st.priceCurrency);

  useEffect(() => {
    let cancelled = false;
    if (!label && !fill && !pub) {
      toast({ kind: 'info', title: t.counter.cameraMenuNeedsPub, icon: 'map-pin' });
      nvBack(router);
      return undefined;
    }
    void (async () => {
      setPhase({ step: 'shooting' });
      const picked = await pickAndPrepareMenuPhoto(fill && source === 'library' ? 'library' : 'camera');
      if (cancelled) return;
      if (picked.status === 'cancelled') {
        if (attempt === 0 || fill) nvBack(router);
        else setPhase({ step: 'failed', message: copy.labelUnread });
        return;
      }
      if (picked.status !== 'picked') {
        setPhase({
          step: 'failed',
          message: picked.status === 'error' ? t.contribute.scanMenu.errorToast : t.contribute.scanMenu.permissionDenied,
        });
        return;
      }
      setUri(picked.uri);
      setPhase({ step: 'reading' });
      if (label) {
        const result = await scanBeerLabel(picked.uri);
        if (cancelled) return;
        if (result.status === 'ok') {
          setServing(result.beer.servingType === 'can' ? 'plech' : 'lahvac');
          setPhase({ step: 'label', beer: result.beer });
        } else {
          setPhase({ step: 'failed', message: result.status === 'empty' ? copy.labelUnread : scanFailureMessage(result.status) });
        }
        return;
      }
      const result = await scanMenuPhoto(picked.uri);
      if (cancelled) return;
      if (result.status !== 'ok') {
        setPhase({
          step: 'failed',
          message: result.status === 'empty' ? t.counter.scanDrinksEmpty : fill && result.status === 'error' ? copy.menuUnread : scanFailureMessage(result.status),
        });
        return;
      }
      const listed = fill ? (useKompasState.getState().menuScan?.known ?? []) : menu.beers;
      const known = new Set(listed.map((b) => normalizeBeerName(b.name)));
      const missing = result.drinks
        .filter((d) => d.drinkType === 'beer' && !known.has(normalizeBeerName(d.name)))
        .map<CommunityBeer>((d) => ({ name: d.name, ...(d.priceCzk ? { priceCzk: d.priceCzk } : {}), ...(d.volumeMl ? { volumeMl: d.volumeMl } : {}) }));
      setChecked(missing.map(() => true));
      setPhase({ step: 'board', missing });
    })();
    return () => {
      cancelled = true;
    };
    // Each attempt takes one photo; the menu is read when the scan answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const retake = () => setAttempt((n) => n + 1);
  const fromLibrary = fill && source === 'library';
  const retakeLabel = fromLibrary ? copy.pickAnother : copy.retake;
  const n = checked.filter(Boolean).length;
  const panel = { position: 'absolute' as const, left: 10, right: 10, bottom: Math.max(insets.bottom, 12), backgroundColor: C.dialog, borderRadius: 28, padding: 20, gap: 14, borderWidth: 1, borderColor: C.tint };

  return (
    <View style={{ flex: 1, backgroundColor: '#1A120B' }}>
      {uri ? (
        <Image source={{ uri }} style={{ position: 'absolute', width: '100%', height: '100%' }} resizeMode="cover" />
      ) : (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, experimental_backgroundImage: 'radial-gradient(circle at 50% 35%, #3B2A18 0%, #140D07 70%)' }} />
      )}
      <View style={[s.row, { position: 'absolute', top: insets.top + 6, left: SCREEN_X, right: SCREEN_X, justifyContent: 'space-between' }]}>
        <IconButton icon="x" bg="#0A0A0A99" onPress={() => nvBack(router)} label={copy.close} />
        <View style={{ paddingHorizontal: 14, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: '#0A0A0A99' }}>
          <T s={13} w={700}>
            {label ? copy.snapLabel : copy.snapBoard}
          </T>
        </View>
        <View style={{ width: 44 }} />
      </View>
      {label && uri ? <View style={{ position: 'absolute', left: '32%', width: '38%', top: '42%', height: '27%', borderRadius: 18, borderWidth: 3, borderColor: C.yellow }} /> : null}
      {phase.step === 'reading' || phase.step === 'shooting' ? (
        <View style={[panel, s.row, { gap: 12 }]}>
          <Spinner />
          <T s={15} w={700}>
            {copy.reading}
          </T>
        </View>
      ) : phase.step === 'failed' ? (
        <View style={panel}>
          <T s={15} w={600} c={C.text2}>
            {phase.message}
          </T>
          <Button label={retakeLabel} icon={fromLibrary ? 'image' : 'camera'} onPress={retake} />
          {label || fill ? (
            <Press onPress={() => nvBack(router)} style={{ alignItems: 'center' }}>
              <T s={14} w={700} c={C.text2}>
                {fill ? copy.writeByHand : copy.notIt}
              </T>
            </Press>
          ) : null}
        </View>
      ) : phase.step === 'label' ? (
        <View style={panel}>
          <View style={{ gap: 4 }}>
            <Kicker>{copy.recognized}</Kicker>
            <D s={28}>{phase.beer.name}</D>
          </View>
          <View style={[s.row, { gap: 10 }]}>
            <SizeCard title={copy.bottle} sub={formatVolume(phase.beer.volumeMl ?? 500)} on={serving === 'lahvac'} onPress={() => setServing('lahvac')} />
            <SizeCard title={copy.can} sub={formatVolume(phase.beer.volumeMl ?? 500)} on={serving === 'plech'} onPress={() => setServing('plech')} />
          </View>
          <Button
            height={58}
            haptic={false}
            label={copy.logBeer}
            sub={`${phase.beer.name} · ${(serving === 'lahvac' ? copy.bottle : copy.can).toLowerCase()} ${formatVolume(phase.beer.volumeMl ?? 500)}`}
            onPress={() => {
              const target: CountPlace = place?.kind === 'outside' ? place : { kind: 'outside', context: 'private' };
              if (place?.kind !== 'outside') useNvPlaceStore.getState().setOutside('private');
              logDrink(target, { name: phase.beer.name, drinkType: 'beer', servingType: serving === 'lahvac' ? 'bottle' : 'can', volumeMl: phase.beer.volumeMl ?? 500 }, undefined, { silentTap: true });
              router.dismissTo('/nv/stamgast');
            }}
          />
          <Press onPress={() => nvBack(router)} style={{ alignItems: 'center' }}>
            <T s={14} w={700} c={C.text2}>
              {copy.notIt}
            </T>
          </Press>
        </View>
      ) : (
        <View style={panel}>
          <View style={{ gap: 2 }}>
            <D s={26}>{phase.missing.length ? copy.boardMissing : copy.boardAllThere}</D>
            {phase.missing.length ? (
              <T s={13} c={C.muted}>
                {copy.boardOthers}
              </T>
            ) : null}
          </View>
          {phase.missing.map((beer, i) => (
            <Press key={beer.name} onPress={() => setChecked(checked.map((c, j) => (j === i ? !c : c)))} style={[s.row, { gap: 12, paddingVertical: 4 }]}>
              <View style={[{ width: 24, height: 24, borderRadius: 6, backgroundColor: checked[i] ? C.yellow : 'transparent', borderWidth: checked[i] ? 0 : 2, borderColor: C.muted }, s.center]}>
                {checked[i] ? <Icon name="check" size={16} color={C.black} /> : null}
              </View>
              <View style={[s.fill, { gap: 2 }]}>
                <T s={15} w={700}>
                  {beer.name}
                </T>
                <T s={12} c={C.muted}>
                  {[beer.volumeMl ? formatVolume(beer.volumeMl) : null, typeof beer.priceCzk === 'number' ? formatPrice(beer.priceCzk, currency) : null].filter(Boolean).join(' · ')}
                </T>
              </View>
            </Press>
          ))}
          <Button
            label={n ? copy.addToBoard(n) : copy.addNothing}
            disabled={n > 0 && !fill && !menu.fresh}
            onPress={() => {
              const added = phase.missing.filter((_b, i) => checked[i]);
              if (fill) {
                const handoff = useKompasState.getState().menuScan;
                useKompasState.getState().set({ menuScan: null });
                if (handoff && added.length) handoff.add(added);
                nvBack(router);
                return;
              }
              if (!added.length || !pub) {
                nvBack(router);
                return;
              }
              addBeersToMenu(pub, menu, added);
              toast({ kind: 'xp', title: copy.boardDone, icon: 'list-plus' });
              router.dismissTo({
                pathname: '/nv/zapis',
                params: { added: added[0].name, ...(added[0].priceCzk ? { price: String(added[0].priceCzk) } : {}), ...(added[0].volumeMl ? { volume: String(added[0].volumeMl) } : {}) },
              });
            }}
          />
          <Press style={{ alignItems: 'center' }} onPress={retake}>
            <T s={14} w={700} c={C.text2}>
              {retakeLabel}
            </T>
          </Press>
        </View>
      )}
    </View>
  );
}

export function ZmenitMistoSheet() {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const { target } = useLocalSearchParams<{ target?: string }>();
  const forBackfill = target === 'dopsat';
  const place = useCountPlace();
  const candidates = useNvPlaceStore((st) => st.candidates);
  const loading = useNvPlaceStore((st) => st.loading);
  const permission = useNvPlaceStore((st) => st.permission);
  const backfillPub = useBackfillPick((st) => st.pub);

  useEffect(() => {
    const { setPicking } = useNvPlaceStore.getState();
    setPicking(true);
    return () => setPicking(false);
  }, []);

  const near = candidates.slice(0, 8);
  const choose = (pub: Pub) => {
    if (forBackfill) useBackfillPick.getState().set(pub);
    else useNvPlaceStore.getState().pickPub(pub);
    nvBack(router);
  };
  const outside = !forBackfill && place?.kind === 'outside';
  const selectedKey = forBackfill ? (backfillPub ? placeKey({ kind: 'pub', pub: backfillPub }) : null) : place?.kind === 'pub' ? placeKey(place) : null;

  return (
    <Sheet title={copy.placeUnknown} top={360}>
      {forBackfill ? null : (
        <View style={[s.row, { gap: 10 }]}>
          {OUTSIDE_CHOICES.map((context) => (
            <Chip
              key={context}
              label={context === 'private' ? copy.placeHome : t.counter.outsideLabel(context)}
              icon={OUTSIDE_ICON[context]}
              active={place?.kind === 'outside' && place.context === context}
              height={48}
              style={{ flex: 1, justifyContent: 'center' }}
              onPress={() => {
                useNvPlaceStore.getState().setOutside(context);
                nvBack(router);
              }}
            />
          ))}
        </View>
      )}
      <View>
        {permission !== 'granted' ? (
          <Row
            last
            leading={<Tile icon="locate-fixed" color={C.yellow} bg={C.control} />}
            title={copy.placeLocate}
            sub={copy.placeLocateSub}
            onPress={() => void useNvPlaceStore.getState().requestPermission()}
          />
        ) : loading && near.length === 0 ? (
          <View style={[s.row, { gap: 10, height: 62 }]}>
            <Spinner />
            <T s={14} c={C.muted}>
              {copy.placeSearching}
            </T>
          </View>
        ) : near.length === 0 ? (
          <Row last leading={<Tile icon="rotate-cw" color={C.yellow} bg={C.control} />} title={copy.placeNone} sub={copy.placeRetry} onPress={() => useNvPlaceStore.getState().retry()} />
        ) : (
          near.map((c, i) => {
            const on = !outside && selectedKey === c.pubKey;
            return (
              <Row
                key={c.pubKey}
                last={i === near.length - 1}
                leading={<Tile icon="map-pin" color={on ? C.black : C.yellow} bg={on ? C.yellow : C.control} />}
                title={c.pub.name}
                sub={[c.pub.city ?? c.pub.address, distanceLabel(c.distanceMeters)].filter(Boolean).join(' · ')}
                trailing={on ? <Icon name="check" size={18} color={C.yellow} /> : null}
                onPress={() => choose(c.pub)}
              />
            );
          })
        )}
      </View>
    </Sheet>
  );
}

