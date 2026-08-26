/**
 * Report / feedback screen — scrollable, dark background.
 *
 * Lets the user send a bug report, idea, or note. On submit it enqueues the
 * message (which persists + retries) fire-and-forget and immediately swaps the
 * form for a thank-you state — delivery is guaranteed by the queue, so we never
 * block on the network.
 */

import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MockColors } from '@/mocks/mockTheme';
import { Colors } from '@/theme/colors';

import { Radius, Spacing } from '@/theme/layout';
import { t } from '@/i18n';
import { leaveRoute } from '@/navigation/leaveRoute';
import { CameraIcon, ChevronLeftIcon, ImagesIcon, XIcon } from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { AppDialogHost, showAppDialog } from '@/components/shared/AppDialog';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { getAppVersionLabel } from '@/utils/appVersion';
import { enqueueFeedback } from '@/data/feedbackQueue';
import type { FeedbackCategory, FeedbackContactType } from '@/data/feedbackClient';
import {
  pickFeedbackAttachment,
  type FeedbackAttachmentSource,
} from '@/data/feedbackAttachmentPicker';
import { openSystemSettings } from '@/compass/permissions';

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'bug', label: t.report.categoryBug },
  { value: 'idea', label: t.report.categoryIdea },
  { value: 'other', label: t.report.categoryOther },
];

// Instagram first — most users know the app from there.
const CONTACT_CHANNELS: { value: FeedbackContactType; label: string }[] = [
  { value: 'instagram', label: t.report.contactInstagram },
  { value: 'email', label: t.report.contactEmail },
];

const CONTACT_PLACEHOLDERS: Record<FeedbackContactType, string> = {
  instagram: t.report.contactInstagramPlaceholder,
  email: t.report.contactEmailPlaceholder,
};

