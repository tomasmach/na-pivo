/**
 * Invite claim screen (Parta 3.0 §A5).
 *
 * Reached via the invite deep link (custom scheme `napivo://parta/pozvanka?code=`
 * today; the public web landing `na-pivo.cz/p/<code>` funnels here too). It
 * resolves the opaque code to its inviter (name/avatar only — no PII in the link)
 * and offers a single "Přidat do party" action that sends the friend request.
 *
 * A code tapped before the (auto-created) account existed is stashed by
 * `friendInviteLink` and claimed on launch, so by the time this screen renders an
 * account is ready and the request goes straight out.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { GlowButton } from '@/components/shared/GlowButton';
import { ChevronLeftIcon, UsersIcon } from '@/components/shared/IconGlyph';
import { claimInviteCode } from '@/data/friendInviteLink';
import { resolveInviteCode, type FriendProfile } from '@/data/friendsClient';
import { Avatar } from '@/profile/Avatar';
import { cs } from '@/i18n/cs';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';

type ClaimState = 'loading' | 'valid' | 'expired' | 'invalid' | 'self';

/** `@nickname` (preferred) → display name → a friendly fallback. */
function nameOf(profile: FriendProfile | null): string {
  if (!profile) return 'Kamarád';
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || 'Kamarád';
}

export default function InviteClaimScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);
  const myId = useAccountStore((s) => s.profile?.id ?? null);

  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const code = useMemo(() => {
    const raw = params.code;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value.trim() : '';
  }, [params.code]);

  // Lazy init from code presence so the effect never needs a synchronous setState.
  const [state, setState] = useState<ClaimState>(() => (code ? 'loading' : 'invalid'));
  const [inviter, setInviter] = useState<FriendProfile | null>(null);
  const [claiming, setClaiming] = useState(false);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  useEffect(() => {
    if (!code) return;
    let alive = true;
    void resolveInviteCode(code).then((result) => {
      if (!alive) return;
      if (!result.valid) {
        setState(result.expired ? 'expired' : 'invalid');
        return;
      }
      setInviter(result.inviter);
      // A resolved inviter equal to me means I opened my own code.
      setState(result.inviter && myId && result.inviter.id === myId ? 'self' : 'valid');
    });
    return () => {
      alive = false;
    };
  }, [code, myId]);

  const goToParta = useCallback(() => {
    router.replace('/friends' as Href);
  }, [router]);

  const handleClaim = useCallback(() => {
    if (claiming || !code) return;
    setClaiming(true);
    void claimInviteCode(code).then((result) => {
      if (!mountedRef.current) return;
      if (result.ok) {
        showToast(cs.friends.claimDone, { icon: <UsersIcon size={20} color={Colors.amber} /> });
        goToParta();
        return;
      }
      setClaiming(false);
      // Surface the backend's reason; fall back to a generic invalid message.
      const message =
        result.code === 'invite_expired' ? cs.friends.claimExpired : result.detail || cs.friends.claimInvalid;
      showToast(message);
    });
  }, [claiming, code, goToParta, showToast]);

  const errorMessage =
    state === 'expired'
      ? cs.friends.claimExpired
      : state === 'invalid'
        ? cs.friends.claimInvalid
        : state === 'self'
          ? cs.friends.claimSelf
          : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      <View style={styles.header}>
        <Pressable
          onPress={goToParta}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={cs.friends.claimBack}
          style={({ pressed }) => [styles.backBtn, pressed && styles.dim]}
        >
          <ChevronLeftIcon size={26} color={Colors.foam} />
        </Pressable>
      </View>

      <View style={styles.body}>
        {state === 'loading' ? (
          <Text style={styles.loadingText} maxFontSizeMultiplier={FontScaleCap.body}>
            {cs.friends.claimLoading}
          </Text>
        ) : errorMessage ? (
          <View style={styles.centerBlock}>
            <UsersIcon size={48} color={Colors.mutedText} />
            <Text style={styles.errorText} maxFontSizeMultiplier={FontScaleCap.body}>
              {errorMessage}
            </Text>
            <View style={styles.ctaWrap}>
              <GlowButton
                label={cs.friends.claimBack}
                onPress={goToParta}
                variant="secondary"
                glow="none"
                height={52}
              />
            </View>
          </View>
        ) : (
          <View style={styles.centerBlock}>
            <Avatar
              uri={inviter?.avatarUrl}
              nickname={inviter?.nickname}
              displayName={inviter?.displayName}
              size={88}
            />
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.friends.claimTitle(nameOf(inviter))}
            </Text>
            <Text style={styles.claimBody} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.friends.claimBody}
            </Text>
            <View style={styles.ctaWrap}>
              <GlowButton
                label={cs.friends.claimCta}
                onPress={handleClaim}
                variant="primary"
                glow="soft"
              />
            </View>
          </View>
        )}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backBtn: {
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -Spacing.sm,
  },
  dim: {
    opacity: 0.6,
  },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: Spacing.xxl,
  },
  loadingText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    color: Colors.mutedText,
  },
  centerBlock: {
    alignItems: 'center',
    gap: Spacing.md,
    alignSelf: 'stretch',
  },
  title: {
    marginTop: Spacing.sm,
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    lineHeight: 30,
    color: Colors.foam,
    textAlign: 'center',
  },
  claimBody: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  errorText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  ctaWrap: {
    alignSelf: 'stretch',
    marginTop: Spacing.md,
  },
});
