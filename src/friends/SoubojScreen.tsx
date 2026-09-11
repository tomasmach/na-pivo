/**
 * Souboj — my numbers against one friend's.
 *
 * This is the answer to "kde se můžu poměřovat s kamarády" that 3.0 dropped
 * with the old party board, and it is deliberately not that board back. A board
 * has one winner and crowns whoever drank most; six disciplines against one
 * person produce "you are ahead on pubs, they are ahead on beers", which is a
 * comparison rather than a podium.
 *
 * Nobody is declared the winner anywhere on this screen. Each row says who
 * leads that one row, and that is the whole verdict the app offers.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_CHROME } from '@/components/shared/TabBar';
import {
  fetchFriendDuel,
  type Duel,
  type DuelSide,
  type DuelWindow,
} from '@/data/friendsClient';
import { t } from '@/i18n';
import PeriodChips from '@/leaderboards/PeriodChips';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Avatar } from '@/profile/Avatar';
import { useAccountStore } from '@/stores/accountStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap, Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { formatPrice } from '@/utils/currency';
import { useReduceMotion } from '@/utils/useReduceMotion';

import { DuelChart } from './DuelChart';
import { friendDisplayName } from './FriendMini';
import OfflineBanner from './OfflineBanner';
import { PartaScreenHeader } from './PartaScreenHeader';
import SkeletonBlock from './SkeletonBlock';

const WINDOWS: readonly { key: DuelWindow; label: string }[] = [
  { key: '30d', label: t.souboj.window30d },
  { key: '180d', label: t.souboj.window180d },
  { key: 'all', label: t.souboj.windowAll },
];

type LoadState = 'loading' | 'loaded' | 'error';

/** One discipline: the two numbers, who leads, and how wide each half draws. */
interface Discipline {
  key: string;
  label: string;
  mine: string;
  theirs: string;
  mineValue: number;
  theirsValue: number;
}

function disciplinesOf(
  me: DuelSide,
  them: DuelSide,
  spendAvailable: boolean,
  currency: Parameters<typeof formatPrice>[1],
): Discipline[] {
  const rows: Discipline[] = [
    {
      key: 'beers',
      label: t.souboj.rowBeers,
      mine: String(me.beers),
      theirs: String(them.beers),
      mineValue: me.beers,
      theirsValue: them.beers,
    },
    {
      key: 'evenings',
      label: t.souboj.rowEvenings,
      mine: String(me.evenings),
      theirs: String(them.evenings),
      mineValue: me.evenings,
      theirsValue: them.evenings,
    },
    {
      key: 'pubs',
      label: t.souboj.rowPubs,
      mine: String(me.pubs),
      theirs: String(them.pubs),
      mineValue: me.pubs,
      theirsValue: them.pubs,
    },
    {
      key: 'pace',
      label: t.souboj.rowPace,
      mine: t.souboj.paceValue(me.beersPerEvening),
      theirs: t.souboj.paceValue(them.beersPerEvening),
      mineValue: me.beersPerEvening,
      theirsValue: them.beersPerEvening,
    },
  ];
  // Only when both sides turned it on — and the server has already refused to
  // send the numbers otherwise, so this is the second lock, not the only one.
  if (spendAvailable && me.spendCzk !== null && them.spendCzk !== null) {
    rows.push({
      key: 'spend',
      label: t.souboj.rowSpend,
      mine: formatPrice(me.spendCzk, currency),
      theirs: formatPrice(them.spendCzk, currency),
      mineValue: me.spendCzk,
      theirsValue: them.spendCzk,
    });
  }
  return rows;
}

/** The one-line verdict above the rows: beers, because that is what gets asked. */
function headline(me: DuelSide, them: DuelSide, friendName: string): string {
  const diff = me.beers - them.beers;
  if (diff === 0) return t.souboj.headlineTied;
  if (diff > 0) return t.souboj.headlineAhead(diff);
  return t.souboj.headlineBehind(friendName, -diff);
}

function DisciplineRow({ row, friendName }: { row: Discipline; friendName: string }) {
  const total = row.mineValue + row.theirsValue;
  // A row where neither has anything splits evenly rather than collapsing to a
  // zero-width bar, which would read as a rendering bug.
  const minePercent = total > 0 ? (row.mineValue / total) * 100 : 50;
  const iLead = row.mineValue > row.theirsValue;
  const theyLead = row.theirsValue > row.mineValue;

  return (
    <View
      style={styles.row}
      accessible
      accessibilityLabel={t.souboj.rowA11y(row.label, row.mine, friendName, row.theirs)}
    >
      <View style={styles.rowTop}>
        <Text style={[styles.rowValue, theyLead && styles.rowValueBehind]} allowFontScaling={false}>
          {row.mine}
        </Text>
        <Text
          style={styles.rowLabel}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {row.label}
        </Text>
        <Text style={[styles.rowValue, iLead && styles.rowValueBehind]} allowFontScaling={false}>
          {row.theirs}
        </Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fillMine, { width: `${minePercent}%` }]} />
        <View style={styles.fillTheirs} />
      </View>
    </View>
  );
}

