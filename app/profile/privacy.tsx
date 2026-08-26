/**
 * One-screen privacy choice shown after a new registration.
 *
 * This deliberately is not a profile wizard: nickname, avatar and friends stay
 * in their natural places inside the app. The screen only asks the one choice
 * that deserves explicit context before a profile becomes discoverable.
 */

import React, { useCallback, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlowButton } from '@/components/shared/GlowButton';
import {
  CheckIcon,
  EyeIcon,
  LockKeyholeIcon,
  ShieldIcon,
} from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { useAccountStore, selectIsPublic } from '@/stores/accountStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

interface PrivacyChoiceProps {
  selected: boolean;
  title: string;
  body: string;
  icon: ReactNode;
  onPress: () => void;
}

function PrivacyChoice({ selected, title, body, icon, onPress }: PrivacyChoiceProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.choice,
        selected && styles.choiceSelected,
        pressed && styles.pressed,
      ]}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={`${title}. ${body}`}
    >
      <View style={[styles.choiceIcon, selected && styles.choiceIconSelected]}>{icon}</View>
      <View style={styles.choiceCopy}>
        <Text style={styles.choiceTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {title}
        </Text>
        <Text style={styles.choiceBody} maxFontSizeMultiplier={FontScaleCap.body}>
          {body}
        </Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <CheckIcon size={16} color={Colors.stout} /> : null}
      </View>
    </Pressable>
  );
}

export default function ProfilePrivacyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const initialIsPublic = useAccountStore(selectIsPublic);
  const updateProfile = useAccountStore((state) => state.updateProfile);

  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const finish = useCallback(() => {
    router.replace('/(tabs)' as Href);
  }, [router]);

  const select = useCallback((next: boolean) => {
    setIsPublic(next);
    setError('');
  }, []);

  const handleConfirm = useCallback(async () => {
    if (busy) return;
    if (isPublic === initialIsPublic) {
      finish();
      return;
    }

    setBusy(true);
    setError('');
    try {
      const result = await updateProfile({ isPublic });
      if (result.ok) {
        finish();
        return;
      }
      setError(result.detail || t.profile.privacy.error);
    } finally {
      setBusy(false);
    }
  }, [busy, finish, initialIsPublic, isPublic, updateProfile]);

  return (
    <View
      style={[
        styles.root,
        {
          paddingTop: insets.top + Spacing.lg,
          paddingBottom: Math.max(insets.bottom, Spacing.lg),
        },
      ]}
    >
      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroMark} accessibilityElementsHidden>
          <View style={styles.heroRing} />
          <ShieldIcon size={34} color={Colors.amber} />
        </View>

        <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.profile.privacy.eyebrow}
        </Text>
        <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.profile.privacy.title}
        </Text>
        <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.profile.privacy.body}
        </Text>

        <View style={styles.choices} accessibilityRole="radiogroup">
          <PrivacyChoice
            selected={isPublic}
            title={t.profile.privacy.publicTitle}
            body={t.profile.privacy.publicBody}
            icon={<EyeIcon size={22} color={isPublic ? Colors.amber : Colors.mutedText} />}
            onPress={() => select(true)}
          />
          <PrivacyChoice
            selected={!isPublic}
            title={t.profile.privacy.privateTitle}
            body={t.profile.privacy.privateBody}
            icon={
              <LockKeyholeIcon
                size={22}
                color={!isPublic ? Colors.amber : Colors.mutedText}
              />
            }
            onPress={() => select(false)}
          />
        </View>

        <View style={styles.promise}>
          <ShieldIcon size={18} color={Colors.amber} />
          <Text style={styles.promiseText} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.profile.privacy.promise}
          </Text>
        </View>

        {!!error && (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.profile.privacy.error}
            </Text>
          </View>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <View>
          <GlowButton
            label={busy ? t.profile.privacy.saving : t.profile.privacy.confirm}
            onPress={handleConfirm}
            glow={busy ? 'none' : 'strong'}
            disabled={busy}
            accessibilityLabel={t.profile.privacy.confirm}
          />
          {busy ? (
            <View style={styles.buttonSpinner} pointerEvents="none">
              <ActivityIndicator color={Colors.stout} />
            </View>
          ) : null}
        </View>
        <Pressable
          onPress={finish}
          disabled={busy}
          style={({ pressed }) => [styles.skipButton, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={error ? t.profile.privacy.skipAfterError : t.profile.privacy.skip}
        >
          <Text style={styles.skipText} maxFontSizeMultiplier={FontScaleCap.body}>
            {error ? t.profile.privacy.skipAfterError : t.profile.privacy.skip}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    paddingHorizontal: Spacing.lg,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: Spacing.md,
  },
  heroMark: {
    width: 72,
    height: 72,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.32),
    marginBottom: Spacing.xl,
  },
  heroRing: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.14),
  },
  eyebrow: {
    fontWeight: '600',
    fontSize: 12,
    letterSpacing: 1.8,
    color: Colors.amber,
    marginBottom: Spacing.sm,
  },
  title: {
    fontWeight: '800',
    fontSize: 34,
    lineHeight: 39,
    letterSpacing: -0.5,
    color: Colors.foam,
    maxWidth: 330,
  },
  body: {
    fontWeight: '400',
    fontSize: 16,
    lineHeight: 24,
    color: Colors.foamMuted,
    marginTop: Spacing.sm,
    maxWidth: 350,
  },
  choices: {
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  choice: {
    minHeight: 104,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout2,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  choiceSelected: {
    borderColor: withAlpha(Colors.amber, 0.72),
    backgroundColor: withAlpha(Colors.amber, 0.09),
  },
  choiceIcon: {
    width: 46,
    height: 46,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.stout3,
  },
  choiceIconSelected: {
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  choiceCopy: {
    flex: 1,
  },
  choiceTitle: {
    fontWeight: '700',
    fontSize: 18,
    color: Colors.foam,
  },
  choiceBody: {
    fontWeight: '400',
    fontSize: 13.5,
    lineHeight: 19,
    color: Colors.foamMuted,
    marginTop: 3,
  },
  radio: {
    width: 26,
    height: 26,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: Colors.amber,
    backgroundColor: Colors.amber,
  },
  promise: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    paddingHorizontal: Spacing.xs,
  },
  promiseText: {
    flex: 1,
    fontWeight: '400',
    fontSize: 13,
    lineHeight: 19,
    color: Colors.mutedText,
  },
  errorBox: {
    marginTop: Spacing.md,
    paddingVertical: 10,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    backgroundColor: withAlpha(Colors.amber, 0.1),
  },
  errorText: {
    fontWeight: '500',
    fontSize: 13.5,
    lineHeight: 20,
    color: Colors.amberLight,
  },
  footer: {
    gap: Spacing.xs,
  },
  buttonSpinner: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skipButton: {
    minHeight: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  skipText: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.mutedText,
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.985 }],
  },
});
