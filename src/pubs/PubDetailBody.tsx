import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { CloseButton } from '@/components/shared/CloseButton';
import { BeerIcon, MapPinIcon, StarIcon } from '@/components/shared/IconGlyph';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { geohash8 } from '@/data/geohash';
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
import {
  selectConfirmedPartyJoinCode,
  selectPartyJoinCode,
  usePartyEveningStore,
} from '@/stores/partyEveningStore';
import { useAccountStore } from '@/stores/accountStore';
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

const TABS = ['Info', 'Aktivita'] as const;

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
  const [tab, setTab] = React.useState<(typeof TABS)[number]>('Info');
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
  const pub = React.useMemo(
    () => presentPub(detailedPub, position, visits),
    [detailedPub, position, visits],
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

  const primaryLabel = picking ? 'Vybrat tuhle hospodu' : 'Začít tu večer';
  const houseBeer = pub.featuredTap?.name ?? 'Pivo';
  const pubKey = geohash8(pub.pub.lat, pub.pub.lng);
  const taps = pub.pub.beers ?? [];
  const partyTaps = taps.flatMap((tap) => {
    const name = tap.name.trim();
    return name
      ? [{ name, priceCzk: typeof tap.priceCzk === 'number' ? tap.priceCzk : null }]
      : [];
  });

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
      router.back();
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
        {onClose ? <CloseButton onPress={onClose} label="Zavřít detail" /> : null}
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
          label="Navigovat"
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
        value={tab}
        onChange={setTab}
        inset={MockLayout.screenPad}
      />

      {tab === 'Info' && pub.visitCount > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            Co se tu dělo
          </Text>
          <StatGrid
            columns={2}
            compact
            stats={[
              { label: 'Návštěv', value: `${pub.visitCount}×` },
              { label: 'Naposled', value: formatLastVisit(pub.lastVisitedAt) },
            ]}
          />
        </View>
      ) : null}

      {tab === 'Info' ? (
        <View style={styles.tapSection}>
          <SectionBreak title="Na čepu" />
          {taps.map((tap, index) => (
            <View
              key={`${tap.name}:${tap.volumeMl ?? 'any'}`}
              style={[styles.tapRow, index === 0 && styles.tapFirst]}
            >
              <Text style={styles.tapName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                {tap.name}
              </Text>
              {typeof tap.priceCzk === 'number' ? (
                <Text style={styles.tapPrice} allowFontScaling={false}>
                  {tap.priceCzk} Kč
                </Text>
              ) : null}
            </View>
          ))}
          {taps.length === 0 && pub.pub.price ? (
            <View style={[styles.tapRow, styles.tapFirst]}>
              <Text style={styles.tapName}>Pivo od</Text>
              <Text style={styles.tapPrice} allowFontScaling={false}>
                {pub.pub.price.czk} Kč
              </Text>
            </View>
          ) : null}
          {taps.length === 0 && !pub.pub.price ? (
            <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
              Výčep tu zatím nikdo nezapsal.
            </Text>
          ) : null}
        </View>
      ) : null}

      {tab === 'Aktivita' ? (
        <View style={styles.feed}>
          {activity.status === 'loading' ? (
            <ActivityIndicator color={Colors.amber} />
          ) : null}
          {activity.status === 'error' ? (
            <View style={styles.activityState}>
              <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
                Aktivitu teď nejde načíst.
              </Text>
              <Pressable
                onPress={retryActivity}
                style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
                accessibilityRole="button"
              >
                <Text style={styles.retryText}>Zkusit znovu</Text>
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
              Zatím sem nikdo nic nezapsal. Buď první.
            </Text>
          ) : null}
          {activity.status === 'ready' && activity.nextCursor ? (
            <Pressable
              onPress={loadMoreActivity}
              disabled={activityLoadingMore}
              style={({ pressed }) => [styles.loadMore, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Načíst další aktivitu hospody"
            >
              {activityLoadingMore ? (
                <ActivityIndicator color={Colors.amber} />
              ) : (
                <Text style={styles.retryText}>
                  {activityMoreError ? 'Zkusit další znovu' : 'Načíst další'}
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
  section: { marginTop: MockLayout.sectionGap, gap: Spacing.sm },
  tapSection: { gap: Spacing.sm },
  sectionTitle: { ...MockType.titleS, color: Colors.foam },
  tapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  tapFirst: { borderTopWidth: 0 },
  tapName: { flex: 1, ...MockType.body, color: Colors.foam },
  tapPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },
});
