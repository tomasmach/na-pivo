import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { CloseButton } from '@/components/shared/CloseButton';
import { BeerIcon, MapPinIcon, PlusIcon, StarIcon } from '@/components/shared/IconGlyph';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import {
  contributeParamsFromPubInfo,
  pubInfoFromPub,
} from '@/components/amenities/pubInfoContext';
import { geohash8 } from '@/data/geohash';
import { formatVolume, t } from '@/i18n';
import { leaveRoute } from '@/navigation/leaveRoute';
import {
  fetchPubNightsFeed,
  type PublishedNight,
} from '@/data/nightsClient';
import type { WireVisit } from '@/data/visitsClient';
import { useLivePartyStore } from '@/mocks/livePartyStore';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { SectionBreak } from '@/mocks/SectionBreak';
import { StatGrid } from '@/mocks/StatGrid';
import {
  formatLastVisit,
  presentPub,
  type PubPosition,
  type PubPresentation,
} from '@/pubs/pubPresentation';
import { usePubDetails } from '@/pubs/usePubDetails';
import { PubAmenitySection } from '@/pubs/PubAmenitySection';
import { PubDetailActions } from '@/pubs/PubDetailActions';
import { buildOpeningHoursRows, resolveDetailBeers } from '@/pubs/pubDetailModel';
import { PubEventsSection } from '@/pubEvents/PubEventsSection';
import {
  selectConfirmedPartyJoinCode,
  selectPartyJoinCode,
  usePartyEveningStore,
} from '@/stores/partyEveningStore';
import { useAccountStore } from '@/stores/accountStore';
import {
  isBeerMenuTypeOverrideCurrent,
  isHoursOverrideCurrent,
  useCommunityStore,
} from '@/stores/communityStore';
import { generateJoinCode } from '@/data/partyClient';
import { flushPartyBeerWrites } from '@/party/logBeer';
import { enqueuePartyPubTransition } from '@/party/partyPubVisits';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { openPubInMaps } from '@/utils/maps';
import { NightCard } from '@/vycep/NightCard';

