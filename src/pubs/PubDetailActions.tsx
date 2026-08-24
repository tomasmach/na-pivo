import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { showAppDialog } from '@/components/shared/AppDialog';
import { CloseButton } from '@/components/shared/CloseButton';
import { GlassIconButton } from '@/components/shared/GlassIconButton';
import {
  ClockIcon,
  EllipsisIcon,
  FlagIcon,
  PencilIcon,
  TriangleAlertIcon,
} from '@/components/shared/IconGlyph';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { buildPubNameCorrectionEntry } from '@/data/pubNameCorrectionsClient';
import { persistPubNameCorrection } from '@/data/pubNameCorrectionsQueue';
import { persistPubReport } from '@/data/pubReportQueue';
import type { PubReportReason } from '@/data/pubReportsClient';
import { clearPubsSnapshot, renameLocalPub, type Pub } from '@/data/pubs';
import { geohash8 } from '@/data/geohash';
import { cs } from '@/i18n/cs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { selectIsSignedIn, useAccountStore } from '@/stores/accountStore';
import { usePubStore } from '@/stores/pubStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

const SHEET_DISMISS_MS = 240;

export function PubDetailActions({
  pub,
  displayName,
  onRenamed,
  onReported,
}: {
  pub: Pub;
  displayName: string;
  onRenamed: (name: string) => void;
  onReported: () => void;
}) {
  const router = useRouter();
  const isSignedIn = useAccountStore(selectIsSignedIn);
  const showToast = useToastStore((state) => state.show);
  const addReportedPub = usePubStore((state) => state.addReportedPub);
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [renameOpen, setRenameOpen] = React.useState(false);
  const [reportOpen, setReportOpen] = React.useState(false);
  const [reportSubmitting, setReportSubmitting] = React.useState(false);
  const [renameDraft, setRenameDraft] = React.useState(displayName);
  const [renameSubmitting, setRenameSubmitting] = React.useState(false);
  const actionTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(
    () => () => {
      if (actionTimer.current) clearTimeout(actionTimer.current);
    },
    [],
  );

  const afterMoreCloses = React.useCallback((action: () => void) => {
    setMoreOpen(false);
    if (actionTimer.current) clearTimeout(actionTimer.current);
    actionTimer.current = setTimeout(() => {
      actionTimer.current = null;
      action();
    }, SHEET_DISMISS_MS);
  }, []);

  const openSuggestEvent = React.useCallback(() => {
    afterMoreCloses(() => {
      if (!isSignedIn) {
        router.push('/auth' as Href);
        return;
      }
      router.push({
        pathname: '/suggest-pub-event',
        params: {
          pubKey: geohash8(pub.lat, pub.lng),
          name: displayName,
          lat: String(pub.lat),
          lng: String(pub.lng),
          city: pub.city ?? '',
          externalId: pub.id,
        },
      } as unknown as Href);
    });
  }, [afterMoreCloses, displayName, isSignedIn, pub, router]);

  const openRename = React.useCallback(() => {
    afterMoreCloses(() => {
      setRenameDraft(displayName);
      setRenameOpen(true);
    });
  }, [afterMoreCloses, displayName]);

  const openEditOwned = React.useCallback(() => {
    if (!pub.userAddedClientId) return;
    afterMoreCloses(() => {
      router.push({
        pathname: '/add-pub',
        params: {
          clientId: pub.userAddedClientId,
          name: displayName,
          city: pub.city ?? '',
          address: pub.address ?? '',
          lat: String(pub.lat),
          lng: String(pub.lng),
        },
      } as unknown as Href);
    });
  }, [afterMoreCloses, displayName, pub, router]);

  const submitRename = React.useCallback(() => {
    const trimmed = renameDraft.trim().slice(0, 200);
    if (!trimmed || trimmed === displayName.trim() || renameSubmitting) return;
    setRenameSubmitting(true);
    renameLocalPub(pub.id, trimmed);
    usePubStore.getState().bumpCatalogRevision();
    void clearPubsSnapshot().catch(() => undefined);
    onRenamed(trimmed);
    const correction = buildPubNameCorrectionEntry({ ...pub, name: displayName }, trimmed);
    void persistPubNameCorrection(correction)
      .then((queued) => {
        if (!queued.persisted) {
          throw new Error('Pub name correction was not persisted');
        }
        setRenameOpen(false);
        setRenameSubmitting(false);
        showToast(cs.compass.renameQueuedToast);
        void queued.sync.then((result) => {
          if (result !== 'rejected' && result !== 'storage-error') return;
          renameLocalPub(pub.id, displayName);
          usePubStore.getState().bumpCatalogRevision();
          onRenamed(displayName);
          showToast(cs.pubDetail.saveFailed);
        }).catch(() => undefined);
      })
      .catch(() => {
        renameLocalPub(pub.id, displayName);
        usePubStore.getState().bumpCatalogRevision();
        onRenamed(displayName);
        showToast(cs.pubDetail.saveFailed);
      })
      .finally(() => setRenameSubmitting(false));
  }, [displayName, onRenamed, pub, renameDraft, renameSubmitting, showToast]);

  const submitReport = React.useCallback(
    (reason: PubReportReason) => {
      if (reportSubmitting) return;
      setReportSubmitting(true);
      void persistPubReport(pub, reason)
        .then((persisted) => {
          setReportSubmitting(false);
          if (!persisted) {
            showToast(cs.pubDetail.saveFailed);
            return;
          }
          setReportOpen(false);
          addReportedPub(pub.id, geohash8(pub.lat, pub.lng));
          showToast(cs.pubDetail.reportQueued);
          onReported();
        })
        .catch(() => {
          setReportSubmitting(false);
          showToast(cs.pubDetail.saveFailed);
        });
    },
    [addReportedPub, onReported, pub, reportSubmitting, showToast],
  );

  const confirmReport = React.useCallback(
    (reason: PubReportReason) => {
      setReportOpen(false);
      if (actionTimer.current) clearTimeout(actionTimer.current);
      actionTimer.current = setTimeout(() => {
        actionTimer.current = null;
        showAppDialog({
          title: cs.pubDetail.reportConfirmTitle(displayName),
          message: cs.pubDetail.reportConfirmBody,
          buttons: [
            { text: cs.pubDetail.reportConfirmCancel, style: 'cancel' },
            {
              text: cs.pubDetail.reportConfirmAction,
              style: 'destructive',
              onPress: () => submitReport(reason),
            },
          ],
        });
      }, SHEET_DISMISS_MS);
    },
    [displayName, submitReport],
  );

  const rows = React.useMemo<MoreRow[]>(
    () => [
      {
        key: 'suggest-event',
        label: isSignedIn ? cs.pubDetail.eventSuggest : cs.pubDetail.eventSuggestSignedOut,
        icon: ClockIcon,
        onPress: openSuggestEvent,
      },
      pub.userAddedClientId
        ? {
            key: 'edit-owned',
            label: cs.pubDetail.editOwnedAction,
            icon: PencilIcon,
            onPress: openEditOwned,
          }
        : {
            key: 'rename',
            label: cs.pubDetail.renameAction,
            icon: PencilIcon,
            onPress: openRename,
          },
      {
        key: 'report',
        label: cs.pubDetail.reportAction,
        icon: FlagIcon,
        onPress: () => afterMoreCloses(() => setReportOpen(true)),
      },
    ],
    [afterMoreCloses, isSignedIn, openEditOwned, openRename, openSuggestEvent, pub.userAddedClientId],
  );

  const trimmed = renameDraft.trim();
  const canRename = trimmed.length > 0 && trimmed !== displayName.trim() && !renameSubmitting;

  return (
    <>
      <GlassIconButton
        size={44}
        accessibilityLabel={cs.pubDetail.moreA11y}
        onPress={() => setMoreOpen(true)}
      >
        <EllipsisIcon size={21} color={Colors.foam} />
      </GlassIconButton>
      <MoreSheet
        visible={moreOpen}
        title={cs.pubDetail.moreTitle}
        rows={rows}
        onClose={() => setMoreOpen(false)}
      />
      <RenameSheet
        visible={renameOpen}
        value={renameDraft}
        canSubmit={canRename}
        submitting={renameSubmitting}
        onChange={setRenameDraft}
        onClose={() => {
          if (!renameSubmitting) setRenameOpen(false);
        }}
        onSubmit={submitRename}
      />
      <ReportSheet
        visible={reportOpen}
        submitting={reportSubmitting}
        onClose={() => {
          if (!reportSubmitting) setReportOpen(false);
        }}
        onSelect={confirmReport}
      />
    </>
  );
}

