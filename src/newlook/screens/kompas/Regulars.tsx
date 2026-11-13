import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { fetchPubRegulars, type PubRegular, type PubRegulars, type RegularsPeriod } from '@/data/pubRegularsClient';
import { t } from '@/i18n';
import { useAccountStore } from '@/stores/accountStore';

import { Ghost } from '../../components/StatusCard';
import { Icon } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, ChipWrap, Chip, D, Person, Press, Row, T, Toggle } from '../../components/ui';
import { fadeIn } from '../../motion';
import { toast } from '../../ui/store';
import { C, s } from '../../theme';
import { useMe } from '../profil/profilModel';

const L = () => t.nv.kompas;
const PERIODS: RegularsPeriod[] = ['30d', 'year', 'all'];

function initialOf(regular: PubRegular): string {
  return (regular.account.nickname || regular.account.displayName).charAt(0).toLocaleUpperCase();
}

/** Under the map on the pub page: who leads, opening the whole order. Nothing when nobody is shown. */
export function RegularsRow({ pubKey, name }: { pubKey: string; name: string }) {
  const router = useRouter();
  const [regulars, setRegulars] = useState<PubRegulars | null>(null);

  useEffect(() => {
    if (!pubKey) return;
    const controller = new AbortController();
    void fetchPubRegulars(pubKey, '30d', { signal: controller.signal }).then((next) => {
      if (!controller.signal.aborted) setRegulars(next);
    });
    return () => controller.abort();
  }, [pubKey]);

  const leader = regulars?.entries[0];
  if (!leader) return null;
  const lead = L().regularsLead(leader.account.nickname, leader.beers);
  return (
    <Animated.View entering={fadeIn}>
      <Press
        onPress={() => router.push({ pathname: '/nv/stamgasti', params: { pubKey, name } })}
        accessibilityRole="button"
        accessibilityLabel={`${L().regulars}, ${lead}`}
        style={[s.row, { gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 20, backgroundColor: C.card }]}
      >
        <View style={s.row}>
          {regulars.entries.slice(0, 3).map((regular, i) => (
            <View key={regular.account.id} style={{ marginLeft: i ? -10 : 0, borderRadius: 18, borderWidth: 2, borderColor: C.card }}>
              <Person initial={initialOf(regular)} uri={regular.account.avatarUrl} size={32} />
            </View>
          ))}
        </View>
        <View style={[s.fill, { gap: 2 }]}>
          <T s={16} w={700}>
            {L().regulars}
          </T>
          <T s={13} c={C.muted}>
            {lead}
          </T>
        </View>
        <Icon name="chevron-right" size={16} color={C.muted} />
      </Press>
    </Animated.View>
  );
}

function RegularLine({ regular, last }: { regular: PubRegular; last: boolean }) {
  const me = useMe();
  const tone = regular.isMe ? C.yellow : C.white;
  return (
    <Row
      last={last}
      leading={
        <View style={[s.row, { gap: 14 }]}>
          <D s={22} c={regular.isMe || regular.rank === 1 ? C.yellow : C.muted} style={{ minWidth: 18 }}>
            {String(regular.rank)}
          </D>
          <Person initial={initialOf(regular)} uri={regular.account.avatarUrl ?? (regular.isMe ? me.avatarUrl : null)} size={36} filled={regular.isMe} />
        </View>
      }
      title={regular.isMe ? L().regularsYou : `@${regular.account.nickname}`}
      titleColor={tone}
      titleWeight={700}
      sub={regular.isFriend ? L().regularsFriend : undefined}
      trailing={
        <D s={24} c={tone}>
          {String(regular.beers)}
        </D>
      }
    />
  );
}

