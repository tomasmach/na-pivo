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

import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilIcon,
  RefreshCwIcon,
} from '@/components/shared/IconGlyph';
import {
  loadAddedPubSubmissions,
  retryAddedPub,
  syncOwnAddedPubs,
  type AddedPubSubmission,
} from '@/data/addedPubsQueue';
import { t } from '@/i18n';
import { usePubStore } from '@/stores/pubStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const SHEET_DISMISS_MS = 260;

export default function MyAddedPubsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bumpCatalogRevision = usePubStore((state) => state.bumpCatalogRevision);
  const [submissions, setSubmissions] = useState<AddedPubSubmission[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true);
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
      setLoading(true);
      void (async () => {
        const cached = await loadAddedPubSubmissions();
        if (!active) return;
        setSubmissions(cached);
        const synced = await syncOwnAddedPubs();
        const rows = await loadAddedPubSubmissions();
        if (active) {
          setLoadFailed(!synced);
          setSubmissions(rows);
          setLoading(false);
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
    () => [...submissions].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
    ),
    [submissions],
  );
  const selectedSubmission =
    submissions.find((submission) => submission.client_id === selectedId) ?? null;
  const lastAddPress = useRef(0);
  const handleAdd = useCallback(() => {
    if (Date.now() - lastAddPress.current < 700) return;
    lastAddPress.current = Date.now();
    router.push('/add-pub');
  }, [router]);

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
        ...(submission.failureReason === 'location-not-found' ? { needsLocation: '1' } : {}),
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
      label: t.addPub.edit,
      icon: PencilIcon,
      onPress: () => runAfterSheetClose(() => handleEdit(selectedSubmission)),
    };
    if (selectedSubmission.syncState === 'synced') return [editRow];
    return [
      editRow,
      {
        key: 'retry',
        label: retryingId === null ? t.addPub.retry : t.addPub.retrying,
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

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={t.a11y.backButton}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text
          style={styles.headerTitle}
          maxFontSizeMultiplier={FontScaleCap.heading}
        >
          {t.addPub.myPubsTitle}
        </Text>
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
        {loadFailed ? (
          <Pressable
            onPress={() => void refresh()}
            disabled={refreshing}
            accessibilityRole="button"
            accessibilityLabel={t.addPub.retryLoad}
            accessibilityState={{ disabled: refreshing }}
            style={({ pressed }) => [styles.loadFailure, pressed && styles.pressed]}
          >
            <Text style={styles.meta} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.addPub.loadFailed}
            </Text>
            <Text style={styles.retryLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.addPub.retry}
            </Text>
          </Pressable>
        ) : null}
        {submissions.length === 0 ? (
          !loadFailed ? (
            <Text
              style={styles.emptyTitle}
              maxFontSizeMultiplier={FontScaleCap.heading}
              accessibilityLiveRegion="polite"
            >
              {loading ? t.addPub.loading : t.addPub.emptyTitle}
            </Text>
          ) : null
        ) : sortedSubmissions.map((submission, index) => {
          const status = retryingId === submission.client_id
            ? t.addPub.retrying
            : submission.failureReason === 'location-not-found'
              ? t.addPub.fixLocation
              : submission.syncState === 'pending'
                ? submission.pendingOperation === 'edit'
                  ? t.addPub.statusPendingEdit
                  : t.addPub.statusPendingCreate
                : submission.syncState === 'failed'
                  ? t.addPub.retry
                  : null;
          const address = [submission.address, submission.city].filter(Boolean).join(', ');
          return (
            <Pressable
              key={submission.client_id}
              onPress={() => submission.failureReason === 'location-not-found'
                ? handleEdit(submission)
                : setSelectedId(submission.client_id)}
              style={({ pressed }) => [
                styles.row,
                index === 0 ? styles.firstRow : styles.rowDivider,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={[
                submission.failureReason === 'location-not-found'
                  ? `${t.addPub.fixLocation}: ${submission.name}`
                  : t.addPub.openPubActions(submission.name),
                address,
                status,
              ].filter(Boolean).join('. ')}
              accessibilityState={{ busy: retryingId === submission.client_id }}
            >
              <View style={styles.rowCopy}>
                <Text style={styles.pubName} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {submission.name}
                </Text>
                {address ? (
                  <Text style={styles.meta} maxFontSizeMultiplier={FontScaleCap.body}>
                    {address}
                  </Text>
                ) : null}
                {status ? (
                  <Text
                    style={[styles.status, submission.syncState === 'failed' && styles.statusFailed]}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {status}
                  </Text>
                ) : null}
              </View>
              <ChevronRightIcon size={18} color={Colors.mutedText} />
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable
        onPress={handleAdd}
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={t.addPub.addCta}
      >
        <Text style={styles.primaryLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.addPub.addCta}
        </Text>
      </Pressable>

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
    backgroundColor: Colors.canvas,
    paddingHorizontal: Spacing.lg,
  },
  header: {
    minHeight: 52,
    marginBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  backButton: {
    width: 44,
    height: 44,
    marginLeft: -Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontWeight: '700',
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.2,
    color: Colors.foam,
    includeFontPadding: false,
  },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: Spacing.lg },
  emptyTitle: {
    marginTop: Spacing.xxl,
    fontSize: 18,
    lineHeight: 24,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  row: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.lg,
  },
  firstRow: { paddingTop: Spacing.md },
  rowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowCopy: { flex: 1, minWidth: 0 },
  pubName: {
    fontWeight: '600',
    fontSize: 16,
    lineHeight: 21,
    color: Colors.foam,
    includeFontPadding: false,
  },
  meta: {
    marginTop: Spacing.xs,
    fontSize: 14,
    lineHeight: 19,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  status: {
    marginTop: Spacing.sm,
    fontWeight: '500',
    fontSize: 14,
    lineHeight: 19,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  statusFailed: { color: Colors.amber },
  loadFailure: { paddingVertical: Spacing.md, minHeight: 44 },
  retryLabel: {
    marginTop: Spacing.sm,
    fontSize: 14,
    fontWeight: '500',
    color: Colors.amber,
  },
  primary: {
    minHeight: 48,
    marginTop: Spacing.md,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '700',
    color: Colors.canvas,
    includeFontPadding: false,
  },
  pressed: { opacity: 0.65 },
});
