import React, { useEffect, useRef, useState } from 'react';
import { View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import * as Location from 'expo-location';
import Animated from 'react-native-reanimated';
import { useIsFocused, useRouter, type Href } from 'expo-router';

import { checkLocationPermission, ensureLocationPermission } from '@/compass/permissions';
import { fetchOpenTourInvites, fetchTourRoster, type OpenTourInvite, type TourInviteRow } from '@/data/tourInvitesClient';
import { searchPublicTours, type PublicTourHit, type TourStopsFilter } from '@/data/toursClient';
import { friendDisplayName } from '@/friends/FriendMini';
import { intlLocale, t } from '@/i18n';
import { useAccountStore } from '@/stores/accountStore';
import { useToursStore } from '@/stores/toursStore';
import { describeRun, sortPlans, upcomingPlan } from '@/tours/glance';
import type { TourPlan } from '@/tours/model';
import { formatWalkDistance } from '@/tours/stopFacts';
import { pubCount, tourError } from '@/tours/TourChrome';

import { BackHeader, Screen } from '../../components/chrome';
import { Ghost, StatusCard } from '../../components/StatusCard';
import { Input, PageTitle, Ticket } from '../../components/forms';
import { Icon } from '../../components/Icon';
import { Button, Card, Chip, IconButton, Person, Press, Row, Segmented, Spinner, Stack, T, Tile } from '../../components/ui';
import { dialog, toast } from '../../ui/store';
import { fadeIn } from '../../motion';
import { C, s } from '../../theme';
import { planSummary, ticketDay, whenText } from './tourView';

const STOPS: (TourStopsFilter | null)[] = [null, '2-3', '4-5', '6-8'];
const HERO_TICKET_HEIGHT = 290;
// Three result rows of 80 inside a card.
const PUBLIC_GHOST_HEIGHT = 3 * 80 + 8;

export const planHref = (id: string) => ({ pathname: '/nv/tour-pruchod', params: { id } }) as unknown as Href;

/** Opens the editor on a new draft or the one already started. */
export async function openEditor(router: ReturnType<typeof useRouter>, id?: string): Promise<void> {
  const result = await useToursStore.getState().beginDraft(id);
  if (result.ok) {
    router.push('/nv/tour-editor');
    return;
  }
  if (result.error === 'busy') {
    dialog({ title: t.tours.continueDraft, actions: [{ label: t.tours.cancel }, { label: t.tours.open, kind: 'primary', onPress: () => router.push('/nv/tour-editor') }] });
    return;
  }
  toast({ kind: 'error', title: tourError(result.error) ?? t.tours.errors.network });
}

function planOrigin(plan: TourPlan): string | null {
  if (plan.source) return t.tours.imported;
  if (plan.publicSource) return t.tours.fromPublic;
  return plan.publication?.status === 'active' ? t.tours.publicState : null;
}

export function TourListScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<'moje' | 'verejne'>('moje');
  const store = useToursStore();
  const tx = t.nv.tour;
  const nearEndRef = useRef<(() => void) | null>(null);
  useEffect(() => { void useToursStore.getState().hydrate(); }, []);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = event.nativeEvent;
    if (layoutMeasurement.height + contentOffset.y > contentSize.height - 600) nearEndRef.current?.();
  };

  const more = () =>
    dialog({
      title: t.tours.mine,
      body: t.tours.localNotice,
      actions: [
        { label: t.tours.close },
        {
          label: t.tours.restore,
          kind: 'primary',
          onPress: () => {
            void useToursStore.getState().restorePublished().then((result) => {
              toast(result.ok ? { kind: 'saved', title: t.tours.restored, icon: 'route' } : { kind: 'error', title: tourError(result.error) ?? t.tours.errors.network });
            });
          },
        },
      ],
    });

  return (
    <Screen
      header={<BackHeader right={<IconButton icon="ellipsis" size={40} iconSize={18} label={tx.more} onPress={more} />} />}
      footer={
        tab === 'moje' ? (
          <Button label={store.draft ? t.tours.continueDraft : tx.create} icon="plus" disabled={!store.hydrated} onPress={() => void openEditor(router)} />
        ) : undefined
      }
      gap={16}
      scrollProps={{ onScroll, scrollEventThrottle: 200 }}
    >
      <PageTitle title={tx.title} />
      <Segmented
        height={38}
        options={[
          { key: 'moje', label: tx.tabMine },
          { key: 'verejne', label: tx.tabPublic },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'moje' ? (
        <>
          <InviteInbox />
          <MineTab />
        </>
      ) : (
        <PublicTab nearEndRef={nearEndRef} />
      )}
    </Screen>
  );
}