function SheetFrame({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
      <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <View style={styles.grabber} />
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {title}
          </Text>
          <CloseButton onPress={onClose} />
        </View>
        {children}
        {footer}
      </View>
    </View>
  );
}

function RenameSheet({
  visible,
  value,
  canSubmit,
  submitting,
  onChange,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  value: string;
  canSubmit: boolean;
  submitting: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <KeyboardAvoidingView
        style={styles.keyboardWrap}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        pointerEvents="box-none"
      >
        <SheetFrame
          title={cs.pubDetail.renameTitle}
          onClose={onClose}
          footer={
            <Pressable
              onPress={onSubmit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.submit,
                !canSubmit && styles.disabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSubmit, busy: submitting }}
            >
              <Text style={styles.submitText}>{cs.pubDetail.renameSave}</Text>
            </Pressable>
          }
        >
          <KeyboardAwareScrollView
            style={styles.sheetScroll}
            contentContainerStyle={styles.sheetScrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardAvoidedExternally
          >
            <Text style={styles.fieldLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.pubDetail.renameLabel}
            </Text>
            <TextInput
              value={value}
              onChangeText={onChange}
              style={styles.input}
              accessibilityLabel={cs.pubDetail.renameLabel}
              autoFocus
              autoCapitalize="words"
              returnKeyType="done"
              maxLength={200}
              onSubmitEditing={canSubmit ? onSubmit : undefined}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
          </KeyboardAwareScrollView>
        </SheetFrame>
      </KeyboardAvoidingView>
    </BottomSheetModal>
  );
}

