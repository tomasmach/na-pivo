/**
 * The running night, as a hub.
 *
 * The first version was Strava's Record screen: a full-bleed map with a sheet of
 * controls over it. That is the right shape for the moment BEFORE anything has
 * happened, and the wrong one from the first beer onwards — a map of one pin you
 * are sitting inside is the least interesting thing on the screen, and it was
 * taking two thirds of it.
 *
 * So the map collapses to a band the moment the night starts, and the evening
 * takes the space. What you get instead, top to bottom:
 *
 *   stats        two or three big numbers, whichever are true right now
 *   controls     invite, photo, +1 beer, games, move on
 *   log          everything that happened, as one thread
 *
 * There are no charts here. A night in progress is a thing you are IN — you
 * glance at the phone to see what just happened, not to study a bar chart of
 * your own evening. The graphs live in the recap, after you finish and post,
 * where looking back is the whole point.
 *
 * Ending the night sits top right, away from "+1 pivo": those two buttons must
 * never be neighbours, because one of them is undoable and the other is not.
 *
 * The table record comes from the private backend endpoint, with the local
 * counter and upload queues layered on top while they wait for signal.
 */

import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeInDown,
  LinearTransition,
  useReducedMotion,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import {
  BeerIcon,
  CameraIcon,
  CircleDotIcon,
  DicesIcon,
  ChevronDownIcon,
  GlassWaterIcon,
  MapPinIcon,
  PlayIcon,
  PlusIcon,
  TrophyIcon,
  UserPlusIcon,
  WineIcon,
} from '@/components/shared/IconGlyph';
import { GlassPill } from '@/components/shared/GlassIconButton';
import {
  PartyDrinkSheet,
  mergePartyDrinkChoices,
  type PartyDrinkChoice,
  type PartyDrinkSource,
} from '@/party/PartyDrinkSheet';
import { BeerFormModal, type BeerFormResult } from '@/counter/BeerFormModal';
import { ReceiptSheet, type ReceiptItem } from '@/counter/ReceiptSheet';
import { BeerCheckInSheet } from '@/counter/BeerCheckInSheet';
import { AppDialogHost, showAppDialog } from '@/components/shared/AppDialog';
import { useAfterModalDismiss } from '@/components/shared/useAfterModalDismiss';
import { ScanMenuSheet, type MenuScanSource } from '@/components/contribute/ScanMenuSheet';
import { menuPhotoPickFeedback, menuScanFailureCopy } from '@/contribute/menuScanFeedback';
import { showMenuScanPermissionBlocked } from '@/contribute/menuScanPermission';
import { ScannedDrinkPicker } from '@/counter/ScannedDrinkPicker';
import { GameCover } from '@/party/GameCover';
import { GAME_CATALOG } from '@/party/gameCatalog';
import { Avatar } from '@/profile/Avatar';
import { PulsePanel } from '@/party/PulsePanel';
import { GamesSheet } from '@/party/GamesSheet';
import { placePartyGameAfterTableConfirmation } from '@/party/placePartyGame';
import { InviteSheet } from '@/party/InviteSheet';
import { JoinTableSheet } from '@/party/JoinTableSheet';
import { RowMenu } from '@/mocks/MenuChip';
import { hubStats } from '@/party/nightPulse';
import { NightRoute } from '@/mocks/NightRoute';
import { BeerPhotoCaptureFlow } from '@/photos/BeerPhotoCaptureFlow';
import { decodeGeohash8, geohash8 } from '@/data/geohash';
import { scanMenuPhoto, type ScannedDrink } from '@/data/menuScanClient';
import type { Pub } from '@/data/pubs';
import { generateJoinCode } from '@/data/partyClient';
import { formatDistanceCs } from '@/compass/distance';
import { useNearbyPub } from '@/counter/useNearbyPub';
import { lastKnownDevicePosition } from '@/compass/useDevicePosition';
import { presentOpenStatus } from '@/pubs/pubPresentation';
import { drinkingDayKey, useTallyStore, type TallyDrink } from '@/stores/tallyStore';
import {
  clockAt,
  isStaleNightStart,
  hubPubName,
  minutesBetween,
  partyTapOptions,
  useLivePartyStore,
  useNightClock,
} from '@/mocks/livePartyStore';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import {
  beersOf,
  nightByBeer,
  nightMe,
  nightTally,
  nightThread,
  uniqueNightStops,
} from '@/party/nightRecord';
import { flushPartyBeerWrites } from '@/party/logBeer';
import {
  enqueuePartyPubTransition,
  enqueuePartyPubVisit,
} from '@/party/partyPubVisits';
import { rememberNightRecord, useNightRecord } from '@/party/useNightRecord';
import { usePartyBeer } from '@/party/usePartyBeer';
import {
  closeAfterDurablePartyBeerMutation,
  createPartyBeerMutationGate,
} from '@/party/partyBeerMutation';
import { finishPartyToRecap, minimizeParty } from '@/party/partyRouting';
import { useAccountStore } from '@/stores/accountStore';
import {
  selectConfirmedPartyJoinCode,
  usePartyEveningStore,
} from '@/stores/partyEveningStore';
import {
  placePartyGameOnTable,
  useFollowPartyGames,
} from '@/stores/partyGamesStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { cs, formatVolume } from '@/i18n/cs';
import { formatPrice } from '@/utils/currency';
import { useSettingsStore } from '@/stores/settingsStore';
import { useToastStore } from '@/stores/toastStore';
import { contextFromPubKey, type DrinkType } from '@/drinks/drinkTypes';

/** Resolved once: constant for the process (iOS 26+, false everywhere else). */
const GLASS = isLiquidGlassAvailable();

/** How far the sheet overlaps the map, which is also its corner radius. */
const SHEET_RADIUS = 28;
type LogKind = 'beer' | 'photo' | 'game' | 'join' | 'pub';

/** The catalogue entry behind a game on the table — the cover art lives there,
 *  and the live store only keeps the key. */
const gameDef = (key: string) => GAME_CATALOG.find((game) => game.key === key) ?? GAME_CATALOG[0];

/**
 * The map of last resort: Prague, framed wide enough to read as "Czechia".
 *
 * The hub's top 460pt were plain black whenever there was no fix yet — the map
 * simply rendered nothing. A guessed frame is a worse map but an honest screen,
 * and the moment a real position arrives it replaces this.
 */
const CZ_FALLBACK_CENTER = { lat: 50.0808, lng: 14.4287, span: 0.9 };

/** Full map before the night starts, a band once it has. */
const MAP_IDLE = 460;
/** Below the notch and the floating chrome: at a fixed 128 the sheet's top edge
 *  cut through the back chevron and "Ukončit" on a tall phone. */
const MAP_LIVE_MIN = 128;
const TOP_BAR_H = HitArea.min + Spacing.sm * 2;

const drinkTypeOf = (drink: TallyDrink): DrinkType => drink.drinkType ?? 'beer';
const drinkIdentity = (drink: Pick<TallyDrink, 'beerName' | 'drinkType' | 'priceCzk' | 'volumeMl'>) =>
  `${drink.drinkType ?? 'beer'}|${drink.beerName}|${drink.volumeMl ?? ''}|${drink.priceCzk ?? ''}`;

function DrinkGlyph({ type, color = Colors.amber }: { type: DrinkType; color?: string }) {
  if (type === 'beer') return <BeerIcon size={17} color={color} />;
  if (type === 'wine') return <WineIcon size={17} color={color} />;
  if (type === 'soft_drink') return <GlassWaterIcon size={17} color={color} />;
  return <CircleDotIcon size={17} color={color} />;
}

/** One glyph per kind of thing that happens in an evening. */
const LOG_GLYPH: Record<LogKind, React.ReactNode> = {
  beer: <BeerIcon size={17} color={Colors.amber} />,
  photo: <CameraIcon size={17} color={Colors.amber} />,
  game: <DicesIcon size={17} color={Colors.amber} />,
  join: <UserPlusIcon size={17} color={Colors.amber} />,
  pub: <MapPinIcon size={17} color={Colors.amber} />,
};


/**
 * A round action in the bottom row.
 *
 * No caption under it. The captions made the discs taller than the amber button
 * beside them, so nothing in the row lined up — and "Foto" under a camera is a
 * label reading out the picture above it.
 */
