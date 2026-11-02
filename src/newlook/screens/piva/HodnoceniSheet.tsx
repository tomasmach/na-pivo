import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';

import { FieldLabel, Input } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { StatusCard } from '../../components/StatusCard';
import { Sheet } from '../../components/overlays';
import { Button, Chip, ChipWrap, Press, T } from '../../components/ui';
import { dialog, toast } from '../../ui/store';
import { C, s } from '../../theme';
import { generateUuidV4 } from '@/data/account';
import { BEER_TAGS, MAX_BEER_TAGS, type BeerCheckIn, type BeerCheckInVisibility, type BeerTag } from '@/data/beerCheckinsClient';
import { pickAndPrepareBeerPhoto, type BeerPhotoSource } from '@/data/beerPhotoPicker';
import { enqueueBeerPhoto, persistBeerPhotoLocally } from '@/data/beerPhotosQueue';
import { fetchBeerPage, submitBeerStyle, type BeerDegree, type StyleAnswer } from '@/data/beersClient';
import { intlLocale, t } from '@/i18n';

import { myLatestRating, saveBeerRating, savedRating } from './model';
import { Loading, useLoad } from './states';
import { DegreePicker, KindPicker } from './StylePicker';

const VISIBILITIES: BeerCheckInVisibility[] = ['private', 'friends', 'public'];

type Params = { id?: string; name?: string; brewery?: string; stars?: string; pub?: string; pubKey?: string };

/**
 * Rate one beer: stars, up to three tags, a note and a photo. Callers pass the
 * catalogue key as `id` (or '-') and, when they have it, `name`, `brewery` and
 * the pub of the visit (`pub`, `pubKey`).
 */
export function HodnoceniSheet() {
  const params = useLocalSearchParams<Params>();
  const productKey = params.id && params.id !== '-' ? params.id : null;
  const fallback = params.name ? { name: params.name, brewery: params.brewery ?? '', history: [] as BeerCheckIn[] } : null;
  const load = useLoad<RatedBeer>(
    `${productKey ?? ''}|${params.name ?? ''}|${params.brewery ?? ''}`,
    // Offline with a name still rates; the queue sends it later.
    (signal) =>
      fetchBeerPage({ productKey, beerName: params.name, breweryName: params.brewery }, null, signal).then((page) =>
        page
          ? {
              name: page.beerName,
              brewery: page.breweryName,
              history: page.myHistory,
              productKey: page.productKey,
              askStyle: !!page.productKey && !page.styleSettled && !page.myStyle,
              askDegree: !!page.productKey && !page.degree && !page.myDegree,
            }
          : fallback,
      ),
  );

  if (load.state.status === 'ready') {
    return <RatingForm beer={load.state.data} params={params} />;
  }
  return (
    <Sheet title={fallback?.name} top={130}>
      {load.state.status === 'loading' ? <Loading /> : <StatusCard text={t.nv.piva.beer.failed} action={t.nv.piva.retry} onAction={load.retry} />}
    </Sheet>
  );
}

type RatedBeer = { name: string; brewery: string; history: BeerCheckIn[]; productKey?: string | null; askStyle?: boolean; askDegree?: boolean };

