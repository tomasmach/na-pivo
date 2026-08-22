/**
 * CodeSheet — "Můj kód" growth sheet (Parta 3.0 §A3).
 *
 * A clone of the FriendSettingsSheet scaffold (transparent fade Modal +
 * absolute-fill backdrop + drag handle + absolute close + SLIDE_SPRING slide-up
 * + inside-Modal Toast). It shows my identity, a scannable QR of my public invite
 * link (readable in a dark pub on a foam card), and share / copy actions so the
 * party can be grown at the table in under a minute.
 *
 * The invite code is minted/reused by the backend (GET /v1/friends/invite) and
 * carries only an opaque random code — never my account id or nickname. The
 * sheet is mounted only while open (parent conditionally renders it), so it
 * fetches the code exactly once per open and owns its own slide-out before
 * unmounting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { useRouter, type Href } from 'expo-router';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { useAfterModalDismiss } from '@/components/shared/useAfterModalDismiss';
import { CloseButton } from '@/components/shared/CloseButton';
import { CopyIcon } from '@/components/shared/IconGlyph';
import { Toast } from '@/components/shared/Toast';
import { fetchFriendInviteCode, type FriendInvite } from '@/data/friendsClient';
import { Avatar } from '@/profile/Avatar';
import { cs } from '@/i18n/cs';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { selectNickname, useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { useReduceMotion } from '@/utils/useReduceMotion';

import SkeletonBlock from './SkeletonBlock';

const QR_SIZE = 200;

interface CodeSheetProps {
  /** Fired once the sheet has finished sliding out (parent then unmounts it). */
  onClose: () => void;
}

