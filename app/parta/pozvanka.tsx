/**
 * Invite claim screen (Parta 3.0 §A5).
 *
 * Reached via the invite deep link (custom scheme `napivo://parta/pozvanka?code=`
 * today; the public web landing `na-pivo.cz/p/<code>` funnels here too). It
 * resolves the opaque code to its inviter (name/avatar only — no PII in the link)
 * and offers a single "Přidat do party" action that sends the friend request.
 *
 * A code tapped before the (auto-created) account existed is stashed by
 * `friendInviteLink`; after a restart startup reopens this confirmation screen
 * with the stashed code, and only the user's explicit "Přidat do party" tap
 * claims/sends it — backing out clears the stash.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';

import { GlowButton } from '@/components/shared/GlowButton';
import { ChevronLeftIcon, UsersIcon } from '@/components/shared/IconGlyph';
import {
  claimInviteCode,
  clearPendingInviteCode,
  inviteClaimRoute,
  inviteClaimState,
  isInviteClaimAccepted,
} from '@/data/friendInviteLink';
import { resolveInviteCode, type FriendProfile } from '@/data/friendsClient';
import { Avatar } from '@/profile/Avatar';
import { cs } from '@/i18n/cs';
import { useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';

type ClaimState = 'loading' | 'valid' | 'expired' | 'invalid' | 'self';
type InviteResolution = {
  code: string;
  state: 'loading' | 'resolved' | 'expired' | 'invalid';
  inviter: FriendProfile | null;
};

/** `@nickname` (preferred) → display name → a friendly fallback. */
function nameOf(profile: FriendProfile | null): string {
  if (!profile) return 'Kamarád';
  if (profile.nickname) return `@${profile.nickname}`;
  return profile.displayName || 'Kamarád';
}

export default function InviteClaimScreen() {
  const params = useLocalSearchParams<{ code?: string | string[] }>();
  const code = useMemo(() => {
    const raw = params.code;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return typeof value === 'string' ? value.trim() : '';
  }, [params.code]);

  // A route-param change is a new confirmation, not an update of the old one.
  // Remounting resets all visible/loading state and invalidates every async
  // callback from the previous code before the new screen can act.
  return <InviteClaimScreenContent key={code || 'invalid-invite'} code={code} />;
}

function InviteClaimScreenContent({ code }: { code: string }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);
  const myId = useAccountStore((s) => s.session?.accountId ?? s.profile?.id ?? null);

  const [resolution, setResolution] = useState<InviteResolution>(() => ({
    code,
    state: code ? 'loading' : 'invalid',
    inviter: null,
  }));
  const [claiming, setClaiming] = useState(false);

  const mountedRef = useRef(true);
  const claimingRef = useRef(false);
  // Claimed synchronously by either Back or the CTA before any storage/network
  // boundary. Exactly one terminal path may clear the invite and navigate.
  const leavingRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!code) return;
    let alive = true;
    void resolveInviteCode(code).then((result) => {
      if (!alive || !mountedRef.current) return;
      if (!result.valid) {
        setResolution({
          code,
          state: result.expired ? 'expired' : 'invalid',
          inviter: null,
        });
        return;
      }
      setResolution({ code, state: 'resolved', inviter: result.inviter });
    });
    return () => {
      alive = false;
    };
  }, [code]);

  const inviter = resolution.inviter;
  const state: ClaimState =
    resolution.state === 'resolved'
      ? inviteClaimState(inviter?.id ?? null, myId)
      : resolution.state;

  const goAfterClaim = useCallback((route: string) => {
    router.replace(route as Href);
  }, [router]);

  const goBack = useCallback(() => {
    if (leavingRef.current || claimingRef.current) return;
    leavingRef.current = true;
    void clearPendingInviteCode().finally(() => {
      if (!mountedRef.current) return;
      if (router.canGoBack()) router.back();
      else router.replace('/friends/parta' as Href);
    });
  }, [router]);

  const handleClaim = useCallback(() => {
    if (leavingRef.current || claimingRef.current || !code || state !== 'valid') return;
    claimingRef.current = true;
    leavingRef.current = true;
    setClaiming(true);
    void claimInviteCode(code).then(async (result) => {
      if (!mountedRef.current) return;
      if (result.ok) {
        await clearPendingInviteCode();
        if (!mountedRef.current) return;
        showToast(
          isInviteClaimAccepted(result) ? cs.friends.requestAcceptedToast : cs.friends.claimDone,
          { icon: <UsersIcon size={20} color={Colors.amber} /> },
        );
        goAfterClaim(inviteClaimRoute(result));
        return;
      }
      claimingRef.current = false;
      leavingRef.current = false;
      setClaiming(false);
      // Surface the backend's reason; fall back to a generic invalid message.
      const message =
        result.code === 'invite_expired' ? cs.friends.claimExpired : result.detail || cs.friends.claimInvalid;
      showToast(message);
    });
  }, [code, goAfterClaim, showToast, state]);

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
          onPress={goBack}
          disabled={claiming}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={cs.friends.claimBack}
          accessibilityState={{ disabled: claiming }}
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
                onPress={goBack}
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
                loading={claiming}
                disabled={claiming || state !== 'valid'}
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
    fontWeight: '500',
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
    fontWeight: '800',
    fontSize: 24,
    lineHeight: 30,
    color: Colors.foam,
    textAlign: 'center',
  },
  claimBody: {
    fontWeight: '500',
    fontSize: 15,
    lineHeight: 21,
    color: Colors.foamMuted,
    textAlign: 'center',
  },
  errorText: {
    fontWeight: '500',
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
