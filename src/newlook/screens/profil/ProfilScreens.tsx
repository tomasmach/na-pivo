import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Image, Linking, Platform, ScrollView, Share, View, type TextInputInstance } from 'react-native';

import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { nvBack } from '@/newlook/navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { updateAccountPreferences } from '@/data/account';
import { loadAddedPubSubmissions } from '@/data/addedPubsQueue';
import type { AuthProvider } from '@/data/auth';
import { parseBadgeProgress } from '@/data/achievements';
import { pickFeedbackAttachment, type FeedbackAttachmentSource } from '@/data/feedbackAttachmentPicker';
import type { FeedbackCategory, FeedbackContactType } from '@/data/feedbackClient';
import { enqueueFeedback } from '@/data/feedbackQueue';
import { claimInviteCode } from '@/data/friendInviteLink';
import {
  cancelFriendRequest,
  fetchBlockedAccounts,
  fetchFriendInviteCode,
  fetchFriendsDashboard,
  resolveInviteCode,
  searchFriends,
  sendFriendRequest,
  unblockFriend,
  type FriendInvite,
  type FriendProfile,
  type Friendship,
  type InviteResolveResult,
} from '@/data/friendsClient';
import { enqueueFriendOp, isRetriableFriendError } from '@/data/friendsQueue';
import { loadFriendsDashboardSnapshot } from '@/data/friendsSnapshot';
import { fetchAllReleaseNotes, getCurrentAppVersion, type ReleaseNote } from '@/data/releaseNotesClient';
import { isAppleSignInSupported, isGoogleSignInConfigured } from '@/data/socialAuth';
import { trackClientEvent } from '@/data/telemetryClient';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { fetchXpEvents, type XpEvent, type XpEventReason } from '@/data/xpEventsClient';
import { friendDisplayName } from '@/friends/FriendMini';
import { locale, t, type Locale } from '@/i18n';
import { switchLocale } from '@/i18n/switchLocale';
import {
  disableBeerCountReminderNotifications,
  enableBeerCountReminderNotifications,
  reschedulePendingBeerCountReminder,
} from '@/notifications/beerCountReminder';
import { disableFriendPush, registerFriendPush } from '@/notifications/friendPush';
import { disableHomeTransitReminder, enableHomeTransitReminder } from '@/notifications/homeTransitReminder';
import { disablePubReminderNotifications } from '@/notifications/pubReminderNotifications';
import { askTourReminderPermission, notificationPermissionStatus } from '@/notifications/tourReminder';
import { pickAndPrepareAvatar } from '@/profile/avatarPicker';
import { PUBLIC_BADGE_KEYS, badgeStates } from '@/profile/badgeModel';
import { roman } from '@/profile/badgeText';
import { checkNicknameLocal, nicknameReasonMessage, nicknameServerReasonMessage } from '@/profile/nickname';
import { markNicknameNudgeSeen } from '@/profile/nicknameNudge';
import { savedFavoritePubs } from '@/profile/profileModel';
import { useRefreshBadgesOnFocus } from '@/profile/useAccountBadges';
import { useLifetimeSummary } from '@/profile/useLifetimeSummary';
import { useAccountStore } from '@/stores/accountStore';
import { useBadgeStore } from '@/stores/badgeStore';
import { loadBeerPhotos, useBeerPhotosStore } from '@/stores/beerPhotosStore';
import { useBeerWatchStore } from '@/stores/beerWatchStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { usePubFavoritesStore } from '@/stores/pubFavoritesStore';
import { usePubStore } from '@/stores/pubStore';
import {
  BEER_COUNT_REMINDER_INTERVAL_OPTIONS,
  useSettingsStore,
  type BeerCountReminderIntervalMinutes,
} from '@/stores/settingsStore';
import { palette, PALETTES, type Palette } from '@/theme/palette';
import { switchPalette } from '@/theme/switchPalette';
import { formatPrice } from '@/utils/currency';
import { dateTimeFormat, numberFormat } from '@/utils/intlFormat';

import { BackHeader, Screen } from '../../components/chrome';
import { Field, Input, PageTitle } from '../../components/forms';
import { Icon, type IconName } from '../../components/Icon';
import { Sheet } from '../../components/overlays';
import { Button, Card, Chip, ChipWrap, D, IconButton, Kicker, Person, Press, ProgressRing, Row, Segmented, Spinner, T, Tile, Toggle } from '../../components/ui';
import { dialog, toast } from '../../ui/store';
import { C, SCREEN_X, s } from '../../theme';
import { Dial } from '../kompas/Dial';
import { ProfilAvatar } from './ProfilAvatar';
import {
  groupBadges,
  isPublicBadge,
  markBadgeOpened,
  nextGoal,
  nvBadgeAbout,
  nvBadgeAmount,
  nvBadgeName,
  nvStillLine,
  profileNights,
  buildNvBadges,
  useMe,
  useNvBadges,
  type NvBadge,
} from './profilModel';

const P = () => t.nv.profil;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const PRIVACY_URL = 'https://tomasmach.github.io/na-pivo/privacy.html';
const DISTANCE_OPTIONS: (number | null)[] = [0.5, 1, 1.5, 2, 2.5, 5, 10, null];
const BADGES_SHOWN = 5;

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function close(router: ReturnType<typeof useRouter>) {
  if (router.canGoBack()) router.back();
  else router.replace('/nv/kompas');
}

function ErrorLine({ text }: { text: string }) {
  if (!text) return null;
  return (
    <T s={14} w={600} c={C.danger} accessibilityRole="alert">
      {text}
    </T>
  );
}