export default function ReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [contactType, setContactType] = useState<FeedbackContactType>('instagram');
  const [contact, setContact] = useState('');
  const [attachmentUri, setAttachmentUri] = useState<string | null>(null);
  const [pickingAttachment, setPickingAttachment] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const appVersionLabel = getAppVersionLabel();
  const canSubmit = message.trim().length > 0 && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);

    try {
      // Wait only for durable local persistence, never for the network. This is
      // what keeps a picked cache image safe if the app is closed while offline.
      await enqueueFeedback({
        category,
        message,
        contactType,
        contact,
        attachmentUri: attachmentUri ?? undefined,
      });
      setSubmitted(true);
    } finally {
      setSubmitting(false);
    }
  }, [attachmentUri, canSubmit, category, message, contactType, contact]);

  const handleAttachmentPick = useCallback(async (source: FeedbackAttachmentSource) => {
    if (pickingAttachment) return;
    setPickingAttachment(true);
    try {
      const result = await pickFeedbackAttachment(source);
      if (result.status === 'picked') {
        setAttachmentUri(result.uri);
      } else if (result.status === 'denied-permanent') {
        showAppDialog({
          title: t.report.attachmentPermissionTitle,
          message: t.report.attachmentPermissionBlocked,
          buttons: [
            { text: t.common.cancel, style: 'cancel' },
            { text: t.report.attachmentOpenSettings, onPress: () => void openSystemSettings() },
          ],
        });
      } else if (result.status === 'denied') {
        showAppDialog({
          title: t.report.attachmentPermissionTitle,
          message: t.report.attachmentPermissionDenied,
          buttons: [{ text: t.common.ok }],
        });
      } else if (result.status === 'error') {
        showAppDialog({
          title: t.report.attachmentErrorTitle,
          message: t.report.attachmentErrorBody,
          buttons: [{ text: t.common.ok }],
        });
      }
    } finally {
      setPickingAttachment(false);
    }
  }, [pickingAttachment]);

  const showAttachmentSource = useCallback(() => {
    showAppDialog({
      title: t.report.attachmentSourceTitle,
      buttons: [
        { text: t.report.attachmentCamera, onPress: () => void handleAttachmentPick('camera') },
        { text: t.report.attachmentLibrary, onPress: () => void handleAttachmentPick('library') },
        { text: t.common.cancel, style: 'cancel' },
      ],
    });
  }, [handleAttachmentPick]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable
          onPress={() => leaveRoute(router)}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={t.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>

        <Text style={styles.headerTitle}>{t.report.title}</Text>

        {/* Invisible spacer keeps title centered */}
        <View style={styles.headerSpacer} />
      </View>

      {submitted ? (
        <View
          style={[
            styles.successWrapper,
            { paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
        >
          <Text style={styles.successTitle}>{t.report.successTitle}</Text>
          <Text style={styles.successBody}>{t.report.successBody}</Text>
          <View style={styles.successButton}>
            <GlowButton
              label={t.report.successClose}
              onPress={() => leaveRoute(router)}
            />
          </View>
        </View>
      ) : (
        // Android is edge-to-edge, so `adjustResize` no longer pushes content
        // above the keyboard — pad it here (iOS pads via keyboard insets below).
        <KeyboardAvoidingView style={styles.flex} behavior="padding" enabled={Platform.OS === 'android'}>
        <KeyboardAwareScrollView
          style={styles.flex}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 24, 32) },
          ]}
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.intro}>{t.report.intro}</Text>

          {/* ── Category selector ── */}
          <View style={styles.segmented}>
            {CATEGORIES.map((item) => {
              const selected = item.value === category;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => setCategory(item.value)}
                  style={[styles.segment, selected && styles.segmentSelected]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t.a11y.feedbackCategory(item.label)}
                >
                  <Text
                    style={[
                      styles.segmentLabel,
                      selected && styles.segmentLabelSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── Message ── */}
          <TextInput
            style={styles.messageInput}
            value={message}
            onChangeText={setMessage}
            placeholder={t.report.messagePlaceholder}
            placeholderTextColor={MockColors.fieldHint}
            multiline
            textAlignVertical="top"
            maxLength={4000}
            accessibilityLabel={t.report.messagePlaceholder}
          />

          {/* ── Optional screenshot/photo ── */}
          <Text style={styles.attachmentCaption}>{t.report.attachmentCaption}</Text>
          {attachmentUri ? (
            <View style={styles.attachmentPreviewRow}>
              <Image source={{ uri: attachmentUri }} style={styles.attachmentPreview} />
              <View style={styles.attachmentPreviewCopy}>
                <Text style={styles.attachmentReady}>{t.report.attachmentReady}</Text>
                <Text style={styles.attachmentPrivacy}>{t.report.attachmentPrivacy}</Text>
              </View>
              <Pressable
                onPress={() => setAttachmentUri(null)}
                accessibilityRole="button"
                accessibilityLabel={t.report.attachmentRemove}
                style={({ pressed }) => [styles.attachmentRemove, pressed && styles.pressed]}
              >
                <XIcon size={18} color={Colors.foamMuted} />
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={showAttachmentSource}
              disabled={pickingAttachment}
              accessibilityRole="button"
              accessibilityLabel={t.report.attachmentAdd}
              style={({ pressed }) => [styles.attachmentButton, pressed && styles.pressed]}
            >
              <View style={styles.attachmentIcon}>
                {pickingAttachment ? (
                  <ImagesIcon size={20} color={Colors.mutedText} />
                ) : (
                  <CameraIcon size={20} color={Colors.amber} />
                )}
              </View>
              <View style={styles.attachmentButtonCopy}>
                <Text style={styles.attachmentButtonTitle}>
                  {pickingAttachment ? t.report.attachmentPreparing : t.report.attachmentAdd}
                </Text>
                <Text style={styles.attachmentPrivacy}>{t.report.attachmentHelper}</Text>
              </View>
            </Pressable>
          )}

          {/* ── Optional contact ── */}
          <Text style={styles.contactCaption}>{t.report.contactCaption}</Text>
          <View style={styles.contactChannels}>
            {CONTACT_CHANNELS.map((channel) => {
              const selected = channel.value === contactType;
              return (
                <Pressable
                  key={channel.value}
                  onPress={() => setContactType(channel.value)}
                  style={[
                    styles.contactPill,
                    selected && styles.contactPillSelected,
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={t.a11y.feedbackContactChannel(channel.label)}
                >
                  <Text
                    style={[
                      styles.contactPillLabel,
                      selected && styles.contactPillLabelSelected,
                    ]}
                  >
                    {channel.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextInput
            style={styles.contactInput}
            value={contact}
            onChangeText={setContact}
            placeholder={CONTACT_PLACEHOLDERS[contactType]}
            placeholderTextColor={MockColors.fieldHint}
            keyboardType={contactType === 'email' ? 'email-address' : 'default'}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
            accessibilityLabel={t.a11y.feedbackContactInput}
          />

          {/* ── Submit ── */}
          <View style={styles.submitButton}>
            <GlowButton
              label={t.report.submit}
              onPress={() => void handleSubmit()}
              glow={canSubmit ? 'soft' : 'none'}
              accessibilityLabel={t.a11y.feedbackSubmitButton}
            />
            {!canSubmit && <View style={styles.submitDisabledOverlay} />}
          </View>

          {appVersionLabel ? (
            <Text style={styles.versionCaption}>
              {t.report.versionCaption(appVersionLabel)}
            </Text>
          ) : null}
        </KeyboardAwareScrollView>
        </KeyboardAvoidingView>
      )}
      {/* This route is a native full-screen modal on iOS. A local host keeps
          the photo-source dialog above that presentation layer. */}
      <AppDialogHost />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  flex: {
    flex: 1,
  },

  // ── Header ──
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontWeight: '800',
    fontSize: 24,
    color: Colors.foam,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },

  // ── Form ──
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  intro: {
    fontWeight: '400',
    fontSize: 15,
    color: Colors.foamMuted,
    lineHeight: 15 * 1.5,
    marginBottom: Spacing.lg,
  },

  // ── Category selector ──
  segmented: {
    flexDirection: 'row',
    backgroundColor: Colors.stout3,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 4,
    gap: 4,
    marginBottom: Spacing.lg,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: Radius.pill,
  },
  segmentSelected: {
    backgroundColor: Colors.amber,
  },
  segmentLabel: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.foamMuted,
  },
  segmentLabelSelected: {
    color: Colors.stout,
  },

  // ── Message well ──
  messageInput: {
    backgroundColor: Colors.stout3,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.medium,
    color: Colors.foam,
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 15 * 1.4,
    minHeight: 140,
    padding: 14,
    marginBottom: Spacing.lg,
  },

  // ── Attachment ──
  attachmentCaption: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.foamMuted,
    marginBottom: Spacing.sm,
  },
  attachmentButton: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout3,
    marginBottom: Spacing.lg,
  },
  attachmentIcon: {
    width: 42,
    height: 42,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout2,
  },
  attachmentButtonCopy: { flex: 1, gap: 3 },
  attachmentButtonTitle: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.foam,
  },
  attachmentPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 8,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.amber,
    backgroundColor: Colors.stout3,
    marginBottom: Spacing.lg,
  },
  attachmentPreview: {
    width: 68,
    height: 68,
    borderRadius: Radius.small,
    backgroundColor: Colors.stout2,
  },
  attachmentPreviewCopy: { flex: 1, gap: 3 },
  attachmentReady: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.amberLight,
  },
  attachmentPrivacy: {
    fontWeight: '400',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.mutedText,
  },
  attachmentRemove: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout2,
  },
  pressed: { opacity: 0.72 },

  // ── Contact ──
  contactCaption: {
    fontWeight: '400',
    fontSize: 12,
    color: Colors.mutedText,
    marginBottom: 8,
  },
  contactChannels: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  contactPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  contactPillSelected: {
    backgroundColor: Colors.amber,
    borderColor: Colors.amber,
  },
  contactPillLabel: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.foamMuted,
  },
  contactPillLabelSelected: {
    color: Colors.stout,
  },
  contactInput: {
    backgroundColor: Colors.stout3,
    borderColor: Colors.border,
    borderWidth: 1,
    borderRadius: Radius.medium,
    color: Colors.foam,
    fontWeight: '400',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: Spacing.lg,
  },

  // ── Submit ──
  submitButton: {
    position: 'relative',
  },
  submitDisabledOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.stout,
    opacity: 0.55,
    borderRadius: Radius.pill,
  },
  versionCaption: {
    fontWeight: '400',
    fontSize: 11,
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: Spacing.md,
  },

  // ── Success ──
  successWrapper: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
  },
  successTitle: {
    fontWeight: '800',
    fontSize: 40,
    color: Colors.foam,
    textAlign: 'center',
  },
  successBody: {
    fontWeight: '400',
    fontSize: 15,
    color: Colors.foamMuted,
    lineHeight: 15 * 1.5,
    textAlign: 'center',
  },
  successButton: {
    alignSelf: 'stretch',
    marginTop: Spacing.sm,
  },
});