function PillAction({
  label,
  children,
  primary,
  onPress,
}: {
  label: string;
  children: React.ReactNode;
  primary?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
      <Text
        style={[styles.actionLabel, primary && styles.actionLabelPrimary]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function EmptyEditRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.emptyEditRow, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <PlusIcon size={18} color={Colors.amber} />
      <Text style={styles.emptyEditLabel} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </Pressable>
  );
}

const TABS = t.pubDetail.tabs;
/** Stable keys; TABS holds the labels in the same order. */
const TAB_KEYS = ['info', 'activity'] as const;
type PubDetailTab = (typeof TAB_KEYS)[number];
const tabLabel = (key: PubDetailTab) => TABS[TAB_KEYS.indexOf(key)];
const tabFromLabel = (label: string): PubDetailTab =>
  TAB_KEYS[(TABS as readonly string[]).indexOf(label)] ?? 'info';

type ActivityState =
  | { status: 'loading'; nights: PublishedNight[]; nextCursor: null }
  | { status: 'ready'; nights: PublishedNight[]; nextCursor: string | null }
  | { status: 'error'; nights: PublishedNight[]; nextCursor: string | null };

const LOADING_ACTIVITY: ActivityState = {
  status: 'loading',
  nights: [],
  nextCursor: null,
};

function openStatusColor(pub: PubPresentation): string {
  if (pub.openState === 'open') return Colors.open;
  if (pub.openState === 'closed') return Colors.closed;
  return Colors.mutedText;
}

export function PubDetailBody({
  pub: initialPub,
  position,
  visits = [],
  onClose,
}: {
  pub: PubPresentation;
  position: PubPosition | null;
  visits?: readonly WireVisit[];
  onClose?: () => void;
}) {
  // The amenity API identifies a place by the catalogue name it was opened
  // with. A local rename changes the display name immediately, but must not
  // silently create a second amenity identity for the same open detail.
  const [amenityIdentityName] = React.useState(() => initialPub.pub.name);
  const [tab, setTab] = React.useState<PubDetailTab>('info');
  const [renamed, setRenamed] = React.useState<{ id: string; name: string | null }>({
    id: initialPub.pub.id,
    name: null,
  });
  const [activityNonce, setActivityNonce] = React.useState(0);
  const viewerAccountId = useAccountStore((state) => state.session?.accountId ?? null);
  const [activityResource, setActivityResource] = React.useState<{
    viewerAccountId: string;
    state: ActivityState;
  } | null>(null);
  const [activityLoadingMoreFor, setActivityLoadingMoreFor] = React.useState<string | null>(null);
  const [activityMoreErrorFor, setActivityMoreErrorFor] = React.useState<string | null>(null);
  const moreControllerRef = React.useRef<AbortController | null>(null);
  const activity =
    activityResource?.viewerAccountId === viewerAccountId
      ? activityResource.state
      : LOADING_ACTIVITY;
  const activityLoadingMore = activityLoadingMoreFor === viewerAccountId;
  const activityMoreError = activityMoreErrorFor === viewerAccountId;
  const detailedPub = usePubDetails(initialPub.pub);
  const renamedName = renamed.id === initialPub.pub.id ? renamed.name : null;
  const namedDetailedPub = React.useMemo(
    () => (renamedName ? { ...detailedPub, name: renamedName } : detailedPub),
    [detailedPub, renamedName],
  );
  const pub = React.useMemo(
    () => presentPub(namedDetailedPub, position, visits),
    [namedDetailedPub, position, visits],
  );
  const router = useRouter();
  const startLocalParty = useLivePartyStore((state) => state.start);
  const setLocalPub = useLivePartyStore((state) => state.setPub);
  const picking = useLivePartyStore((state) => state.pickingPub);
  const endPicking = useLivePartyStore((state) => state.endPickingPub);
  const localPartyLive = useLivePartyStore((state) => state.live);
  const sharedEveningCode = usePartyEveningStore(selectPartyJoinCode);
  const confirmedEveningCode = usePartyEveningStore(selectConfirmedPartyJoinCode);
  const sharedEveningBusy = usePartyEveningStore((state) => state.busy);
  const startSharedEvening = usePartyEveningStore((state) => state.start);

  React.useEffect(() => {
    if (!viewerAccountId) return;
    let active = true;
    const controller = new AbortController();
    const requestedViewer = viewerAccountId;
    const kickoff = setTimeout(() => {
      setActivityResource({ viewerAccountId: requestedViewer, state: LOADING_ACTIVITY });
      void fetchPubNightsFeed(initialPub.name, undefined, controller.signal).then((result) => {
        if (
          !active ||
          useAccountStore.getState().session?.accountId !== requestedViewer
        ) return;
        setActivityResource({
          viewerAccountId: requestedViewer,
          state: result.ok
            ? {
                status: 'ready',
                nights: result.nights,
                nextCursor: result.nextCursor,
              }
            : { status: 'error', nights: [], nextCursor: null },
        });
      });
    }, 0);
    return () => {
      active = false;
      clearTimeout(kickoff);
      controller.abort();
      moreControllerRef.current?.abort();
    };
  }, [activityNonce, initialPub.name, viewerAccountId]);

  const primaryLabel = picking ? t.pubDetail.chooseHere : t.pubDetail.startHere;
  const houseBeer = pub.featuredTap?.name ?? t.pubDetail.beerFallback;
  const pubKey = geohash8(pub.pub.lat, pub.pub.lng);
  const communityOverride = useCommunityStore((state) => state.overrides[pubKey]);
  const weeklyHours = isHoursOverrideCurrent(communityOverride, pub.pub.hoursUpdatedAt)
    ? communityOverride?.hours ?? null
    : pub.pub.communityHours ?? null;
  const openingRows = React.useMemo(
    () => buildOpeningHoursRows(weeklyHours, pub.pub.openingHours, t.pubDetail.openingClosed),
    [pub.pub.openingHours, weeklyHours],
  );
  const taps = React.useMemo(
    () => resolveDetailBeers(pub.pub, communityOverride),
    [communityOverride, pub.pub],
  );
  const menuRotates = isBeerMenuTypeOverrideCurrent(communityOverride, pub.pub.beersUpdatedAt)
    ? communityOverride?.beerMenuRotates
    : pub.pub.beerMenuRotates;
  const pubInfo = React.useMemo(
    () => ({
      ...pubInfoFromPub(pub.pub),
      name: pub.name,
      prefillHours: weeklyHours,
      prefillBeers: taps,
      beerMenuRotates: menuRotates,
    }),
    [menuRotates, pub.name, pub.pub, taps, weeklyHours],
  );
  const partyTaps = taps.flatMap((tap) => {
    const name = tap.name.trim();
    return name
      ? [{ name, priceCzk: typeof tap.priceCzk === 'number' ? tap.priceCzk : null }]
      : [];
  });

  const openContribution = (focus: 'hours' | 'beers') => {
    router.push({
      pathname: '/contribute',
      params: contributeParamsFromPubInfo(pubInfo, focus, menuRotates),
    } as unknown as Href);
  };

  const closeAfterReport = () => {
    if (onClose) onClose();
    else leaveRoute(router);
  };

  const startHere = () => {
    const partyArgs = [
      pub.name,
      houseBeer,
      pubKey,
      partyTaps,
      pub.pub.city,
      pub.pub.googlePlaceId,
    ] as const;
    const transition = picking
      ? setLocalPub(...partyArgs)
      : localPartyLive
        ? setLocalPub(...partyArgs)
        : startLocalParty(...partyArgs);

    const shouldEnsureTable = !picking || localPartyLive;
    let stagedCode = sharedEveningCode;
    let table: ReturnType<typeof startSharedEvening> | null = null;
    if (shouldEnsureTable && !sharedEveningCode && !sharedEveningBusy) {
      stagedCode = generateJoinCode();
      table = startSharedEvening(pub.name, pub.pub.city, stagedCode);
    }
    void enqueuePartyPubTransition(transition, stagedCode, {
      deferDelivery: table !== null || (!!stagedCode && !confirmedEveningCode),
    });
    if (table) void table.finally(() => flushPartyBeerWrites());

    if (picking) {
      endPicking();
      onClose?.();
      leaveRoute(router);
      return;
    }
    router.push('/party-live' as Href);
  };

  const retryActivity = () => {
    if (viewerAccountId) {
      setActivityResource({ viewerAccountId, state: LOADING_ACTIVITY });
    }
    setActivityMoreErrorFor(null);
    setActivityNonce((nonce) => nonce + 1);
  };

  const loadMoreActivity = () => {
    if (
      activity.status !== 'ready' ||
      !activity.nextCursor ||
      activityLoadingMore
    ) {
      return;
    }
    if (!viewerAccountId) return;
    const requestedViewer = viewerAccountId;
    const cursor = activity.nextCursor;
    const controller = new AbortController();
    moreControllerRef.current?.abort();
    moreControllerRef.current = controller;
    setActivityLoadingMoreFor(requestedViewer);
    setActivityMoreErrorFor(null);
    void fetchPubNightsFeed(initialPub.name, cursor, controller.signal).then((result) => {
      if (
        controller.signal.aborted ||
        useAccountStore.getState().session?.accountId !== requestedViewer
      ) return;
      setActivityLoadingMoreFor(null);
      if (!result.ok) {
        setActivityMoreErrorFor(requestedViewer);
        return;
      }
      setActivityResource((current) => {
        if (
          current?.viewerAccountId !== requestedViewer ||
          current.state.status !== 'ready' ||
          current.state.nextCursor !== cursor
        ) return current;
        const existing = new Set(current.state.nights.map((night) => night.id));
        return {
          viewerAccountId: requestedViewer,
          state: {
            status: 'ready',
            nights: [
              ...current.state.nights,
              ...result.nights.filter((night) => !existing.has(night.id)),
            ],
            nextCursor: result.nextCursor,
          },
        };
      });
    });
  };

  const meta = [
    ...(pub.rating == null ? [] : [{ key: 'rating', text: pub.rating.toFixed(1) }]),
    { key: 'open', text: pub.openLabel, color: openStatusColor(pub) },
    ...(pub.distanceLabel == null
      ? []
      : [{ key: 'distance', text: pub.distanceLabel, color: Colors.foam }]),
  ];
  return (
    <View style={styles.body}>
      <View style={styles.titleRow}>
        <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
          {pub.name}
        </Text>
        <PubDetailActions
          pub={pub.pub}
          displayName={pub.name}
          onRenamed={(name) => setRenamed({ id: pub.pub.id, name })}
          onReported={closeAfterReport}
        />
        {onClose ? <CloseButton onPress={onClose} label={t.pubDetail.closeA11y} /> : null}
      </View>

      <View style={styles.metaRow}>
        {meta.map((item, index) => (
          <React.Fragment key={item.key}>
            {index > 0 ? (
              <Text style={styles.metaDot} allowFontScaling={false}>
                ·
              </Text>
            ) : null}
            {item.key === 'rating' ? <StarIcon size={13} color={Colors.amber} /> : null}
            <Text style={[styles.meta, item.color ? { color: item.color } : null]} allowFontScaling={false}>
              {item.text}
            </Text>
          </React.Fragment>
        ))}
      </View>

      <Text style={styles.address} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {pub.address}
      </Text>

      <View style={styles.actions}>
        <PillAction
          label={t.pubDetail.navigate}
          onPress={() => {
            void openPubInMaps(pub.pub).catch(() => undefined);
          }}
        >
          <MapPinIcon size={18} color={Colors.foam} />
        </PillAction>
        <PillAction label={primaryLabel} primary onPress={startHere}>
          <BeerIcon size={18} color={Colors.stout} />
        </PillAction>
      </View>

      <UnderlineTabs
        options={TABS}
        value={tabLabel(tab)}
        onChange={(label) => setTab(tabFromLabel(label))}
        inset={MockLayout.screenPad}
      />

      {tab === 'info' ? (
        <View>
          <SectionBreak
            title={t.pubDetail.openingTitle}
            onPress={openingRows.length > 0 ? () => openContribution('hours') : undefined}
            accessibilityLabel={t.pubDetail.openingEditA11y}
          />
          {openingRows.length > 0 ? (
            openingRows.map((row, index) => (
              <View key={`${row.days}:${row.hours}`} style={[styles.factRow, index > 0 && styles.rowDivider]}>
                <Text
                  style={styles.factLabel}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {row.days}
                </Text>
                <Text
                  style={styles.factValue}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {row.hours}
                </Text>
              </View>
            ))
          ) : (
            <EmptyEditRow label={t.pubDetail.openingAdd} onPress={() => openContribution('hours')} />
          )}

          <SectionBreak
            title={t.pubDetail.tapsTitle}
            onPress={taps.length > 0 || !!pub.pub.price ? () => openContribution('beers') : undefined}
            accessibilityLabel={t.pubDetail.tapsEditA11y}
          />
          {taps.map((tap, index) => (
            <View
              key={`${tap.name}:${tap.volumeMl ?? 'any'}:${index}`}
              style={[styles.tapRow, index > 0 && styles.rowDivider]}
            >
              <View style={styles.tapNameWrap}>
                <Text style={styles.tapName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {tap.name}
                </Text>
                {typeof tap.volumeMl === 'number' ? (
                  <Text style={styles.tapVolume} allowFontScaling={false}>
                    {formatVolume(tap.volumeMl)}
                  </Text>
                ) : null}
              </View>
              {typeof tap.priceCzk === 'number' ? (
                <Text style={styles.tapPrice} allowFontScaling={false}>
                  {t.pubDetail.priceValue(tap.priceCzk)}
                </Text>
              ) : null}
            </View>
          ))}
          {taps.length === 0 && pub.pub.price ? (
            <View style={styles.tapRow}>
              <Text style={styles.tapName}>{t.pubDetail.beerFrom}</Text>
              <Text style={styles.tapPrice} allowFontScaling={false}>
                {t.pubDetail.priceValue(pub.pub.price.czk)}
              </Text>
            </View>
          ) : null}
          {taps.length === 0 && !pub.pub.price ? (
            <EmptyEditRow label={t.pubDetail.tapsAdd} onPress={() => openContribution('beers')} />
          ) : null}

          <PubEventsSection
            visible={tab === 'info'}
            pubKey={pubKey}
            pubName={pub.name}
            info={pubInfo}
            showSuggestion={false}
          />

          {pub.visitCount > 0 ? (
            <View>
              <SectionBreak title={t.pubDetail.visitsTitle} />
              <StatGrid
                columns={2}
                compact
                stats={[
                  { label: t.pubDetail.visits, value: `${pub.visitCount}×` },
                  { label: t.pubDetail.lastVisit, value: formatLastVisit(pub.lastVisitedAt) },
                ]}
              />
            </View>
          ) : null}

          <PubAmenitySection
            visible={tab === 'info'}
            pubKey={pubKey}
            pubName={amenityIdentityName}
          />
        </View>
      ) : null}

      {tab === 'activity' ? (
        <View style={styles.feed}>
          {activity.status === 'loading' ? (
            <ActivityIndicator color={Colors.amber} />
          ) : null}
          {activity.status === 'error' ? (
            <View style={styles.activityState}>
              <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.pubDetail.activityLoadError}
              </Text>
              <Pressable
                onPress={retryActivity}
                style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>{t.pubDetail.activityRetry}</Text>
              </Pressable>
            </View>
          ) : null}
          {activity.status === 'ready'
            ? activity.nights.map((night) => (
                <NightCard
                  key={night.id}
                  night={night}
                  onRemoved={() =>
                    setActivityResource((current) => {
                      if (
                        current?.viewerAccountId !== viewerAccountId ||
                        current.state.status !== 'ready'
                      ) return current;
                      return {
                        viewerAccountId: current.viewerAccountId,
                        state: {
                          status: 'ready',
                          nights: current.state.nights.filter((item) => item.id !== night.id),
                          nextCursor: current.state.nextCursor,
                        },
                      };
                    })
                  }
                  onChanged={retryActivity}
                />
              ))
            : null}
          {activity.status === 'ready' && activity.nights.length === 0 ? (
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.pubDetail.activityEmpty}
            </Text>
          ) : null}
          {activity.status === 'ready' && activity.nextCursor ? (
            <Pressable
              onPress={loadMoreActivity}
              disabled={activityLoadingMore}
              style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={t.pubDetail.activityLoadMoreA11y}
            >
              {activityLoadingMore ? (
                <ActivityIndicator color={Colors.amber} />
              ) : (
                <Text style={styles.retryText}>
                  {activityMoreError
                    ? t.pubDetail.activityLoadMoreRetry
                    : t.pubDetail.activityLoadMore}
                </Text>
              )}
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  pressed: { opacity: 0.65 },
  body: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.md },
  feed: { marginTop: Spacing.md, gap: Spacing.md },
  activityState: { gap: Spacing.sm, alignItems: 'flex-start' },
  empty: {
    marginTop: Spacing.md,
    fontSize: 15,
    fontWeight: '500',
    color: Colors.mutedText,
    lineHeight: 21,
  },
  retry: {
    minHeight: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
  },
  retryText: { fontSize: 14, fontWeight: '700', color: Colors.foam },
  loadMore: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  title: {
    flex: 1,
    fontSize: 30,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -0.6,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 5, marginTop: 4 },
  meta: { fontSize: 14, fontWeight: '600', color: Colors.foam },
  metaDot: { fontSize: 14, color: Colors.mutedText },
  address: { fontSize: 14, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    alignSelf: 'flex-start',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 52,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  actionPrimary: { backgroundColor: Colors.amber },
  actionLabel: { fontSize: 15, fontWeight: '700', color: Colors.foam },
  actionLabelPrimary: { color: Colors.stout },
  factRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  factLabel: {
    minWidth: 46,
    flexShrink: 0,
    ...MockType.body,
    fontWeight: '700',
    color: Colors.foamMuted,
  },
  factValue: { flex: 1, ...MockType.body, color: Colors.foam, textAlign: 'right' },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  emptyEditRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyEditLabel: { fontSize: 15, fontWeight: '700', color: Colors.amber },
  tapRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  tapNameWrap: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  tapName: { flexShrink: 1, ...MockType.body, color: Colors.foam },
  tapVolume: { fontSize: 12, fontWeight: '600', color: Colors.mutedText },
  tapPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
});
