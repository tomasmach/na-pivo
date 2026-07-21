/** User-visible sync history for pubs added from this device/account. */

import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import {
  BadgeCheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  MapPinIcon,
  PencilIcon,
  RefreshCwIcon,
} from '@/components/shared/IconGlyph';
import {
  loadAddedPubSubmissions,
  retryAddedPub,
  syncOwnAddedPubs,
  type AddedPubSubmission,
} from '@/data/addedPubsQueue';
import { usePubStore } from '@/stores/pubStore';

export default function MyAddedPubsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bumpCatalogRevision = usePubStore((state) => state.bumpCatalogRevision);
  const [submissions, setSubmissions] = useState<AddedPubSubmission[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    await syncOwnAddedPubs();
    setSubmissions(await loadAddedPubSubmissions());
    bumpCatalogRevision();
  }, [bumpCatalogRevision]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void (async () => {
        await syncOwnAddedPubs();
        const rows = await loadAddedPubSubmissions();
        if (active) setSubmissions(rows);
      })();
      return () => {
        active = false;
      };
    }, []),
  );

  const handleRetry = useCallback(async (clientId: string) => {
    if (retryingId) return;
    setRetryingId(clientId);
    await retryAddedPub(clientId);
    setSubmissions(await loadAddedPubSubmissions());
    bumpCatalogRevision();
    setRetryingId(null);
  }, [bumpCatalogRevision, retryingId]);

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

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle}>{cs.addPub.myPubsTitle}</Text>
        <Pressable
          onPress={() => void refresh()}
          style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.addPub.retry}
        >
          <RefreshCwIcon size={19} color={Colors.foamMuted} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.subtitle} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.addPub.myPubsSubtitle}
        </Text>

        {submissions.length === 0 ? (
          <View style={styles.empty}>
            <MapPinIcon size={24} color={Colors.amber} />
            <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.addPub.myPubsEmpty}
            </Text>
          </View>
        ) : submissions.map((submission) => {
          const pending = submission.syncState === 'pending';
          const failed = submission.syncState === 'failed';
          const StatusIcon = pending ? ClockIcon : failed ? RefreshCwIcon : BadgeCheckIcon;
          const statusText = pending
            ? cs.addPub.statusPending
            : failed
              ? cs.addPub.statusFailed
              : cs.addPub.statusSynced;
          const statusColor = submission.syncState === 'synced' ? Colors.success : Colors.amberLight;
          return (
            <View key={submission.client_id} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={[styles.statusIcon, { borderColor: withAlpha(statusColor, 0.35) }]}>
                  <StatusIcon size={17} color={statusColor} />
                </View>
                <View style={styles.cardCopy}>
                  <Text style={styles.pubName} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {submission.name}
                  </Text>
                  <Text style={[styles.status, { color: statusColor }]}>{statusText}</Text>
                </View>
              </View>
              <Text style={styles.address} maxFontSizeMultiplier={FontScaleCap.body}>
                {[submission.address, submission.city].filter(Boolean).join(', ')}
              </Text>
              <View style={styles.actions}>
                {failed && (
                  <Pressable
                    onPress={() => void handleRetry(submission.client_id)}
                    disabled={retryingId !== null}
                    style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
                    accessibilityRole="button"
                  >
                    <RefreshCwIcon size={16} color={Colors.stout} />
                    <Text style={styles.primaryActionText}>
                      {retryingId === submission.client_id ? cs.addPub.retrying : cs.addPub.retry}
                    </Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => handleEdit(submission)}
                  style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}
                  accessibilityRole="button"
                >
                  <PencilIcon size={16} color={Colors.amber} />
                  <Text style={styles.secondaryActionText}>{cs.addPub.edit}</Text>
                </Pressable>
              </View>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12 },
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
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  content: { paddingHorizontal: 20, paddingTop: Spacing.md, gap: Spacing.md },
  subtitle: { fontFamily: Fonts.ui.regular, fontSize: 15, lineHeight: 21, color: Colors.foamMuted },
  empty: {
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  emptyText: { textAlign: 'center', fontFamily: Fonts.ui.medium, fontSize: 15, color: Colors.foamMuted },
  card: {
    gap: Spacing.md,
    padding: Spacing.lg,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  statusIcon: {
    width: 38,
    height: 38,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: Colors.stout3,
  },
  cardCopy: { flex: 1, minWidth: 0, gap: 2 },
  pubName: { fontFamily: Fonts.ui.bold, fontSize: 17, color: Colors.foam },
  status: { fontFamily: Fonts.ui.semibold, fontSize: 12 },
  address: { fontFamily: Fonts.ui.regular, fontSize: 14, lineHeight: 20, color: Colors.foamMuted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  primaryAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  primaryActionText: { fontFamily: Fonts.ui.bold, fontSize: 14, color: Colors.stout },
  secondaryAction: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.4),
  },
  secondaryActionText: { fontFamily: Fonts.ui.semibold, fontSize: 14, color: Colors.amber },
  pressed: { opacity: 0.78 },
});