export default function SoubojScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { accountId } = useLocalSearchParams<{ accountId?: string }>();
  const currency = useSettingsStore((state) => state.priceCurrency);
  const myProfile = useAccountStore((state) => state.profile);
  const reduceMotion = useReduceMotion();

  const [span, setSpan] = useState<DuelWindow>('180d');
  const [state, setState] = useState<LoadState>('loading');
  const [duel, setDuel] = useState<Duel | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mountedRef = useRef(true);

  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  // A later window choice always outranks an older response.
  const requestRef = useRef(0);
  const load = useCallback(
    async (next: DuelWindow) => {
      const requestId = ++requestRef.current;
      // A missing route id resolves to null in the client, so this stays one
      // unconditional await and lands in the same failed state as a refusal.
      const result = await fetchFriendDuel(accountId ?? '', next);
      // The request counter, not an abort signal, decides staleness: tapping
      // through three windows must leave the last one on screen, not whichever
      // request happened to answer last.
      if (!mountedRef.current || requestId !== requestRef.current) return;
      // Keep what is on screen when a refresh fails: the error notice already
      // says the numbers are stale, and blanking them loses the comparison the
      // user opened the screen for.
      setDuel((previous) => result ?? previous);
      setState(result ? 'loaded' : 'error');
    },
    [accountId],
  );

  // Changing the window deliberately does NOT blank the rows: `state` stays
  // 'loaded' and the previous numbers sit there until the new ones land, so a
  // chip tap does not read as the screen reloading.
  useEffect(() => {
    void load(span);
  }, [load, span]);

  // No id in the route is the same dead end as a failed request, and deriving
  // it keeps the effect from having to set state before it has awaited anything.
  const failed = state === 'error' || !accountId;

  const refresh = useCallback(() => {
    setRefreshing(true);
    void load(span).finally(() => {
      if (mountedRef.current) setRefreshing(false);
    });
  }, [load, span]);

  const friendName = duel ? friendDisplayName(duel.friend) : '';

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.headerPad}>
        <PartaScreenHeader title={t.souboj.title} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          // TAB_CHROME already carries the safe area (see its docstring), so
          // adding insets.bottom on top would reserve it twice. Twelve older
          // screens still do; that is their bug to fix, not a pattern to copy.
          { paddingBottom: TAB_CHROME },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.amber} />
        }
      >
        {state === 'loading' && !duel && !failed ? (
          <View
            style={styles.skeleton}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <SkeletonBlock width="100%" height={96} radius={Radius.card} reduceMotion={reduceMotion} />
            <SkeletonBlock width="100%" height={140} radius={Radius.card} reduceMotion={reduceMotion} />
            <SkeletonBlock width="100%" height={200} radius={Radius.card} reduceMotion={reduceMotion} />
          </View>
        ) : null}

        {/* With numbers already on screen the failure is a strip over stale
            data, the same shape the Parta hub uses; with nothing to show it
            takes the whole screen. Either way it never silently pretends the
            numbers are fresh. */}
        {failed ? (
          duel ? (
            <View style={styles.staleStrip}>
              <OfflineBanner onRetry={() => void load(span)} />
            </View>
          ) : (
            <View style={styles.notice}>
              <Text style={styles.noticeTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                {t.souboj.errorTitle}
              </Text>
              <Pressable
                onPress={() => void load(span)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
              >
                <Text style={styles.retryText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.souboj.retry}
                </Text>
              </Pressable>
            </View>
          )
        ) : null}

        {duel ? (
          <>
            <View style={styles.versus}>
              <View style={styles.side}>
                <Avatar
                  uri={myProfile?.avatarUrl ?? null}
                  nickname={myProfile?.nickname ?? null}
                  displayName={myProfile?.displayName ?? ''}
                  size={54}
                />
                <Text style={styles.sideName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.souboj.me}
                </Text>
              </View>
              <Text style={styles.vs} allowFontScaling={false}>
                {t.souboj.vs}
              </Text>
              <Pressable
                onPress={() => router.push(`/parta/${duel.friend.id}` as Href)}
                accessibilityRole="button"
                accessibilityLabel={t.souboj.openFriendA11y(friendName)}
                style={({ pressed }) => [styles.side, pressed && styles.pressed]}
              >
                <Avatar
                  uri={duel.friend.avatarUrl}
                  nickname={duel.friend.nickname}
                  displayName={duel.friend.displayName}
                  size={54}
                />
                <Text
                  style={styles.sideName}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {friendName}
                </Text>
              </Pressable>
            </View>

            {duel.available && duel.me && duel.them ? (
              <>
                <View style={styles.windowRow}>
                  <PeriodChips
                    options={WINDOWS}
                    value={span}
                    onChange={setSpan}
                    accessibilityLabel={t.souboj.windowA11y}
                  />
                </View>

                <Text style={styles.headline} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {headline(duel.me, duel.them, friendName)}
                </Text>

                {duel.series.length > 0 ? (
                  <View style={styles.section}>
                    <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                      {t.souboj.chartHeader}
                    </Text>
                    <DuelChart series={duel.series} friendName={friendName} />
                  </View>
                ) : null}

                <View style={styles.band} />
                <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {t.souboj.rowsHeader}
                </Text>
                {disciplinesOf(duel.me, duel.them, duel.spendAvailable, currency).map((row) => (
                  <DisciplineRow key={row.key} row={row} friendName={friendName} />
                ))}

                {!duel.spendAvailable ? (
                  <Text style={styles.footnote} maxFontSizeMultiplier={FontScaleCap.body}>
                    {duel.spendBlockedByMe
                      ? t.souboj.spendOffMine(friendName)
                      : t.souboj.spendOff(friendName)}
                  </Text>
                ) : null}
              </>
            ) : (
              <View style={styles.notice}>
                <Text style={styles.noticeTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {t.souboj.privateTitle}
                </Text>
                <Text style={styles.noticeBody} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.souboj.privateBody(friendName)}
                </Text>
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.stout },
  headerPad: { paddingHorizontal: Spacing.sm },
  content: { paddingHorizontal: MockLayout.screenPad },
  skeleton: { gap: Spacing.md, marginTop: Spacing.lg },

  versus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  side: { flex: 1, alignItems: 'center', gap: 7 },
  sideName: { fontSize: 14, fontWeight: '700', color: Colors.foam },
  vs: {
    fontFamily: Fonts.numeral,
    fontSize: 19,
    // 19/24 is the documented pair (§3.2). Baloo overshoots its box, and
    // without the line height iOS clips the top of the glyphs.
    lineHeight: 24,
    color: Colors.mutedText,
    includeFontPadding: false,
  },

  windowRow: { marginTop: MockLayout.controlGap },
  headline: {
    ...MockType.titleS,
    color: Colors.foam,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },

  section: { marginTop: MockLayout.sectionGap },
  sectionTitle: {
    ...MockType.titleS,
    color: Colors.foam,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  band: {
    height: 10,
    marginTop: Spacing.xl,
    marginHorizontal: -MockLayout.screenPad,
    backgroundColor: '#0F0A05',
  },

  row: { paddingVertical: Spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    textAlign: 'center',
    fontSize: 13,
    color: Colors.mutedText,
  },
  rowValue: {
    minWidth: 64,
    fontFamily: Fonts.numeral,
    fontSize: 19,
    lineHeight: 24,
    color: Colors.foam,
    letterSpacing: -0.2,
    fontVariant: ['tabular-nums'],
    includeFontPadding: false,
  },
  rowValueBehind: { color: Colors.mutedText },
  track: {
    flexDirection: 'row',
    height: 8,
    borderRadius: 4,
    overflow: 'hidden',
    marginTop: Spacing.sm,
    backgroundColor: withAlpha(Colors.foam, 0.08),
  },
  fillMine: { height: '100%', backgroundColor: Colors.amber },
  // The same dim amber the chart gives their column, so "their share" reads as
  // one colour across the screen. Foam at 28 % outshouted the amber beside it.
  fillTheirs: { flex: 1, height: '100%', backgroundColor: withAlpha(Colors.amber, 0.28) },

  footnote: { ...MockType.bodySmall, color: Colors.mutedText, marginTop: Spacing.lg },

  staleStrip: { marginTop: Spacing.md },
  notice: { marginTop: Spacing.xxl, alignItems: 'center', gap: Spacing.md },
  noticeTitle: { ...MockType.titleS, color: Colors.foam, textAlign: 'center' },
  noticeBody: {
    ...MockType.bodySmall,
    color: Colors.mutedText,
    textAlign: 'center',
    maxWidth: 280,
  },
  retry: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  retryText: { ...MockType.bodySemibold, color: Colors.amber },
  pressed: { opacity: 0.65 },
});