/** Friends' tours waiting for this account's answer, read from the server so a missed push never hides one. */
function InviteInbox() {
  const router = useRouter();
  const focused = useIsFocused();
  const plans = useToursStore((st) => st.plans);
  const hydrated = useToursStore((st) => st.hydrated);
  // Kept with the account it was read for: after a logout or switch the previous account's invites never show.
  const accountId = useAccountStore((st) => st.session?.accountId ?? null);
  const [found, setFound] = useState<{ accountId: string; invites: OpenTourInvite[] } | null>(null);
  useEffect(() => {
    if (!focused || !accountId) return;
    let alive = true;
    void fetchOpenTourInvites().then((result) => { if (alive) setFound({ accountId, invites: result.ok ? result.value : [] }); });
    return () => { alive = false; };
  }, [focused, accountId]);
  const invites = found && found.accountId === accountId ? found.invites : [];
  // A declined invite is answered; a going one stays until its tour is saved, so the list is the way back to a lost copy.
  const shown = invites.filter(
    (invite) => invite.status === 'invited' || (invite.status === 'going' && !plans.some((plan) => plan.source?.tourId === invite.planId && plan.source.token === invite.token)),
  );
  if (!hydrated || !shown.length) return null;
  return (
    <>
      <T s={17} w={700}>
        {t.tourInvites.inboxTitle}
      </T>
      <Card>
        {shown.map((invite, i) => (
          <Row
            key={invite.planId}
            last={i === shown.length - 1}
            height={72}
            leading={<Person initial={(invite.inviter.nickname || invite.inviter.displayName || '?').charAt(0).toUpperCase()} />}
            title={invite.title}
            titleWeight={700}
            sub={[t.tourInvites.invitedBy(friendDisplayName(invite.inviter)), whenText(invite), invite.firstPub || null].filter(Boolean).join(' · ')}
            chevron
            onPress={() => router.push({ pathname: '/nv/tour-verejna', params: { token: invite.token } } as unknown as Href)}
          />
        ))}
      </Card>
    </>
  );
}

function MineTab() {
  const router = useRouter();
  const store = useToursStore();
  const tx = t.nv.tour;
  const active = store.activeRun;
  const upcoming = active ? undefined : upcomingPlan(store.plans);
  const heroPlan = active ? store.plans.find((p) => p.id === active.planId) : (upcoming ?? sortPlans(store.plans)[0]);
  const others = sortPlans(store.plans.filter((plan) => plan.id !== heroPlan?.id && plan.id !== active?.planId));

  // Tours live on the phone, so this only waits for local storage; the stand-in is the size of the hero ticket.
  if (!store.hydrated) return <Ghost height={HERO_TICKET_HEIGHT} />;
  if (store.error && !store.plans.length && !store.runs.length) {
    return <StatusCard text={tourError(store.error) ?? t.tours.errors.storage} />;
  }
  if (!active && !heroPlan && !store.draft && !store.runs.length) {
    return <StatusCard text={tx.empty} />;
  }
  return (
    <>
      {active ? <ActiveHero /> : heroPlan ? <PlanHero plan={heroPlan} upcoming={!!upcoming} /> : null}
      {store.draft || others.length ? (
        <>
          <T s={17} w={700}>
            {tx.otherTours}
          </T>
          <Card>
            {store.draft ? (
              <Row
                last={!others.length}
                leading={<Tile icon="pencil" color={C.white} />}
                title={store.draft.title.trim() || t.tours.untitled}
                sub={`${t.tours.draft} · ${pubCount(store.draft.stops.length)}`}
                chevron
                onPress={() => router.push('/nv/tour-editor')}
              />
            ) : null}
            {others.map((plan, i) => (
              <Row
                key={plan.id}
                last={i === others.length - 1}
                leading={<Tile icon="route" color={C.white} />}
                title={plan.title}
                sub={[whenText(plan) ?? t.tours.optional, pubCount(plan.stops.length), planOrigin(plan)].filter(Boolean).join(' · ')}
                chevron
                onPress={() => router.push(planHref(plan.id))}
              />
            ))}
          </Card>
        </>
      ) : null}
      {store.runs.length ? (
        <>
          <T s={17} w={700} c={C.muted}>
            {tx.pastRuns}
          </T>
          <Card>
            {store.runs.map((run, i) => {
              const glance = describeRun(run);
              return (
                <Row
                  key={run.id}
                  last={i === store.runs.length - 1}
                  leading={<Tile icon="flag" color={C.text2} />}
                  title={run.snapshot.title}
                  sub={`${new Date(run.startedAt).toLocaleDateString(intlLocale)} · ${t.tours.progress(glance.visited, glance.total)}`}
                  chevron
                  onPress={() => router.push({ pathname: '/nv/tour-historie', params: { run: run.id } } as unknown as Href)}
                />
              );
            })}
          </Card>
        </>
      ) : null}
    </>
  );
}

