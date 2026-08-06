import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { CloseButton } from '@/components/shared/CloseButton';
import { BeerIcon, MapPinIcon, StarIcon } from '@/components/shared/IconGlyph';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { geohash8 } from '@/data/geohash';
import {
  fetchNightsFeed,
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
import { usePartyEveningStore } from '@/stores/partyEveningStore';
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
  | { status: 'loading'; nights: PublishedNight[] }
  | { status: 'ready'; nights: PublishedNight[] }
  | { status: 'error'; nights: PublishedNight[] };

function normalizePubName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('cs-CZ');
}

function nightMentionsPub(night: PublishedNight, pubName: string): boolean {
  const wanted = normalizePubName(pubName);
  return night.pubNames.some((name) => normalizePubName(name) === wanted);
}

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
  const [activity, setActivity] = React.useState<ActivityState>({
    status: 'loading',
    nights: [],
  });
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
  const sharedEvening = usePartyEveningStore((state) => state.evening);
  const sharedEveningBusy = usePartyEveningStore((state) => state.busy);
  const startSharedEvening = usePartyEveningStore((state) => state.start);

  React.useEffect(() => {
    let active = true;
    void fetchNightsFeed('friends').then((result) => {
      if (!active) return;
      if (!result.ok) {
        setActivity({ status: 'error', nights: [] });
        return;
      }
      setActivity({
        status: 'ready',
        nights: result.nights.filter((night) => nightMentionsPub(night, initialPub.name)),
      });
    });
    return () => {
      active = false;
    };
  }, [activityNonce, initialPub.name]);

  const primaryLabel = picking ? 'Vybrat tuhle hospodu' : 'Začít tu večer';
  const houseBeer = pub.featuredTap?.name ?? 'Pivo';
  const pubKey = geohash8(pub.pub.lat, pub.pub.lng);

  const startHere = () => {
    if (picking) {
      setLocalPub(pub.name, houseBeer, pubKey);
      endPicking();
      onClose?.();
      router.back();
      return;
    }

    if (localPartyLive) setLocalPub(pub.name, houseBeer, pubKey);
    else startLocalParty(pub.name, houseBeer, pubKey);

    if (!sharedEvening && !sharedEveningBusy) {
      void startSharedEvening(pub.name, pub.pub.city);
    }
    router.push('/party-live' as Href);
  };

  const retryActivity = () => {
    setActivity({ status: 'loading', nights: [] });
    setActivityNonce((nonce) => nonce + 1);
  };

  const meta = [
    ...(pub.rating == null ? [] : [{ key: 'rating', text: pub.rating.toFixed(1) }]),
    { key: 'open', text: pub.openLabel, color: openStatusColor(pub) },
    ...(pub.distanceLabel == null
      ? []
      : [{ key: 'distance', text: pub.distanceLabel, color: Colors.foam }]),
  ];
  const taps = pub.pub.beers ?? [];

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
                    setActivity((current) => ({
                      status: 'ready',
                      nights: current.nights.filter((item) => item.id !== night.id),
                    }))
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