function CodeSheet({ onClose }: CodeSheetProps): React.ReactElement {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const router = useRouter();
  const showToast = useToastStore((s) => s.show);

  const profile = useAccountStore((s) => s.profile);
  const nickname = useAccountStore(selectNickname);

  const [invite, setInvite] = useState<FriendInvite | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    const result = await fetchFriendInviteCode();
    if (!mountedRef.current) return;
    if (result) {
      setInvite(result);
    } else {
      setFailed(true);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // Defer off the synchronous effect pass (load()'s first setState resolves in
    // a scheduled task) so the compiler doesn't read it as a cascading render.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const [closing, setClosing] = useState(false);
  const afterModalDismiss = useAfterModalDismiss();
  const requestClose = useCallback(
    (afterClose?: () => void) => {
      if (closing) return;
      setClosing(true);
      afterModalDismiss(() => {
        onClose();
        afterClose?.();
      });
    },
    [afterModalDismiss, closing, onClose],
  );

  const link = invite?.webUrl || invite?.url || '';

  const handleQuickSend = useCallback(() => {
    if (!link) return;
    trackUiInteraction('friend_invite_share', 'share');
    void Share.share({ message: cs.friends.shareMessage(link) }).catch(() => {
      if (!mountedRef.current) return;
      showToast(cs.friends.shareError, {
        icon: <CopyIcon size={20} color={Colors.amber} />,
      });
    });
  }, [link, showToast]);

  return (
    <BottomSheetModal visible={!closing} onClose={() => requestClose()}>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />

          <View style={styles.headerRow}>
            <Text
              style={styles.title}
              numberOfLines={1}
              maxFontSizeMultiplier={FontScaleCap.heading}
            >
              {cs.friends.codeSheetTitle}
            </Text>
            <CloseButton onPress={() => requestClose()} label={cs.friends.settingsClose} />
          </View>

          <ScrollView style={styles.body} showsVerticalScrollIndicator={false} bounces={false}>
            {/* Identity */}
            <View style={styles.identity}>
              <Avatar
                uri={profile?.avatarUrl}
                nickname={profile?.nickname}
                displayName={profile?.displayName}
                size={76}
              />
              {nickname ? (
                <Text
                  style={styles.handleText}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.heading}
                >
                  {`@${nickname}`}
                </Text>
              ) : (
                <View style={styles.noNick}>
                  <Text style={styles.noNickText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.friends.codeNoNick}
                  </Text>
                  <Pressable
                    onPress={() => {
                      requestClose(() => router.push('/profile/edit' as Href));
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={cs.friends.codeNoNickCta}
                  >
                    <Text style={styles.noNickCta} maxFontSizeMultiplier={FontScaleCap.body}>
                      {cs.friends.codeNoNickCta}
                    </Text>
                  </Pressable>
                </View>
              )}
              {profile?.displayName ? (
                <Text
                  style={styles.displayName}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {profile.displayName}
                </Text>
              ) : null}
            </View>

            {/* QR on a foam card so it reads in a dark pub */}
            <View style={styles.qrWrap}>
              {loading ? (
                <SkeletonBlock
                  width={QR_SIZE}
                  height={QR_SIZE}
                  radius={Radius.small}
                  reduceMotion={reduceMotion}
                />
              ) : failed || !link ? (
                <View style={styles.qrFallback}>
                  <Text style={styles.offlineText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.friends.codeOffline}
                  </Text>
                  <Pressable
                    onPress={() => void load()}
                    style={({ pressed }) => [styles.retryPill, pressed && styles.pressedDim]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.friends.retry}
                  >
                    <Text style={styles.retryLabel} maxFontSizeMultiplier={FontScaleCap.heading}>
                      {cs.friends.retry}
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.qrCard}>
                  <QRCode
                    value={link}
                    size={QR_SIZE}
                    color={Colors.stout}
                    backgroundColor={Colors.foam}
                  />
                </View>
              )}
            </View>

            <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.friends.codeSheetHint}
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={handleQuickSend}
              disabled={!link}
              style={({ pressed }) => [styles.actionBtn, (pressed || !link) && styles.pressedDim]}
              accessibilityRole="button"
              accessibilityLabel={cs.friends.codeShare}
              accessibilityState={{ disabled: !link }}
            >
              <CopyIcon size={18} color={Colors.stout} />
              <Text
                style={styles.actionLabel}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {cs.friends.codeShare}
              </Text>
            </Pressable>
          </View>
        </View>

        <Toast />
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  cardWrap: { width: '100%', maxHeight: '92%' },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    ...softDrop(),
  },
  grabber: {
    alignSelf: 'center',
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    marginBottom: Spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flexShrink: 1,
    ...MockType.titleS,
    color: Colors.foam,
  },
  pressedDim: {
    opacity: 0.6,
  },
  body: {
    flexGrow: 0,
    flexShrink: 1,
    marginTop: Spacing.md,
  },
  identity: {
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  handleText: {
    fontWeight: '800',
    fontSize: 20,
    color: Colors.foam,
  },
  displayName: {
    fontWeight: '500',
    fontSize: 14,
    color: Colors.mutedText,
  },
  noNick: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  noNickText: {
    fontWeight: '500',
    fontSize: 14,
    color: withAlpha(Colors.amberLight, 0.9),
    textAlign: 'center',
  },
  noNickCta: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.amber,
  },
  qrWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: QR_SIZE + Spacing.lg * 2,
  },
  qrCard: {
    padding: Spacing.lg,
    borderRadius: Radius.card,
    backgroundColor: Colors.foam,
  },
  qrFallback: {
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.xl,
  },
  offlineText: {
    fontWeight: '500',
    fontSize: 14,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  retryPill: {
    minHeight: 40,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.6),
    backgroundColor: withAlpha(Colors.foam, 0.06),
    alignItems: 'center',
    justifyContent: 'center',
  },
  retryLabel: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.foamMuted,
  },
  hint: {
    marginTop: Spacing.lg,
    fontWeight: '500',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  actions: {
    paddingTop: Spacing.md,
    marginTop: Spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: HitArea.min,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  actionLabel: {
    fontWeight: '600',
    fontSize: 14,
    color: Colors.stout,
  },
});

export default CodeSheet;