function ActiveHero() {
  const router = useRouter();
  const run = useToursStore((s) => s.activeRun);
  if (!run) return null;
  const glance = describeRun(run);
  const started = new Date(run.startedAt);
  const localDate = `${started.getFullYear()}-${String(started.getMonth() + 1).padStart(2, '0')}-${String(started.getDate()).padStart(2, '0')}`;
  const day = ticketDay({ scheduledDate: localDate, scheduledTime: started.toLocaleTimeString(intlLocale, { hour: 'numeric', minute: '2-digit' }) });
  const crew = run.crew && !run.crew.refused ? (run.crew.members ?? []).filter((m) => !m.left) : [];
  return (
    <Press onPress={() => router.push(planHref(run.planId))}>
      <Ticket
        big
        kicker={t.tours.active}
        kickerIcon="footprints"
        dayNum={day.dayNum}
        dayName={day.dayName}
        time={day.time}
        title={run.snapshot.title}
        quote={[t.tours.runOf(glance.visited, glance.total), glance.next ? t.tours.nextPub(glance.next.name, glance.minutes) : null].filter(Boolean).join(' · ')}
        stub={
          <View style={[s.row, { gap: 10, height: 40, paddingHorizontal: 4 }]}>
            {crew.length ? <Stack initials={crew.slice(0, 3).map((m) => m.nickname.charAt(0).toUpperCase())} /> : null}
            <T s={14} w={600} c={C.text2} style={s.fill}>
              {crew.length > 1 ? t.tours.crewGoing(crew.length) : t.tours.crewAlone}
            </T>
            <T s={14} w={700}>
              {t.tours.open}
            </T>
            <Icon name="chevron-right" size={14} />
          </View>
        }
      />
    </Press>
  );
}

/** Invited friends and their answers, for a plan the server knows. Null until loaded or when it cannot load. */
export function useRoster(plan: TourPlan | undefined): TourInviteRow[] | null {
  const focused = useIsFocused();
  const [roster, setRoster] = useState<{ id: string; rows: TourInviteRow[] } | null>(null);
  const onServer = !!plan && !plan.source && plan.revision > 0;
  const id = plan?.id;
  useEffect(() => {
    if (!focused || !onServer || !id) return;
    let alive = true;
    void fetchTourRoster(id).then((result) => { if (alive && result.ok) setRoster({ id, rows: result.value }); });
    return () => { alive = false; };
  }, [focused, onServer, id]);
  return roster && roster.id === id ? roster.rows : null;
}

export function RosterStub({ roster, onPress }: { roster: TourInviteRow[] | null; onPress?: () => void }) {
  const going = (roster ?? []).filter((row) => row.status === 'going');
  const body = (
    <View style={[s.row, { gap: 10, height: 40, paddingHorizontal: 4 }]}>
      {going.length ? <Stack initials={going.slice(0, 3).map((row) => (row.friend.nickname || row.friend.displayName || '?').charAt(0).toUpperCase())} /> : <Icon name="user-plus" size={18} color={C.yellow} />}
      <T s={14} w={600} c={C.text2} style={s.fill}>
        {roster?.length ? t.tourInvites.rosterSummary(roster.length, going.length) : t.tourInvites.invite}
      </T>
      <T s={14} w={700}>
        {t.nv.tour.whoGoes}
      </T>
      <Icon name="chevron-right" size={14} />
    </View>
  );
  return onPress ? <Press onPress={onPress}>{body}</Press> : body;
}