/** Route `/nv/stamgasti`: the whole order of one pub, with the period and my own listing. */
export function RegularsSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ pubKey?: string; name?: string }>();
  const pubKey = params.pubKey ?? '';
  const me = useMe();
  const updateProfile = useAccountStore((st) => st.updateProfile);
  const [period, setPeriod] = useState<RegularsPeriod>('30d');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; regulars: PubRegulars | null } | null>(null);
  const [optedIn, setOptedIn] = useState<boolean | null>(null);
  const key = `${period}:${attempt}`;
  const regulars = result?.key === key ? result.regulars : null;
  const failed = result?.key === key && !result.regulars;

  useEffect(() => {
    if (!pubKey) return;
    const controller = new AbortController();
    void fetchPubRegulars(pubKey, period, { signal: controller.signal, force: attempt > 0 }).then((next) => {
      if (!controller.signal.aborted) setResult({ key, regulars: next });
    });
    return () => controller.abort();
  }, [pubKey, period, attempt, key]);

  const toggle = (on: boolean) => {
    setOptedIn(on);
    void updateProfile({ showAsPubRegular: on }).then((res) => {
      if (!res.ok) {
        setOptedIn(!on);
        toast({ kind: 'error', title: res.detail || t.nv.parta.failed, icon: 'circle-alert' });
        return;
      }
      setAttempt((n) => n + 1);
    });
  };

  const mine = regulars?.me;
  const listed = optedIn ?? mine?.optedIn ?? false;
  const meInList = regulars?.entries.some((entry) => entry.isMe) ?? false;
  const myRow: PubRegular | null =
    mine && listed && !meInList && mine.rank && mine.beers > 0
      ? { rank: mine.rank, beers: mine.beers, isMe: true, isFriend: false, account: { id: 'me', nickname: me.nick, displayName: me.displayName, avatarUrl: me.avatarUrl } }
      : null;
  const needsProfile = () =>
    router.push(!me.isSignedIn ? '/nv/prihlaseni' : !me.nick ? '/nv/dokoncit-ucet' : '/nv/upravit-profil');

  return (
    <Sheet title={L().regulars} top={90}>
      {params.name ? (
        <T s={14} c={C.muted} style={{ marginTop: -16 }}>
          {params.name}
        </T>
      ) : null}
      <ChipWrap>
        {PERIODS.map((p) => (
          <Chip key={p} label={L().regularsPeriods[p]} plain active={period === p} onPress={() => setPeriod(p)} />
        ))}
      </ChipWrap>
      {!regulars ? (
        failed ? (
          <View style={{ gap: 12, alignItems: 'center', paddingVertical: 24 }}>
            <T s={15} c={C.muted}>
              {L().regularsFailed}
            </T>
            <Button label={t.nv.parta.retry} kind="raised" height={42} onPress={() => setAttempt((n) => n + 1)} />
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            <Ghost height={52} radius={14} />
            <Ghost height={52} radius={14} />
            <Ghost height={52} radius={14} />
          </View>
        )
      ) : (
        <Animated.View entering={fadeIn} style={{ gap: 12 }}>
          {regulars.entries.length ? (
            <View>
              {regulars.entries.map((regular, i) => (
                <RegularLine key={regular.account.id} regular={regular} last={i === regulars.entries.length - 1} />
              ))}
            </View>
          ) : (
            <T s={15} c={C.text2} lh={1.4}>
              {L().regularsEmpty}
            </T>
          )}
          {myRow ? (
            <View style={{ paddingHorizontal: 14, borderRadius: 18, backgroundColor: C.yellowWash, borderWidth: 1, borderColor: C.yellowEdge }}>
              <RegularLine regular={myRow} last />
            </View>
          ) : null}
          {mine?.ghost ? null : mine?.eligible ? (
            <View style={{ gap: 6 }}>
              <Row
                last
                title={L().regularsOptIn}
                sub={L().regularsOptInSub(mine.beers, mine.rank)}
                trailing={<Toggle testID="regulars-opt-in" value={listed} onChange={toggle} />}
              />
              <T s={13} c={C.muted} lh={1.4}>
                {L().regularsOptInNote}
              </T>
            </View>
          ) : (
            <Row last title={L().regularsNeedsProfile} sub={L().regularsNeedsProfileSub} chevron onPress={needsProfile} />
          )}
          <T s={13} c={C.muted} lh={1.4}>
            {L().regularsNote}
          </T>
        </Animated.View>
      )}
    </Sheet>
  );
}
