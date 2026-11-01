import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Share, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { fetchSharedTour, fetchTourRunPreview, type PublicTourInfo, type TourRunPreview } from '@/data/toursClient';
import { tourBoundary } from '@/data/toursBoundary';
import { answerTourInvite, fetchMyTourInvite, type MyTourInvite } from '@/data/tourInvitesClient';
import { friendDisplayName } from '@/friends/FriendMini';
import { t } from '@/i18n';
import { selectIsSignedIn, selectNickname, useAccountStore } from '@/stores/accountStore';
import { useToursStore } from '@/stores/toursStore';
import { uuidValid, type TourPlan } from '@/tours/model';
import { formatWalkDistance } from '@/tours/stopFacts';
import { pubCount, tourError } from '@/tours/TourChrome';

import { BackHeader, Screen } from '../../components/chrome';
import { PageTitle } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Button, Card, IconButton, Person, Row, Stack, T } from '../../components/ui';
import { dialog, toast } from '../../ui/store';
import { C, s } from '../../theme';
import { planHref } from './TourListScreen';
import { StopRail, TourMap } from './TourParts';
import { planSummary, whenText } from './tourView';

const initial = (name: string | null | undefined) => (name || '?').charAt(0).toUpperCase();

/** A tour opened from a link: public (`token`), a party QR (`token` + `r`), or a friend's private share. */
export function TourPublicScreen() {
  const { token, r } = useLocalSearchParams<{ token?: string; r?: string }>();
  const runId = uuidValid(r) ? r : undefined;
  return <PublicTour key={`${token ?? ''}:${runId ?? ''}`} token={token ?? ''} runId={runId} />;
}

