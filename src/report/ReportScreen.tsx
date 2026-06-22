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
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  StyleSheet,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';
import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { getAppVersionLabel } from '@/utils/appVersion';
import { enqueueFeedback, flushFeedbackQueue } from '@/data/feedbackQueue';
import type { FeedbackCategory, FeedbackContactType } from '@/data/feedbackClient';

const CATEGORIES: Array<{ value: FeedbackCategory; label: string }> = [
  { value: 'bug', label: cs.report.categoryBug },
  { value: 'idea', label: cs.report.categoryIdea },
  { value: 'other', label: cs.report.categoryOther },
];

// Instagram first — most users know the app from there.
const CONTACT_CHANNELS: Array<{ value: FeedbackContactType; label: string }> = [
  { value: 'instagram', label: cs.report.contactInstagram },
  { value: 'email', label: cs.report.contactEmail },
];

const CONTACT_PLACEHOLDERS: Record<FeedbackContactType, string> = {
  instagram: cs.report.contactInstagramPlaceholder,
  email: cs.report.contactEmailPlaceholder,
};

export default function ReportScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [contactType, setContactType] = useState<FeedbackContactType>('instagram');
  const [contact, setContact] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const appVersionLabel = getAppVersionLabel();
  const canSubmit = message.trim().length > 0;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;

    // Fire-and-forget: the queue persists the entry before the first send and
    // retries on launch/foreground, so we never block on the network here.
    // buildFeedbackEntry omits the contact pair when the input is empty.
    void enqueueFeedback({
      category,
      message,
      contactType,
      contact,
    });
    void flushFeedbackQueue();

    setSubmitted(true);
  }, [canSubmit, category, message, contactType, contact]);

  return (
    <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>

        <Text style={styles.headerTitle}>{cs.report.title}</Text>

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
          <Text style={styles.successTitle}>{cs.report.successTitle}</Text>
          <Text style={styles.successBody}>{cs.report.successBody}</Text>
          <View style={styles.successButton}>
            <GlowButton
              label={cs.report.successClose}
              onPress={() => router.back()}
            />
          </View>
        </View>
      ) : (
        <ScrollView
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
          <Text style={styles.intro}>{cs.report.intro}</Text>

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
                  accessibilityLabel={cs.a11y.feedbackCategory(item.label)}
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
            placeholder={cs.report.messagePlaceholder}
            placeholderTextColor={Colors.mutedText}
            multiline
            textAlignVertical="top"
            maxLength={4000}
            accessibilityLabel={cs.report.messagePlaceholder}
          />

          {/* ── Optional contact ── */}
          <Text style={styles.contactCaption}>{cs.report.contactCaption}</Text>
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
                  accessibilityLabel={cs.a11y.feedbackContactChannel(channel.label)}
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
            placeholderTextColor={Colors.mutedText}
            keyboardType={contactType === 'email' ? 'email-address' : 'default'}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={254}
            accessibilityLabel={cs.a11y.feedbackContactInput}
          />

          {/* ── Submit ── */}
          <View style={styles.submitButton}>
            <GlowButton
              label={cs.report.submit}
              onPress={handleSubmit}
              glow={canSubmit ? 'soft' : 'none'}
              accessibilityLabel={cs.a11y.feedbackSubmitButton}
            />
            {!canSubmit && <View style={styles.submitDisabledOverlay} />}
          </View>

          {appVersionLabel ? (
            <Text style={styles.versionCaption}>
              {cs.report.versionCaption(appVersionLabel)}
            </Text>
          ) : null}
        </ScrollView>
      )}
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
    fontFamily: Fonts.display.extrabold,
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
    fontFamily: Fonts.ui.regular,
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
    fontFamily: Fonts.ui.semibold,
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
    fontFamily: Fonts.ui.regular,
    fontSize: 15,
    lineHeight: 15 * 1.4,
    minHeight: 140,
    padding: 14,
    marginBottom: Spacing.lg,
  },

  // ── Contact ──
  contactCaption: {
    fontFamily: Fonts.ui.regular,
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
    fontFamily: Fonts.ui.semibold,
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
    fontFamily: Fonts.ui.regular,
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
    fontFamily: Fonts.ui.regular,
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
    fontFamily: Fonts.display.extrabold,
    fontSize: 40,
    color: Colors.foam,
    textAlign: 'center',
  },
  successBody: {
    fontFamily: Fonts.ui.regular,
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
