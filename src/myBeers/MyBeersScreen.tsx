/**
 * "Moje piva" — the pivní stopa.
 *
 * A small product surface over the data the counter already collects locally
 * (tallyStore): it turns the running tally + archived sessions into a personal
 * memory of drinking evenings — where you were, what you drank, how many and how
 * much it cost — plus a private "stálo to za návrat?" rating per pub.
 *
 * Read-only over the counter's data (no writes back to the tally), so it can
 * never break the counter. Works fully offline and without an account.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { amberGlow } from '@/theme/shadows';
import { cs } from '@/i18n/cs';
import { formatPrice } from '@/utils/currency';
import {
  ChevronRightIcon,
  BeerIcon,
  HistoryIcon,
  PlusIcon,
} from '@/components/shared/IconGlyph';
import { fetchMyBeerCheckIns, type BeerCheckIn, type BeerCheckInInput } from '@/data/beerCheckinsClient';
import { getPendingBeerCheckIns } from '@/data/beerCheckinsQueue';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  useTallyStore,
  sessionTotalCzk,
  type TallySession,
} from '@/stores/tallyStore';
import { usePubRatingsStore } from '@/stores/pubRatingsStore';
import { sessionBreakdown, sessionDrinkSummary, eveningDateLabel, eveningDayRelation } from '@/myBeers/eveningModel';
import { EveningBreakdown } from '@/myBeers/EveningBreakdown';
import { PubRatingControl } from '@/myBeers/PubRatingControl';
import { MapPubEntry } from '@/components/amenities/MapPubEntry';
import { VerdictBadge } from '@/myBeers/VerdictBadge';
import { HistoricalBeerEntrySheet } from '@/myBeers/HistoricalBeerEntrySheet';
import type { PriceCurrency } from '@/utils/currency';

function lastDrinkText(session: TallySession, now: Date): string | null {
  if (eveningDayRelation(session.startedAt, now) !== 'today') return null;
  const latest = session.drinks[session.drinks.length - 1];
  if (!latest) return null;
  const atMs = Date.parse(latest.at);
  if (!Number.isFinite(atMs)) return null;
  const minutes = Math.max(0, Math.floor((now.getTime() - atMs) / 60000));
  return minutes === 0 ? cs.myBeers.lastDrinkJustNow : cs.myBeers.lastDrinkMinutesAgo(minutes);
}

// ─── Current evening card ──────────────────────────────────────────────────────

function CurrentEveningCard({
  session,
  priceCurrency,
  now,
}: {
  session: TallySession;
  priceCurrency: PriceCurrency;
  now: Date;
}) {
  const totalCzk = sessionTotalCzk(session);
  const breakdown = useMemo(() => sessionBreakdown(session), [session]);
  const lastText = lastDrinkText(session, now);

  return (
    <View style={styles.card}>
      <View style={styles.cardSectionHeader}>
        <BeerIcon size={14} color={Colors.amber} />
        <Text style={styles.cardSectionHeaderText}>{cs.myBeers.currentHeader}</Text>
        <View style={styles.flex} />
        <Text style={styles.dateLabel} maxFontSizeMultiplier={FontScaleCap.body}>
          {eveningDateLabel(session.startedAt, now)}
        </Text>
      </View>

      <Text style={styles.pubName} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
        {session.pubName}
      </Text>
      <Text style={styles.summary} maxFontSizeMultiplier={FontScaleCap.body}>
        {cs.myBeers.summary(sessionDrinkSummary(session), formatPrice(totalCzk, priceCurrency))}
      </Text>
      {lastText && (
        <Text style={styles.lastDrink} maxFontSizeMultiplier={FontScaleCap.body}>
          {lastText}
        </Text>
      )}

      <View style={styles.divider} />
      <EveningBreakdown
        lines={breakdown}
        totalCzk={totalCzk}
        priceCurrency={priceCurrency}
        showTotal={false}
      />

      <View style={styles.divider} />
      <PubRatingControl pubKey={session.pubKey} pubName={session.pubName} />

      {/* Public community mapping — distinct from the private rating above. One
          clear trigger; the sheet holds the detail so the card stays compact. */}
      <View style={styles.divider} />
      <MapPubEntry pubKey={session.pubKey} pubName={session.pubName} />
    </View>
  );
}