function PlanHero({ plan, upcoming }: { plan: TourPlan; upcoming: boolean }) {
  const router = useRouter();
  const roster = useRoster(plan);
  const day = ticketDay(plan);
  const origin = planOrigin(plan);
  return (
    <Press onPress={() => router.push(planHref(plan.id))}>
      <Ticket
        big
        kicker={upcoming ? t.nv.tour.nearest : t.tours.ready}
        kickerIcon="route"
        dayNum={day.dayNum}
        dayName={day.dayName}
        time={day.time}
        title={plan.title}
        quote={[planSummary(plan.stops), origin].filter(Boolean).join(' · ')}
        stub={<RosterStub roster={plan.source ? null : roster} />}
      />
    </Press>
  );
}

type Position = { lat: number; lon: number };

/** One fix, never longer than a few seconds; indoors a fresh fix can take ages. */
async function readPosition(): Promise<Position | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000));
  const fix = (async () => {
    try {
      const found =
        (await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000, requiredAccuracy: 200 })) ??
        (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, mayShowUserSettingsDialog: false }));
      const { latitude, longitude } = found.coords;
      return Number.isFinite(latitude) && Number.isFinite(longitude) ? { lat: latitude, lon: longitude } : null;
    } catch {
      return null;
    }
  })();
  return Promise.race([fix, timeout]);
}

const tileDistance = (meters: number) => (meters >= 10000 ? `${Math.round(meters / 1000).toLocaleString(intlLocale)} km` : formatWalkDistance(meters));

type Failure = 'offline' | 'failed';