function Bar({ progress, height = 8 }: { progress: number; height?: number }) {
  const width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` as const;
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: C.control }}>
      <View style={{ width, height, borderRadius: height / 2, backgroundColor: C.yellow }} />
    </View>
  );
}

export function BadgeCircle({ icon, got, size = 76 }: { icon: IconName; got: boolean; size?: number }) {
  return (
    <View
      style={[
        { width: size, height: size, borderRadius: size / 2, backgroundColor: got ? C.yellowSoft : C.card, borderWidth: got ? 2.5 : 1, borderColor: got ? C.yellow : C.hairline },
        s.center,
      ]}
    >
      <Icon name={icon} size={size * 0.38} color={got ? C.yellow : C.muted} />
    </View>
  );
}

function notificationsDenied(body?: string) {
  const copy = t.settings.pubReminders.denied['notifications-denied'];
  dialog({
    title: copy.title,
    body: body ?? copy.body,
    actions: [
      { label: P().settings.cancel },
      { label: t.settings.pubReminders.openSettings, kind: 'primary', onPress: () => void Linking.openSettings() },
    ],
  });
}

// ---------------------------------------------------------------------------
// Profil
// ---------------------------------------------------------------------------

export function ProfilScreen() {
  const router = useRouter();
  const me = useMe();
  const summary = useLifetimeSummary(true);
  const priceCurrency = useSettingsStore((st) => st.priceCurrency);
  const photos = useBeerPhotosStore((st) => st.photos);
  const favoriteMap = usePubFavoritesStore((st) => st.favorites);
  const reportedKeys = usePubStore((st) => st.reportedCacheKeys);
  const reportedIds = usePubStore((st) => st.reportedPubIds);
  const watchCount = useBeerWatchStore((st) => st.watches.length);
  const ownLedger = useBadgeStore((st) => st.accountId != null && st.accountId === me.profile?.id);
  const recentBadges = useBadgeStore((st) => st.recent);
  const badges = useNvBadges();
  const [addedPubs, setAddedPubs] = useState<number | null>(null);
  const accountId = me.profile?.id ?? null;
  useRefreshBadgesOnFocus();

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void loadAddedPubSubmissions().then((list) => {
        if (alive) setAddedPubs(list.length);
      });
      return () => {
        alive = false;
      };
    }, []),
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadBeerPhotos(controller.signal);
    return () => controller.abort();
  }, [accountId]);

  const favorites = useMemo(
    () => savedFavoritePubs(favoriteMap, reportedKeys, reportedIds).length,
    [favoriteMap, reportedIds, reportedKeys],
  );

  const shelf = useMemo(() => {
    if (!badges) return null;
    const recent = ownLedger ? recentBadges : [];
    const rank = (key: string) => {
      const index = (recent as readonly string[]).indexOf(key);
      return index === -1 ? recent.length : index;
    };
    const earned = badges.filter((badge) => badge.state.tier > 0);
    return {
      earned: earned.length,
      total: badges.length,
      shown: [...earned].sort((a, b) => rank(a.key) - rank(b.key) || b.state.tier - a.state.tier).slice(0, BADGES_SHOWN),
    };
  }, [badges, ownLedger, recentBadges]);

  const xp = me.xp;
  const nf = numberFormat();
  const title = me.isSignedIn ? (me.nick ? `@${me.nick}` : me.displayName || t.profile.noDisplayName) : t.profile.noAccountNick;
  const missingNick = me.isSignedIn && me.profile != null && !me.nick;
  const caption = !me.isSignedIn
    ? t.profile.noAccountCaption
    : missingNick
      ? t.profile.nicknameMissing
      : xp
        ? P().profile.levelLine(xp.level, xp.title)
        : null;
  // Level and visibility get a line each, so neither wraps next to the edit buttons.
  const visibility = me.isSignedIn && !missingNick ? (me.isPublic ? t.profile.visibilityPublic : t.profile.visibilityPrivate) : null;
  const levelCaption = me.isSignedIn && !missingNick;
  const nights = useMemo(() => profileNights(summary.sessions, summary.remoteStats), [summary.sessions, summary.remoteStats]);
  const since = summary.firstBeerAt
    ? dateTimeFormat({ day: 'numeric', month: 'numeric', year: 'numeric' }).format(new Date(summary.firstBeerAt))
    : null;

  return (
    <Screen header={<BackHeader />} gap={20}>
      <View style={[s.row, { gap: 16 }]}>
        <View style={{ width: 84, height: 84 }}>
          <ProgressRing size={84} progress={me.progress} stroke={4} />
          <View style={[{ position: 'absolute', left: 8, top: 8, width: 68, height: 68, borderRadius: 34, backgroundColor: C.control, overflow: 'hidden' }, s.center]}>
            {me.avatarUrl ? (
              <Image source={{ uri: me.avatarUrl }} style={{ width: 68, height: 68 }} accessibilityIgnoresInvertColors />
            ) : me.initial ? (
              <T s={28} w={800} c={C.yellow}>
                {me.initial}
              </T>
            ) : (
              <Icon name="user" size={28} color={C.yellow} />
            )}
          </View>
        </View>
        <View style={[s.fill, { gap: 2 }]}>
          <D s={34} numberOfLines={1} adjustsFontSizeToFit>
            {title}
          </D>
          <Press disabled={!missingNick} onPress={() => router.push('/nv/dokoncit-ucet')}>
            {caption ? (
              <T s={14} c={missingNick ? C.yellow : C.muted} numberOfLines={levelCaption ? 1 : undefined} adjustsFontSizeToFit={levelCaption} minimumFontScale={0.85}>
                {caption}
              </T>
            ) : null}
            {visibility ? (
              <T s={14} c={C.muted} numberOfLines={1}>
                {visibility}
              </T>
            ) : null}
          </Press>
        </View>
        <IconButton
          icon="pencil"
          size={40}
          iconSize={18}
          onPress={() => {
            trackUiInteraction(me.isSignedIn ? 'profile_edit_open' : 'profile_signup_open');
            router.push(me.isSignedIn ? '/nv/upravit-profil' : '/nv/prihlaseni');
          }}
          label={me.isSignedIn ? P().profile.edit : P().profile.signIn}
        />
        <IconButton
          icon="settings"
          size={40}
          iconSize={18}
          onPress={() => {
            trackUiInteraction('profile_settings_open');
            router.push('/nv/nastaveni');
          }}
          label={P().profile.settings}
        />
      </View>
      <View style={[s.row, { gap: 14 }]}>
        <D s={96} lh={0.9} c={C.yellow}>
          {nf.format(summary.beers)}
        </D>
        <View style={{ gap: 2 }}>
          <T s={19} w={700}>
            {P().profile.lifetime(summary.beers)}
          </T>
          {since ? <T s={13} c={C.muted}>{P().profile.since(since)}</T> : null}
        </View>
      </View>
      {xp ? (
        <Press onPress={() => router.push('/nv/novy-level')} style={{ gap: 10 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={14} w={600}>
              {xp.xpForNextLevel == null ? t.profile.levelMaxed : P().profile.toLevel(xp.level + 1)}
            </T>
            {xp.xpForNextLevel != null ? <T s={14} c={C.muted}>{P().profile.xpOf(xp.xpIntoLevel, xp.xpForNextLevel)}</T> : null}
          </View>
          <Bar progress={me.progress} height={10} />
        </Press>
      ) : !me.isSignedIn ? (
        <Press
          onPress={() => {
            trackUiInteraction('profile_signup_open');
            router.push('/nv/prihlaseni');
          }}
          style={{ gap: 10 }}
        >
          <T s={14} w={600}>
            {t.profile.levelNoAccount}
          </T>
          <Bar progress={0} height={10} />
        </Press>
      ) : null}
      <View style={[s.row, { justifyContent: 'space-between' }]}>
        {[
          [nf.format(summary.pubs), P().profile.pubs(summary.pubs)],
          [nf.format(nights.nights), P().profile.evenings(nights.nights)],
          [numberFormat({ maximumFractionDigits: 1 }).format(nights.average), P().profile.perEvening],
          [formatPrice(summary.spentCzk, priceCurrency), P().profile.spent],
        ].map(([v, l]) => (
          <View key={l} style={{ gap: 2 }}>
            <D s={24} lh={1}>
              {v}
            </D>
            <T s={12} c={C.muted}>
              {l}
            </T>
          </View>
        ))}
      </View>
      {shelf ? (
        <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 16, gap: 14 }}>
          <Press
            onPress={() => {
              trackUiInteraction('profile_badges_open');
              router.push('/nv/odznaky');
            }}
            style={[s.row, { justifyContent: 'space-between' }]}
          >
            <T s={17} w={700}>
              {P().profile.badges}
            </T>
            <T s={14} w={700} c={C.yellow}>
              {P().profile.badgesCount(shelf.earned, shelf.total)}
            </T>
          </Press>
          {shelf.shown.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 14 }}>
              {shelf.shown.map((badge) => (
                <Press key={badge.key} onPress={() => router.push({ pathname: '/nv/odznak', params: { id: badge.key } })} style={{ alignItems: 'center', gap: 6 }}>
                  <BadgeCircle icon={badge.icon} got size={54} />
                  <T s={11} w={600} c={C.text2}>
                    {badge.name}
                  </T>
                </Press>
              ))}
            </ScrollView>
          ) : null}
        </View>
      ) : null}
      <Card>
        <Row leading={<Tile icon="image" />} title={P().profile.photos} trailing={<T s={15} w={600}>{nf.format(photos.length)}</T>} chevron
          onPress={() => {
            trackUiInteraction('profile_photos_open');
            router.push('/nv/pivni-fotky');
          }}
        />
        <Row leading={<Tile icon="heart" />} title={P().profile.favorites} trailing={<T s={15} w={600}>{nf.format(favorites)}</T>} chevron onPress={() => router.push('/nv/hledani')} />
        <Row
          leading={<Tile icon="map-pin-plus" />}
          title={P().profile.addedPubs}
          trailing={addedPubs ? <T s={15} w={600}>{nf.format(addedPubs)}</T> : null}
          chevron
          onPress={() => router.push('/nv/moje-hospody')}
        />
        <Row leading={<Tile icon="route" />} title={P().profile.tours} chevron onPress={() => router.push('/nv/tour')} />
        <Row
          last
          leading={<Tile icon="bell" />}
          title={P().profile.watched}
          trailing={watchCount > 0 ? <T s={15} w={600}>{nf.format(watchCount)}</T> : null}
          chevron
          onPress={() => router.push('/nv/hlidana-piva')}
        />
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Odznaky
// ---------------------------------------------------------------------------

function useBadgesOrLocked(): NvBadge[] {
  const badges = useNvBadges();
  return useMemo(() => badges ?? buildNvBadges(parseBadgeProgress({}), new Date()), [badges]);
}

export function OdznakyScreen() {
  const router = useRouter();
  const badges = useBadgesOrLocked();
  useRefreshBadgesOnFocus();
  const earned = badges.filter((badge) => badge.state.tier > 0).length;
  const goal = nextGoal(badges);
  const goalStill = goal ? nvStillLine(goal) : null;
  return (
    <Screen header={<BackHeader />} gap={18}>
      <View style={[s.row, { justifyContent: 'space-between', alignItems: 'flex-end' }]}>
        <D s={44}>{P().badges.title}</D>
        <T s={16} w={700} c={C.muted} style={{ marginBottom: 6 }}>
          {P().badges.count(earned, badges.length)}
        </T>
      </View>
      {goal ? (
        <Press
          onPress={() => router.push({ pathname: '/nv/odznak', params: { id: goal.key } })}
          style={{ padding: 16, gap: 14, borderRadius: 22, backgroundColor: C.yellowWash, borderWidth: 1, borderColor: C.yellowEdge }}
        >
          <View style={[s.row, { gap: 12 }]}>
            <View style={[{ width: 40, height: 40, borderRadius: 20, backgroundColor: C.control }, s.center]}>
              <Icon name={goal.icon} size={18} color={C.yellow} />
            </View>
            <View style={{ gap: 2 }}>
              <T s={16} w={700}>
                {t.badges.nextRow(nvBadgeName(goal, goal.state.tier + 1))}
              </T>
              {goalStill ? (
                <T s={13} c={C.muted}>
                  {goalStill}
                </T>
              ) : null}
            </View>
          </View>
          <Bar progress={goal.state.value / (goal.state.next ?? 1)} />
        </Press>
      ) : null}
      {groupBadges(badges).map((group) => (
        <View key={group.group} style={{ gap: 14 }}>
          <T s={17} w={700}>
            {group.title}
          </T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 }}>
            {group.items.map((badge) => {
              const hidden = badge.state.secret && badge.state.tier === 0;
              return (
                <Press
                  key={badge.key}
                  onPress={() => router.push({ pathname: '/nv/odznak', params: { id: badge.key } })}
                  style={{ width: '33.33%', alignItems: 'center', gap: 6 }}
                >
                  <BadgeCircle icon={hidden ? 'circle-question-mark' : badge.icon} got={badge.state.tier > 0} />
                  <T s={13} w={700} c={badge.state.tier > 0 ? C.white : C.muted} style={{ textAlign: 'center' }}>
                    {badge.name}
                  </T>
                  <T s={11} c={C.muted}>
                    {badge.status}
                  </T>
                </Press>
              );
            })}
          </View>
        </View>
      ))}
    </Screen>
  );
}

function BadgeVisibility({ badge }: { badge: NvBadge }) {
  const shared = isPublicBadge(badge.key);
  return (
    <View style={[s.row, { justifyContent: 'center', gap: 8 }]}>
      <Icon name={shared ? 'users' : 'lock'} size={14} color={C.muted} />
      <T s={13} c={C.muted}>
        {shared ? t.badges.friendsSee : t.badges.onlyYou}
      </T>
    </View>
  );
}

export function OdznakSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = firstParam(params.id);
  const badges = useBadgesOrLocked();
  const badge = badges.find((candidate) => candidate.key === id) ?? null;

  useEffect(() => {
    if (badge) markBadgeOpened(badge.key);
    else nvBack(router);
  }, [badge, router]);

  if (!badge) return null;
  const { state } = badge;
  const got = state.tier > 0;

  if (state.secret && !got) {
    return (
      <Sheet scroll={false} contentStyle={{ alignItems: 'center' }}>
        <View style={[{ width: 128, height: 128, borderRadius: 26, borderWidth: 2, borderStyle: 'dashed', borderColor: '#FFFFFF4D', marginTop: -20 }, s.center]}>
          <D s={64} c={C.text2}>
            ?
          </D>
        </View>
        <D s={34}>{t.badges.secretName}</D>
        <T s={15} c={C.text2} style={{ marginTop: -10 }}>
          {t.badges.secretAbout}
        </T>
        <View style={[s.row, { height: 38, borderRadius: 19, paddingHorizontal: 14, gap: 6, backgroundColor: C.control }]}>
          <Icon name="sparkles" size={15} color={C.text2} />
          <T s={14} w={700}>
            {t.badges.secretStatus}
          </T>
        </View>
      </Sheet>
    );
  }

  if (state.kind === 'slots') {
    const weekdays = badge.key === 'weekdays';
    const labels = weekdays ? t.badges.weekdays : t.badges.months;
    const filled = new Set(state.slots ?? []);
    const total = labels.length;
    const missing = total - state.value;
    const size = weekdays ? 40 : 44;
    return (
      <Sheet scroll={false} contentStyle={{ alignItems: 'center' }}>
        <View style={[{ width: 130, height: 130, marginTop: -20 }, s.center]}>
          <ProgressRing size={130} progress={state.value / total} stroke={14} />
          <Icon name={badge.icon} size={40} color={got ? C.yellow : C.text2} />
        </View>
        <D s={34}>{badge.name}</D>
        <T s={14} c={C.muted} style={{ marginTop: -14 }}>
          {t.badges.slotsOf(state.value, total)}
        </T>
        <T s={15} c={C.text2} style={{ textAlign: 'center' }}>
          {weekdays ? t.badges.keepDays : t.badges.keepMonths}
        </T>
        <View style={[s.row, { gap: 8, flexWrap: 'wrap', justifyContent: 'center' }]}>
          {labels.map((label, index) => {
            const on = filled.has(weekdays ? index : index + 1);
            return (
              <View
                key={label}
                style={[{ width: size, height: size, borderRadius: size / 2, borderWidth: on ? 2 : 1, borderColor: on ? C.yellow : C.hairline, backgroundColor: on ? C.yellowSoft : 'transparent' }, s.center]}
              >
                <T s={weekdays ? 13 : 12} w={700} c={on ? C.yellow : C.muted}>
                  {label}
                </T>
              </View>
            );
          })}
        </View>
        <T s={16} w={700}>
          {missing <= 0
            ? weekdays
              ? t.badges.allDays
              : t.badges.allMonths
            : weekdays
              ? t.badges.missingDays(missing)
              : t.badges.missingMonths(missing)}
        </T>
      </Sheet>
    );
  }

  const medal = (
    <View style={{ alignItems: 'center', gap: 6, marginTop: -20 }}>
      <View style={[{ width: 132, height: 132, borderRadius: 66, borderWidth: got ? 3 : 1.5, borderColor: got ? C.yellow : C.hairline, backgroundColor: got ? C.yellowSoft : C.card }, s.center]}>
        <View style={[{ width: 92, height: 92, borderRadius: 46, borderWidth: 1.5, borderColor: got ? C.yellowLine : C.hairline }, s.center]}>
          <Icon name={badge.icon} size={40} color={got ? C.yellow : C.muted} />
        </View>
      </View>
      <D s={38} style={{ marginTop: 10, textAlign: 'center' }}>
        {badge.name}
      </D>
      {state.kind === 'tiered' && got ? (
        <T s={14} c={C.muted}>
          {t.badges.levelOf(String(state.tier), String(state.tiers.length))}
        </T>
      ) : null}
      <T s={16} c={C.text2} lh={1.4} style={{ textAlign: 'center', marginTop: 8 }}>
        {nvBadgeAbout(badge)}
      </T>
    </View>
  );
  const quip = badge.key === 'partyEvenings' ? undefined : (t.badges.quips as Partial<Record<string, string>>)[badge.key];

  if (state.kind === 'once') {
    return (
      <Sheet scroll={false}>
        {medal}
        <View style={[s.row, { alignSelf: 'center', height: 38, borderRadius: 19, paddingHorizontal: 14, gap: 6, backgroundColor: C.control }]}>
          <Icon name={got ? 'check' : 'lock'} size={15} color={got ? C.yellow : C.text2} />
          <T s={14} w={700}>
            {badge.status}
          </T>
        </View>
        {got && quip ? (
          <View style={{ padding: 14, borderRadius: 16, backgroundColor: C.card }}>
            <T s={14} c={C.text2} style={{ textAlign: 'center', fontStyle: 'italic' }}>
              {`„${quip}“`}
            </T>
          </View>
        ) : null}
        <BadgeVisibility badge={badge} />
      </Sheet>
    );
  }

  const still = nvStillLine(badge);
  return (
    <Sheet scroll={false}>
      {medal}
      {got && quip ? (
        <View style={{ padding: 14, borderRadius: 16, backgroundColor: C.card }}>
          <T s={14} c={C.text2} style={{ textAlign: 'center', fontStyle: 'italic' }}>
            {`„${quip}“`}
          </T>
        </View>
      ) : null}
      {state.next != null ? (
        <View style={{ gap: 10 }}>
          <T s={15} w={700}>
            {state.volume ? nvBadgeAmount(badge, state.value) : [t.badges.toLevel(roman(state.tier + 1)), still].filter(Boolean).join(' · ')}
          </T>
          <Bar progress={state.value / state.next} />
        </View>
      ) : (
        <T s={15} w={700} style={{ textAlign: 'center' }}>
          {t.badges.allLevels}
        </T>
      )}
      <View style={{ gap: 10 }}>
        <T s={15} w={700} c={C.muted}>
          {t.badges.levels}
        </T>
        <View style={[s.row, { justifyContent: 'space-between' }]}>
          {state.tiers.map((threshold, i) => {
            const on = i < state.tier;
            return (
              <View key={threshold} style={{ alignItems: 'center', gap: 6 }}>
                <View style={[{ width: 44, height: 44, borderRadius: 22, borderWidth: on ? 2 : 1, borderColor: on ? C.yellow : C.muted, backgroundColor: on ? C.yellowSoft : 'transparent' }, s.center]}>
                  <T s={14} w={800} c={on ? C.yellow : C.muted}>
                    {roman(i + 1)}
                  </T>
                </View>
                <T s={11} c={on ? C.white : C.muted}>
                  {on ? t.badges.earned : t.badges.locked}
                </T>
              </View>
            );
          })}
        </View>
      </View>
      <BadgeVisibility badge={badge} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Nový level
// ---------------------------------------------------------------------------

const REASON_ICON: Record<XpEventReason, IconName> = {
  drink: 'beer',
  photo: 'camera',
  checkin: 'star',
  mapping: 'map',
  community: 'clock-3',
  contest: 'trophy',
};

export function NovyLevelSheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ since?: string }>();
  const since = firstParam(params.since) || null;
  const me = useMe();
  const xp = me.xp;
  const [events, setEvents] = useState<XpEvent[] | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetchXpEvents(since, controller.signal).then((list) => {
      if (!controller.signal.aborted) setEvents(list);
    });
    return () => controller.abort();
  }, [since]);

  useEffect(() => {
    if (!xp) nvBack(router);
  }, [router, xp]);

  if (!xp) return null;
  const shown = (events ?? []).slice(0, 3);
  return (
    <Sheet closeIcon={false} scroll={false}>
      <View style={{ alignItems: 'center', gap: 16 }}>
        <View style={{ width: 124, height: 124 }}>
          <ProgressRing size={124} progress={0.999} stroke={8} />
          <View style={[{ position: 'absolute', left: 16, top: 16, width: 92, height: 92, borderRadius: 46, backgroundColor: C.control, overflow: 'hidden' }, s.center]}>
            {me.avatarUrl ? (
              <Image source={{ uri: me.avatarUrl }} style={{ width: 92, height: 92 }} accessibilityIgnoresInvertColors />
            ) : me.initial ? (
              <T s={36} w={800} c={C.yellow}>
                {me.initial}
              </T>
            ) : (
              <Icon name="user" size={36} color={C.yellow} />
            )}
          </View>
        </View>
        <D s={36} style={{ textAlign: 'center' }}>
          {P().level.title(xp.level, xp.title)}
        </D>
      </View>
      {xp.xpForNextLevel != null ? (
        <View style={{ gap: 10 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <T s={14} w={700}>
              {P().level.toLevel(xp.level + 1)}
            </T>
            <T s={14} c={C.muted}>
              {P().level.remaining(Math.max(0, xp.xpForNextLevel - xp.xpIntoLevel))}
            </T>
          </View>
          <Bar progress={me.progress} />
        </View>
      ) : (
        <T s={15} w={700} style={{ textAlign: 'center' }}>
          {t.profile.levelMaxed}
        </T>
      )}
      {events == null && since ? <Spinner /> : null}
      {shown.length > 0 ? (
        <>
          <T s={15} w={700} c={C.muted}>
            {P().level.whatMoved}
          </T>
          <View>
            {shown.map((event, index) => (
              <Row
                key={`${event.createdAt}-${index}`}
                last={index === shown.length - 1}
                leading={<Tile icon={REASON_ICON[event.reason]} color={C.white} />}
                title={P().level.reasons[event.reason]}
                titleWeight={700}
                sub={event.pubName || undefined}
                trailing={<D s={24} c={C.yellow}>{P().level.amount(event.amount)}</D>}
              />
            ))}
          </View>
        </>
      ) : null}
      <Button label={P().level.cta} onPress={() => nvBack(router)} />
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Nastavení
// ---------------------------------------------------------------------------

function distanceLabel(km: number | null): string {
  if (km === null) return t.settings.distance.unlimited;
  if (km < 1) return t.settings.distance.meters(Math.round(km * 1000));
  return `${numberFormat({ maximumFractionDigits: 1 }).format(km)} ${t.settings.distance.kmShort}`;
}

function providerName(provider: AuthProvider): string {
  return P().account.methods[provider];
}

export function NastaveniScreen() {
  const router = useRouter();
  const me = useMe();
  const st = useSettingsStore();
  const [picker, setPicker] = useState<'distance' | 'interval' | null>(null);
  const [busy, setBusy] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const homeSet = st.homePoint != null;
  const providers = me.profile?.providers ?? [];
  // On only when tour reminders can really come: a fresh install that was never asked shows off, and a tap asks.
  const [tourPermissionGranted, setTourPermissionGranted] = useState(false);
  useEffect(() => {
    const check = () => void notificationPermissionStatus().then((status) => setTourPermissionGranted(status === 'granted'));
    check();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    return () => subscription.remove();
  }, []);
  const tourRemindersOn = st.tourRemindersEnabled && tourPermissionGranted;

  const togglePicker = (next: 'distance' | 'interval') => setPicker((current) => (current === next ? null : next));

  const pickDistance = (km: number | null) => {
    setPicker(null);
    trackUiInteraction('settings_distance_change', 'select');
    st.setMaxDistanceKm(km);
    void updateAccountPreferences({ maxDistanceKm: km });
  };

  const pickInterval = (minutes: BeerCountReminderIntervalMinutes) => {
    setPicker(null);
    st.setBeerCountReminderIntervalMinutes(minutes);
    void reschedulePendingBeerCountReminder();
  };

  const toggleNextBeer = async () => {
    if (busy) return;
    trackUiInteraction('settings_beer_reminders', st.beerCountReminderEnabled ? 'toggle_off' : 'toggle_on');
    setBusy(true);
    try {
      if (st.beerCountReminderEnabled) await disableBeerCountReminderNotifications();
      else if (!(await enableBeerCountReminderNotifications()).ok) notificationsDenied();
    } finally {
      setBusy(false);
    }
  };

  const toggleTransit = async () => {
    if (!homeSet) {
      router.push('/nv/domovsky-bod');
      return;
    }
    if (busy) return;
    if (st.homeTransitReminderEnabled) {
      disableHomeTransitReminder();
      return;
    }
    setBusy(true);
    try {
      if (!(await enableHomeTransitReminder()).ok) notificationsDenied();
    } finally {
      setBusy(false);
    }
  };

  const toggleHaptic = (on: boolean) => {
    trackUiInteraction('settings_haptics', on ? 'toggle_on' : 'toggle_off');
    st.setHapticEnabled(on);
    void updateAccountPreferences({ hapticEnabled: on });
  };

  const toggleMarketingEmails = (on: boolean) => {
    trackUiInteraction('settings_marketing_emails', on ? 'toggle_on' : 'toggle_off');
    st.setMarketingEmailsEnabled(on);
    void updateAccountPreferences({ marketingEmailsEnabled: on });
  };

  const toggleSound = (on: boolean) => {
    trackUiInteraction('settings_sound', on ? 'toggle_on' : 'toggle_off');
    st.setSoundEnabled(on);
    void updateAccountPreferences({ soundEnabled: on });
  };

  const toggleHideNames = (on: boolean) => {
    trackUiInteraction('settings_hide_names', on ? 'toggle_on' : 'toggle_off');
    st.setHidePubNames(on);
    void updateAccountPreferences({ hidePubNames: on });
  };

  const togglePreferRated = (on: boolean) => {
    trackUiInteraction('settings_prefer_rated', on ? 'toggle_on' : 'toggle_off');
    st.setPreferRatedPubs(on);
  };

  const toggleWater = (on: boolean) => {
    trackUiInteraction('settings_water_nudge', on ? 'toggle_on' : 'toggle_off');
    st.setWaterNudgeEnabled(on);
  };

  const pickNavigation = (provider: typeof st.navigationProvider) => {
    if (provider === st.navigationProvider) return;
    trackUiInteraction(provider === 'google' ? 'settings_navigation_google' : 'settings_navigation_mapy', 'select');
    st.setNavigationProvider(provider);
  };

  const openAccount = (pathname: '/nv/ucet' | '/nv/prihlaseni') => {
    trackUiInteraction('settings_account_open');
    router.push(pathname);
  };

  const toggleTourReminders = async () => {
    if (tourRemindersOn) {
      st.setTourRemindersEnabled(false);
      return;
    }
    st.setTourRemindersEnabled(true);
    const answer = await askTourReminderPermission();
    setTourPermissionGranted(answer === 'granted');
    if (answer !== 'granted') useSettingsStore.getState().setTourRemindersEnabled(false);
    // Only a real no sends people to the system settings; without an answer the toggle can simply be tried again.
    if (answer === 'denied') notificationsDenied();
  };

  // The system can refuse notifications, so the switch shows the stored outcome, not the tap.
  const togglePartyPush = async () => {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (st.friendPushEnabled) {
        if (!(await disableFriendPush())) toast({ kind: 'error', title: P().settings.partyPushDisableError });
        return;
      }
      const result = await registerFriendPush();
      if (result.ok || result.reason === 'cancelled') return;
      if (result.reason === 'denied') notificationsDenied(P().settings.partyPushDenied);
      else toast({ kind: 'error', title: P().settings.partyPushEnableError });
    } finally {
      setPushBusy(false);
    }
  };

  const pickPalette = async (next: Palette) => {
    if (!(await switchPalette(next))) toast({ kind: 'error', title: t.account.errorGeneric });
  };

  const pickLocale = async (code: Locale) => {
    if (code === locale) return;
    if (!(await switchLocale(code))) toast({ kind: 'error', title: t.account.errorGeneric });
  };

  const accountTitle = me.nick ? `@${me.nick}` : me.displayName || me.profile?.email || t.settings.accountCard.ctaSignedIn;

  return (
    <Screen header={<BackHeader />} gap={14}>
      <PageTitle title={P().settings.title} />
      <Card>
        {me.isSignedIn ? (
          <>
            <Row
              leading={<Tile icon="user" />}
              title={accountTitle}
              titleWeight={700}
              sub={providers.length > 0 ? P().settings.accountSub(providers.map(providerName).join(', ')) : undefined}
              chevron
              onPress={() => openAccount('/nv/ucet')}
            />
            <Row
              last
              title={t.settings.marketingEmails.title}
              sub={t.settings.marketingEmails.subtitle}
              trailing={<Toggle value={st.marketingEmailsEnabled} onChange={toggleMarketingEmails} />}
            />
          </>
        ) : (
          <Row
            last
            leading={<Tile icon="user" />}
            title={t.settings.accountCard.signedOutTitle}
            titleWeight={700}
            sub={t.settings.accountCard.ctaSignedOutSubtitle}
            chevron
            onPress={() => openAccount('/nv/prihlaseni')}
          />
        )}
      </Card>
      <T s={15} w={700} c={C.muted}>
        {P().settings.privacySection}
      </T>
      <Card>
        <Row last title={P().settings.hideNames} sub={P().settings.hideNamesSub} trailing={<Toggle value={st.hidePubNames} onChange={toggleHideNames} />} />
      </Card>
      <T s={15} w={700} c={C.muted}>
        {P().settings.vycep}
      </T>
      <Card>
        <Row last title={P().settings.publishNights} chevron onPress={() => router.push({ pathname: '/nv/prvni-vyveseni', params: { from: 'nastaveni' } })} />
      </Card>
      <T s={15} w={700} c={C.muted}>
        {P().settings.kompas}
      </T>
      <Card>
        <Row
          last={false}
          title={P().settings.distance}
          trailing={<T s={15} w={600}>{distanceLabel(st.maxDistanceKm)}</T>}
          chevron
          onPress={() => togglePicker('distance')}
        />
        {picker === 'distance' ? (
          <ChipWrap style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.hairline }}>
            {DISTANCE_OPTIONS.map((km) => (
              <Chip key={String(km)} label={distanceLabel(km)} active={st.maxDistanceKm === km} onPress={() => pickDistance(km)} />
            ))}
          </ChipWrap>
        ) : null}
        <Row title={P().settings.preferRated} sub={P().settings.preferRatedSub} trailing={<Toggle value={st.preferRatedPubs} onChange={togglePreferRated} />} />
        <Row
          title={P().settings.navigateVia}
          trailing={
            <Segmented
              height={36}
              style={{ width: 180 }}
              options={[
                { key: 'google', label: P().settings.google },
                { key: 'mapy', label: P().settings.mapy },
              ]}
              value={st.navigationProvider}
              onChange={pickNavigation}
            />
          }
        />
        <Row
          last
          title={P().settings.homePoint}
          trailing={<T s={15} w={600}>{homeSet ? P().settings.homeSet : P().settings.homeUnset}</T>}
          chevron
          onPress={() => router.push('/nv/domovsky-bod')}
        />
      </Card>
      <T s={15} w={700} c={C.muted}>
        {P().settings.reminders}
      </T>
      <Card>
        <Row
          title={P().settings.nextBeer}
          sub={P().settings.nextBeerSub(st.beerCountReminderIntervalMinutes)}
          trailing={<Toggle value={st.beerCountReminderEnabled} onChange={() => void toggleNextBeer()} />}
          onPress={st.beerCountReminderEnabled ? () => togglePicker('interval') : undefined}
        />
        {picker === 'interval' ? (
          <ChipWrap style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.hairline }}>
            {BEER_COUNT_REMINDER_INTERVAL_OPTIONS.map((minutes) => (
              <Chip
                key={minutes}
                label={t.settings.beerCountReminder.intervalShort(minutes)}
                active={st.beerCountReminderIntervalMinutes === minutes}
                onPress={() => pickInterval(minutes)}
              />
            ))}
          </ChipWrap>
        ) : null}
        <Row
          title={P().settings.lastTransit}
          sub={P().settings.lastTransitSub}
          trailing={<Toggle value={st.homeTransitReminderEnabled && homeSet} onChange={() => void toggleTransit()} />}
        />
        <Row
          title={P().settings.tourReminders}
          sub={P().settings.tourRemindersSub}
          trailing={<Toggle value={tourRemindersOn} onChange={() => void toggleTourReminders()} />}
        />
        <Row title={P().settings.water} sub={P().settings.waterSub} trailing={<Toggle value={st.waterNudgeEnabled} onChange={toggleWater} />} />
        {me.isSignedIn ? (
          <Row
            title={P().settings.partyPush}
            sub={P().settings.partyPushSub}
            trailing={<Toggle value={st.friendPushEnabled} onChange={() => void togglePartyPush()} />}
          />
        ) : null}
        <Row
          last
          title={P().settings.pubPing}
          trailing={
            <Toggle
              value={st.pubReminderEnabled}
              onChange={(on) => {
                trackUiInteraction('settings_pub_reminders', on ? 'toggle_on' : 'toggle_off');
                if (on) {
                  router.push({ pathname: '/nv/pripominky', params: { krok: 'povoleni' } });
                  return;
                }
                st.setPubReminderEnabled(false);
                void disablePubReminderNotifications();
              }}
            />
          }
        />
      </Card>
      <T s={15} w={700} c={C.muted}>
        {P().settings.phone}
      </T>
      <Card>
        <Row title={P().settings.haptics} sub={P().settings.hapticsSub} trailing={<Toggle value={st.hapticEnabled} onChange={toggleHaptic} />} />
        <Row last title={P().settings.sound} sub={P().settings.soundSub} trailing={<Toggle value={st.soundEnabled} onChange={toggleSound} />} />
      </Card>
      <T s={15} w={700} c={C.muted}>
        {P().settings.other}
      </T>
      <Card>
        <Row title={P().settings.sharing} chevron onPress={() => router.push('/nv/sdileni-souhlas')} />
        <Row
          title={P().settings.language}
          trailing={
            <Segmented
              height={36}
              style={{ width: 180 }}
              options={[
                { key: 'cs', label: t.settings.language.cs },
                { key: 'en', label: t.settings.language.en },
              ]}
              value={locale}
              onChange={(code) => void pickLocale(code)}
            />
          }
        />
        {/* The new look ignores the palette and Android keeps its icon (switchPalette), so there it would change nothing. */}
        {Platform.OS === 'ios' ? (
          <Row
            title={P().settings.appIcon}
            sub={P().settings.appIconSub}
            trailing={
              <Segmented
                height={36}
                style={{ width: 180 }}
                options={PALETTES.map((key) => ({ key, label: key === 'brown' ? P().settings.appIconBrown : P().settings.appIconGray }))}
                value={palette}
                onChange={(next) => void pickPalette(next)}
              />
            }
          />
        ) : null}
        <Row title={P().settings.writeMe} chevron onPress={() => router.push('/nv/napis-mi')} />
        <Row last title={P().settings.about} chevron onPress={() => router.push('/nv/o-appce')} />
      </Card>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Upravit profil, dokončit účet
// ---------------------------------------------------------------------------

function nicknameError(code: string, detail: string): string {
  if (code === 'nickname_taken' || code === 'http_409') return t.profile.form.nicknameTaken;
  if (code.startsWith('nickname_') || code.startsWith('http_4')) return detail || nicknameServerReasonMessage(code);
  return detail || t.profile.edit.errorGeneric;
}

export function UpravitProfilScreen() {
  const router = useRouter();
  const me = useMe();
  const updateProfile = useAccountStore((st) => st.updateProfile);
  const uploadAvatar = useAccountStore((st) => st.uploadAvatar);
  const removeAvatar = useAccountStore((st) => st.removeAvatar);
  const initialNick = me.profile?.nickname ?? '';
  const initialName = me.profile?.displayName ?? '';
  const [name, setName] = useState(initialName);
  const [nick, setNick] = useState(initialNick);
  const [pub, setPub] = useState(me.isPublic);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const pickPhoto = async () => {
    if (avatarBusy) return;
    setError('');
    setAvatarBusy(true);
    try {
      const picked = await pickAndPrepareAvatar();
      if (picked.status === 'cancelled') return;
      if (picked.status === 'denied') return setError(t.profile.form.permissionBody);
      if (picked.status === 'denied-permanent') return setError(t.profile.form.permissionBlockedBody);
      if (picked.status === 'error') return setError(t.profile.form.avatarUploadError);
      const result = await uploadAvatar(picked.uri);
      if (!result.ok) setError(result.detail || t.profile.form.avatarUploadError);
    } finally {
      setAvatarBusy(false);
    }
  };

  const deletePhoto = async () => {
    setAvatarBusy(true);
    try {
      const result = await removeAvatar();
      if (!result.ok) setError(result.detail || t.profile.edit.errorGeneric);
    } finally {
      setAvatarBusy(false);
    }
  };

  const changePhoto = () => {
    if (!me.avatarUrl) return void pickPhoto();
    dialog({
      title: P().editProfile.changePhoto,
      actions: [
        { label: P().editProfile.removePhoto, kind: 'danger', onPress: () => void deletePhoto() },
        { label: P().editProfile.changePhoto, kind: 'primary', onPress: () => void pickPhoto() },
      ],
    });
  };

  const save = async () => {
    if (saving) return;
    const trimmedNick = nick.trim();
    const trimmedName = name.trim();
    const nickChanged = trimmedNick !== initialNick;
    const params: { nickname?: string; displayName?: string; isPublic?: boolean } = {};
    if (nickChanged) {
      const local = checkNicknameLocal(trimmedNick);
      if (!local.valid) return setError(nicknameReasonMessage(local.reason));
      params.nickname = trimmedNick;
    }
    if (trimmedName !== initialName.trim()) params.displayName = trimmedName;
    if (pub !== me.isPublic) params.isPublic = pub;
    if (Object.keys(params).length === 0) return nvBack(router);
    setError('');
    setSaving(true);
    try {
      const result = await updateProfile(params);
      if (result.ok) {
        nvBack(router);
        toast({ kind: 'saved', title: P().editProfile.saved, icon: 'check' });
        return;
      }
      setError(nickChanged ? nicknameError(result.code, result.detail) : result.detail || t.profile.edit.errorGeneric);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen header={<BackHeader />} footer={<Button testID="profile-save" label={saving ? t.account.loading : P().editProfile.save} disabled={saving} onPress={() => void save()} />} gap={16}>
      <PageTitle title={P().editProfile.title} />
      <Press onPress={changePhoto} disabled={avatarBusy} style={{ alignItems: 'center', gap: 10 }} accessibilityRole="button">
        <ProfilAvatar uri={me.avatarUrl} initial={(nick.trim() || name.trim()).charAt(0).toLocaleUpperCase()} size={96} />
        {avatarBusy ? (
          <Spinner />
        ) : (
          <T s={15} w={700} c={C.yellow}>
            {P().editProfile.changePhoto}
          </T>
        )}
      </Press>
      <Field label={P().editProfile.name}>
        <Input testID="profile-display-name" value={name} onChangeText={setName} />
      </Field>
      <View style={{ gap: 8 }}>
        <Field label={P().editProfile.nick}>
          <Input
            testID="profile-nickname"
            value={nick ? `@ ${nick}` : ''}
            onChangeText={(v) => setNick(v.replace(/^@\s?/, ''))}
            placeholder={P().finishAccount.placeholder}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
        <T s={13} c={C.muted}>
          {P().editProfile.nickHint}
        </T>
      </View>
      <ErrorLine text={error} />
      <Card>
        <Row last title={P().editProfile.public} trailing={<Toggle testID="profile-public" value={pub} onChange={setPub} />} />
      </Card>
      <T s={13} c={C.muted} lh={1.45}>
        {P().editProfile.publicNote}
      </T>
    </Screen>
  );
}

export function DokonciUcetSheet() {
  const router = useRouter();
  const updateProfile = useAccountStore((st) => st.updateProfile);
  const [nick, setNick] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const trimmed = nick.trim().replace(/^@\s?/, '');

  const dismiss = () => {
    void markNicknameNudgeSeen(getCurrentAppVersion());
    nvBack(router);
  };

  const save = async () => {
    if (busy) return;
    const local = checkNicknameLocal(trimmed);
    if (!local.valid) return setError(nicknameReasonMessage(local.reason));
    setError('');
    setBusy(true);
    try {
      const result = await updateProfile({ nickname: trimmed });
      if (result.ok) {
        void markNicknameNudgeSeen(getCurrentAppVersion());
        nvBack(router);
        toast({ kind: 'saved', title: P().finishAccount.saved(trimmed), icon: 'check' });
        return;
      }
      setError(nicknameError(result.code, result.detail));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet closeIcon={false} scroll={false} onClose={dismiss}>
      <View style={{ gap: 6 }}>
        <Kicker color={C.yellow}>{P().finishAccount.kicker}</Kicker>
        <D s={34}>{P().finishAccount.title}</D>
      </View>
      <T s={15} c={C.text2} lh={1.45} style={{ marginTop: -6 }}>
        {P().finishAccount.body}
      </T>
      <View style={{ gap: 8 }}>
        <T s={13} w={600} c={C.muted}>
          {P().finishAccount.label}
        </T>
        <Input value={nick} onChangeText={setNick} placeholder={P().finishAccount.placeholder} autoFocus autoCapitalize="none" autoCorrect={false} onSubmitEditing={() => void save()} />
        <T s={12} c={error ? C.danger : C.muted}>
          {error || P().finishAccount.hint}
        </T>
      </View>
      <Button label={busy ? t.account.loading : P().finishAccount.save} disabled={trimmed.length < 3 || busy} onPress={() => void save()} />
      <Press onPress={dismiss} style={{ alignItems: 'center', paddingBottom: 6 }}>
        <T s={15} w={700} c={C.text2}>
          {P().finishAccount.notNow}
        </T>
      </Press>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Účet, přihlašování
// ---------------------------------------------------------------------------

export function UcetScreen() {
  const router = useRouter();
  const me = useMe();
  const profile = me.profile;
  const logout = useAccountStore((st) => st.logout);
  const deleteAccount = useAccountStore((st) => st.deleteAccount);
  const exportAccountData = useAccountStore((st) => st.exportAccountData);
  const requestEmailVerification = useAccountStore((st) => st.requestEmailVerification);
  const [busy, setBusy] = useState<string | null>(null);
  const providers = profile?.providers ?? [];

  const run = async (key: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const resend = () =>
    run('verify', async () => {
      const result = await requestEmailVerification();
      if (result.ok) toast({ kind: 'saved', title: P().account.resent, icon: 'mail' });
      else toast({ kind: 'error', title: result.detail || t.account.errorGeneric });
    });

  const exportData = () =>
    run('export', async () => {
      const result = await exportAccountData();
      if (result.ok) toast({ kind: 'saved', title: P().account.exported, sub: P().account.exportedSub, icon: 'mail' });
      else toast({ kind: 'error', title: result.detail || t.account.errorGeneric });
    });

  const signOut = () =>
    run('logout', async () => {
      await logout();
      router.replace('/nv/prihlaseni');
    });

  const confirmDelete = () =>
    dialog({
      title: P().account.deleteTitle,
      body: P().account.deleteBody,
      actions: [
        { label: P().account.cancel },
        {
          label: P().account.deleteConfirm,
          kind: 'danger',
          onPress: () =>
            void run('delete', async () => {
              const result = await deleteAccount();
              if (!result.ok) {
                toast({ kind: 'error', title: result.detail || t.account.errorGeneric });
                return;
              }
              toast({ kind: 'info', title: t.account.deleteToast });
              router.replace('/nv/onboarding');
            }),
        },
      ],
    });

  if (!me.isSignedIn) {
    return (
      <Screen header={<BackHeader />} gap={16}>
        <PageTitle title={P().account.title} />
        <Card>
          <Row last title={t.settings.accountCard.signedOutTitle} sub={t.settings.accountCard.ctaSignedOutSubtitle} chevron onPress={() => router.replace('/nv/prihlaseni')} />
        </Card>
      </Screen>
    );
  }

  const verified = profile?.emailVerified === true;
  return (
    <Screen header={<BackHeader />} gap={16}>
      <PageTitle title={P().account.title} />
      <View style={{ backgroundColor: C.card, borderRadius: 24, paddingHorizontal: 16, paddingTop: 14 }}>
        {profile?.email ? (
          <>
            <View style={[s.row, { gap: 12, paddingBottom: 14 }]}>
              <Tile icon="mail" />
              <View style={[s.fill, { gap: 3 }]}>
                <T s={16} w={600} numberOfLines={1}>
                  {profile.email}
                </T>
                {verified ? (
                  <View style={[s.row, { gap: 5 }]}>
                    <Icon name="badge-check" size={14} color={C.yellow} />
                    <T s={13} c={C.text2}>
                      {P().account.verified}
                    </T>
                  </View>
                ) : null}
              </View>
            </View>
            {!verified ? (
              <View style={[s.row, { gap: 10, padding: 12, marginBottom: 12, borderRadius: 14, backgroundColor: '#FFC40014', borderWidth: 1, borderColor: C.yellowEdge }]}>
                <Icon name="mail-warning" size={18} color={C.yellow} />
                <T s={13} c={C.text2} style={s.fill}>
                  {P().account.unverified}
                </T>
                <Press onPress={() => void resend()} disabled={busy === 'verify'}>
                  <T s={13} w={700} c={C.yellow}>
                    {P().account.resend}
                  </T>
                </Press>
              </View>
            ) : null}
          </>
        ) : null}
        <Row
          last
          title={P().account.howYouSignIn}
          trailing={<T s={14} c={C.text2}>{providers.map(providerName).join(', ')}</T>}
          chevron
          onPress={() => router.push('/nv/prihlasovani')}
        />
      </View>
      <T s={15} w={700} c={C.muted}>
        {P().account.more}
      </T>
      <Card>
        <Row title={P().account.export} chevron onPress={() => void exportData()} trailing={busy === 'export' ? <Spinner /> : null} />
        <Row title={P().account.logout} chevron onPress={() => void signOut()} trailing={busy === 'logout' ? <Spinner /> : null} />
        <Row last title={P().account.delete} titleColor={C.danger} chevron onPress={confirmDelete} trailing={busy === 'delete' ? <Spinner /> : null} />
      </Card>
    </Screen>
  );
}

export function PrihlasovaniSheet() {
  const me = useMe();
  const profile = me.profile;
  const linkGoogle = useAccountStore((st) => st.linkGoogle);
  const linkApple = useAccountStore((st) => st.linkApple);
  const unlink = useAccountStore((st) => st.unlink);
  const setPassword = useAccountStore((st) => st.setPassword);
  const [busy, setBusy] = useState<string | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [password, setPasswordValue] = useState('');
  const [email, setEmail] = useState(profile?.email ?? '');
  const [error, setError] = useState('');
  const providers = profile?.providers ?? [];
  const appleSupported = useMemo(() => isAppleSignInSupported(), []);
  const googleConfigured = useMemo(() => isGoogleSignInConfigured(), []);
  const single = providers.length === 1;
  const all = (['email', 'google', 'apple'] as const).filter(
    (provider) =>
      providers.includes(provider) ||
      provider === 'email' ||
      (provider === 'google' ? googleConfigured : appleSupported),
  );

  const link = async (provider: 'google' | 'apple') => {
    if (busy) return;
    setBusy(provider);
    try {
      const result = provider === 'google' ? await linkGoogle() : await linkApple();
      if (result.ok) toast({ kind: 'saved', title: P().loginMethods.linkedToast(P().loginMethods[provider]), icon: 'link' });
      else if (result.code !== 'cancelled') toast({ kind: 'error', title: result.detail || t.account.errorGeneric });
    } finally {
      setBusy(null);
    }
  };

  const confirmUnlink = (provider: AuthProvider) => {
    const name = P().loginMethods[provider];
    dialog({
      title: t.account.unlinkConfirmTitle(name),
      body: t.account.unlinkConfirmBody,
      actions: [
        { label: t.account.deleteConfirmCancel },
        {
          label: t.account.unlinkCta,
          kind: 'danger',
          onPress: async () => {
            setBusy(provider);
            try {
              const result = await unlink(provider);
              toast(result.ok ? { kind: 'saved', title: t.account.unlinkedToast, icon: 'check' } : { kind: 'error', title: result.detail || t.account.errorGeneric });
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    });
  };

  const savePassword = async () => {
    if (busy) return;
    if (password.length < MIN_PASSWORD) return setError(t.account.errorPasswordShort);
    const needsEmail = !profile?.email;
    if (needsEmail && !EMAIL_RE.test(email.trim())) return setError(t.account.errorEmailInvalid);
    setError('');
    setBusy('password');
    try {
      const result = await setPassword({ password, email: needsEmail ? email.trim() : undefined });
      if (result.ok) {
        setPasswordOpen(false);
        setPasswordValue('');
        toast({ kind: 'saved', title: t.account.setPasswordToast, icon: 'check' });
      } else {
        setError(result.detail || t.account.errorGeneric);
      }
    } finally {
      setBusy(null);
    }
  };

  const icons: Record<AuthProvider, IconName> = { email: 'mail', google: 'globe', apple: 'apple' };
  return (
    <Sheet title={P().loginMethods.title} top={single ? 560 : 600} scroll={passwordOpen}>
      {single ? (
        <T s={15} c={C.text2} style={{ marginTop: -8 }}>
          {P().loginMethods.onlyVia(providerName(providers[0]))}
        </T>
      ) : null}
      <Card>
        {all.map((provider, i) => {
          const linked = providers.includes(provider);
          const locked = linked && single;
          return (
            <Row
              key={provider}
              last={i === all.length - 1}
              leading={<Tile icon={icons[provider]} color={C.white} />}
              title={P().loginMethods[provider]}
              sub={locked ? P().loginMethods.onlyOne : linked ? P().loginMethods.linked : P().loginMethods.notLinked}
              trailing={
                busy === provider ? (
                  <Spinner />
                ) : locked ? (
                  <Icon name="lock" size={16} color={C.muted} />
                ) : (
                  <Chip
                    label={linked ? P().loginMethods.unlink : provider === 'email' ? P().loginMethods.setPassword : P().loginMethods.link}
                    plain
                    active={!linked}
                    height={34}
                    onPress={() => {
                      if (linked) confirmUnlink(provider);
                      else if (provider === 'email') setPasswordOpen(true);
                      else void link(provider);
                    }}
                  />
                )
              }
            />
          );
        })}
      </Card>
      {passwordOpen ? (
        <View style={{ gap: 14 }}>
          {!profile?.email ? (
            <Field label={P().loginMethods.emailLabel}>
              <Input value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
            </Field>
          ) : null}
          <Field label={P().loginMethods.passwordLabel}>
            <Input value={password} onChangeText={setPasswordValue} placeholder={P().loginMethods.passwordPlaceholder} secureTextEntry autoFocus onSubmitEditing={() => void savePassword()} />
          </Field>
          <ErrorLine text={error} />
          <Button label={busy === 'password' ? t.account.loading : P().loginMethods.savePassword} disabled={busy !== null} onPress={() => void savePassword()} />
        </View>
      ) : null}
    </Sheet>
  );
}

export function PrihlaseniScreen() {
  const router = useRouter();
  const passwordRef = useRef<TextInputInstance>(null);
  const login = useAccountStore((st) => st.login);
  const register = useAccountStore((st) => st.register);
  const signInGoogle = useAccountStore((st) => st.signInGoogle);
  const signInApple = useAccountStore((st) => st.signInApple);
  const requestPasswordReset = useAccountStore((st) => st.requestPasswordReset);
  const sessionExpired = useAccountStore((st) => st.status === 'reauth-required');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<null | 'submit' | 'google' | 'apple' | 'reset'>(null);
  const appleSupported = useMemo(() => isAppleSignInSupported(), []);
  const googleConfigured = useMemo(() => isGoogleSignInConfigured(), []);

  const done = (created: boolean) => {
    // A new account picks its nickname and whether the profile is public first.
    if (created) router.replace('/nv/upravit-profil');
    else close(router);
  };

  const submit = async () => {
    if (busy) return;
    trackUiInteraction('auth_email_submit', 'submit');
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed) || password.length < MIN_PASSWORD) {
      trackUiInteraction('auth_email_submit', 'failure');
      return setError(EMAIL_RE.test(trimmed) ? t.account.errorPasswordShort : t.account.errorEmailInvalid);
    }
    setError('');
    setBusy('submit');
    try {
      const result = mode === 'login' ? await login({ email: trimmed, password }) : await register({ email: trimmed, password });
      trackUiInteraction('auth_email_submit', result.ok ? 'success' : result.code === 'cancelled' ? 'cancel' : 'failure');
      if (result.ok) {
        if (mode === 'register' && !result.profile.emailVerified) toast({ kind: 'info', title: t.account.verifyEmailSentToast, icon: 'mail' });
        done(mode === 'register');
        return;
      }
      if (result.code !== 'cancelled') setError(result.detail || t.account.errorGeneric);
    } finally {
      setBusy(null);
    }
  };

  const social = async (provider: 'google' | 'apple') => {
    if (busy) return;
    const target = provider === 'google' ? 'auth_google_submit' : 'auth_apple_submit';
    trackUiInteraction(target, 'submit');
    setError('');
    setBusy(provider);
    try {
      const result = provider === 'google' ? await signInGoogle() : await signInApple();
      trackUiInteraction(target, result.ok ? 'success' : result.code === 'cancelled' ? 'cancel' : 'failure');
      if (result.ok) {
        // Claimed anonymous accounts can come back with created=false and no nickname.
        done(result.profile.created === true || result.profile.nickname == null);
        return;
      }
      if (result.code !== 'cancelled') setError(result.detail || t.account.errorGeneric);
    } finally {
      setBusy(null);
    }
  };

  // One tap both opens and sends the reset, which the old screen tracked as two steps.
  const forgot = async () => {
    if (busy) return;
    trackUiInteraction('auth_reset_open');
    trackUiInteraction('auth_reset_submit', 'submit');
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      trackUiInteraction('auth_reset_submit', 'failure');
      return setError(t.account.errorEmailInvalid);
    }
    setError('');
    setBusy('reset');
    try {
      const result = await requestPasswordReset(trimmed);
      trackUiInteraction('auth_reset_submit', result.ok ? 'success' : 'failure');
      if (!result.ok) return setError(result.detail || t.account.errorGeneric);
      toast({ kind: 'saved', title: t.account.resetSentToast, icon: 'mail' });
      router.push('/nv/obnova-hesla');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen
      gap={16}
      padTop={0}
      footer={
        <View style={{ gap: 14 }}>
          <Button
            testID="auth-submit"
            label={busy === 'submit' ? t.account.loading : mode === 'login' ? P().signIn.login : P().signIn.register}
            disabled={busy !== null}
            onPress={() => void submit()}
          />
          <Press onPress={() => void forgot()} style={{ alignItems: 'center' }}>
            <T s={14} w={600} c={C.yellow}>
              {P().signIn.forgot}
            </T>
          </Press>
        </View>
      }
    >
      <Press onPress={() => close(router)} style={{ alignSelf: 'flex-end' }}>
        <T s={15} w={600} c={C.muted}>
          {P().signIn.skip}
        </T>
      </Press>
      <PageTitle title={P().signIn.title} intro={P().signIn.intro} />
      <Segmented
        height={40}
        options={[
          { key: 'login', label: P().signIn.login },
          { key: 'register', label: P().signIn.register },
        ]}
        value={mode}
        onChange={(next) => {
          if (next !== mode) trackUiInteraction(next === 'login' ? 'auth_login_mode' : 'auth_register_mode', 'select');
          setMode(next);
          setError('');
        }}
      />
      {appleSupported ? (
        <Button label={busy === 'apple' ? t.account.loading : P().signIn.apple} icon="apple" kind="white" height={52} disabled={busy !== null} onPress={() => void social('apple')} />
      ) : null}
      {googleConfigured ? (
        <Button label={busy === 'google' ? t.account.loading : P().signIn.google} kind="raised" height={52} disabled={busy !== null} onPress={() => void social('google')} />
      ) : null}
      {appleSupported || googleConfigured ? (
        <View style={[s.row, { gap: 12 }]}>
          <View style={[s.fill, { height: 1, backgroundColor: C.hairline }]} />
          <T s={13} c={C.muted}>
            {P().signIn.orEmail}
          </T>
          <View style={[s.fill, { height: 1, backgroundColor: C.hairline }]} />
        </View>
      ) : null}
      <Field label={P().signIn.email}>
        <Input
          testID="auth-email"
          value={email}
          onChangeText={setEmail}
          placeholder={t.account.emailPlaceholder}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
      </Field>
      <Field label={P().signIn.password}>
        <Input
          testID="auth-password"
          inputRef={passwordRef}
          value={password}
          onChangeText={setPassword}
          placeholder={mode === 'register' ? P().signIn.passwordPlaceholder : undefined}
          secureTextEntry
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          textContentType={mode === 'login' ? 'password' : 'newPassword'}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
      </Field>
      <ErrorLine text={error || (sessionExpired ? t.account.sessionExpired : '')} />
    </Screen>
  );
}

export function ObnovaHeslaScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const linkToken = firstParam(params.token);
  const resetPassword = useAccountStore((st) => st.resetPassword);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    const token = linkToken || code.trim();
    if (!token) return setError(t.account.errorResetCodeMissing);
    if (password.length < MIN_PASSWORD) return setError(t.account.errorPasswordShort);
    setError('');
    setBusy(true);
    try {
      const result = await resetPassword({ token, password });
      if (result.ok) {
        toast({ kind: 'saved', title: t.account.resetDoneToast, icon: 'check' });
        router.dismissAll();
        router.replace('/nv/kompas');
        return;
      }
      if (result.code === 'token_invalid') {
        router.replace({ pathname: '/nv/vysledek', params: { kind: 'neplatny' } });
        return;
      }
      setError(result.detail || t.account.errorGeneric);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      header={<BackHeader icon="x" onBack={() => close(router)} />}
      footer={<Button testID="reset-submit" label={busy ? t.account.loading : P().reset.submit} disabled={busy} onPress={() => void submit()} />}
      gap={16}
    >
      <PageTitle title={P().reset.title} />
      {!linkToken ? (
        <Field label={P().reset.code}>
          <Input testID="reset-code" value={code} onChangeText={setCode} placeholder={P().reset.codePlaceholder} autoCapitalize="none" autoCorrect={false} />
        </Field>
      ) : null}
      <Field label={P().reset.password}>
        <Input
          testID="reset-password"
          value={password}
          onChangeText={setPassword}
          placeholder={P().reset.passwordPlaceholder}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />
      </Field>
      <ErrorLine text={error} />
    </Screen>
  );
}

type ResultKind = 'neplatny' | 'overen' | 'neovereno' | 'diky';
const RESULT_ICONS: Record<ResultKind, IconName> = {
  neplatny: 'link-2-off',
  overen: 'badge-check',
  neovereno: 'mail-x',
  diky: 'send',
};

function isResultKind(value: string): value is ResultKind {
  return value in RESULT_ICONS;
}

/** One-message screens: verified e-mail (`?token=` verifies it here), broken link, thanks. */
export function VysledekScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; token?: string }>();
  const token = firstParam(params.token);
  const requested = firstParam(params.kind);
  const verifyEmail = useAccountStore((st) => st.verifyEmail);
  const [verified, setVerified] = useState<ResultKind | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (!token || ran.current) return;
    ran.current = true;
    void verifyEmail(token).then((result) => setVerified(result.ok ? 'overen' : 'neovereno'));
  }, [token, verifyEmail]);

  if (token && !verified) {
    return (
      <Screen>
        <View style={{ marginTop: 130, gap: 18 }}>
          <Spinner style={{ alignSelf: 'flex-start' }} />
          <D s={44}>{P().result.verifying}</D>
        </View>
      </Screen>
    );
  }
  const kind: ResultKind = verified ?? (isResultKind(requested) ? requested : 'overen');
  const copy = P().result[kind];
  return (
    <Screen
      footer={<Button label={kind === 'diky' ? P().result.close : P().result.back} kind={kind === 'diky' ? 'raised' : 'primary'} onPress={() => close(router)} />}
    >
      <View style={{ marginTop: 130, gap: 18 }}>
        <Tile icon={RESULT_ICONS[kind]} size={64} radius={32} />
        <D s={44}>{copy.title}</D>
        <T s={16} c={C.text2} lh={1.45} style={{ marginTop: -6 }}>
          {copy.body}
        </T>
      </View>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Parta: správa a pozvánka
// ---------------------------------------------------------------------------

export function SpravaPartyScreen() {
  const router = useRouter();
  const me = useMe();
  const needsNickname = me.isSignedIn && me.profile != null && !me.nick;
  const [invite, setInvite] = useState<FriendInvite | null | 'loading'>('loading');
  const [friends, setFriends] = useState<FriendProfile[] | null>(null);
  const [outgoing, setOutgoing] = useState<Friendship[]>([]);
  const [canceling, setCanceling] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<FriendProfile[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FriendProfile[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [requesting, setRequesting] = useState<string | null>(null);
  const searchSeq = useRef(0);
  const shown = useRef(false);

  const load = useCallback(() => {
    const controller = new AbortController();
    void loadFriendsDashboardSnapshot().then((snapshot) => {
      // The saved copy only fills an empty screen; it can still hold a request cancelled here.
      if (controller.signal.aborted || !snapshot || shown.current) return;
      shown.current = true;
      setFriends(snapshot.dashboard.friends);
      setOutgoing(snapshot.dashboard.outgoingRequests);
    });
    void fetchFriendsDashboard(controller.signal).then((dashboard) => {
      if (controller.signal.aborted || !dashboard) return;
      shown.current = true;
      setFriends(dashboard.friends);
      setOutgoing(dashboard.outgoingRequests);
    });
    void fetchBlockedAccounts(controller.signal).then((list) => {
      if (!controller.signal.aborted && list) setBlocked(list);
    });
    return () => controller.abort();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!me.isSignedIn) return undefined;
      return load();
    }, [load, me.isSignedIn]),
  );

  useEffect(() => {
    if (!me.isSignedIn || needsNickname) return;
    const controller = new AbortController();
    void fetchFriendInviteCode(controller.signal).then((result) => {
      if (!controller.signal.aborted) setInvite(result);
    });
    return () => controller.abort();
  }, [me.isSignedIn, needsNickname]);

  const link = invite && invite !== 'loading' ? invite.webUrl || invite.url : '';

  const share = async () => {
    trackUiInteraction('friend_invite_share', 'share');
    if (!link) return toast({ kind: 'offline', title: t.friends.codeOffline });
    await Share.share({ message: t.friends.shareMessage(link) }).catch(() => undefined);
  };

  const copyLink = async () => {
    if (!link) return toast({ kind: 'offline', title: t.friends.codeOffline });
    await Clipboard.setStringAsync(link);
    toast({ kind: 'saved', title: P().parta.copied, icon: 'copy' });
  };

  const search = async () => {
    const q = query.trim().replace(/^@/, '');
    if (q.length < 2) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    const found = await searchFriends(q);
    if (seq !== searchSeq.current) return;
    setSearching(false);
    if (found === null) {
      toast({ kind: 'offline', title: t.friends.offline });
      return;
    }
    setResults(found);
  };

  const request = async (profile: FriendProfile | null) => {
    const nickname = query.trim().replace(/^@/, '');
    const key = profile ? `account:${profile.id}` : `nickname:${nickname.toLowerCase()}`;
    if (requesting) return;
    trackUiInteraction('friend_request_send', 'submit');
    setRequesting(key);
    const result = profile ? await sendFriendRequest({ accountId: profile.id }) : await sendFriendRequest({ nickname });
    setRequesting(null);
    trackUiInteraction('friend_request_send', result.ok || isRetriableFriendError(result) ? 'success' : 'failure');
    if (!result.ok && !isRetriableFriendError(result)) {
      toast({ kind: 'error', title: result.detail });
      return;
    }
    if (!result.ok) {
      await enqueueFriendOp(profile ? { op: 'request', key, accountId: profile.id } : { op: 'request', key, nickname });
    }
    const accepted = result.ok && 'accepted' in result && result.accepted === true;
    toast({ kind: 'saved', title: accepted ? t.friends.requestAccepted : t.friends.requestSent, icon: 'user-plus' });
    setQuery('');
    setResults(null);
    load();
  };

  const confirmUnblock = (account: FriendProfile) =>
    dialog({
      title: t.friends.unblockTitle(friendDisplayName(account)),
      body: t.friends.unblockBody,
      actions: [
        { label: P().settings.cancel },
        {
          label: t.friends.unblockAction,
          kind: 'primary',
          onPress: () =>
            void unblockFriend(account.id).then((result) => {
              if (!result.ok) return toast({ kind: 'error', title: result.detail });
              setBlocked((list) => list.filter((item) => item.id !== account.id));
              toast({ kind: 'saved', title: t.friends.unblocked, icon: 'check' });
            }),
        },
      ],
    });

  const confirmCancelRequest = (request: Friendship) =>
    dialog({
      title: P().parta.cancelRequestTitle(friendDisplayName(request.recipient)),
      actions: [
        { label: t.nv.parta.back },
        {
          label: P().parta.cancelRequestConfirm,
          kind: 'danger',
          onPress: () => {
            setCanceling(request.id);
            void cancelFriendRequest(request.recipient.id).then((result) => {
              setCanceling(null);
              if (!result.ok) return toast({ kind: 'error', title: result.detail });
              setOutgoing((list) => list.filter((item) => item.id !== request.id));
              toast({ kind: 'saved', title: P().parta.requestCanceled, icon: 'check' });
              load();
            });
          },
        },
      ],
    });

  const gate = !me.isSignedIn
    ? { title: t.friends.coldStartAnonTitle, body: t.friends.coldStartAnonBody, cta: t.friends.coldStartAnonCta, href: '/nv/prihlaseni' as const }
    : needsNickname
      ? { title: t.friends.coldStartSetupTitle, body: t.friends.coldStartSetupBody, cta: t.friends.coldStartSetupCta, href: '/nv/dokoncit-ucet' as const }
      : null;

  return (
    <Screen header={<BackHeader />} gap={16}>
      <PageTitle title={P().parta.title} />
      {gate ? (
        <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 20, gap: 12 }}>
          <T s={17} w={700}>
            {gate.title}
          </T>
          <T s={14} c={C.text2} lh={1.45}>
            {gate.body}
          </T>
          <Button label={gate.cta} onPress={() => router.push(gate.href)} />
        </View>
      ) : (
        <>
          <T s={17} w={700}>
            {P().parta.myCode}
          </T>
          <View style={{ backgroundColor: C.card, borderRadius: 24, padding: 20, gap: 16, alignItems: 'center' }}>
            <View style={[{ width: 228, height: 228, padding: 14, borderRadius: 22, backgroundColor: C.white }, s.center]}>
              {link ? (
                <QRCode value={link} size={200} color={C.black} backgroundColor={C.white} />
              ) : invite === 'loading' ? (
                <Spinner color={C.black} />
              ) : (
                <T s={14} w={600} c={C.black} style={{ textAlign: 'center' }}>
                  {t.friends.codeOffline}
                </T>
              )}
            </View>
            <T s={14} c={C.text2} style={{ textAlign: 'center' }}>
              {P().parta.codeHint}
            </T>
            <Button label={P().parta.share} icon="share" style={{ alignSelf: 'stretch' }} onPress={() => void share()} />
            <Button label={P().parta.copyLink} icon="link" kind="raised" style={{ alignSelf: 'stretch' }} onPress={() => void copyLink()} />
          </View>
          <T s={17} w={700}>
            {P().parta.add}
          </T>
          <View style={[s.row, { gap: 10 }]}>
            <View style={s.fill}>
              <Input
                value={query}
                onChangeText={(value) => {
                  setQuery(value);
                  setResults(null);
                }}
                placeholder={P().parta.searchPlaceholder}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="search"
                onSubmitEditing={() => void search()}
              />
            </View>
            <Button
              label={P().parta.find}
              kind="raised"
              height={48}
              style={{ paddingHorizontal: 16 }}
              disabled={searching || query.trim().replace(/^@/, '').length < 2}
              onPress={() => void search()}
            />
          </View>
          {results ? (
            <Card>
              {results.map((profile, idx) => (
                <Row
                  key={profile.id}
                  last={idx === results.length - 1}
                  leading={<ProfilAvatar uri={profile.avatarUrl} initial={(profile.nickname ?? profile.displayName ?? '?')[0]?.toLocaleUpperCase() ?? '?'} />}
                  title={friendDisplayName(profile)}
                  sub={profile.nickname ? profile.displayName || undefined : undefined}
                  trailing={
                    requesting === `account:${profile.id}` ? (
                      <Spinner />
                    ) : (
                      <Chip label={P().parta.addOne} active plain height={34} onPress={() => void request(profile)} />
                    )
                  }
                />
              ))}
              {results.length === 0 ? (
                <Row
                  last
                  title={t.friends.noResults}
                  trailing={<Chip label={t.friends.addByNickname} active plain height={34} onPress={() => void request(null)} />}
                />
              ) : null}
            </Card>
          ) : null}
          <T s={17} w={700}>
            {P().parta.friends}
          </T>
          {friends == null ? (
            <Spinner style={{ alignSelf: 'flex-start' }} />
          ) : friends.length === 0 ? (
            <T s={14} c={C.muted}>
              {P().parta.noFriends}
            </T>
          ) : (
            <Card>
              {friends.map((profile, idx) => (
                <Row
                  key={profile.id}
                  last={idx === friends.length - 1}
                  leading={<ProfilAvatar uri={profile.avatarUrl} initial={(profile.nickname ?? profile.displayName ?? '?')[0]?.toLocaleUpperCase() ?? '?'} />}
                  title={friendDisplayName(profile)}
                  sub={profile.nickname ? profile.displayName || undefined : undefined}
                  chevron
                  onPress={() => router.push({ pathname: '/nv/kamos/[id]', params: { id: profile.id } })}
                />
              ))}
            </Card>
          )}
          {outgoing.length > 0 ? (
            <>
              <T s={17} w={700}>
                {P().parta.outgoing}
              </T>
              <Card>
                {outgoing.map((request, idx) => (
                  <Row
                    key={request.id}
                    last={idx === outgoing.length - 1}
                    leading={<ProfilAvatar uri={request.recipient.avatarUrl} initial={initialOf(request.recipient)} />}
                    title={friendDisplayName(request.recipient)}
                    sub={P().parta.outgoingSub}
                    trailing={
                      canceling === request.id ? (
                        <Spinner />
                      ) : (
                        <Chip label={P().parta.cancelRequest} plain height={34} onPress={canceling ? undefined : () => confirmCancelRequest(request)} />
                      )
                    }
                  />
                ))}
              </Card>
            </>
          ) : null}
          {blocked.length > 0 ? (
            <>
              <T s={17} w={700}>
                {P().parta.blocked}
              </T>
              <Card>
                {blocked.map((account, idx) => (
                  <Row
                    key={account.id}
                    last={idx === blocked.length - 1}
                    leading={<Person initial={(account.nickname ?? account.displayName ?? '?')[0]?.toLocaleUpperCase() ?? '?'} ring={false} />}
                    title={friendDisplayName(account)}
                    trailing={<Chip label={P().parta.unblock} plain height={34} onPress={() => confirmUnblock(account)} />}
                  />
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function initialOf(profile: FriendProfile): string {
  return ((profile.nickname || profile.displayName || '?')[0] ?? '?').toLocaleUpperCase();
}

export function PozvankaDoPartySheet() {
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string }>();
  const code = firstParam(params.code);
  const myId = useAccountStore((st) => st.profile?.id ?? null);
  const [resolved, setResolved] = useState<InviteResolveResult | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [friendIds, setFriendIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    void loadFriendsDashboardSnapshot().then((snap) => {
      if (snap) setFriendIds(new Set(snap.dashboard.friends.map((f) => f.id)));
    });
  }, []);

  useEffect(() => {
    if (!code) return;
    const controller = new AbortController();
    void resolveInviteCode(code, controller.signal).then((result) => {
      if (!controller.signal.aborted) setResolved(result);
    });
    return () => controller.abort();
  }, [code]);

  const claim = async () => {
    if (claiming || !code) return;
    setClaiming(true);
    const result = await claimInviteCode(code);
    setClaiming(false);
    if (result.ok) {
      close(router);
      toast({ kind: 'saved', title: t.friends.claimDone, icon: 'user-plus' });
      return;
    }
    toast({ kind: 'error', title: result.code === 'invite_expired' ? t.friends.claimExpired : result.detail || t.friends.claimInvalid });
  };

  const inviter = resolved?.valid ? resolved.inviter : null;
  const state = !code
    ? 'invalid'
    : !resolved
      ? 'loading'
      : !resolved.valid || !inviter
        ? resolved.expired
          ? 'expired'
          : 'invalid'
        : myId && inviter.id === myId
          ? 'self'
          : friendIds.has(inviter.id)
            ? 'friend'
            : 'valid';

  if (state === 'friend' && inviter) {
    return (
      <Sheet closeIcon={false} scroll={false}>
        <View style={{ alignItems: 'center', gap: 14, paddingVertical: 12 }}>
          <Kicker>{P().invite.kicker}</Kicker>
          <ProfilAvatar uri={inviter.avatarUrl} initial={initialOf(inviter)} size={84} />
          <T s={16} c={C.text2} style={{ textAlign: 'center' }}>
            {P().invite.alreadyFriends}
          </T>
        </View>
        <Button label={P().invite.openProfile} onPress={() => router.replace({ pathname: '/nv/kamos/[id]', params: { id: inviter.id } })} />
        <Press onPress={() => close(router)} style={{ alignItems: 'center', paddingBottom: 6 }}>
          <T s={15} w={700} c={C.text2}>
            {P().invite.notNow}
          </T>
        </Press>
      </Sheet>
    );
  }

  if (state !== 'valid' || !inviter) {
    const message =
      state === 'loading' ? t.friends.claimLoading : state === 'expired' ? t.friends.claimExpired : state === 'self' ? t.friends.claimSelf : t.friends.claimInvalid;
    return (
      <Sheet closeIcon={false} scroll={false}>
        <View style={{ alignItems: 'center', gap: 14, paddingVertical: 12 }}>
          <Kicker>{P().invite.kicker}</Kicker>
          {state === 'loading' ? <Spinner /> : <Icon name="users" size={40} color={C.muted} />}
          <T s={16} c={C.text2} style={{ textAlign: 'center' }}>
            {message}
          </T>
        </View>
        <Press onPress={() => close(router)} style={{ alignItems: 'center', paddingBottom: 6 }}>
          <T s={15} w={700} c={C.text2}>
            {P().invite.notNow}
          </T>
        </Press>
      </Sheet>
    );
  }

  const stats = resolved?.publicStats ?? null;
  const mutual = resolved?.mutualFriends;
  const name = inviter.displayName || (inviter.nickname ? `@${inviter.nickname}` : t.friends.fallbackName);
  const handle = inviter.nickname ? `@${inviter.nickname}` : name;
  const earnedPublic = stats
    ? badgeStates(stats.badgeProgress).filter((state) => PUBLIC_BADGE_KEYS.has(state.key) && state.tier > 0).length
    : 0;
  return (
    <Sheet closeIcon={false} scroll={false}>
      <View style={{ alignItems: 'center', gap: 10, marginTop: -6 }}>
        <Kicker>{P().invite.kicker}</Kicker>
        <ProfilAvatar uri={inviter.avatarUrl} initial={initialOf(inviter)} size={84} />
        <D s={34} style={{ textAlign: 'center' }}>
          {name}
        </D>
        {inviter.displayName && inviter.nickname ? (
          <T s={14} c={C.muted} style={{ marginTop: -6 }}>
            {handle}
          </T>
        ) : null}
      </View>
      {stats ? (
        <View style={[s.row, { padding: 14, borderRadius: 18, backgroundColor: C.card }]}>
          {[
            [stats.totalBeers, P().invite.beers(stats.totalBeers)],
            [stats.distinctPubs, P().invite.pubs(stats.distinctPubs)],
            [earnedPublic, P().invite.badges(earnedPublic)],
          ].map(([v, l]) => (
            <View key={String(l)} style={{ flex: 1, alignItems: 'center' }}>
              <D s={26}>{numberFormat().format(Number(v))}</D>
              <T s={12} c={C.muted}>
                {l}
              </T>
            </View>
          ))}
        </View>
      ) : null}
      <T s={15} c={C.text2} style={{ textAlign: 'center' }}>
        {P().invite.body}
      </T>
      {mutual && mutual.count > 0 ? (
        <View style={[s.row, { justifyContent: 'center', gap: 8 }]}>
          <View style={s.row}>
            {mutual.profiles.map((profile, i) => (
              <View key={profile.id} style={{ marginLeft: i ? -8 : 0 }}>
                <ProfilAvatar uri={profile.avatarUrl} initial={initialOf(profile)} size={26} ring={false} />
              </View>
            ))}
          </View>
          <T s={13} c={C.muted} style={{ flexShrink: 1 }}>
            {P().invite.mutual(mutual.profiles.map(friendDisplayName), Math.max(0, mutual.count - mutual.profiles.length))}
          </T>
        </View>
      ) : null}
      <Button label={claiming ? t.account.loading : P().invite.add} icon="user-plus" disabled={claiming} onPress={() => void claim()} />
      <Press onPress={() => close(router)} style={{ alignItems: 'center', paddingBottom: 6 }}>
        <T s={15} w={700} c={C.text2}>
          {P().invite.notNow}
        </T>
      </Press>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Napiš mi, O appce
// ---------------------------------------------------------------------------

export function NapisMiScreen() {
  const router = useRouter();
  const [kind, setKind] = useState<FeedbackCategory>('bug');
  const [via, setVia] = useState<FeedbackContactType>('instagram');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [attachment, setAttachment] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const version = getCurrentAppVersion();

  const send = async () => {
    if (busy || !message.trim()) return;
    setBusy(true);
    try {
      // Waits only for local persistence; the queue sends it once online.
      await enqueueFeedback({ category: kind, message, contactType: via, contact, attachmentUri: attachment ?? undefined });
      router.replace({ pathname: '/nv/vysledek', params: { kind: 'diky' } });
    } finally {
      setBusy(false);
    }
  };

  const pick = async (source: FeedbackAttachmentSource) => {
    const result = await pickFeedbackAttachment(source);
    if (result.status === 'picked') setAttachment(result.uri);
    else if (result.status === 'denied' || result.status === 'denied-permanent') {
      dialog({
        title: t.report.attachmentPermissionTitle,
        body: result.status === 'denied' ? t.report.attachmentPermissionDenied : t.report.attachmentPermissionBlocked,
        actions:
          result.status === 'denied'
            ? [{ label: t.common.ok }]
            : [{ label: P().writeMe.cancel }, { label: t.report.attachmentOpenSettings, kind: 'primary', onPress: () => void Linking.openSettings() }],
      });
    } else if (result.status === 'error') {
      dialog({ title: t.report.attachmentErrorTitle, body: t.report.attachmentErrorBody, actions: [{ label: t.common.ok }] });
    }
  };

  const chooseSource = () =>
    dialog({
      title: t.report.attachmentSourceTitle,
      actions: [
        { label: t.report.attachmentCamera, onPress: () => void pick('camera') },
        { label: t.report.attachmentLibrary, onPress: () => void pick('library') },
      ],
    });

  return (
    <Screen
      header={<BackHeader />}
      footer={
        <View style={{ gap: 12 }}>
          <Button label={P().writeMe.send} disabled={busy || !message.trim()} onPress={() => void send()} />
          {version ? (
            <T s={12} c={C.muted} style={{ textAlign: 'center' }}>
              {P().writeMe.version(version)}
            </T>
          ) : null}
        </View>
      }
      gap={14}
    >
      <PageTitle title={P().writeMe.title} />
      <T s={16} c={C.text2} lh={1.45} style={{ marginTop: -6 }}>
        {P().writeMe.intro}
      </T>
      <ChipWrap>
        {(
          [
            ['bug', P().writeMe.bug],
            ['idea', P().writeMe.idea],
            ['other', P().writeMe.other],
          ] as const
        ).map(([key, label]) => (
          <Chip key={key} label={label} active={kind === key} onPress={() => setKind(key)} />
        ))}
      </ChipWrap>
      <Input testID="feedback-message" multiline value={message} onChangeText={setMessage} placeholder={P().writeMe.placeholder} style={{ minHeight: 124 }} />
      <T s={13} c={C.text2}>
        {P().writeMe.attachment}
      </T>
      {attachment ? (
        <View style={[s.row, { gap: 12 }]}>
          <Image source={{ uri: attachment }} style={{ width: 64, height: 64, borderRadius: 14 }} accessibilityIgnoresInvertColors />
          <Button label={P().writeMe.removeAttachment} icon="x" kind="raised" height={46} onPress={() => setAttachment(null)} />
        </View>
      ) : (
        <Button label={P().writeMe.addAttachment} icon="image-plus" kind="raised" height={46} style={{ alignSelf: 'flex-start' }} onPress={chooseSource} />
      )}
      <T s={13} c={C.text2}>
        {P().writeMe.contact}
      </T>
      <Segmented
        height={38}
        options={[
          { key: 'instagram', label: P().writeMe.instagram },
          { key: 'email', label: P().writeMe.email },
        ]}
        value={via}
        onChange={setVia}
      />
      <Input
        value={contact}
        onChangeText={setContact}
        placeholder={via === 'instagram' ? P().writeMe.instagramPlaceholder : P().writeMe.emailPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={via === 'email' ? 'email-address' : 'default'}
      />
    </Screen>
  );
}

export function OAppceScreen() {
  const version = getCurrentAppVersion();
  const [notes, setNotes] = useState<ReleaseNote | null | 'loading' | 'error'>('loading');

  useEffect(() => {
    const controller = new AbortController();
    void fetchAllReleaseNotes(controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      if (result.kind === 'error') return setNotes('error');
      setNotes(result.notes.find((note) => note.version === version) ?? result.notes[0] ?? null);
    });
    return () => controller.abort();
  }, [version]);

  const items = notes && typeof notes === 'object' ? notes.items.filter((item) => item.text.trim()) : [];
  return (
    <Screen header={<BackHeader />} gap={16}>
      <View style={[s.row, { gap: 16 }]}>
        <Image source={require('../../../../assets/images/icon.png')} style={{ width: 84, height: 84, borderRadius: 20 }} />
        <View>
          <D s={38}>{P().about.name}</D>
          {version ? (
            <T s={14} c={C.muted}>
              {P().about.version(version)}
            </T>
          ) : null}
        </View>
      </View>
      <T s={16} c={C.text2}>
        {P().about.tagline}
      </T>
      {notes === 'loading' ? (
        <Spinner style={{ alignSelf: 'flex-start' }} />
      ) : notes === 'error' ? (
        <T s={14} c={C.muted}>
          {P().about.notesFailed}
        </T>
      ) : items.length > 0 ? (
        <>
          <Kicker>{P().about.whatsNew}</Kicker>
          <Card>
            {items.map((item, i) => (
              <Row
                key={i}
                last={i === items.length - 1}
                leading={
                  <View style={[{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFC40026', alignSelf: 'flex-start' }, s.center]}>
                    <T s={12} w={800} c={C.yellow}>
                      {String(i + 1)}
                    </T>
                  </View>
                }
                title={
                  <T s={14} c={C.text2} lh={1.45}>
                    {item.text}
                  </T>
                }
              />
            ))}
          </Card>
        </>
      ) : null}
      <Card>
        <Row last title={P().about.privacy} trailing={<Icon name="arrow-up-right" size={16} color={C.muted} />} onPress={() => void Linking.openURL(PRIVACY_URL)} />
      </Card>
      <T s={13} c={C.muted} style={{ textAlign: 'center', marginTop: 60 }}>
        {P().about.footer}
      </T>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState(0);
  const finished = useRef(false);
  const slides = P().onboarding.slides;
  const p = slides[page];

  useEffect(() => {
    void trackClientEvent({ event: 'onboarding_started' });
  }, []);

  const finish = (event: 'onboarding_completed' | 'onboarding_skipped') => {
    if (finished.current) return;
    finished.current = true;
    useOnboardingStore.getState().complete();
    void trackClientEvent({ event, context: { slide: page + 1 } });
    router.replace('/nv/prihlaseni');
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8, paddingHorizontal: SCREEN_X, paddingBottom: Math.max(insets.bottom, 16) + 4 }}>
      <View style={[s.row, { justifyContent: 'space-between', height: 32 }]}>
        <View style={[s.row, { gap: 6 }]}>
          {slides.map((_, i) => (
            <View key={i} style={{ width: i === page ? 28 : 10, height: 6, borderRadius: 3, backgroundColor: i === page ? C.yellow : C.control }} />
          ))}
        </View>
        <Press
          testID="onboarding-skip"
          onPress={() => {
            trackUiInteraction('onboarding_skip');
            finish('onboarding_skipped');
          }}
        >
          <T s={15} w={600} c={C.muted}>
            {P().onboarding.skip}
          </T>
        </Press>
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        {page === 0 ? (
          <Dial centerIcon="beer" />
        ) : page === 1 ? (
          <View style={{ alignItems: 'center', gap: 4 }}>
            <D s={180} lh={1} c={C.yellow}>
              3
            </D>
            <T s={18} w={600} c={C.text2}>
              {P().onboarding.tonight}
            </T>
          </View>
        ) : (
          <View style={{ alignItems: 'center', gap: 16 }}>
            <View style={s.row}>
              {['K', 'M', 'J', 'T'].map((x, i) => (
                <View key={x} style={{ marginLeft: i ? -14 : 0 }}>
                  <Person initial={x} size={70} filled={x === 'T'} />
                </View>
              ))}
            </View>
            <T s={16} w={600} c={C.text2}>
              {P().onboarding.partaDemo}
            </T>
          </View>
        )}
      </View>
      <View style={{ gap: 14, paddingBottom: 40 }}>
        <D s={48} lh={1}>
          {p.title}
        </D>
        <T s={16} c={C.text2} lh={1.45}>
          {p.body}
        </T>
      </View>
      <Button
        label={page < slides.length - 1 ? P().onboarding.next : P().onboarding.done}
        onPress={() => {
          trackUiInteraction('onboarding_next');
          if (page < slides.length - 1) setPage(page + 1);
          else finish('onboarding_completed');
        }}
      />
    </View>
  );
}

