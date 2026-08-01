/** User-visible sync history for pubs added from this device/account. */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddedPubsCard } from '@/addedPubs/AddedPubsCard';
import { PinMat } from '@/addedPubs/PinMat';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  RefreshCwIcon,
} from '@/components/shared/IconGlyph';
import { CounterCta } from '@/counter/CounterCta';
import { NudgeSlot, type Nudge } from '@/counter/NudgeSlot';
import {
  loadAddedPubSubmissions,
  retryAddedPub,
  syncOwnAddedPubs,
  type AddedPubSubmission,
} from '@/data/addedPubsQueue';
import { cs } from '@/i18n/cs';
import { usePubStore } from '@/stores/pubStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const SHEET_DISMISS_MS = 260;
const STATE_ORDER: Record<AddedPubSubmission['syncState'], number> = {
  failed: 0,
  pending: 1,
  synced: 2,
};

export default function MyAddedPubsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bumpCatalogRevision = usePubStore((state) => state.bumpCatalogRevision);
  const [submissions, setSubmissions] = useState<AddedPubSubmission[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sheetActionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (sheetActionTimer.current !== null) clearTimeout(sheetActionTimer.current);
  }, []);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const synced = await syncOwnAddedPubs();
      setLoadFailed(!synced);
      setSubmissions(await loadAddedPubSubmissions());
      bumpCatalogRevision();
    } finally {
      setRefreshing(false);
    }
  }, [bumpCatalogRevision]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        const synced = await syncOwnAddedPubs();
        const rows = await loadAddedPubSubmissions();
        if (active) {
          setLoadFailed(!synced);
          setSubmissions(rows);
        }
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  const handleRetry = useCallback(async (clientId: string) => {
    if (retryingId !== null) return;
    setRetryingId(clientId);
    try {
      await retryAddedPub(clientId);
      setSubmissions(await loadAddedPubSubmissions());
      bumpCatalogRevision();
    } finally {
      setRetryingId(null);
    }
  }, [bumpCatalogRevision, retryingId]);

  const sortedSubmissions = useMemo(
    () => [...submissions].sort((left, right) => {
      const stateDifference = STATE_ORDER[left.syncState] - STATE_ORDER[right.syncState];
      if (stateDifference !== 0) return stateDifference;
      return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    }),
    [submissions],
  );
  const failedSubmissions = useMemo(
    () => sortedSubmissions.filter((submission) => submission.syncState === 'failed'),
    [sortedSubmissions],
  );
  const pendingCount = useMemo(
    () => submissions.filter((submission) => submission.syncState === 'pending').length,
    [submissions],
  );
  const syncedCount = useMemo(
    () => submissions.filter((submission) => submission.syncState === 'synced').length,
    [submissions],
  );
  const latestSubmission = useMemo(
    () => [...submissions].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    )[0] ?? null,
    [submissions],
  );
  const selectedSubmission =
    submissions.find((submission) => submission.client_id === selectedId) ?? null;

  const handleRetryAll = useCallback(async () => {
    if (retryingId !== null || failedSubmissions.length === 0) return;
    try {
      for (const submission of failedSubmissions) {
        setRetryingId(submission.client_id);
        await retryAddedPub(submission.client_id);
      }
      setSubmissions(await loadAddedPubSubmissions());
      bumpCatalogRevision();
    } finally {
      setRetryingId(null);
    }
  }, [bumpCatalogRevision, failedSubmissions, retryingId]);

  const handleEdit = useCallback((submission: AddedPubSubmission) => {
    router.push({
      pathname: '/add-pub',
      params: {
        clientId: submission.client_id,
        name: submission.name,
        city: submission.city ?? '',
        address: submission.address ?? '',
        lat: String(submission.lat),
        lng: String(submission.lng),
      },
    });
  }, [router]);

  const runAfterSheetClose = useCallback((action: () => void) => {
    setSelectedId(null);
    if (sheetActionTimer.current !== null) clearTimeout(sheetActionTimer.current);
    sheetActionTimer.current = setTimeout(() => {
      sheetActionTimer.current = null;
      action();
    }, SHEET_DISMISS_MS);
  }, []);

  const sheetRows = useMemo<MoreRow[]>(() => {
    if (selectedSubmission === null) return [];
    const editRow: MoreRow = {
      key: 'edit',
      label: cs.addPub.edit,
      icon: PencilIcon,
      onPress: () => runAfterSheetClose(() => handleEdit(selectedSubmission)),
    };
    if (selectedSubmission.syncState === 'synced') return [editRow];
    return [
      editRow,
      {
        key: 'retry',
        label: retryingId === null ? cs.addPub.retry : cs.addPub.retrying,
        icon: RefreshCwIcon,
        disabled: retryingId !== null,
        onPress: () => {
          if (retryingId === null) {
            runAfterSheetClose(() => void handleRetry(selectedSubmission.client_id));
          }
        },
      },
    ];
  }, [handleEdit, handleRetry, retryingId, runAfterSheetClose, selectedSubmission]);

  const nudge = useMemo<Nudge | null>(() => {
    if (retryingId !== null) {
      return { kind: 'dopito', label: cs.addPub.retryingAll, onPress: () => undefined };
    }
    if (failedSubmissions.length > 0) {
      return {
        kind: 'counted',
        text: cs.addPub.failedCount(failedSubmissions.length),
        undoLabel: cs.addPub.retry,
        onUndo: () => void handleRetryAll(),
        actionAccessibilityLabel: cs.addPub.retryAll,
      };
    }
    if (loadFailed) {
      return {
        kind: 'counted',
        text: cs.addPub.loadFailed,
        undoLabel: cs.addPub.retry,
        onUndo: () => void refresh(),
        actionAccessibilityLabel: cs.addPub.retryLoad,
      };
    }
    if (pendingCount > 0) {
      return {
        kind: 'dopito',
        label: cs.addPub.pendingCount(pendingCount),
        onPress: () => void refresh(),
      };
    }
    return null;
  }, [failedSubmissions.length, handleRetryAll, loadFailed, pendingCount, refresh, retryingId]);

  const heroFact =
    pendingCount > 0
      ? cs.addPub.pendingCount(pendingCount)
      : failedSubmissions.length > 0
        ? cs.addPub.needsFixCount(failedSubmissions.length)
        : cs.addPub.allSynced;

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
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text
          style={styles.headerTitle}
          numberOfLines={1}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {cs.addPub.myPubsTitle}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={Colors.amber}
          />
        }
      >
        {submissions.length === 0 ? (
          <View style={styles.empty}>
            <PinMat count={0} width={96} />
            <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.addPub.emptyTitle}
            </Text>
            <Text style={styles.emptyBody} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.addPub.emptyBody}
            </Text>
          </View>
        ) : (
          <>
            <AddedPubsCard
              syncedCount={syncedCount}
              totalCount={submissions.length}
              caption={syncedCount === 0 ? cs.addPub.noneSyncedCaption : cs.addPub.syncedCaption}
              headline={
                latestSubmission === null ? null : cs.addPub.latestPub(latestSubmission.name)
              }
              factStrong={heroFact}
              factMuted={cs.addPub.totalCount(submissions.length)}
            />

            <Text style={styles.listLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.addPub.listLabel}
            </Text>
            <View style={styles.rowsCard}>
              {sortedSubmissions.map((submission, index) => {
                const status =
                  submission.syncState === 'pending'
                    ? cs.addPub.statusPending
                    : submission.syncState === 'failed'
                      ? cs.addPub.statusFailed
                      : cs.addPub.statusSynced;
                return (
                  <Pressable
                    key={submission.client_id}
                    onPress={() => setSelectedId(submission.client_id)}
                    style={({ pressed }) => [
                      styles.row,
                      index > 0 && styles.rowDivider,
                      pressed && styles.rowPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.addPub.openPubActions(submission.name)}
                  >
                    <View style={styles.rowCopy}>
                      <Text
                        style={styles.pubName}
                        numberOfLines={1}
                        maxFontSizeMultiplier={FontScaleCap.heading}
                      >
                        {submission.name}
                      </Text>
                      <Text
                        style={styles.meta}
                        numberOfLines={1}
                        maxFontSizeMultiplier={FontScaleCap.body}
                      >
                        {[submission.address, submission.city].filter(Boolean).join(', ')}
                      </Text>
                    </View>
                    <Text
                      style={[
                        styles.status,
                        submission.syncState === 'failed' && styles.statusFailed,
                      ]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={FontScaleCap.body}
                    >
                      {status}
                    </Text>
                    <ChevronRightIcon size={18} color={Colors.mutedText} />
                  </Pressable>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>

      <NudgeSlot nudge={nudge} />
      <CounterCta
        label={submissions.length === 0 ? cs.addPub.addFirstCta : cs.addPub.addCta}
        subLabel={cs.addPub.addCtaHint}
        onPress={() => router.push('/add-pub')}
        accessibilityLabel={submissions.length === 0 ? cs.addPub.addFirstCta : cs.addPub.addCta}
      />

      <MoreSheet
        visible={selectedSubmission !== null}
        title={selectedSubmission?.name}
        rows={sheetRows}
        onClose={() => setSelectedId(null)}
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
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
    includeFontPadding: false,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 12,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingHorizontal: 12,
  },
  emptyTitle: {
    fontWeight: '800',
    fontSize: 24,
    color: Colors.foam,
    textAlign: 'center',
    includeFontPadding: false,
  },
  emptyBody: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 22,
    color: Colors.mutedText,
    textAlign: 'center',
    includeFontPadding: false,
  },
  listLabel: {
    marginTop: 24,
    marginBottom: 8,
    fontWeight: '500',
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
  row: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  pubName: {
    flexShrink: 1,
    fontWeight: '700',
    fontSize: 16,
    color: Colors.foam,
    includeFontPadding: false,
  },
  meta: {
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  status: {
    flexShrink: 1,
    fontWeight: '500',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  statusFailed: {
    color: Colors.amber,
  },
  pressed: {
    opacity: 0.78,
  },
});
