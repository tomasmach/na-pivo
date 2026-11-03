import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { formatClock } from '@/counter/useAlcoholEstimate';
import { isContextPubKey } from '@/drinks/drinkTypes';
import { t } from '@/i18n';
import { nvBack } from '@/newlook/navigation';
import { PUB_NOTE_MAX_LENGTH, selectPubRating, usePubRatingsStore, type PubRating, type PubVerdict } from '@/stores/pubRatingsStore';

import { FieldLabel, Input } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, Chip, ChipWrap, Press, T } from '../../components/ui';
import { C, s } from '../../theme';
import { dateOfDay, type Night } from './eveningData';

type Router = ReturnType<typeof useRouter>;

export function openPubVerdict(router: Router, pubKey: string, name: string, sub: string) {
  router.push({ pathname: '/nv/palec', params: { pubKey, name, sub } });
}

/** Tag label and note of a rating, e.g. "Vrátím se sem · výčep super". */
export function verdictSummary(rating: PubRating | undefined): string {
  const tag = rating?.tag ? t.myBeers.notePresets.find((p) => p.value === rating.tag)?.label ?? rating.tag : '';
  return [tag, rating?.note ?? ''].filter(Boolean).join(' · ');
}

export function verdictLabel(verdict: PubVerdict): string {
  return verdict === 'like' ? t.myBeers.verdictLike : t.myBeers.verdictDislike;
}

function ThumbButton({ verdict, active, pubName, onPress }: { verdict: PubVerdict; active: boolean; pubName: string; onPress: () => void }) {
  return (
    <Press
      haptic
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={`${verdictLabel(verdict)}, ${pubName}`}
      style={[
        s.center,
        { width: 44, height: 44, borderRadius: 22, backgroundColor: active ? C.yellowTint : C.control, borderWidth: 1, borderColor: active ? C.yellowStrong : 'transparent' },
      ]}
    >
      <Icon name={verdict === 'like' ? 'thumbs-up' : 'thumbs-down'} size={18} color={active ? C.yellow : C.text2} />
    </Press>
  );
}

function PubVerdictRow({ pub, night, last }: { pub: Night['pubs'][number]; night: Night; last: boolean }) {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const rating = usePubRatingsStore(selectPubRating(pub.pubKey));
  const setRating = usePubRatingsStore((st) => st.setRating);
  const summary = verdictSummary(rating);
  const tap = (verdict: PubVerdict) => setRating(pub.pubKey, { verdict: rating?.verdict === verdict ? undefined : verdict });
  const open = () => {
    const day = dateOfDay(night.day);
    const dayLabel = copy.eveningTitle(copy.weekdaysLong[day.getDay()], day.getDate(), day.getMonth() + 1);
    openPubVerdict(router, pub.pubKey, pub.name, copy.pubVerdictSheetSub(dayLabel, pub.beers));
  };
  return (
    <View style={[s.row, { minHeight: 72, gap: 10 }, !last && { borderBottomWidth: 1, borderBottomColor: C.hairline }]}>
      <Press onPress={open} accessibilityRole="button" accessibilityLabel={copy.pubVerdictOpen(pub.name)} style={[s.fill, { gap: 2, paddingVertical: 12 }]}>
        <T s={16} w={600} numberOfLines={1}>
          {pub.name}
        </T>
        <T s={13} c={C.muted} numberOfLines={1}>
          {summary || copy.pubVerdictRowSub(pub.beers, formatClock(new Date(pub.firstAt)))}
        </T>
      </Press>
      <ThumbButton verdict="like" active={rating?.verdict === 'like'} pubName={pub.name} onPress={() => tap('like')} />
      <ThumbButton verdict="dislike" active={rating?.verdict === 'dislike'} pubName={pub.name} onPress={() => tap('dislike')} />
    </View>
  );
}