// ─── Past evening row ──────────────────────────────────────────────────────────

function PastEveningRow({
  session,
  priceCurrency,
  now,
  onPress,
}: {
  session: TallySession;
  priceCurrency: PriceCurrency;
  now: Date;
  onPress: () => void;
}) {
  const totalCzk = sessionTotalCzk(session);
  const verdict = usePubRatingsStore((s) => s.ratings[session.pubKey]?.verdict);
  const summary = cs.myBeers.summary(sessionDrinkSummary(session), formatPrice(totalCzk, priceCurrency));

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={cs.a11y.myBeersEvening(session.pubName, summary)}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowDate} maxFontSizeMultiplier={FontScaleCap.body}>
          {eveningDateLabel(session.startedAt, now)}
        </Text>
        <Text style={styles.rowPub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {session.pubName}
        </Text>
        <Text style={styles.rowSummary} maxFontSizeMultiplier={FontScaleCap.body}>
          {summary}
        </Text>
      </View>
      <VerdictBadge verdict={verdict} />
      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

function shortDateTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
}

function shortDiaryTimeRange(startIso: string, endIso?: string | null): string {
  const startMs = Date.parse(startIso);
  if (!Number.isFinite(startMs)) return '';
  const start = new Date(startMs);
  const date = start.toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
  const startTime = start.toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const endMs = endIso ? Date.parse(endIso) : NaN;
  if (!Number.isFinite(endMs)) return `${date} ${startTime}`;
  const end = new Date(endMs);
  const endTime = end.toLocaleTimeString('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const crossesDay = end.toDateString() !== start.toDateString();
  return `${date} ${startTime}-${endTime}${crossesDay ? ' +1' : ''}`;
}

function checkInAmountLabel(checkIn: BeerCheckIn, priceCurrency: PriceCurrency): string {
  const quantity = Math.max(1, Math.floor(checkIn.quantity || 1));
  const parts = quantity > 1 ? [`${quantity}×`] : [];
  if (checkIn.priceCzk != null) {
    const total = checkIn.priceCzk * quantity;
    parts.push(formatPrice(total, priceCurrency));
  }
  return parts.join(' · ');
}

function HistoricalCheckInRow({
  checkIn,
  priceCurrency,
  onPress,
}: {
  checkIn: BeerCheckIn;
  priceCurrency: PriceCurrency;
  onPress: () => void;
}) {
  const meta = [
    checkInAmountLabel(checkIn, priceCurrency),
    checkIn.pubName || cs.myBeers.historicalNoPub,
    checkIn.endedAt ? shortDiaryTimeRange(checkIn.checkedInAt, checkIn.endedAt) : shortDateTime(checkIn.checkedInAt),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.diaryRow, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={cs.a11y.myBeersDiaryEntry(checkIn.beerName, meta)}
    >
      <View style={styles.diaryIcon}>
        <BeerIcon size={16} color={Colors.amber} />
      </View>
      <View style={styles.diaryText}>
        <Text style={styles.diaryTitle} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {checkIn.beerName}
        </Text>
        <Text style={styles.diaryMeta} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {meta}
        </Text>
      </View>
      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

function HistoricalEntryButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.addHistoryButton, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={cs.a11y.myBeersAddHistorical}
    >
      <View style={styles.addHistoryIcon}>
        <PlusIcon size={18} color={Colors.stout} />
      </View>
      <View style={styles.addHistoryText}>
        <Text style={styles.addHistoryTitle} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.myBeers.historicalCta}
        </Text>
        <Text style={styles.addHistorySubtitle} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.myBeers.historicalCtaBody}
        </Text>
      </View>
    </Pressable>
  );
}