function PublicTour({ token, runId }: { token: string; runId?: string }) {
  const router = useRouter();
  const tx = t.nv.tour;
  const store = useToursStore();
  const [plan, setPlan] = useState<TourPlan | null>(null);
  const [info, setInfo] = useState<PublicTourInfo | null>(null);
  const [preview, setPreview] = useState<TourRunPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const signedIn = useAccountStore(selectIsSignedIn);
  const crewEligible = useAccountStore((st) => selectIsSignedIn(st) && !!selectNickname(st));
  const accountId = useAccountStore((st) => st.session?.accountId ?? null);
  // A friend's invite to this private tour, kept with the plan and account it was read for.
  const [found, setFound] = useState<{ key: string; invite: MyTourInvite | null } | null>(null);
  const [answering, setAnswering] = useState(false);
  const answerLock = useRef(false);

  useEffect(() => {
    let alive = true;
    const generation = tourBoundary().generation;
    void useToursStore.getState().hydrate();
    void fetchSharedTour(token).then((result) => {
      if (!alive) return;
      setLoading(false);
      if (generation !== tourBoundary().generation) {
        setError(t.tours.errors.session);
        return;
      }
      if (!result.ok) {
        setError(result.error === 'expired' ? t.tours.invalidLink : t.tours.errors.network);
        return;
      }
      setPlan(result.tour);
      setInfo(result.public ?? null);
      // The run has to belong to this tour, or the screen would show another tour's party.
      if (result.public && runId) void fetchTourRunPreview(runId, result.public.id).then((next) => { if (alive) setPreview(next); });
    });
    return () => { alive = false; };
  }, [token, runId, retry]);

  // Only an existing account can have been invited; opening a link must not create one just to ask.
  const privatePlanId = plan && !info ? plan.id : null;
  useEffect(() => {
    if (!privatePlanId || !accountId) return;
    let alive = true;
    const generation = tourBoundary().generation;
    const key = `${privatePlanId}:${accountId}`;
    void fetchMyTourInvite(privatePlanId).then((mine) => {
      if (alive) setFound({ key, invite: mine.ok && generation === tourBoundary().generation ? mine.value : null });
    });
    return () => { alive = false; };
  }, [privatePlanId, accountId]);
  const inviteKey = privatePlanId && accountId ? `${privatePlanId}:${accountId}` : null;
  const invite = found && found.key === inviteKey ? found.invite : null;

  const own = info ? store.plans.find((p) => p.publication?.token === token) : undefined;
  const authored = !!info && !!accountId && info.author.id === accountId;
  const existing = plan ? store.plans.find((p) => (info ? p.publicSource?.publicId === info.id : p.source?.tourId === plan.id)) : undefined;
  const update = !info && !!existing?.source && existing.source.revision < (plan?.revision ?? 0);
  const reported = !!info && (store.hiddenPublic ?? []).includes(info.id);
  const joining = !!runId && !!info && !reported;

  async function join() {
    if (!runId) return;
    // The party knows each other by nickname, so a walker without one picks it first.
    if (!crewEligible) {
      router.push(signedIn ? '/nv/upravit-profil' : '/nv/prihlaseni');
      return;
    }
    const go = async () => {
      const result = await useToursStore.getState().joinCrew(token, runId, plan && info ? { tour: plan, public: info } : undefined);
      if (result.ok && result.id) router.replace(planHref(result.id));
      else if (!result.ok) toast({ kind: 'error', title: tourError(result.error) ?? t.tours.errors.network });
    };
    if (useToursStore.getState().activeRun) {
      dialog({
        title: t.tours.crewActiveRun,
        body: t.tours.crewActiveRunMessage,
        actions: [
          { label: t.tours.cancel },
          { label: t.tours.crewEndAndJoin, kind: 'primary', onPress: () => void useToursStore.getState().endRun().then((ended) => { if (ended.ok) void go(); }) },
        ],
      });
    } else await go();
  }

  async function save() {
    const opened = own ?? (!update ? existing : undefined);
    if (opened) {
      router.replace(planHref(opened.id));
      return;
    }
    const result = info ? await store.savePublic(token, plan ? { tour: plan, public: info } : undefined) : await store.importShared(token, update);
    if (!result.ok) {
      toast({ kind: 'error', title: tourError(result.error) ?? t.tours.errors.network });
      return;
    }
    toast({ kind: 'saved', title: tx.savedToMine, icon: 'bookmark' });
  }

  /** "Jdu" also saves the tour to the phone, so the plan is there for the walk. */
  async function answer(status: 'going' | 'declined') {
    if (!plan || answerLock.current) return;
    answerLock.current = true;
    setAnswering(true);
    try {
      if (status === 'going' && !(existing && !update && existing.source?.token === token)) {
        const saved = await useToursStore.getState().importShared(token, update);
        if (!saved.ok) {
          toast({ kind: 'error', title: tourError(saved.error) ?? t.tours.errors.network });
          return;
        }
      }
      const result = await answerTourInvite(plan.id, status);
      if (!result.ok) toast({ kind: 'error', title: result.error === 'not_found' ? t.tourInvites.errors.gone : t.tourInvites.errors.answer });
      else if (inviteKey) setFound({ key: inviteKey, invite: result.value });
    } finally {
      answerLock.current = false;
      setAnswering(false);
    }
  }

  function report() {
    if (!info) return;
    const id = info.id;
    dialog({
      title: t.tours.reportTitle,
      body: t.tours.reportMessage,
      actions: [
        { label: t.tours.cancel },
        {
          label: t.tours.report,
          kind: 'danger',
          onPress: () =>
            void useToursStore.getState().reportPublic(id).then((r) => {
              toast(r.ok ? { kind: 'saved', title: t.tours.reported, icon: 'flag' } : { kind: 'error', title: t.tours.reportFailed });
              if (r.ok) router.back();
            }),
        },
      ],
    });
  }

  const busy = store.busy || answering;
  const footer = !plan ? undefined : reported ? (
    <Button label={t.tours.backToTours} kind="raised" onPress={() => router.back()} />
  ) : joining ? (
    <View style={{ gap: 12 }}>
      <View style={[s.row, { gap: 8, alignItems: 'flex-start' }]}>
        <Icon name="lock" size={14} color={C.muted} />
        <T s={13} c={C.muted} style={s.fill}>
          {t.tours.crewJoinPrivacy}
        </T>
      </View>
      <Button label={crewEligible ? t.tours.crewJoin : signedIn ? t.tours.pickNickname : t.tours.crewSignInJoin} icon="footprints" disabled={busy} onPress={() => void join()} />
    </View>
  ) : invite && !info ? (
    invite.status === 'invited' ? (
      <View style={[s.row, { gap: 10 }]}>
        <Button label={t.tourInvites.notGoing} kind="raised" disabled={busy} onPress={() => void answer('declined')} style={{ paddingHorizontal: 24 }} />
        <Button label={t.tourInvites.going} icon="check" flex disabled={busy} onPress={() => void answer('going')} />
      </View>
    ) : invite.status === 'declined' ? (
      <Button label={t.tourInvites.changeToGoing} disabled={busy} onPress={() => void answer('going')} />
    ) : (
      <View style={{ gap: 10 }}>
        <Button label={update ? t.tours.update : existing ? t.tours.openSaved : t.tours.import} icon="bookmark" disabled={busy} onPress={() => void save()} />
        <Button label={t.tourInvites.changeToNotGoing} kind="raised" disabled={busy} onPress={() => void answer('declined')} />
      </View>
    )
  ) : (
    <Button label={own ? t.tours.open : update ? t.tours.update : existing ? t.tours.openSaved : tx.saveTour} icon="bookmark" disabled={busy} onPress={() => void save()} />
  );

  return (
    <Screen
      header={
        <BackHeader
          right={
            info && !reported ? (
              <>
                {!own && !authored ? <IconButton icon="flag" size={40} iconSize={18} label={t.tours.report} onPress={report} /> : null}
                <IconButton icon="share" size={40} iconSize={18} label={t.tours.shareLink} onPress={() => void Share.share({ message: `https://na-pivo.cz/t/${token}` }).catch(() => undefined)} />
              </>
            ) : undefined
          }
        />
      }
      footer={footer}
      gap={16}
    >
      {loading ? (
        <ActivityIndicator color={C.yellow} style={{ marginTop: 24 }} />
      ) : error || !plan ? (
        <View style={{ gap: 12 }}>
          <T s={15} c={C.text2} lh={1.4}>
            {error ?? t.tours.invalidLink}
          </T>
          <Button label={t.tours.retry} kind="raised" icon="refresh-cw" onPress={() => { setError(null); setLoading(true); setRetry((n) => n + 1); }} />
        </View>
      ) : reported ? (
        <T s={15} c={C.text2} lh={1.4}>
          {t.tours.reported}
        </T>
      ) : (
        <>
          <PageTitle kicker={info ? t.tours.publicTour : t.tours.invite} title={plan.title} />
          <T s={15} c={C.text2} style={{ marginTop: -8 }}>
            {info ? t.tours.publicMeta(info.city, pubCount(plan.stops.length), formatWalkDistance(info.walkM)) : [whenText(plan) ?? t.tours.optional, planSummary(plan.stops)].join(' · ')}
          </T>
          {info ? (
            <View style={[s.row, { gap: 8 }]}>
              {joining && preview ? (
                <Stack initials={(preview.members.length ? preview.members : [preview.organizer]).slice(0, 4).map((member) => initial(member.nickname))} />
              ) : (
                <Icon name="users" size={16} color={C.text2} />
              )}
              <T s={14} w={600} style={s.fill}>
                {joining && preview
                  ? preview.going > 1
                    ? t.tours.crewAlreadyGoing(`@${preview.organizer.nickname}`, preview.going - 1)
                    : t.tours.crewInvitedBy(`@${preview.organizer.nickname}`)
                  : t.tours.peopleCount(info.peopleCount)}
              </T>
            </View>
          ) : invite ? (
            <View style={{ gap: 6 }}>
              <View style={[s.row, { gap: 8 }]}>
                <Person initial={initial(friendDisplayName(invite.inviter))} size={28} ring={false} />
                <T s={14} w={600} style={s.fill}>
                  {t.tourInvites.invitedBy(friendDisplayName(invite.inviter))}
                </T>
              </View>
              {invite.status !== 'invited' ? (
                <T s={13} c={C.text2}>
                  {invite.status === 'going' ? t.tourInvites.answeredGoing : t.tourInvites.answeredDeclined}
                </T>
              ) : null}
            </View>
          ) : null}
          {info ? (
            <Card>
              <Row
                last
                leading={<Person initial={initial(info.author.nickname)} />}
                title={`@${info.author.nickname}`}
                sub={info.author.displayName || undefined}
                chevron
                onPress={() => router.push({ pathname: '/nv/kamos/[id]', params: { id: info.author.id } } as unknown as Href)}
              />
            </Card>
          ) : null}
          {update ? (
            <View style={{ gap: 6, padding: 14, borderRadius: 18, backgroundColor: C.card }}>
              <T s={15} w={700}>
                {t.tours.importUpdate}
              </T>
              <T s={13} c={C.text2} lh={1.4}>
                {t.tours.updateMessage}
              </T>
            </View>
          ) : null}
          <TourMap stops={plan.stops} height={130} planning />
          <T s={17} w={700}>
            {t.tours.stops}
          </T>
          <StopRail stops={plan.stops} next={-1} />
          {!joining ? (
            <T s={13} c={C.muted} lh={1.4}>
              {invite && !info ? t.tourInvites.answerVisible(friendDisplayName(invite.inviter)) : t.tours.runPrivacy}
            </T>
          ) : null}
        </>
      )}
    </Screen>
  );
}