function PublicTab({ nearEndRef }: { nearEndRef: React.RefObject<(() => void) | null> }) {
  const router = useRouter();
  const tx = t.nv.tour;
  const hidden = useToursStore((st) => st.hiddenPublic);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState<Position | null>(null);
  const [locating, setLocating] = useState(false);
  const [stops, setStops] = useState<TourStopsFilter | null>(null);
  const [challenges, setChallenges] = useState(false);
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ key: string; hits: PublicTourHit[] | null; nearby: boolean; nextPage: number | null; failure: Failure | null } | null>(null);
  // The next page of the search in `key`; a failed one waits for a tap so scrolling does not hammer a dead connection.
  const [more, setMore] = useState<{ key: string; failure: Failure | null } | null>(null);
  const moreFor = useRef<string | null>(null);
  const term = /[\p{L}\p{N}]/u.test(query.trim()) ? query.trim() : '';
  const key = JSON.stringify([term, position, stops, challenges, retry]);
  const liveKey = useRef(key);
  useEffect(() => { liveKey.current = key; }, [key]);

  // With location already allowed, nearby tours come first; asking waits for a tap on "Kolem mě".
  useEffect(() => {
    let alive = true;
    void checkLocationPermission()
      .then(async (state) => {
        const fix = state === 'granted' ? await readPosition() : null;
        if (alive && fix) setPosition(fix);
      })
      .catch(() => undefined)
      .finally(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => {
      void searchPublicTours({ q: term, ...(position ?? {}), stops, challenges }).then((r) => {
        if (liveKey.current !== key) return;
        setResult(
          r.ok
            ? { key, hits: r.results, nearby: r.nearby, nextPage: r.nextPage, failure: null }
            : { key, hits: null, nearby: true, nextPage: null, failure: r.offline ? 'offline' : 'failed' },
        );
      });
    }, term ? 350 : 0);
    return () => clearTimeout(timer);
  }, [ready, key, term, position, stops, challenges]);

  const current = result?.key === key ? result : null;
  const pending = more?.key === key ? more : null;

  async function loadMore(again = false) {
    const asked = key;
    const page = current?.nextPage;
    if (page == null || moreFor.current === asked || (pending?.failure && !again)) return;
    moreFor.current = asked;
    setMore({ key: asked, failure: null });
    const r = await searchPublicTours({ q: term, ...(position ?? {}), stops, challenges, page });
    if (moreFor.current === asked) moreFor.current = null;
    if (liveKey.current !== asked) return;
    if (!r.ok) {
      setMore({ key: asked, failure: r.offline ? 'offline' : 'failed' });
      return;
    }
    setMore(null);
    setResult((prev) => {
      if (prev?.key !== asked || !prev.hits) return prev;
      const seen = new Set(prev.hits.map((hit) => hit.id));
      return { ...prev, nextPage: r.nextPage, hits: [...prev.hits, ...r.results.filter((hit) => !seen.has(hit.id))] };
    });
  }

  useEffect(() => {
    nearEndRef.current = () => void loadMore();
    return () => { nearEndRef.current = null; };
  });

  async function nearMe() {
    if (position) {
      setPosition(null);
      return;
    }
    setLocating(true);
    const state = await ensureLocationPermission();
    const fix = state === 'granted' ? await readPosition() : null;
    setLocating(false);
    if (fix) setPosition(fix);
    else toast({ kind: 'info', title: t.tours.discoverNoLocation, icon: 'navigation' });
  }

  const hits = (current?.hits ?? []).filter((hit) => !(hidden ?? []).includes(hit.id));
  const filtered = !!stops || challenges;
  const stopIndex = STOPS.indexOf(stops);
  return (
    <>
      <Input icon="search" placeholder={tx.searchPublic} value={query} onChangeText={setQuery} returnKeyType="search" autoCorrect={false} />
      <View style={[s.row, { gap: 8, flexWrap: 'wrap' }]}>
        <Chip label={tx.nearMe} icon="navigation" active={!!position} onPress={() => void nearMe()} />
        <Chip label={stops ? t.tours.discoverStopsRange[stops] : tx.stopCount} trailing="chevron-down" active={!!stops} onPress={() => setStops(STOPS[(stopIndex + 1) % STOPS.length])} />
        <Chip label={tx.withChallenges} icon="flag" active={challenges} onPress={() => setChallenges(!challenges)} />
      </View>
      {!current || locating ? (
        <Ghost height={PUBLIC_GHOST_HEIGHT} />
      ) : current.failure ? (
        <StatusCard
          text={current.failure === 'offline' ? t.tours.discoverOffline : t.tours.discoverFailed}
          action={t.tours.retry}
          actionIcon="refresh-cw"
          onAction={() => setRetry((r) => r + 1)}
        />
      ) : !hits.length ? (
        <StatusCard
          text={term ? t.tours.discoverNothingFor(term) : filtered ? t.tours.discoverNothingFiltered : t.tours.discoverNothing}
          action={filtered ? t.tours.discoverClearFilters : undefined}
          onAction={() => {
            setStops(null);
            setChallenges(false);
          }}
        />
      ) : (
        <Animated.View entering={fadeIn} style={{ gap: 16 }}>
          {position && !term && !current.nearby ? (
            <T s={13} c={C.muted} lh={1.4}>
              {filtered ? t.tours.discoverNothingNearFiltered : t.tours.discoverNothingNear}
            </T>
          ) : null}
          <Card>
            {hits.map((hit, i) => (
              <Row
                key={hit.id}
                last={i === hits.length - 1}
                height={80}
                leading={
                  hit.distanceM === null ? (
                    <Tile icon="route" color={C.white} size={44} />
                  ) : (
                    <View style={[{ width: 56, height: 44, borderRadius: 12, backgroundColor: C.control }, s.center]}>
                      <T s={13} w={800} numberOfLines={1} adjustsFontSizeToFit>
                        {tileDistance(hit.distanceM)}
                      </T>
                    </View>
                  )
                }
                title={hit.title}
                titleWeight={700}
                sub={
                  <View>
                    <T s={13} c={C.text2}>
                      {t.tours.publicMeta(hit.city, pubCount(hit.stopCount), formatWalkDistance(hit.walkM))}
                    </T>
                    <T s={13} c={C.muted}>
                      {[`@${hit.author.nickname}`, hit.peopleCount > 0 ? t.tours.discoverPeople(hit.peopleCount) : null, hit.hasChallenges ? t.tours.discoverWithChallenges : null].filter(Boolean).join(' · ')}
                    </T>
                  </View>
                }
                chevron
                onPress={() => router.push({ pathname: '/nv/tour-verejna', params: { token: hit.token } } as unknown as Href)}
              />
            ))}
          </Card>
          {pending?.failure ? (
            <StatusCard
              text={pending.failure === 'offline' ? t.tours.discoverOffline : t.tours.discoverFailed}
              action={t.tours.retry}
              actionIcon="refresh-cw"
              onAction={() => void loadMore(true)}
            />
          ) : pending ? (
            <Spinner accessibilityLabel={t.tours.loading} style={{ paddingVertical: 8 }} />
          ) : null}
        </Animated.View>
      )}
    </>
  );
}