function CircleButton({
  label,
  children,
  onPress,
  /** Does this put something INTO the evening? Those get a plus, so a row of
   *  nouns ("Foto", "Hry") reads as five things you can add rather than five
   *  places you can go. */
  adds = true,
}: {
  label: string;
  children: React.ReactNode;
  onPress?: () => void;
  adds?: boolean;
}) {
  return (
    <View style={styles.circleWrap}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.circleSecondary, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={adds ? `Přidat: ${label}` : label}
      >
        {/* Real glass where the OS has it (§15.1), a filled disc below iOS 26.
            The discs sit over a fading thread, which is exactly the situation
            the material is for — a flat plate here read as five holes cut in
            the screen. */}
        {GLASS ? (
          <GlassView
            style={styles.circleGlass}
            glassEffectStyle="regular"
            tintColor={withAlpha(Colors.foam, 0.06)}
            colorScheme="dark"
            pointerEvents="none"
          />
        ) : (
          <View style={[styles.circleGlass, styles.circleSolid]} pointerEvents="none" />
        )}
        {children}
        {adds ? (
          <View style={styles.addBadge}>
            <PlusIcon size={9} color={Colors.stout} />
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

export default function LivePartyMockScreen() {
  const [isFocused, setIsFocused] = React.useState(false);
  useFocusEffect(
    React.useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { joinCode: inviteJoinCode, invite: inviteRequestId } = useLocalSearchParams<{
    joinCode?: string;
    invite?: string;
  }>();

  const live = useLivePartyStore((s) => s.live);
  const startedAt = useLivePartyStore((s) => s.startedAt);
  const houseBeer = useLivePartyStore((s) => s.houseBeer);
  const pubTaps = useLivePartyStore((s) => s.pubTaps);
  const pubName = useLivePartyStore((s) => s.pubName);
  const pubKey = useLivePartyStore((s) => s.pubKey);
  const startParty = useLivePartyStore((s) => s.start);
  const setPartyPub = useLivePartyStore((s) => s.setPub);
  const adoptSharedPub = useLivePartyStore((s) => s.adoptSharedPub);
  const resumeParty = useLivePartyStore((s) => s.resume);
  const endParty = useLivePartyStore((s) => s.end);
  const addGame = useLivePartyStore((s) => s.addGame);
  const selectedVisit = useLivePartyStore((s) => s.pubVisits.at(-1) ?? null);

  // The real shared evening, which is what makes the code, the games and the
  // quiz reach anybody else's phone. The hub's own state stays local and
  // instant; this runs alongside it and is allowed to be slow or to fail.
  const night = useNightRecord({ pollingEnabled: isFocused });
  const beer = usePartyBeer();
  const mutateBeer = React.useMemo(
    () => createPartyBeerMutationGate(() => {
      useToastStore.getState().show(cs.friends.queueSaveError);
    }),
    [],
  );
  const evening = usePartyEveningStore((s) => s.evening);
  const confirmedIdentity = usePartyEveningStore((s) => s.confirmedIdentity);
  const pendingJoinCode = usePartyEveningStore((s) => s.pendingJoinCode);
  const confirmedPartyCode = usePartyEveningStore(selectConfirmedPartyJoinCode);
  const finishFromServer = usePartyEveningStore((s) => s.finishFromServer);
  const closeLostTable = usePartyEveningStore((s) => s.closeLostTable);
  const accountId = useAccountStore((s) => s.session?.accountId);
  const nearby = useNearbyPub();
  const tallyCurrent = useTallyStore((s) => s.current);
  const tallyHistory = useTallyStore((s) => s.history);
  const archiveCurrent = useTallyStore((s) => s.archiveCurrent);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const [undoDrink, setUndoDrink] = React.useState<TallyDrink | null>(null);
  const undoTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const stagedPartyCode = confirmedPartyCode ?? pendingJoinCode;
  const active = live || evening?.active === true || confirmedIdentity !== null;
  const partyPlaceKey = pubKey ?? 'ctx:other';
  const effectiveStartedAt = startedAt ?? (
    evening?.startedAt && Number.isFinite(Date.parse(evening.startedAt))
      ? Date.parse(evening.startedAt)
      : null
  );
  // The stopwatch. Ticks on its own; every reading below is derived from it.
  const minutes = useNightClock(effectiveStartedAt);
  const rememberUndo = (drink: TallyDrink) => {
    setUndoDrink(drink);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => {
      setUndoDrink(null);
      undoTimer.current = null;
      void flushPartyBeerWrites();
    }, 5_000);
  };
  // The table's games, live. The hub is normally the screen that is open when
  // somebody else puts one down.
  useFollowPartyGames(confirmedPartyCode);
  const startEvening = usePartyEveningStore((s) => s.start);
  const joinEvening = usePartyEveningStore((s) => s.join);
  const joiningTable = usePartyEveningStore((s) => s.busy);
  const joinError = usePartyEveningStore((s) => s.error);
  const clearJoinError = usePartyEveningStore((s) => s.clearError);
  const refreshEvening = usePartyEveningStore((s) => s.refresh);

  // On the way in, ask whether this account is already sitting somewhere — you
  // may have started the night on a different phone, or reinstalled mid-evening.
  React.useEffect(() => {
    void refreshEvening();
  }, [refreshEvening]);

  // A shared table nobody closed is not a running evening. The local chrome
  // already expires after 24 hours and the server refuses a party entry past
  // the same cap, but a table hosted by another account had no such rule — the
  // hub reopened a night from three days ago with the stopwatch still ticking.
  const staleEveningCode = React.useMemo(
    () =>
      evening?.active && isStaleNightStart(evening.startedAt)
        ? evening.joinCode
        : null,
    [evening],
  );

  React.useEffect(() => {
    if (!staleEveningCode) return;
    // Detach only: no publish, no server call. The table is the server's
    // business; this phone just stops pretending it is sitting at it.
    closeLostTable(staleEveningCode);
    // The local evening is ended only when it IS that stale table. A fresh
    // night started while the server still remembered an old table must keep
    // running — the Android QA lost four logged beers to exactly that.
    const local = useLivePartyStore.getState();
    const localIsStale =
      !local.live ||
      local.startedAt === null ||
      isStaleNightStart(new Date(local.startedAt).toISOString());
    if (!localIsStale) return;
    endParty();
    useToastStore.getState().show(cs.party.staleEveningClosed);
  }, [closeLostTable, endParty, staleEveningCode]);

  React.useEffect(() => {
    // The server can briefly return the previous table while a new local one is
    // already running. Without this guard that stale refresh rewrites the pub
    // and stopwatch underneath the current evening. Explicit joins replace the
    // local night in their success handler below.
    if (evening?.active && !live && !staleEveningCode) {
      resumeParty(evening.pubName, evening.startedAt);
    }
  }, [evening, live, resumeParty, staleEveningCode]);

  React.useEffect(() => {
    const detected = nearby.selected;
    if (active || pubName.trim() || !detected) return;
    const detectedTaps = (detected.beers ?? []).flatMap((tap) => {
      const name = tap.name.trim();
      return name
        ? [{ name, priceCzk: typeof tap.priceCzk === 'number' ? tap.priceCzk : null }]
        : [];
    });
    setPartyPub(
      detected.name,
      detectedTaps[0]?.name ?? 'Pivo',
      geohash8(detected.lat, detected.lng),
      detectedTaps,
    );
  }, [active, nearby.selected, pubName, setPartyPub]);

  const latestSharedStop = night.stops.at(-1) ?? null;
  React.useEffect(() => {
    if (!active || !latestSharedStop) return;
    if (
      latestSharedStop.pubName === pubName &&
      (latestSharedStop.cacheKey ?? null) === pubKey
    ) {
      return;
    }
    adoptSharedPub(latestSharedStop.pubName, latestSharedStop.cacheKey);
  }, [active, adoptSharedPub, latestSharedStop, pubKey, pubName]);

  React.useEffect(() => {
    if (!active || !confirmedPartyCode || !night.endedAt) return;
    void rememberNightRecord(night, accountId);
    finishFromServer(night.endedAt);
    archiveCurrent('manual');
    endParty();
    finishPartyToRecap(router, '/party-live');
  }, [accountId, active, archiveCurrent, confirmedPartyCode, endParty, finishFromServer, night, router]);

  /**
   * Start the night: locally first, on the server after.
   *
   * The local start is instant and unconditional, because the counter must work
   * in a cellar with no signal. The evening is a best-effort extra — when it
   * lands there is a code to read out, and when it does not the night still runs.
   */
  const beginNight = (firstDrink: BeerFormResult) => {
    const placeName = pubName.trim() || 'Mimo hospodu';
    const transition = startParty(placeName, firstDrink.name, pubKey, pubTaps);
    const joinCode = stagedPartyCode ?? generateJoinCode();
    if (!confirmedPartyCode) void startEvening(placeName, undefined, joinCode);
    void enqueuePartyPubTransition(transition, joinCode, {
      deferDelivery: true,
    });
    // The first beer is a real beer: it goes into the diary through the same
    // path as every other one. Its queue is durable immediately, but delivery
    // waits for the table create so a fast POST cannot outrun its party code.
    const id = beer.add(firstDrink.name, {
      partyCode: joinCode,
      deferDelivery: true,
      drinkType: firstDrink.drinkType,
      priceCzk: firstDrink.priceCzk,
      volumeMl: firstDrink.volumeMl,
      servingType: firstDrink.servingType,
      ...(transition?.current ? { visit: transition.current } : {}),
    });
    rememberUndo({
      id,
      beerName: firstDrink.name,
      drinkType: firstDrink.drinkType,
      priceCzk: firstDrink.priceCzk,
      volumeMl: firstDrink.volumeMl,
      servingType: firstDrink.servingType,
      at: new Date().toISOString(),
    });
  };

  const openInvite = () => {
    setInviteOpen(true);
    // QR and share must point at a real members-only table. Starting the table
    // is independent from counting the first beer, so inviting before the first
    // order no longer leaves this sheet on an endless fake placeholder.
    if (!confirmedPartyCode) {
      const table = startEvening(pubName.trim() || 'Mimo hospodu');
      void table
        .then(async (created) => {
          const currentVisit = useLivePartyStore.getState().pubVisits.at(-1);
          if (created && currentVisit) {
            await enqueuePartyPubVisit(currentVisit, created.joinCode);
          }
        })
        .finally(() => flushPartyBeerWrites());
    }
  };

  // Rows already on screen at first paint must NOT animate — the log would deal
  // itself out like a hand of cards every time you open the hub. Stamping the
  // mount (in the state initialiser, so render stays pure) lets each row decide
  // for itself: anything logged after you got here is genuinely new.
  const [mountedAt] = React.useState(() => Date.now());
  const reduceMotion = useReducedMotion();

  const [gamesOpen, setGamesOpen] = React.useState(false);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [joinOpen, setJoinOpen] = React.useState(false);
  const [prefilledJoinCode, setPrefilledJoinCode] = React.useState<string | null>(null);
  const [beersOpen, setBeersOpen] = React.useState(false);
  const [photoOpen, setPhotoOpen] = React.useState(false);
  const [receiptOpen, setReceiptOpen] = React.useState(false);
  const [formOpen, setFormOpen] = React.useState(false);
  const [formMode, setFormMode] = React.useState<'add' | 'edit'>('add');
  const [formDrinkType, setFormDrinkType] = React.useState<DrinkType>('beer');
  const [formDrink, setFormDrink] = React.useState<TallyDrink | null>(null);
  const [formNonce, setFormNonce] = React.useState(0);
  const formGenerationRef = React.useRef(0);
  const [backdateAt, setBackdateAt] = React.useState<string | null>(null);
  const [scanOpen, setScanOpen] = React.useState(false);
  const [scannedDrinks, setScannedDrinks] = React.useState<ScannedDrink[]>([]);
  const [checkInDrink, setCheckInDrink] = React.useState<TallyDrink | null>(null);
  const [checkInVisible, setCheckInVisible] = React.useState(false);
  const afterModalDismiss = useAfterModalDismiss();

  React.useEffect(() => {
    if (!inviteJoinCode || !inviteRequestId) return;
    const openTimer = setTimeout(() => {
      setPrefilledJoinCode(inviteJoinCode);
      clearJoinError();
      setJoinOpen(true);
      // Consume the request so returning to this mounted route cannot reopen
      // the sheet. A later tap gets a fresh request id from RootLayout.
      router.setParams({ joinCode: '', invite: '' });
    }, 0);
    return () => clearTimeout(openTimer);
  }, [clearJoinError, inviteJoinCode, inviteRequestId, router]);

  React.useEffect(() => () => {
    if (undoTimer.current) {
      clearTimeout(undoTimer.current);
      void flushPartyBeerWrites();
    }
  }, []);

  const mapHeight = active
    ? Math.max(MAP_LIVE_MIN, insets.top + TOP_BAR_H + SHEET_RADIUS)
    : MAP_IDLE;

  // Everything below is READ from the night, never kept beside it. One record,
  // so the faces, the numbers and the thread cannot disagree with each other.
  const meId = nightMe(night)?.id;
  const games = night.games;
  const photoCount = night.photos.length;
  // Memoized on the night record: this screen re-renders on every store tick
  // and once a minute from the clock, and these derivations walk the whole
  // night (stops, people, drinks) — they only change when the night does.
  const { routeStops, people, myDrinks, mine, table, byType } = React.useMemo(() => {
    const drinks = night.drinks.filter((drink) => drink.by === meId);
    return {
      routeStops: uniqueNightStops(night).flatMap((stop) => {
        if (stop.lat !== undefined && stop.lng !== undefined) {
          return [{ name: stop.pubName, lat: stop.lat, lng: stop.lng }];
        }
        if (stop.cacheKey && /^[0-9bcdefghjkmnpqrstuvwxyz]{8}$/i.test(stop.cacheKey)) {
          return [{ name: stop.pubName, ...decodeGeohash8(stop.cacheKey) }];
        }
        return [];
      }),
      people: night.people.slice(1).filter((person) => person.active !== false),
      myDrinks: drinks,
      mine: beersOf(night, meId),
      table: nightTally(night).beers,
      byType: nightByBeer({ ...night, drinks }).map((row) => ({
        beer: row.beer,
        count: row.count,
      })),
    };
  }, [night, meId]);
  // What the map band draws before (and between) real stops. An idle hub used
  // to render nothing here — NightRoute returns null without stops, so the top
  // 460pt of the screen was a black hole. The evening always has a WHERE even
  // before it starts: the chosen or detected pub, or — outside a pub — the
  // neighbourhood you are standing in, framed without a marker.
  const idleStop = React.useMemo(
    () =>
      /^[0-9bcdefghjkmnpqrstuvwxyz]{8}$/i.test(partyPlaceKey)
        ? { name: pubName, ...decodeGeohash8(partyPlaceKey) }
        : null,
    [partyPlaceKey, pubName],
  );
  const mapStops = React.useMemo(
    () => (routeStops.length > 0 ? routeStops : idleStop ? [idleStop] : []),
    [idleStop, routeStops],
  );
  const detectedPub = nearby.selected && pubKey === geohash8(nearby.selected.lat, nearby.selected.lng)
    ? nearby.selected
    : null;
  const detectedCandidate = detectedPub
    ? nearby.candidates.find((candidate) => candidate.pubKey === pubKey)
    : null;
  const detectedTaps = React.useMemo(
    () =>
      (detectedPub?.beers ?? []).map((tap) => ({
        name: tap.name,
        priceCzk: typeof tap.priceCzk === 'number' ? tap.priceCzk : null,
      })),
    [detectedPub],
  );
  const taps = React.useMemo(
    () =>
      partyTapOptions(
        pubTaps,
        detectedTaps,
        [{ name: houseBeer, priceCzk: null }],
        byType.map((row) => ({ name: row.beer, priceCzk: null })),
      ),
    [byType, detectedTaps, houseBeer, pubTaps],
  );
  const { privateDrinks, privateDrinksAtPlace, drinkPlaceById, privateById, latestDrink } =
    React.useMemo(() => {
      const myDrinkIds = new Set(myDrinks.map((drink) => drink.id));
      const tallySessions = [tallyCurrent, ...tallyHistory]
        .filter((session): session is NonNullable<typeof session> => session !== null);
      const drinks = tallySessions
        .flatMap((session) => session.drinks)
        .filter((drink) => myDrinkIds.has(drink.id));
      const drinksAtPlace = tallySessions
        .filter((session) => session.pubKey === partyPlaceKey)
        .flatMap((session) => session.drinks)
        .filter((drink) => myDrinkIds.has(drink.id));
      return {
        privateDrinks: drinks,
        privateDrinksAtPlace: drinksAtPlace,
        drinkPlaceById: new Map(tallySessions.flatMap((session) =>
          session.drinks.map((drink) => [drink.id, session.pubKey] as const),
        )),
        privateById: new Map(drinks.map((drink) => [drink.id, drink])),
        latestDrink:
          [...drinksAtPlace].sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null,
      };
    }, [myDrinks, partyPlaceKey, tallyCurrent, tallyHistory]);
  // What you already drank here, then the pub's taps — merged so one beer is
  // one row however the three sources spell it (§13 of the QA pass: "Pilsner
  // Urquell · 0,5 l · 60 Kč ×2" sat right above "Pilsner Urquell 12° · 0,5 l").
  const drinkChoices = React.useMemo<PartyDrinkChoice[]>(() => {
    const sources: PartyDrinkSource[] = [
      ...privateDrinksAtPlace.map((drink) => ({
        name: drink.beerName,
        drinkType: drinkTypeOf(drink),
        priceCzk: drink.priceCzk,
        volumeMl: drink.volumeMl,
        count: 1,
      })),
      ...taps.map((tap) => ({
        name: tap.name,
        drinkType: 'beer' as DrinkType,
        priceCzk: tap.priceCzk ?? undefined,
        volumeMl: 500,
        count: 0,
      })),
    ];
    return mergePartyDrinkChoices(sources).map((row) => ({
      key: `${row.drinkType}|${row.name}|${row.volumeMl ?? ''}|${row.priceCzk ?? ''}`,
      name: row.name,
      drinkType: row.drinkType,
      priceCzk: row.priceCzk,
      volumeMl: row.volumeMl,
      count: row.count,
      meta:
        [
          row.volumeMl ? formatVolume(row.volumeMl) : null,
          row.priceCzk ? formatPrice(row.priceCzk, priceCurrency) : null,
        ]
          .filter(Boolean)
          .join(' · ') || null,
    }));
  }, [priceCurrency, privateDrinksAtPlace, taps]);
  const { totalCzk, hasCompletePrice, receiptBeerRows, receiptOtherRows } = React.useMemo(() => {
    const receiptGrouped = new Map<string, PartyDrinkChoice>();
    for (const drink of privateDrinks) {
      const key = drinkIdentity(drink);
      const current = receiptGrouped.get(key);
      receiptGrouped.set(key, {
        key,
        name: drink.beerName,
        drinkType: drinkTypeOf(drink),
        priceCzk: drink.priceCzk,
        volumeMl: drink.volumeMl,
        count: (current?.count ?? 0) + 1,
        meta: null,
      });
    }
    const receiptRows = [...receiptGrouped.values()]
      .map<ReceiptItem>((choice) => ({
        key: choice.key,
        name: choice.name,
        meta: choice.volumeMl ? formatVolume(choice.volumeMl) : null,
        count: choice.count,
        totalLabel: choice.priceCzk
          ? formatPrice(choice.priceCzk * choice.count, priceCurrency)
          : null,
      }));
    const beerRows = receiptRows.filter((row) =>
      privateDrinks.some((drink) => drinkIdentity(drink) === row.key && drinkTypeOf(drink) === 'beer'),
    );
    return {
      totalCzk: privateDrinks.reduce((sum, drink) => sum + (drink.priceCzk ?? 0), 0),
      hasCompletePrice: privateDrinks.length > 0 &&
        privateDrinks.every((drink) => typeof drink.priceCzk === 'number'),
      receiptBeerRows: beerRows,
      receiptOtherRows: receiptRows.filter((row) => !beerRows.includes(row)),
    };
  }, [priceCurrency, privateDrinks]);
  const openDrinkForm = (mode: 'add' | 'edit', type: DrinkType, drink: TallyDrink | null = null) => {
    setBeersOpen(false);
    setFormMode(mode);
    setFormDrinkType(type);
    setFormDrink(drink);
    formGenerationRef.current += 1;
    setFormNonce(formGenerationRef.current);
    setFormOpen(true);
  };
  const openBackdateForm = (at: string) => {
    setBackdateAt(at);
    openDrinkForm('add', 'beer');
  };
  const openBackdatePicker = (now: number) => {
    const CAP_MS = 48 * 60 * 60 * 1000;
    const clamp = (ms: number) => new Date(Math.max(ms, now - CAP_MS)).toISOString();
    const yesterdayEvening = new Date(now);
    yesterdayEvening.setDate(yesterdayEvening.getDate() - 1);
    yesterdayEvening.setHours(20, 0, 0, 0);

    showAppDialog({
      title: cs.counter.backdateTitle,
      buttons: [
        {
          text: cs.counter.backdateHourAgo,
          onPress: () => openBackdateForm(clamp(now - 60 * 60 * 1000)),
        },
        {
          text: cs.counter.backdateTwoHoursAgo,
          onPress: () => openBackdateForm(clamp(now - 2 * 60 * 60 * 1000)),
        },
        {
          text: cs.counter.backdateYesterdayEvening,
          onPress: () => openBackdateForm(clamp(yesterdayEvening.getTime())),
        },
        { text: cs.counter.cancel, style: 'cancel' },
      ],
    });
  };
  const logDrink = (result: BeerFormResult, atOverride?: string) => {
    if (!active) {
      beginNight(result);
      return;
    }
    const at = atOverride ?? new Date().toISOString();
    const id = beer.add(result.name, {
      deferDelivery: true,
      drinkType: result.drinkType,
      priceCzk: result.priceCzk,
      volumeMl: result.volumeMl,
      servingType: result.servingType,
      at,
      backdated: atOverride !== undefined,
    });
    rememberUndo({
      id,
      beerName: result.name,
      drinkType: result.drinkType,
      priceCzk: result.priceCzk,
      volumeMl: result.volumeMl,
      servingType: result.servingType,
      at,
    });
  };
  const repeatDrink = (drink: TallyDrink) => {
    if (drinkPlaceById.get(drink.id) !== partyPlaceKey) {
      openDrinkForm('add', drinkTypeOf(drink), {
        ...drink,
        id: '',
        priceCzk: undefined,
      });
      return;
    }
    logDrink({
      name: drink.beerName,
      drinkType: drinkTypeOf(drink),
      priceCzk: drink.priceCzk,
      volumeMl: drink.volumeMl,
      servingType: drink.servingType,
    });
  };
  const confirmDrinkRemoval = (drinkId: string) => {
    showAppDialog({
      title: cs.myBeers.deleteDrinkTitle,
      message: cs.myBeers.deleteDrinkBody,
      buttons: [
        { text: cs.myBeers.deleteDrinkCancel, style: 'cancel' },
        {
          text: cs.myBeers.deleteDrinkConfirm,
          style: 'destructive',
          onPress: () => {
            void mutateBeer(drinkId, () => beer.remove(drinkId));
          },
        },
      ],
    });
  };
  const removeReceiptIdentity = (key: string) => {
    const drink = [...privateDrinks].reverse().find((candidate) => drinkIdentity(candidate) === key);
    if (drink) void mutateBeer(drink.id, () => beer.remove(drink.id));
  };
  const runDrinkScan = async (source: MenuScanSource) => {
    setScanOpen(false);
    const toast = useToastStore.getState().show;
    const { pickAndPrepareMenuPhoto } = await import('@/data/menuPhotoPicker');
    const picked = await pickAndPrepareMenuPhoto(source);
    const pickFeedback = menuPhotoPickFeedback(picked.status, source);
    if (pickFeedback.action === 'cancel') return;
    if (pickFeedback.action === 'settings') {
      showMenuScanPermissionBlocked(source);
      return;
    }
    if (pickFeedback.action === 'toast') {
      toast(pickFeedback.message);
      return;
    }
    if (picked.status !== 'picked') return;
    const result = await scanMenuPhoto(picked.uri);
    if (result.status === 'ok') {
      if (result.drinks.length > 0) {
        setScannedDrinks(result.drinks);
      } else {
        toast(cs.counter.scanDrinksEmpty);
      }
      return;
    }
    toast(menuScanFailureCopy(result.status, cs.counter.scanDrinksEmpty));
  };
  const displayPubName = hubPubName(pubName, evening) || 'Vyber hospodu';
  const currentVisit = selectedVisit?.pubKey === partyPlaceKey ? selectedVisit : null;
  const partyPub: Pub | null = detectedPub ?? (
    /^[0-9bcdefghjkmnpqrstuvwxyz]{8}$/i.test(partyPlaceKey)
      ? {
          id: currentVisit?.pubExternalId ?? '',
          name: displayPubName,
          ...decodeGeohash8(partyPlaceKey),
          city: currentVisit?.pubCity,
        }
      : null
  );
  const idlePubMeta = detectedPub
    ? [
        detectedCandidate ? formatDistanceCs(detectedCandidate.distanceMeters) : null,
        presentOpenStatus(detectedPub).label,
        taps[0]
          ? `${taps[0].name}${taps[0].priceCzk == null ? '' : ` · ${taps[0].priceCzk} Kč`}`
          : null,
      ].filter((value): value is string => !!value)
    : [];

  /**
   * The thread, in the shape the rows below draw.
   *
   * `nightThread` already ordered it and counted each person's beers; this only
   * puts Czech on it. A pub row is the first stop or a move, which is the same
   * event read differently depending on whether anything came before it.
   */
  const log = React.useMemo(() => {
    const myId = nightMe(night)?.id;
    const nameOf = (id: string | null) =>
      night.people.find((person) => person.id === id)?.name ?? 'Někdo';
    let stops = 0;
    return nightThread(night).map((entry) => {
      const pubText = entry.kind === 'pub' ? (stops++ === 0 ? 'Večer začal v ' : 'Přesun do ') : '';
      return {
        id: entry.id,
        at: new Date(entry.at).getTime(),
        kind: entry.kind,
        text:
          entry.kind === 'pub'
            ? `${pubText}${entry.label}`
            : entry.kind === 'join'
              ? `${entry.label} je u stolu`
              : entry.kind === 'photo'
                ? 'Fotka'
                : entry.label,
        by: entry.by === myId ? 'Ty' : nameOf(entry.by),
        // Only your own beer can be corrected — somebody else's row is theirs.
        beerId: entry.kind === 'beer' && entry.by === myId ? entry.refId : undefined,
        drinkType: entry.drinkType,
        photo: entry.url,
        gameKey: entry.gameKey,
        ordinal: entry.ordinal,
      };
    });
  }, [night]);

  // The pulse rules work in minutes from the start; the stamps are epoch.
  const beerTimes = React.useMemo(
    () =>
      effectiveStartedAt === null
        ? []
        : myDrinks
            .filter((drink) => drink.drinkType === 'beer')
            .map((drink) => minutesBetween(effectiveStartedAt, new Date(drink.at).getTime())),
    [effectiveStartedAt, myDrinks],
  );
  const stats = active
    ? hubStats({ beerTimes, now: minutes, mine, table, others: people.length })
    : [];

  return (
    <View style={styles.screen}>
      {/* The map shrinks to a band once the night is running: at that point it
          is orientation, not the subject. */}
      <View style={styles.map}>
        <NightRoute
          stops={mapStops}
          live={active}
          height={mapHeight}
          caption={false}
          fallbackCenter={nearby.position ?? lastKnownDevicePosition() ?? CZ_FALLBACK_CENTER}
        />
      </View>

      {/* Absolute: it is chrome floating ON the map. In the column it was also
          CONSUMING height, so the sheet's map offset stacked on top of it and
          left a band of nothing between the two. */}
      <View style={[styles.topBar, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => minimizeParty(router)}
          style={({ pressed }) => [styles.topIcon, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Minimalizovat večer"
        >
          <ChevronDownIcon size={20} color={Colors.foam} />
        </Pressable>

        <View style={styles.grow} />

        {active && privateDrinks.length > 0 ? (
          <Pressable
            onPress={() => setReceiptOpen(true)}
            style={({ pressed }) => [styles.receiptPill, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Otevřít účet"
          >
            <Text style={styles.receiptText} allowFontScaling={false}>
              {hasCompletePrice ? formatPrice(totalCzk, priceCurrency) : 'Účet'}
            </Text>
          </Pressable>
        ) : null}

        {/* Top right, as far from "+1 pivo" as the screen allows. */}
        {active ? (
          <Pressable
            // Ending goes THROUGH the finish screen, never straight to nothing:
            // the last thing an evening does is become a post, and dropping the
            // state on the floor is how a good night ends up unrecorded.
            onPress={() => router.push('/party-finish' as Href)}
            style={({ pressed }) => [styles.endPill, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Ukončit večer"
          >
            <Text style={styles.endText} maxFontSizeMultiplier={FontScaleCap.heading}>
              Ukončit
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* The sheet starts BELOW the map band rather than at `marginTop: 'auto'`:
          with `flex: 1` the auto margin collapsed to nothing and the sheet
          covered the map it was supposed to sit under. */}
      <View
        style={[
          styles.sheet,
          {
            // Pulled UP over the map by the radius, or the rounded corners have
            // nothing behind them to reveal and the edge reads as square.
            marginTop: mapHeight - SHEET_RADIUS,
            paddingBottom: insets.bottom + Spacing.md,
          },
        ]}
      >
        <View style={styles.grabber} />

        {/* The header does not scroll. Where you are, who is with you and the
            night's numbers are the answer to "what is going on" — scrolling the
            log to see what just happened must not push them off the screen. */}
        <View style={styles.sheetHead}>
          {/* Strava's band: the STATE over the numbers, and a way to blow the
              numbers up for a phone lying on the table. */}
          {/* What the hub IS: a place and the people in it. The pub used to be a
              pill floating on the map and the table was buried three sections
              down, so the top of a screen about an evening with friends said
              nothing about either. */}
          <View style={styles.hub}>
            <View style={styles.hubTop}>
            <Pressable
              // The Hospody screen, over the hub. It already has the map, the
              // filters, the sort and the detail, so a second pub list in here
              // would be a worse copy of it — but reaching it by dropping the
              // night and jumping to another tab made choosing a pub feel like
              // abandoning the evening. Same screen, presented as a modal.
              // The pickingPub flag is owned by the modal's own lifecycle, so
              // it cannot stay stuck when the route pops without picking.
              onPress={() => router.push('/pick-pub' as Href)}
              style={({ pressed }) => [styles.hubPub, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={`${displayPubName}. Změnit hospodu.`}
            >
              {active ? <View style={styles.pubDot} /> : null}
              <Text
                style={styles.hubPubName}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.heading}
              >
                {displayPubName}
              </Text>
              <ChevronDownIcon size={15} color={Colors.amber} />
            </Pressable>

            {/* Inviting lives up here, opposite the pub — the header is the
                "who and where" row, and that is what asking someone to join
                changes. Down in the control row it sat among the things you do
                over and over all evening; you invite people once. */}
            {/* Before the night starts too. Getting people to the pub is the
                thing you do BEFORE the first beer, so hiding this until one is
                poured hid it at exactly the moment it is useful.

                With a word on it: a bare glyph in a corner is a guess, and this
                is the one control here whose job no icon says on its own. */}
            <GlassPill accessibilityLabel="Přizvat ke stolu" onPress={openInvite}>
              <UserPlusIcon size={17} color={Colors.amber} />
              <Text style={styles.invitePill} maxFontSizeMultiplier={FontScaleCap.heading}>
                Pozvat
              </Text>
            </GlassPill>
            </View>

            {!active && idlePubMeta.length > 0 ? (
              <Text
                style={styles.hubMeta}
                numberOfLines={2}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {idlePubMeta.join('  ·  ')}
              </Text>
            ) : null}

            {/* The table, once there is one. Before the night the nearest pub's
                distance, opening state and first tap sit above this block;
                after start this row becomes about who is actually at the table.

                Not a button, and no "+" face: inviting lives in the control row
                with the other things that ADD to the evening. Two ways to do it
                made the header read as a control panel. */}
            {active ? (
              <View
                style={styles.hubPeople}
                accessibilityLabel={
                  people.length > 0
                    ? `U stolu: ty, ${people.map((person) => person.name).join(', ')}`
                    : 'U stolu: ty'
                }
              >
                <View style={styles.faces}>
                  {/* The same component the feed card uses, so a person looks
                      the same wherever they appear. */}
                  <Avatar nickname="Ty" size={30} />
                  {people.map((person) => (
                    <View key={person.id} style={styles.faceOverlap}>
                      <Avatar
                        uri={person.avatarUrl}
                        nickname={person.name}
                        displayName={person.name}
                        size={30}
                        border="quiet"
                      />
                    </View>
                  ))}
                </View>
                <Text
                  style={styles.hubNames}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {['Ty', ...people.map((p) => p.name)].join(', ')}
                </Text>
              </View>
            ) : null}

            {/* The other door. Before a night there are two ways in and only one
                was on screen: you could start a table, but not sit down at one
                somebody else had already started. It disappears once the night
                is running — you are at a table, that is the answer. */}
            {active ? null : (
              <Pressable
                onPress={() => {
                  setPrefilledJoinCode(null);
                  setJoinOpen(true);
                }}
                style={({ pressed }) => [styles.joinRow, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel="Přisednout ke stolu kódem"
              >
                <Text style={styles.joinText} maxFontSizeMultiplier={FontScaleCap.body}>
                  Někdo už stůl založil?{' '}
                  <Text style={styles.joinLink} maxFontSizeMultiplier={FontScaleCap.body}>
                    Přisednout kódem
                  </Text>
                </Text>
              </Pressable>
            )}
          </View>

          {/* Only once the night is running. A stopwatch reading "0:00 večer"
              before anything has happened is a number about nothing — and it
              stayed on screen after a shared table ended, which read as an
              evening still going. Before the first drink the hub is a place,
              some people and a way to start.

              Which numbers these are is a product rule with tests, not a fixed
              row: alone the table is your own count twice over. */}
          {active ? (
            <PulsePanel
              startedAt={startedAt}
              stats={stats.map((stat) => ({ value: stat.value, unit: stat.label }))}
            />
          ) : null}

          {/* The thread. Every kind of thing the row of buttons can add lands
              here, in order, with the name of whoever added it — at a table of
              four "Fotka" with no name is the app talking to itself. A game is
              not a line ABOUT a game: the row IS the game and starts it. */}
        </View>

        {/* Only the thread scrolls. No gap between the rows either: the rail is
            drawn INSIDE each row, so spacing between them cuts the thread into
            dashes. The rows carry their own vertical padding. */}
        <ScrollView
          style={styles.grow}
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
        >
          {log.length > 0 ? (
            <View>
              {[...log].reverse().map((event, index, all) => {
                const game = event.gameKey
                  ? games.find((entry) => entry.key === event.gameKey)
                  : undefined;
                const privateDrink = event.beerId ? privateById.get(event.beerId) : undefined;
                return (
                  <Animated.View
                    key={event.id}
                    style={styles.logRow}
                    entering={
                      event.at > mountedAt && !reduceMotion ? FadeInDown.duration(260) : undefined
                    }
                    // The rows under it slide down to make room instead of
                    // teleporting, so you can see WHERE the new one landed.
                    layout={reduceMotion ? undefined : LinearTransition.duration(220)}
                  >
                    {/* The rail. A timeline is a chronology, not a list —
                        hairlines BETWEEN rows separate them, a line THROUGH them
                        says they are one thread. It stops at the first and last
                        node so the thread has ends. */}
                    <View style={styles.logRail} pointerEvents="none">
                      <View style={[styles.railLine, index === 0 && styles.railHidden]} />
                      <View
                        style={[styles.railLine, index === all.length - 1 && styles.railHidden]}
                      />
                    </View>
                    {/* A beer wears the same amber mug-and-plus as the button
                        that pours one, so the thread's most common row is the
                        one you can find without reading. Everything else stays a
                        quiet disc — if every kind were amber, none would be. */}
                    {event.kind === 'beer' ? (
                      // The mug carries WHICH beer this is — third of the night
                      // for whoever poured it. A plus said the row added
                      // something, which the row already said by existing; the
                      // number is the fact you cannot get any other way.
                      <View style={[styles.logIcon, styles.logIconBeer]}>
                        <DrinkGlyph type={event.drinkType ?? 'beer'} color={Colors.stout} />
                        {event.ordinal !== undefined ? (
                          <Text style={styles.logIconCount} allowFontScaling={false}>
                            {event.ordinal}
                          </Text>
                        ) : null}
                      </View>
                    ) : (
                      <View style={styles.logIcon}>{LOG_GLYPH[event.kind]}</View>
                    )}

                    <View style={styles.grow}>
                      {game ? (
                        <View style={styles.gameBlock}>
                          {/* Who put it on the table goes ABOVE the cover: the
                              cover is the thing, and a caption under it read as
                              a footnote to a picture. */}
                          <View style={styles.logWho}>
                            <Text
                              style={styles.logWhoName}
                              maxFontSizeMultiplier={FontScaleCap.body}
                            >
                              {event.by === 'Ty'
                                ? `Hodil jsi na stůl ${game.name}`
                                : `${event.by} hodil na stůl ${game.name}`}{' '}
                              · {clockAt(event.at)}
                            </Text>
                          </View>

                          <Pressable
                            onPress={() => router.push(`/party-game?key=${game.key}` as Href)}
                            style={({ pressed }) => [styles.gameCover, pressed && styles.pressed]}
                            accessibilityRole="button"
                            accessibilityLabel={
                              game.result ? `${game.name}, výsledek` : `Spustit ${game.name}`
                            }
                          >
                            <GameCover game={gameDef(game.key)} height={132} glyph={38} />
                            {/* A play disc, so there is no question what the
                                card does. A chevron on a picture is a link; a
                                play button is a game waiting to be started. */}
                            <View style={styles.playDisc} pointerEvents="none">
                              {game.result ? (
                                <TrophyIcon size={22} color={Colors.stout} />
                              ) : (
                                <PlayIcon size={22} color={Colors.stout} />
                              )}
                            </View>
                            {/* A finished game says so ON its cover. The result
                                under the picture was a caption; over it, the
                                cover IS the result — which is what you want to
                                see when you scroll past it later. */}
                            {game.result ? (
                              <View style={styles.gameScrim} pointerEvents="none" />
                            ) : null}
                            <View style={styles.gameCaption} pointerEvents="none">
                              {/* Who is buying beats who won: it is the fact the
                                  table will still be talking about. */}
                              {game.result?.paying ? (
                                <Text
                                  style={styles.gameWinner}
                                  numberOfLines={1}
                                  maxFontSizeMultiplier={FontScaleCap.heading}
                                >
                                  Platí {game.result.paying}
                                </Text>
                              ) : game.result?.winner ? (
                                <Text
                                  style={styles.gameWinner}
                                  numberOfLines={1}
                                  maxFontSizeMultiplier={FontScaleCap.heading}
                                >
                                  Vyhrál {game.result.winner}
                                </Text>
                              ) : null}
                              <Text
                                style={styles.gameTitle}
                                numberOfLines={1}
                                maxFontSizeMultiplier={FontScaleCap.body}
                              >
                                {game.name}
                              </Text>
                              <Text
                                style={styles.gameMeta}
                                maxFontSizeMultiplier={FontScaleCap.body}
                              >
                                {game.result
                                  ? game.result.winner || game.result.paying
                                    ? 'Odehráno'
                                    : 'Odehráno — bez vítěze'
                                  : 'Ťukni a hraj'}
                              </Text>
                            </View>
                          </Pressable>

                          {game.result ? (
                            <View style={styles.board}>
                              {game.result.scores.slice(0, 4).map((row, rank) => (
                                <View key={row.name} style={styles.boardRow}>
                                  <Text style={styles.boardRank} allowFontScaling={false}>
                                    {rank + 1}
                                  </Text>
                                  <Text
                                    style={styles.boardName}
                                    numberOfLines={1}
                                    maxFontSizeMultiplier={FontScaleCap.body}
                                  >
                                    {row.name}
                                  </Text>
                                  <Text style={styles.boardScore} allowFontScaling={false}>
                                    {row.score}
                                  </Text>
                                </View>
                              ))}
                            </View>
                          ) : null}
                        </View>
                      ) : event.photo ? (
                        // The picture, not a line saying a picture exists.
                        <Image source={{ uri: event.photo }} style={styles.logPhoto} />
                      ) : (
                        <Text
                          style={styles.logText}
                          numberOfLines={2}
                          maxFontSizeMultiplier={FontScaleCap.body}
                        >
                          {privateDrink
                            ? [
                                privateDrink.beerName,
                                privateDrink.volumeMl ? formatVolume(privateDrink.volumeMl) : null,
                                privateDrink.priceCzk ? formatPrice(privateDrink.priceCzk, priceCurrency) : null,
                              ].filter(Boolean).join(' · ')
                            : event.text}
                        </Text>
                      )}

                      {/* Who put it there. Just the name — a 16pt avatar beside
                          every row made a column of confetti down the thread,
                          and the glyph on the rail is already the row's
                          picture. The game block prints its own, above its
                          cover. */}
                      {game ? null : (
                        <Text style={styles.logWhoName} maxFontSizeMultiplier={FontScaleCap.body}>
                          {event.by} · {clockAt(event.at)}
                        </Text>
                      )}
                    </View>

                    {/* Mis-taps happen in pubs, and the log is the only place
                        you can see WHICH beer was wrong — so correcting it
                        belongs here. Spendee's row menu: the taps as a checked
                        list, "Smazat" destructive underneath.

                        The slot is always there, empty or not. Rendered only on
                        rows that have a menu, it shoved their timestamps left
                        and the column of times zig-zagged down the thread. */}
                    <View style={styles.logMenuSlot}>
                      {event.beerId ? (
                        <RowMenu
                          title="Co to bylo?"
                          value={event.text}
                          options={privateDrink && drinkTypeOf(privateDrink) === 'beer'
                            ? Array.from(new Set([privateDrink.beerName, ...taps.map((tap) => tap.name)]))
                            : undefined}
                          onChange={(next) => {
                            const drinkId = event.beerId as string;
                            void mutateBeer(drinkId, () => beer.rename(drinkId, next));
                          }}
                          // Repeat the current selection from the row; this is the only place
                          // that knows which private drink the event represents.
                          repeat={{
                            label: cs.counter.repeatCta,
                            onPress: () => privateDrink ? repeatDrink(privateDrink) : beer.add(event.text),
                          }}
                          actions={[
                            ...(privateDrink ? [{
                              label: 'Upravit',
                              onPress: () => openDrinkForm('edit', drinkTypeOf(privateDrink), privateDrink),
                            }] : []),
                            ...(privateDrink && drinkTypeOf(privateDrink) === 'beer' && partyPub ? [{
                              label: 'Check-in',
                              onPress: () => {
                                setCheckInDrink(privateDrink);
                                setCheckInVisible(true);
                              },
                            }] : []),
                          ]}
                          destructive={{
                            label: cs.myBeers.deleteDrink,
                            onPress: () => confirmDrinkRemoval(event.beerId as string),
                          }}
                        />
                      ) : null}
                    </View>
                  </Animated.View>
                );
              })}
            </View>
          ) : null}
        </ScrollView>

        <View style={styles.undoSlot}>
          {undoDrink ? <View style={styles.undoStrip}>
            <Text style={styles.undoText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
              Zapsáno: {undoDrink.beerName}
            </Text>
            <Pressable
              onPress={() => {
                const drink = undoDrink;
                void mutateBeer(drink.id, () => beer.remove(drink.id)).then((stored) => {
                  if (!stored) return;
                  setUndoDrink((current) => (current?.id === drink.id ? null : current));
                  if (undoTimer.current) clearTimeout(undoTimer.current);
                });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Vrátit zápis ${undoDrink.beerName}`}
            >
              <Text style={styles.undoAction} maxFontSizeMultiplier={FontScaleCap.body}>Vrátit</Text>
            </Pressable>
          </View> : null}
        </View>

        {/* The controls float ON the thread, not on a plate under a rule. The
            hairline said "this is a different panel" and pushed the buttons up
            off the bottom of the phone; a gradient that is solid under the row
            and fades to nothing above it lets the log run out of sight instead
            of stopping at a border.

            The room under the row exists only for the beer chip, which hangs
            below the disc while a night runs. Before one starts there is no
            chip, and fixed padding left the buttons floating in a hole. */}
        <View style={[styles.controls, active && styles.controlsLive]}>
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <LinearGradient id="controlsFade" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor={MockColors.bg} stopOpacity="0" />
                <Stop offset="0.45" stopColor={MockColors.bg} stopOpacity="0.92" />
                <Stop offset="1" stopColor={MockColors.bg} stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill="url(#controlsFade)" />
          </Svg>
          <CircleButton
            label={photoCount > 0 ? `Foto, ${photoCount}` : 'Foto'}
            onPress={() => setPhotoOpen(true)}
          >
            <CameraIcon size={20} color={Colors.foam} />
          </CircleButton>

          {/* One long button instead of a disc with a caption hanging under it.
              The name of what you are drinking belongs INSIDE the thing that
              pours it — floating below, it had nowhere to break, so a long tap
              name either clipped or wrapped into the labels beside it.

              Two targets in one shape: the body logs a beer, the chevron at the
              end changes which. Same split as before, just no longer stacked. */}
          {/* One button, cut. Same amber, same height, flat where they meet and
              rounded only on the outside, with 2pt of the ground showing
              through as the seam. Two separate capsules read as two controls
              that happened to be near each other; this reads as one thing whose
              end does something slightly different. */}
          <View style={styles.primaryGroup}>
          {/* Before a night starts there is no picker beside it, so the flat
              right edge would be a seam with nothing on the other side. */}
          <View style={[styles.primaryWrap, !active && styles.primaryWhole]}>
            <Pressable
              onPress={() => (active && latestDrink ? repeatDrink(latestDrink) : setBeersOpen(true))}
              style={({ pressed }) => [styles.primaryBody, pressed && styles.primaryPressed]}
              accessibilityRole="button"
              accessibilityLabel={active && latestDrink ? `Přidat ${latestDrink.beerName}` : 'Začít večer prvním nápojem'}
            >
              <PlusIcon size={17} color={Colors.stout} />
              <DrinkGlyph type={latestDrink ? drinkTypeOf(latestDrink) : 'beer'} color={Colors.stout} />
              <Text
                style={[styles.primaryLabel, !active && styles.primaryLabelWhole]}
                numberOfLines={2}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {active ? (latestDrink?.beerName ?? houseBeer) : 'Začni večer'}
              </Text>
            </Pressable>
          </View>

          {/* Changing the beer is its OWN button, outside the amber. Inside it,
              a chevron behind a hairline was a second action hiding in the
              middle of the one thing on this screen you press all night — and a
              button you press by accident when you meant to log a beer. */}
          {active ? (
            <Pressable
              onPress={() => setBeersOpen(true)}
              style={({ pressed }) => [styles.primaryPick, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Vybrat jiný nápoj"
            >
              <ChevronDownIcon size={18} color={Colors.stout} />
            </Pressable>
          ) : null}
          </View>

          <CircleButton label="Hry" onPress={() => setGamesOpen(true)}>
            <DicesIcon size={21} color={Colors.foam} />
          </CircleButton>
        </View>
      </View>

      <GamesSheet
        visible={gamesOpen}
        onTable={games.map((game) => game.key)}
        onClose={() => setGamesOpen(false)}
        onPick={(key, name) => {
          addGame(key, name);
          const selected = gameDef(key);
          void placePartyGameAfterTableConfirmation({
            confirmedPartyCode,
            startTable: () => startEvening(pubName.trim() || 'Mimo hospodu'),
            readConfirmedPartyCode: () =>
              selectConfirmedPartyJoinCode(usePartyEveningStore.getState()),
            place: placePartyGameOnTable,
            input: {
              catalogKey: key,
              name,
              scoring: selected.scoring,
            },
          });
          setGamesOpen(false);
        }}
      />

      <PartyDrinkSheet
        visible={beersOpen}
        choices={drinkChoices}
        onClose={() => setBeersOpen(false)}
        onPick={(picked) => {
          if (contextFromPubKey(partyPlaceKey) === null && picked.priceCzk === undefined) {
            openDrinkForm('add', picked.drinkType, {
              id: '', beerName: picked.name, drinkType: picked.drinkType,
              priceCzk: picked.priceCzk, volumeMl: picked.volumeMl,
              at: new Date().toISOString(),
            });
          } else {
            logDrink({
              name: picked.name, drinkType: picked.drinkType,
              priceCzk: picked.priceCzk, volumeMl: picked.volumeMl,
            });
          }
          setBeersOpen(false);
        }}
        onNew={(type) => openDrinkForm('add', type)}
        onBackdate={active ? openBackdatePicker : undefined}
        onScan={() => { setBeersOpen(false); setScanOpen(true); }}
      />

      <ReceiptSheet
        visible={receiptOpen}
        startedAtLabel={effectiveStartedAt ? cs.counter.receiptStarted(clockAt(effectiveStartedAt)) : null}
        beerItems={receiptBeerRows}
        otherItems={receiptOtherRows}
        totalLabel={hasCompletePrice ? formatPrice(totalCzk, priceCurrency) : null}
        onRemove={(item) => removeReceiptIdentity(item.key)}
        onDone={() => setReceiptOpen(false)}
        onClose={() => setReceiptOpen(false)}
      />

      <BeerFormModal
        visible={formOpen}
        mode={formMode}
        beer={formDrink ? { name: formDrink.beerName, priceCzk: formDrink.priceCzk, volumeMl: formDrink.volumeMl } : null}
        initialDrinkType={formDrinkType}
        lockNameInEdit={false}
        placeContext={contextFromPubKey(partyPlaceKey) ?? 'pub'}
        formKey={formNonce}
        titleOverride={formMode === 'edit' ? 'Upravit nápoj' : undefined}
        onCancel={() => {
          setFormOpen(false);
          setFormDrink(null);
          setBackdateAt(null);
        }}
        onSubmit={(result) => {
          const closeForm = () => {
            setFormOpen(false);
            setFormDrink(null);
            setBackdateAt(null);
          };
          if (formMode === 'edit' && formDrink) {
            const drink = formDrink;
            const submittedFormGeneration = formGenerationRef.current;
            void closeAfterDurablePartyBeerMutation(
              mutateBeer,
              drink.id,
              () => beer.update(drink.id, {
                beerName: result.name,
                drinkType: result.drinkType,
                priceCzk: result.priceCzk,
                volumeMl: result.volumeMl,
                servingType: result.servingType,
              }),
              closeForm,
              () => formGenerationRef.current === submittedFormGeneration,
            );
            return;
          }
          logDrink(result, backdateAt ?? undefined);
          closeForm();
        }}
        onScanMenu={backdateAt ? undefined : () => {
          setFormOpen(false);
          afterModalDismiss(() => setScanOpen(true));
        }}
      />

      <ScanMenuSheet
        visible={scanOpen}
        onClose={() => setScanOpen(false)}
        onPick={(source) => {
          setScanOpen(false);
          afterModalDismiss(() => void runDrinkScan(source));
        }}
      />
      <ScannedDrinkPicker
        visible={scannedDrinks.length > 0}
        drinks={scannedDrinks}
        priceCurrency={priceCurrency}
        onClose={() => setScannedDrinks([])}
        onSelect={(drink) => {
          setScannedDrinks([]);
          afterModalDismiss(() => openDrinkForm('add', drink.drinkType, {
              id: '', beerName: drink.name, drinkType: drink.drinkType,
              priceCzk: drink.priceCzk, volumeMl: drink.volumeMl,
              at: new Date().toISOString(),
            }));
        }}
      />
      {partyPub && checkInDrink ? (
        <BeerCheckInSheet
          visible={checkInVisible}
          key={checkInDrink.id}
          beerName={checkInDrink.beerName}
          pub={partyPub}
          pubKey={partyPlaceKey}
          visitClientId={currentVisit?.clientId}
          onClose={() => {
            setCheckInVisible(false);
            afterModalDismiss(() => setCheckInDrink(null));
          }}
          onSubmitted={() => {
            setCheckInVisible(false);
            afterModalDismiss(() => setCheckInDrink(null));
          }}
        />
      ) : null}

      <JoinTableSheet
        visible={joinOpen}
        busy={joiningTable}
        error={joinError}
        initialCode={prefilledJoinCode}
        onJoin={async (code) => {
          const previousCode = confirmedPartyCode;
          const joined = await joinEvening(code);
          if (!joined) return;
          // Sitting down at a running table: the local night starts too, so the
          // counter, the thread and the games have something to run on. A stale
          // local night from a table that already ended must be replaced even
          // if its persisted `live` flag has not settled yet.
          if (!active || previousCode?.toUpperCase() !== joined.joinCode.toUpperCase()) {
            const transition = startParty(
              joined.pubName || pubName || 'Mimo hospodu',
              houseBeer,
            );
            void enqueuePartyPubTransition(transition, joined.joinCode);
          }
          setPrefilledJoinCode(null);
          setJoinOpen(false);
        }}
        onClose={() => {
          clearJoinError();
          setPrefilledJoinCode(null);
          setJoinOpen(false);
        }}
      />

      <InviteSheet
        visible={inviteOpen}
        present={night.people.filter((person) => person.active !== false).map((person) => person.id)}
        // The real thing, or nothing. The evening is created when the night
        // starts; until the server answers there is no code to read out.
        code={confirmedPartyCode}
        link={evening?.joinUrl ?? null}
        onClose={() => setInviteOpen(false)}
      />

      <BeerPhotoCaptureFlow
        open={photoOpen}
        onClose={() => setPhotoOpen(false)}
        partyCode={confirmedPartyCode}
        pendingPartyCode={confirmedPartyCode ? null : pendingJoinCode}
        partyDrinkingDay={
          active && night.startedAt ? drinkingDayKey(new Date(night.startedAt)) : null
        }
      />
      {isFocused ? <AppDialogHost /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MockColors.bg },
  pressed: { opacity: 0.65 },
  grow: { flex: 1 },

  map: { position: 'absolute', top: 0, left: 0, right: 0 },

  // — Floating top bar —
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  pubPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    height: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.stout, 0.92),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  pubDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: MockColors.live },

  // — Hub header —
  hub: { gap: Spacing.sm, marginBottom: Spacing.lg },
  hubTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  invitePill: { fontSize: 14, fontWeight: '700', color: Colors.amber },
  joinRow: {
    minHeight: HitArea.min,
    marginTop: Spacing.md,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  joinText: { fontSize: 14, fontWeight: '500', color: Colors.mutedText },
  joinLink: { color: Colors.amber, fontWeight: '700' },
  // A pill, not a heading with a chevron bolted on: it is a control, and it
  // should look like one before you tap it.
  hubPub: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.sm,
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  hubPubName: {
    flexShrink: 1,
    minWidth: 0,
    fontSize: 18,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: -0.2,
  },
  hubMeta: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  hubPeople: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  faces: { flexDirection: 'row', alignItems: 'center' },
  faceOverlap: { marginLeft: -9 },
  faceText: { fontSize: 12, fontWeight: '800', color: Colors.stout },
  hubNames: { flex: 1, fontSize: 13, fontWeight: '500', color: Colors.mutedText },
  topIcon: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.92),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  endPill: {
    minHeight: HitArea.min,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.92),
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.2),
  },
  receiptPill: {
    minHeight: HitArea.min,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  receiptText: { fontSize: 14, fontWeight: '800', color: Colors.stout, fontVariant: ['tabular-nums'] },
  endText: { fontSize: 14, fontWeight: '700', color: Colors.foam },

  // — Sheet —
  sheet: {
    flex: 1,
    backgroundColor: MockColors.bg,
    borderTopLeftRadius: SHEET_RADIUS,
    borderTopRightRadius: SHEET_RADIUS,
    // The app's one width (§18.3b), not a private 16 because it is a sheet.
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.sm,
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.22),
    marginBottom: Spacing.md,
  },
  sheetHead: { paddingBottom: Spacing.xs },
  sheetContent: { paddingBottom: Spacing.md },

  section: {
    ...MockType.titleS,
    fontSize: 15,
    color: Colors.mutedText,
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },


  output: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: HitArea.min,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: MockColors.surfaceHigh,
    marginTop: Spacing.lg,
  },
  outputText: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foam },

  // — Sections —
  sectionBody: { gap: Spacing.md },
  empty: { fontSize: 14, fontWeight: '400', color: Colors.mutedText, lineHeight: 20 },

  // — Games on the table —
  game: { padding: Spacing.md, borderRadius: 22, backgroundColor: MockColors.surfaceHigh },
  gameHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  // A wash over the art so the words on it stay readable, darkest at the bottom
  // where they sit.
  gameScrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '70%',
    backgroundColor: withAlpha(Colors.stout, 0.55),
  },
  gameWinner: {
    fontFamily: Fonts.numeral,
    fontSize: 22,
    color: Colors.amber,
    marginBottom: 2,
  },
  gameTitle: { ...MockType.bodySemibold, color: Colors.foam },
  gameMeta: { fontSize: 12, fontWeight: '500', color: Colors.mutedText, marginTop: 1 },
  board: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    gap: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  boardRank: {
    width: 14,
    fontSize: 12,
    fontWeight: '700',
    color: Colors.mutedText,
    fontVariant: ['tabular-nums'],
  },
  boardName: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foam },
  boardScore: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  // — Log —
  logRow: {
    flexDirection: 'row',
    // The glyph centres against the WHOLE block, both lines of it. Top-aligned,
    // the icon lined up with the first line and the author's name hung below
    // it, so every row looked a few points too low.
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 64,
  },
  /** Behind the icon column: two half-height segments, so either end can be
   *  hidden and the thread stops at the first and last node. */
  logRail: {
    position: 'absolute',
    left: 19,
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
  },
  railLine: { flex: 1, backgroundColor: withAlpha(Colors.foam, 0.12) },
  railHidden: { backgroundColor: 'transparent' },
  logIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    // Opaque, so the rail passes BEHIND the node rather than through it.
    backgroundColor: Colors.stout3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.1),
    // The badge hangs off the disc.
    overflow: 'visible',
  },
  gameBlock: { gap: Spacing.sm },
  gameCover: { borderRadius: 18, overflow: 'hidden' },
  playDisc: {
    position: 'absolute',
    top: 42,
    left: '50%',
    marginLeft: -24,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  gameCaption: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    bottom: Spacing.sm,
    // The cover art runs under the words, so they need their own ground.
    textShadowColor: Colors.stout,
  },
  logPhoto: {
    width: 140,
    height: 140,
    borderRadius: 16,
    backgroundColor: Colors.stout3,
  },
  logMenuSlot: { width: 30, alignItems: 'flex-end' },
  logWho: { marginTop: 2 },
  // Who and when, on one quiet line under the thing itself. The time used to be
  // right-aligned in its own column, which put the least interesting fact on the
  // row at the end of a long empty gap.
  logWhoName: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.mutedText,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  logIconBeer: {
    flexDirection: 'row',
    gap: 1,
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  logIconCount: { fontFamily: Fonts.numeral, fontSize: 14, color: Colors.stout },
  logText: { fontSize: 16, fontWeight: '600', color: Colors.foam },

  undoSlot: { height: 44, justifyContent: 'center' },
  undoStrip: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  undoText: { flex: 1, color: Colors.foam, fontSize: 14, fontWeight: '600' },
  undoAction: { color: Colors.amber, fontSize: 14, fontWeight: '800' },

  // — Controls —
  // Five equal columns. The primary is bigger but occupies the same slot, so
  // the gaps between all five read as one rhythm instead of the middle pair
  // being pushed apart by the disc.
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.sm,
    // Overlaps the thread it fades out — the scroll runs under it.
    marginTop: -Spacing.xl,
  },
  controlsLive: { paddingBottom: Spacing.sm },
  circleWrap: { alignItems: 'center' },
  primaryGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 2 },
  primaryWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    height: 60,
    borderTopLeftRadius: Radius.pill,
    borderBottomLeftRadius: Radius.pill,
    // A hair of a radius on the seam side too. Dead square, the two halves read
    // as a capsule someone cut with scissors; 6pt and it reads as one object
    // with a joint in it.
    borderTopRightRadius: 6,
    borderBottomRightRadius: 6,
    backgroundColor: Colors.amber,
    overflow: 'hidden',
  },
  // Centred when it is the whole button; left-aligned when a beer name has to
  // share the capsule with the picker.
  primaryLabelWhole: { textAlign: 'center' },
  primaryWhole: {
    borderTopRightRadius: Radius.pill,
    borderBottomRightRadius: Radius.pill,
  },
  primaryBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: '100%',
    paddingHorizontal: Spacing.md,
  },
  primaryPick: {
    width: 52,
    height: 60,
    borderTopLeftRadius: 6,
    borderBottomLeftRadius: 6,
    borderTopRightRadius: Radius.pill,
    borderBottomRightRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  addBadge: {
    position: 'absolute',
    right: -1,
    top: -1,
    width: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    borderWidth: 2,
    borderColor: MockColors.bg,
  },
  circleSecondary: {
    overflow: 'visible',
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circleGlass: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 24,
    overflow: 'hidden',
  },
  circleSolid: { backgroundColor: MockColors.surfaceHigh },
  primaryPressed: { opacity: 0.9, transform: [{ scale: 0.97 }] },
  primaryLabel: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 15,
    lineHeight: 18,
    color: Colors.stout,
  },
  /**
   * Full width of the control row, not the width of the disc above it. Clipped
   * to the disc, a long beer name came out clipped — and the whole
   * point of the chip is telling you what "+1" will pour.
   */
});