/** "Stálo to za návrat?" under the drinks of an evening: one private thumb per pub of the night. */
export function PubVerdictSection({ night }: { night: Night }) {
  const copy = t.nv.stamgast;
  const byKey = new Map<string, Night['pubs'][number]>();
  for (const pub of night.pubs) {
    if (isContextPubKey(pub.pubKey)) continue;
    const seen = byKey.get(pub.pubKey);
    byKey.set(pub.pubKey, seen ? { ...seen, beers: seen.beers + pub.beers } : pub);
  }
  const pubs = [...byKey.values()];
  if (!pubs.length) return null;
  return (
    <>
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        <T s={19} w={700}>
          {copy.pubVerdictTitle}
        </T>
        <View style={[s.row, { gap: 5 }]}>
          <Icon name="lock" size={13} color={C.muted} />
          <T s={13} c={C.muted}>
            {copy.pubVerdictPrivate}
          </T>
        </View>
      </View>
      <Card>
        {pubs.map((pub, i) => (
          <PubVerdictRow key={pub.pubKey} pub={pub} night={night} last={i === pubs.length - 1} />
        ))}
      </Card>
    </>
  );
}

/** Small thumb shown after a pub name in lists, or nothing when the pub has no verdict. */
export function VerdictMark({ pubKey, size = 13 }: { pubKey: string; size?: number }) {
  const verdict = usePubRatingsStore((st) => st.ratings[pubKey]?.verdict);
  if (!verdict) return null;
  return (
    <View accessible accessibilityLabel={verdictLabel(verdict)}>
      <Icon name={verdict === 'like' ? 'thumbs-up' : 'thumbs-down'} size={size} color={verdict === 'like' ? C.yellow : C.muted} />
    </View>
  );
}

/** Route `/nv/palec`: thumb, one tag and a note for one pub. */
export function PubVerdictSheet() {
  const router = useRouter();
  const copy = t.nv.stamgast;
  const mb = t.myBeers;
  const params = useLocalSearchParams<{ pubKey?: string; name?: string; sub?: string }>();
  const pubKey = params.pubKey ?? '';
  const saved = usePubRatingsStore(selectPubRating(pubKey));
  const setRating = usePubRatingsStore((st) => st.setRating);
  const [verdict, setVerdict] = useState<PubVerdict | undefined>(saved?.verdict);
  const [tag, setTag] = useState<string | undefined>(saved?.tag);
  const [note, setNote] = useState(saved?.note ?? '');
  const save = () => {
    const changed = verdict !== saved?.verdict || tag !== saved?.tag || note.trim() !== (saved?.note ?? '');
    if (pubKey && changed) setRating(pubKey, { verdict, tag, note });
    nvBack(router);
  };
  return (
    <Sheet title={params.name} top={130} footer={<Button height={60} label={copy.pubVerdictSave} disabled={!pubKey} onPress={save} />}>
      {params.sub ? (
        <T s={14} c={C.muted} style={{ marginTop: -16 }}>
          {params.sub}
        </T>
      ) : null}
      <View style={[s.row, { justifyContent: 'center', gap: 12 }]}>
        {(['like', 'dislike'] as const).map((v) => {
          const on = verdict === v;
          return (
            <Press
              key={v}
              haptic
              onPress={() => setVerdict(on ? undefined : v)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[
                s.row,
                { height: 52, paddingHorizontal: 22, borderRadius: 26, gap: 8, backgroundColor: on ? C.yellowTint : C.control, borderWidth: 1, borderColor: on ? C.yellowStrong : 'transparent' },
              ]}
            >
              <Icon name={v === 'like' ? 'thumbs-up' : 'thumbs-down'} size={20} color={on ? C.yellow : C.text2} />
              <T s={16} w={700} c={on ? C.yellow : C.white}>
                {verdictLabel(v)}
              </T>
            </Press>
          );
        })}
      </View>
      <View style={{ gap: 12 }}>
        <FieldLabel>{mb.tagLabel}</FieldLabel>
        <ChipWrap>
          {mb.notePresets.map((preset) => (
            <Chip key={preset.value} label={preset.label} plain active={tag === preset.value} onPress={() => setTag(tag === preset.value ? undefined : preset.value)} />
          ))}
        </ChipWrap>
      </View>
      <Input multiline value={note} onChangeText={setNote} placeholder={mb.notePlaceholder} maxLength={PUB_NOTE_MAX_LENGTH} />
      <View style={[s.row, { gap: 8, alignItems: 'flex-start' }]}>
        <Icon name="lock" size={14} color={C.muted} />
        <T s={13} c={C.muted} style={s.fill}>
          {mb.ratingHint}
        </T>
      </View>
    </Sheet>
  );
}
