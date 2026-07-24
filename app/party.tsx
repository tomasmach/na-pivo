import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { showAppDialog } from '@/components/shared/AppDialog';
import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { CounterCta, CounterSecondary } from '@/counter/CounterCta';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import { generateUuidV4 } from '@/data/account';
import {
  createPartyEvening,
  endPartyEvening,
  fetchCurrentPartyEvening,
  joinPartyEvening,
  leavePartyEvening,
  sharePartyEveningDrink,
  type FriendActionError,
  type FriendProfile,
  type PartyEvening,
} from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { PartyDrinkSheet } from '@/friends/PartyDrinkSheet';
import { PartyEveningCard } from '@/friends/PartyEveningCard';
import { PartyJoinSheet } from '@/friends/PartyJoinSheet';
import { PartyStartSheet } from '@/friends/PartyStartSheet';
import { PartyTable } from '@/friends/PartyTable';
import { cs } from '@/i18n/cs';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function sanitizeCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
}

function makeJoinCode(): string {
  const hex = generateUuidV4().replace(/-/g, '');
  return Array.from({ length: 6 }, (_, index) => {
    const value = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
    return CODE_ALPHABET[(Number.isFinite(value) ? value : index) % CODE_ALPHABET.length];
  }).join('');
}

function profileName(profile: FriendProfile): string {
  return profile.nickname
    ? `@${profile.nickname}`
    : profile.displayName || cs.partyEvening.friendFallback;
}

function timeLabel(iso: string): string {
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed)) return '';
  return new Date(parsed).toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function errorCopy(error: FriendActionError): string {
  if (error.code === 'ghost_mode') return cs.partyEvening.ghost;
  if (error.code === 'not_friends') return cs.partyEvening.notFriends;
  if (error.code === 'party_not_found' || error.code === 'party_not_active') {
    return cs.partyEvening.notFound;
  }
  return error.detail || cs.partyEvening.error;
}