function RatingForm({ beer, params }: { beer: RatedBeer; params: Params }) {
  const router = useRouter();
  const r = t.nv.piva.rating;
  const latest = myLatestRating(beer.history);
  const existing = savedRating(beer.name) ?? latest?.rating ?? null;
  const [stars, setStars] = useState(Number(params.stars) || (existing ? Math.round(existing) : 0));
  const [tags, setTags] = useState<BeerTag[]>(latest?.tags ?? []);
  const [text, setText] = useState(latest?.note ?? '');
  const [visibility, setVisibility] = useState<BeerCheckInVisibility>(latest?.visibility ?? 'private');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [style, setStyle] = useState<StyleAnswer | null>(null);
  const [degree, setDegree] = useState<BeerDegree | null>(null);
  const time = new Date().toLocaleTimeString(intlLocale, { hour: 'numeric', minute: '2-digit' });

  const toggleTag = (tag: BeerTag) =>
    setTags((prev) => (prev.includes(tag) ? prev.filter((x) => x !== tag) : prev.length < MAX_BEER_TAGS ? [...prev, tag] : prev));

  const pickPhoto = () => {
    const pick = (source: BeerPhotoSource) =>
      void pickAndPrepareBeerPhoto(source).then((result) => {
        if (result.status === 'picked') setPhotoUri(result.uri);
        else if (result.status === 'error') toast({ kind: 'error', title: r.photoFailed });
      });
    dialog({
      title: r.photo,
      actions: [
        { label: t.photoDiary.takePhoto, kind: 'primary', onPress: () => pick('camera') },
        { label: t.photoDiary.pickFromLibrary, kind: 'raised', onPress: () => pick('library') },
      ],
    });
  };

  const chooseVisibility = () =>
    dialog({
      title: r.visibilityTitle,
      actions: VISIBILITIES.map((v) => ({ label: r.visibilityOptions[v], kind: v === visibility ? 'primary' : 'raised', onPress: () => setVisibility(v) })),
    });

  const save = async () => {
    if (!stars || saving) return;
    setSaving(true);
    const pub = params.pub ? { name: params.pub, cacheKey: params.pubKey } : null;
    const payload = await saveBeerRating(
      { beerName: beer.name, breweryName: beer.brewery, history: beer.history, pub },
      { rating: stars, tags, note: text.trim(), visibility },
    );
    // The style is a crowd answer next to the rating; offline it simply is not counted.
    if ((style || degree) && beer.productKey) {
      void submitBeerStyle({ productKey: beer.productKey }, { ...(style ? { style } : {}), ...(degree ? { degree } : {}) });
    }
    if (photoUri) {
      const clientId = generateUuidV4();
      void persistBeerPhotoLocally(photoUri, clientId).then((localUri) =>
        enqueueBeerPhoto({
          clientId,
          localUri,
          caption: beer.name,
          pubCacheKey: payload.pubCacheKey || undefined,
          pubName: payload.pubName || undefined,
          pubCity: payload.pubCity || undefined,
          // Photos have no public audience yet; a public rating shares its photo with the party.
          visibility: visibility === 'private' ? 'private' : 'friends',
          takenAt: new Date().toISOString(),
        }),
      );
    }
    nvBack(router);
    toast({ kind: 'saved', title: r.saved, icon: 'star' });
  };

  return (
    <Sheet title={beer.name} top={130} footer={<Button height={60} label={r.save} disabled={!stars || saving} onPress={() => void save()} />}>
      <T s={14} c={C.muted} style={{ marginTop: -16 }}>
        {r.context(params.pub ?? null, time)}
      </T>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <View style={[s.row, { gap: 8 }]}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Press key={n} haptic onPress={() => setStars(n)} accessibilityLabel={r.starsA11y(n)}>
              <Icon name="star" size={46} color={n <= stars ? C.yellow : C.muted} fill={n <= stars ? C.yellow : 'none'} strokeWidth={1.5} />
            </Press>
          ))}
        </View>
        <T s={16} w={700}>
          {r.verdict[stars] ?? ''}
        </T>
      </View>
      {beer.askStyle ? (
        <View style={{ gap: 12 }}>
          <FieldLabel>{t.nv.piva.stylePick.question}</FieldLabel>
          <KindPicker value={style} onPick={(next) => setStyle((prev) => (prev === next ? null : next))} />
        </View>
      ) : null}
      {beer.askDegree ? (
        <View style={{ gap: 12 }}>
          <FieldLabel>{t.nv.piva.stylePick.degreeQuestion}</FieldLabel>
          <DegreePicker value={degree} onPick={(next) => setDegree((prev) => (prev === next ? null : next))} />
        </View>
      ) : null}
      <View style={{ gap: 12 }}>
        <FieldLabel>{r.tagsLabel}</FieldLabel>
        <ChipWrap>
          {BEER_TAGS.map((tag) => (
            <Chip key={tag} label={r.tags[tag]} active={tags.includes(tag)} plain onPress={() => toggleTag(tag)} />
          ))}
        </ChipWrap>
      </View>
      <Input multiline value={text} onChangeText={setText} placeholder={r.notePlaceholder} maxLength={500} />
      <View style={[s.row, { gap: 10 }]}>
        {photoUri ? (
          <View style={{ width: 72, height: 72, borderRadius: 14, overflow: 'hidden' }}>
            <Image source={{ uri: photoUri }} style={{ width: '100%', height: '100%' }} />
            <Press onPress={() => setPhotoUri(null)} style={[{ position: 'absolute', right: 4, top: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: C.onYellowMuted }, s.center]}>
              <Icon name="x" size={12} />
            </Press>
          </View>
        ) : null}
        <Press onPress={pickPhoto} style={[{ width: 72, height: 72, borderRadius: 14, borderWidth: 1.5, borderColor: C.lineStrong, gap: 4 }, s.center]}>
          <Icon name="camera" size={18} color={C.yellow} />
          <T s={12} w={600}>
            {r.photo}
          </T>
        </Press>
      </View>
      <Press onPress={chooseVisibility} style={[s.row, { height: 48, borderRadius: 16, paddingHorizontal: 14, gap: 10, backgroundColor: C.card }]}>
        <Icon name={visibility === 'public' ? 'globe' : visibility === 'friends' ? 'users' : 'lock'} size={18} color={C.yellow} />
        <T s={15} w={600} style={s.fill}>
          {r.visibility[visibility]}
        </T>
        <T s={14} c={C.muted}>
          {r.change}
        </T>
        <Icon name="chevron-right" size={14} color={C.muted} />
      </Press>
    </Sheet>
  );
}
