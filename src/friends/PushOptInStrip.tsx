/**
 * PushOptInStrip — the warm, in-context Parta push opt-in (Parta 3.0 §E2).
 *
 * A deliberately WARM amber-tinted sibling of OfflineBanner's shell (the offline
 * strip is cool/muted; this one is inviting). Two shapes:
 *   - prompt → BellRing + title/body + "Zapnout upozornění" / "Teď ne".
 *   - denied → one-line hint + "Zapnout" that jumps to system settings.
 *
 * It only ever appears when there is actually something to notify about (the
 * parent gates it on having friends / an incoming request), never on the empty
 * 0-friend screen — you ask once there is a reason to.
 */

import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { BellRingIcon } from '@/components/shared/IconGlyph';
import { GlowButton } from '@/components/shared/GlowButton';
import { t } from '@/i18n';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

interface PushOptInStripProps {
  /** 'prompt' asks; 'denied' collapses to the system-settings nudge. */
  mode: 'prompt' | 'denied';
  onEnable: () => void;
  onDismiss: () => void;
  onOpenSettings: () => void;
}

function PushOptInStripComponent({ mode, onEnable, onDismiss, onOpenSettings }: PushOptInStripProps) {
  if (mode === 'denied') {
    return (
      <View style={styles.deniedStrip}>
        <BellRingIcon size={17} color={Colors.mutedText} />
        <Text
          style={styles.deniedText}
          numberOfLines={2}
          maxFontSizeMultiplier={FontScaleCap.body}
        >
          {t.friends.pushDeniedHint}
        </Text>
        <Pressable
          onPress={onOpenSettings}
          accessibilityRole="button"
          accessibilityLabel={t.friends.pushDeniedCta}
          hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
          style={({ pressed }) => [styles.deniedCta, pressed && styles.pressed]}
        >
          <Text style={styles.deniedCtaText} maxFontSizeMultiplier={FontScaleCap.heading}>
            {t.friends.pushDeniedCta}
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.strip}>
      <View style={styles.headRow}>
        <View style={styles.bellDisk}>
          <BellRingIcon size={18} color={Colors.amber} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
            {t.friends.pushPromptTitle}
          </Text>
          <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.friends.pushPromptBody}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        <View style={styles.enableWrap}>
          <GlowButton
            label={t.friends.pushPromptCta}
            onPress={onEnable}
            variant="primary"
            glow="soft"
            height={48}
            icon={<BellRingIcon size={18} color={Colors.stout} />}
          />
        </View>
        <Pressable
          onPress={onDismiss}
          accessibilityRole="button"
          accessibilityLabel={t.friends.pushPromptDismiss}
          hitSlop={8}
          style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
        >
          <Text style={styles.dismissText} maxFontSizeMultiplier={FontScaleCap.heading}>
            {t.friends.pushPromptDismiss}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.34),
    backgroundColor: withAlpha(Colors.amber, 0.08),
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  bellDisk: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontWeight: '800',
    fontSize: 16,
    color: Colors.foam,
  },
  body: {
    marginTop: 2,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.foamMuted,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  enableWrap: {
    flex: 1,
  },
  dismiss: {
    minHeight: 44,
    paddingHorizontal: Spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.mutedText,
  },
  pressed: {
    opacity: 0.6,
  },
  // — Denied one-liner —
  deniedStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
    backgroundColor: withAlpha(Colors.stout2, 0.7),
  },
  deniedText: {
    flex: 1,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
  },
  deniedCta: {
    flexShrink: 0,
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.36),
    backgroundColor: withAlpha(Colors.amber, 0.12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  deniedCtaText: {
    fontWeight: '600',
    fontSize: 13,
    color: Colors.amber,
  },
});

export default memo(PushOptInStripComponent);