export default function PartyEveningScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((state) => state.show);
  const accountId = useAccountStore((state) => state.session?.accountId ?? null);
  const routeCode = useMemo(() => sanitizeCode(param(params.code)), [params.code]);

  const [evening, setEvening] = useState<PartyEvening | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [pubName, setPubName] = useState('');
  const [pubCity, setPubCity] = useState('');
  const [joinCode, setJoinCode] = useState(routeCode);
  const [beerName, setBeerName] = useState('');
  const [startOpen, setStartOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(routeCode.length > 0);
  const [drinkOpen, setDrinkOpen] = useState(false);
  const [pendingCreate, setPendingCreate] = useState<{
    code: string;
    pubName: string;
    pubCity: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    const result = await fetchCurrentPartyEvening();
    if (result.ok) {
      setEvening(result.evening);
      if (result.evening) setPendingCreate(null);
    } else {
      setLoadError(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const handleCreate = useCallback(async () => {
    const trimmedName = pubName.trim();
    if (!trimmedName || busy) return;
    setBusy(true);
    const clientId = generateUuidV4();
    const code = makeJoinCode();
    const startedAt = new Date().toISOString();
    const result = await createPartyEvening({
      clientId,
      joinCode: code,
      pubName: trimmedName,
      pubCity: pubCity.trim(),
      startedAt,
    });
    if (result.ok) {
      setEvening(result.evening);
      setPendingCreate(null);
      setStartOpen(false);
    } else if (isRetriableFriendError(result)) {
      setPendingCreate({ code, pubName: trimmedName, pubCity: pubCity.trim() });
      await enqueueFriendOp({
        op: 'party-create',
        clientId,
        code,
        pubName: trimmedName,
        pubCity: pubCity.trim(),
        startedAt,
      });
      setStartOpen(false);
      showToast(cs.partyEvening.actionQueued);
    } else {
      showToast(errorCopy(result));
    }
    setBusy(false);
  }, [busy, pubCity, pubName, showToast]);

  const handleJoin = useCallback(async () => {
    const code = sanitizeCode(joinCode.trim());
    if (code.length !== 6 || busy) return;
    setBusy(true);
    const result = await joinPartyEvening(code);
    if (result.ok) {
      setEvening(result.evening);
      setPendingCreate(null);
      setJoinOpen(false);
    } else if (isRetriableFriendError(result)) {
      await enqueueFriendOp({ op: 'party-join', code });
      setJoinOpen(false);
      showToast(cs.partyEvening.actionQueued);
    } else {
      showToast(errorCopy(result));
    }
    setBusy(false);
  }, [busy, joinCode, showToast]);

  const handleShareDrink = useCallback(
    async (requestedBeer?: string) => {
      const trimmedBeer = (requestedBeer ?? beerName).trim();
      const code = evening?.joinCode ?? pendingCreate?.code;
      if (!code || !trimmedBeer || busy) return;
      setBusy(true);
      const clientId = generateUuidV4();
      const sharedAt = new Date().toISOString();
      const result = await sharePartyEveningDrink(code, {
        clientId,
        beerName: trimmedBeer,
        sharedAt,
      });
      if (result.ok) {
        setBeerName('');
        setDrinkOpen(false);
        showToast(cs.partyEvening.shared);
        await load();
      } else if (isRetriableFriendError(result)) {
        await enqueueFriendOp({
          op: 'party-drink',
          code,
          clientId,
          beerName: trimmedBeer,
          quantity: 1,
          sharedAt,
        });
        setBeerName('');
        setDrinkOpen(false);
        showToast(cs.partyEvening.actionQueued);
      } else {
        showToast(errorCopy(result));
      }
      setBusy(false);
    },
    [beerName, busy, evening?.joinCode, load, pendingCreate?.code, showToast],
  );

  const performLeaveOrEnd = useCallback(async () => {
    if (!evening || busy) return;
    setBusy(true);
    const result = evening.isHost
      ? await endPartyEvening(evening.joinCode)
      : await leavePartyEvening(evening.joinCode);
    if (result.ok) {
      showToast(evening.isHost ? cs.partyEvening.ended : cs.partyEvening.left);
    } else if (isRetriableFriendError(result)) {
      await enqueueFriendOp({
        op: evening.isHost ? 'party-end' : 'party-leave',
        code: evening.joinCode,
      });
      showToast(cs.partyEvening.actionQueued);
    } else {
      showToast(errorCopy(result));
      setBusy(false);
      return;
    }
    setEvening(null);
    setBusy(false);
    router.back();
  }, [busy, evening, router, showToast]);

  const handleLeaveOrEnd = useCallback(() => {
    if (!evening || busy) return;
    if (!evening.isHost) {
      void performLeaveOrEnd();
      return;
    }
    showAppDialog({
      title: cs.partyEvening.endConfirmTitle,
      message: cs.partyEvening.endConfirmBody,
      buttons: [
        { text: cs.partyEvening.endConfirmBack, style: 'cancel' },
        {
          text: cs.partyEvening.endConfirmAction,
          style: 'destructive',
          onPress: () => void performLeaveOrEnd(),
        },
      ],
    });
  }, [busy, evening, performLeaveOrEnd]);

  const copyCode = useCallback(
    async (code: string) => {
      await Clipboard.setStringAsync(code);
      showToast(cs.partyEvening.copied);
    },
    [showToast],
  );

  const activeEvening = evening?.active ? evening : null;
  const hasTable = activeEvening !== null || pendingCreate !== null;
  const activeCode = activeEvening?.joinCode ?? pendingCreate?.code ?? '';
  const activePubName = activeEvening?.pubName ?? pendingCreate?.pubName ?? '';
  const activePubCity = activeEvening?.pubCity ?? pendingCreate?.pubCity ?? '';
  const memberCount = activeEvening?.members.length ?? (pendingCreate ? 1 : 0);
  const hostLabel = activeEvening
    ? cs.partyEvening.hostedBy(profileName(activeEvening.host))
    : cs.partyEvening.pendingShort;
  const events = activeEvening?.events ?? [];

  const lastBeerName = useMemo(() => {
    if (!activeEvening || !accountId) return null;
    for (let index = activeEvening.events.length - 1; index >= 0; index -= 1) {
      const event = activeEvening.events[index];
      if (event.kind === 'drink' && event.account.id === accountId && event.beerName.trim()) {
        return event.beerName;
      }
    }
    return null;
  }, [accountId, activeEvening]);

  const nudge = useMemo<Nudge | null>(() => {
    if (loadError) {
      return {
        kind: 'counted',
        text: cs.partyEvening.error,
        undoLabel: cs.partyEvening.retry,
        onUndo: () => void load(),
      };
    }
    if (pendingCreate) {
      return {
        kind: 'counted',
        text: cs.partyEvening.pendingNudge,
        undoLabel: cs.partyEvening.refresh,
        onUndo: () => void load(),
      };
    }
    if (evening && !evening.active) {
      return {
        kind: 'dopito',
        label: cs.partyEvening.ended,
        onPress: () => router.back(),
      };
    }
    return null;
  }, [evening, load, loadError, pendingCreate, router]);

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + 8,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        >
          <ChevronLeftIcon size={24} color={Colors.foam} />
        </Pressable>
        <Text
          style={styles.headerTitle}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {cs.partyEvening.title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {loading ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.cardGrow}>
            <PartyEveningCard
              count={0}
              pubName=""
              pubCity=""
              code=""
              hostLabel=""
              pending={false}
              loading
              onCopyCode={() => undefined}
            />
          </View>
        </ScrollView>
      ) : hasTable ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void handleRefresh()}
              tintColor={Colors.amber}
            />
          }
          showsVerticalScrollIndicator={false}
        >
          <View style={events.length === 0 ? styles.cardGrow : undefined}>
            <PartyEveningCard
              count={memberCount}
              pubName={activePubName}
              pubCity={activePubCity}
              code={activeCode}
              hostLabel={hostLabel}
              pending={pendingCreate !== null}
              onCopyCode={() => void copyCode(activeCode)}
            />
          </View>

          <Text style={styles.feedHeader} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.partyEvening.feed}
          </Text>

          {events.length > 0 ? (
            <View style={styles.rowsCard}>
              {events.map((event, index) => {
                const name = profileName(event.account);
                return (
                  <View
                    key={event.id}
                    style={[styles.eventRow, index > 0 && styles.eventRowDivider]}
                  >
                    <Text
                      style={styles.eventText}
                      numberOfLines={2}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {event.kind === 'drink'
                        ? cs.partyEvening.drank(name, event.beerName, event.quantity)
                        : cs.partyEvening.joined(name)}
                    </Text>
                    <Text
                      style={styles.eventTime}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {timeLabel(event.at)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : (
            <Text style={styles.emptyFeed} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.partyEvening.emptyFeed}
            </Text>
          )}
        </ScrollView>
      ) : (
        <View style={styles.empty}>
          <PartyTable going={0} maybe={0} mine={false} width={120} />
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.partyEvening.emptyTitle}
          </Text>
          <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.partyEvening.emptyBody}
          </Text>
          <Text style={styles.emptyPrivacy} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.partyEvening.privacy}
          </Text>
        </View>
      )}

      <NudgeSlot nudge={nudge} />

      <CounterCta
        label={hasTable ? cs.partyEvening.shareDrinkCta : cs.partyEvening.createCta}
        subLabel={null}
        onPress={() => {
          if (hasTable) setDrinkOpen(true);
          else setStartOpen(true);
        }}
        accessibilityLabel={
          hasTable ? cs.partyEvening.shareDrinkCta : cs.partyEvening.createCta
        }
        disabled={loading || busy}
      />

      {!loading && activeEvening ? (
        <CounterSecondary
          label={activeEvening.isHost ? cs.partyEvening.end : cs.partyEvening.leave}
          onPress={handleLeaveOrEnd}
        />
      ) : !loading && !hasTable ? (
        <CounterSecondary
          label={cs.partyEvening.joinCta}
          onPress={() => setJoinOpen(true)}
        />
      ) : null}

      <PartyStartSheet
        visible={startOpen}
        pubName={pubName}
        pubCity={pubCity}
        busy={busy}
        onChangePubName={setPubName}
        onChangePubCity={setPubCity}
        onSubmit={() => void handleCreate()}
        onClose={() => setStartOpen(false)}
      />
      <PartyJoinSheet
        visible={joinOpen}
        code={joinCode}
        busy={busy}
        onChangeCode={setJoinCode}
        onSubmit={() => void handleJoin()}
        onClose={() => setJoinOpen(false)}
      />
      <PartyDrinkSheet
        visible={drinkOpen}
        beerName={beerName}
        lastBeerName={lastBeerName}
        busy={busy}
        onChangeBeerName={setBeerName}
        onRepeatLast={() => {
          if (lastBeerName) void handleShareDrink(lastBeerName);
        }}
        onSubmit={() => void handleShareDrink()}
        onClose={() => setDrinkOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: 24,
    gap: 12,
  },
  header: {
    minHeight: 44,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButton: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
  },
  headerTitle: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  headerSpacer: {
    flex: 1,
    minWidth: Spacing.sm,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 12,
  },
  cardGrow: {
    flex: 1,
  },
  feedHeader: {
    marginTop: 24,
    marginBottom: 8,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  rowsCard: {
    overflow: 'hidden',
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.07),
    paddingVertical: 4,
  },
  eventRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  eventRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  eventText: {
    flex: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  eventTime: {
    flexShrink: 0,
    fontFamily: Fonts.ui.regular,
    fontSize: 12,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  emptyFeed: {
    fontFamily: Fonts.ui.regular,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: 12,
  },
  emptyTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
    textAlign: 'center',
    includeFontPadding: false,
  },
  emptyBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 22,
    color: Colors.mutedText,
    textAlign: 'center',
    includeFontPadding: false,
  },
  emptyPrivacy: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.mutedText,
    textAlign: 'center',
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.7,
  },
});