function ReportSheet({
  visible,
  submitting,
  onClose,
  onSelect,
}: {
  visible: boolean;
  submitting: boolean;
  onClose: () => void;
  onSelect: (reason: PubReportReason) => void;
}) {
  const rows = [
    { reason: 'closed' as const, label: cs.pubDetail.reportClosed, icon: ClockIcon },
    { reason: 'not_pub' as const, label: cs.pubDetail.reportNotPub, icon: TriangleAlertIcon },
  ];
  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <SheetFrame title={cs.pubDetail.reportTitle} onClose={onClose}>
        {rows.map(({ reason, label, icon: Icon }, index) => (
          <Pressable
            key={reason}
            onPress={() => onSelect(reason)}
            disabled={submitting}
            style={({ pressed }) => [
              styles.reportRow,
              index > 0 && styles.reportDivider,
              pressed && styles.pressed,
            ]}
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting, busy: submitting }}
          >
            <Icon size={20} color={Colors.amber} />
            <Text style={styles.reportLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {label}
            </Text>
          </Pressable>
        ))}
      </SheetFrame>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  keyboardWrap: { flex: 1, justifyContent: 'flex-end' },
  cardWrap: { width: '100%', maxHeight: '92%' },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.12),
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.sm,
    ...softDrop(),
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  sheetTitle: { flex: 1, ...MockType.titleS, color: Colors.foam },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  sheetScrollContent: { paddingBottom: Spacing.md },
  fieldLabel: { marginBottom: Spacing.sm, fontSize: 13, fontWeight: '700', color: Colors.foamMuted },
  input: {
    minHeight: HitArea.min,
    borderRadius: Radius.small,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.18),
    backgroundColor: Colors.stout3,
    paddingHorizontal: Spacing.md,
    fontSize: 16,
    color: Colors.foam,
  },
  submit: {
    minHeight: MockLayout.sheetButtonHeight,
    marginTop: Spacing.sm,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  submitText: { fontSize: 15, fontWeight: '800', color: Colors.stout },
  disabled: { opacity: 0.4 },
  reportRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  reportDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  reportLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.foam },
  pressed: { opacity: 0.7 },
});