function optimisticCheckIn(input: BeerCheckInInput): BeerCheckIn {
  const now = new Date().toISOString();
  return {
    id: input.clientId,
    account: {
      id: '',
      nickname: null,
      displayName: '',
      avatarUrl: null,
      isPublic: false,
    },
    clientId: input.clientId,
    beerName: input.beerName,
    breweryName: input.breweryName ?? '',
    beerStyle: input.beerStyle ?? '',
    abv: input.abv ?? null,
    quantity: input.quantity ?? 1,
    priceCzk: input.priceCzk ?? null,
    rating: input.rating ?? null,
    note: input.note ?? '',
    tags: input.tags ?? [],
    pubCacheKey: input.pubCacheKey ?? '',
    pubName: input.pubName ?? '',
    pubCity: input.pubCity ?? '',
    visitClientId: input.visitClientId ?? null,
    visibility: input.visibility,
    checkedInAt: input.checkedInAt ?? now,
    endedAt: input.endedAt ?? null,
    reactions: { cheers: 0 },
    myReaction: null,
    createdAt: now,
    updatedAt: now,
  };
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function MyBeersScreen({ embedded = false }: { embedded?: boolean } = {}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Keep the "poslední pivo před X minutami" label honest while the screen is
  // open — tick once a minute, the same pattern the counter uses.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60 * 1000);
    if (typeof timer === 'object' && 'unref' in timer && typeof timer.unref === 'function') {
      timer.unref();
    }
    return () => clearInterval(timer);
  }, []);
  const now = useMemo(() => new Date(nowMs), [nowMs]);

  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const [historicalOpen, setHistoricalOpen] = useState(false);
  const [diaryRefreshToken, setDiaryRefreshToken] = useState(0);
  const [diaryEntries, setDiaryEntries] = useState<BeerCheckIn[]>([]);
  const [optimisticDiaryEntries, setOptimisticDiaryEntries] = useState<BeerCheckIn[]>([]);

  const refreshDiary = useCallback(() => {
    setDiaryRefreshToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getPendingBeerCheckIns().then((pending) => {
      if (controller.signal.aborted) return;
      setOptimisticDiaryEntries((current) => {
        const merged = new Map<string, BeerCheckIn>();
        for (const entry of pending.map(optimisticCheckIn)) {
          merged.set(entry.clientId, entry);
        }
        for (const entry of current) {
          merged.set(entry.clientId, entry);
        }
        return Array.from(merged.values());
      });
    });
    void fetchMyBeerCheckIns(controller.signal).then((items) => {
      if (controller.signal.aborted || !items) return;
      setDiaryEntries(items);
      setOptimisticDiaryEntries((current) =>
        current.filter((entry) => !items.some((item) => item.clientId === entry.clientId)),
      );
    });
    return () => controller.abort();
  }, [diaryRefreshToken]);

  const currentEvening = current && current.drinks.length > 0 ? current : null;
  const pastEvenings = history;
  const visibleDiaryEntries = useMemo(
    () => [...optimisticDiaryEntries, ...diaryEntries],
    [diaryEntries, optimisticDiaryEntries],
  );
  const isEmpty = !currentEvening && pastEvenings.length === 0 && visibleDiaryEntries.length === 0;

  const openHistorical = useCallback(() => setHistoricalOpen(true), []);
  const handleHistoricalSaved = useCallback(
    (entries: BeerCheckInInput[]) => {
      const optimistic = entries.map(optimisticCheckIn);
      const ids = new Set(optimistic.map((entry) => entry.clientId));
      setOptimisticDiaryEntries((current) => [
        ...optimistic,
        ...current.filter((item) => !ids.has(item.clientId)),
      ]);
      refreshDiary();
    },
    [refreshDiary],
  );

  return (
    <View style={styles.root}>
      {/* Header — a tab screen, so no back button; just the title. Suppressed
          when embedded in the "Pivo" tab, where the segment control is the title. */}
      {!embedded && (
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.headerTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.myBeers.title}
          </Text>
        </View>
      )}

      {isEmpty ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, amberGlow(14)]}>
            <HistoryIcon size={52} color={Colors.amber} />
          </View>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.myBeers.emptyTitle}
          </Text>
          <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.myBeers.emptyBody}
          </Text>
          <HistoricalEntryButton onPress={openHistorical} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          <HistoricalEntryButton onPress={openHistorical} />

          {currentEvening && (
            <CurrentEveningCard
              session={currentEvening}
              priceCurrency={priceCurrency}
              now={now}
            />
          )}

          {pastEvenings.length > 0 && (
            <>
              <Text style={styles.listHeader} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.myBeers.pastHeader}
              </Text>
              <View style={[styles.card, styles.listCard]}>
                {pastEvenings.map((session, i) => (
                  <View
                    key={`${session.pubKey}|${session.startedAt}`}
                    style={i > 0 && styles.rowBorder}
                  >
                    <PastEveningRow
                      session={session}
                      priceCurrency={priceCurrency}
                      now={now}
                      onPress={() =>
                        router.push({
                          pathname: '/evening',
                          params: { startedAt: session.startedAt },
                        })
                      }
                    />
                  </View>
                ))}
              </View>
            </>
          )}

          {visibleDiaryEntries.length > 0 && (
            <>
              <Text style={styles.listHeader} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.myBeers.diaryHeader}
              </Text>
              <View style={[styles.card, styles.listCard]}>
                {visibleDiaryEntries.map((checkIn, i) => (
                  <View
                    key={checkIn.clientId || checkIn.id}
                    style={i > 0 && styles.rowBorder}
                  >
                    <HistoricalCheckInRow
                      checkIn={checkIn}
                      priceCurrency={priceCurrency}
                      onPress={() =>
                        router.push({
                          pathname: '/beer-detail',
                          params: { beer: checkIn.beerName, brewery: checkIn.breweryName },
                        })
                      }
                    />
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={{ height: Spacing.lg }} />
        </ScrollView>
      )}
      <HistoricalBeerEntrySheet
        visible={historicalOpen}
        onClose={() => setHistoricalOpen(false)}
        onSaved={handleHistoricalSaved}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  flex: { flex: 1 },

  // — Header —
  header: {
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  headerTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 28,
    color: Colors.foam,
  },

  // — ScrollView —
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm + 2,
  },

  // — Cards —
  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
  },
  listCard: {
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  cardSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  cardSectionHeaderText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  dateLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.mutedText,
  },
  pubName: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    marginBottom: 4,
  },
  summary: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
  },
  lastDrink: {
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    color: Colors.mutedText,
    marginTop: 4,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.md,
  },

  // — Past list —
  listHeader: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
    marginTop: Spacing.sm,
    marginLeft: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    minHeight: 64,
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  rowPressed: {
    opacity: 0.65,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowDate: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 0.5,
    color: Colors.mutedText,
    textTransform: 'uppercase',
  },
  rowPub: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  rowSummary: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 13,
    color: Colors.amber,
  },

  // — Historical diary —
  addHistoryButton: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 68,
    padding: 14,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  addHistoryIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  addHistoryText: {
    flex: 1,
    gap: 2,
  },
  addHistoryTitle: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  addHistorySubtitle: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.foamMuted,
  },
  diaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    minHeight: 72,
  },
  diaryIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
  },
  diaryText: {
    flex: 1,
    gap: 2,
  },
  diaryTitle: {
    fontFamily: Fonts.display.bold,
    fontSize: 16,
    color: Colors.foam,
  },
  diaryMeta: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
  },

  // — Empty —
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    gap: Spacing.md,
    paddingBottom: 60,
  },
  emptyIcon: {
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    color: Colors.mutedText,
    textAlign: 'center',
    lineHeight: 22,
  },
});
