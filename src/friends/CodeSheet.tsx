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
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { useRouter, type Href } from 'expo-router';

import { CopyIcon, LinkIcon, XIcon } from '@/components/shared/IconGlyph';
import { Toast } from '@/components/shared/Toast';
import { fetchFriendInviteCode, type FriendInvite } from '@/data/friendsClient';
import { Avatar } from '@/profile/Avatar';
import { cs } from '@/i18n/cs';
import { selectNickname, useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import { useReduceMotion } from '@/utils/useReduceMotion';

import SkeletonBlock from './SkeletonBlock';

const SLIDE_SPRING = { damping: 18, stiffness: 180, mass: 0.9 } as const;
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

  // ── Card slide-up (clone of FriendSettingsSheet); own the slide-out too. ──
  // The shared value is written ONLY inside the effect (keyed on `closing`), the
  // pattern the compiler's immutability rule accepts.
  const [closing, setClosing] = useState(false);
  const progress = useSharedValue(0);
  useEffect(() => {
    if (closing) {
      progress.value = withTiming(0, { duration: reduceMotion ? 0 : 140 });
    } else {
      progress.value = reduceMotion ? withTiming(1, { duration: 0 }) : withSpring(1, SLIDE_SPRING);
    }
  }, [closing, reduceMotion, progress]);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, reduceMotion ? 0 : 150);
  }, [closing, onClose, reduceMotion]);

  const cardAnim = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 48 }],
  }));

  const link = invite?.webUrl || invite?.url || '';

  const handleShare = useCallback(() => {
    if (!link) return;
    void Share.share({ message: cs.friends.shareMessage(link) });
  }, [link]);

  const handleQuickSend = useCallback(() => {
    if (!link) return;
    void Share.share({ message: cs.friends.shareMessage(link) }).catch(() => {
      if (!mountedRef.current) return;
      showToast(cs.friends.shareError, { icon: <CopyIcon size={20} color={Colors.amber} /> });
    });
  }, [link, showToast]);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={requestClose}>
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={requestClose}
          accessibilityRole="button"
          accessibilityLabel={cs.friends.settingsClose}
        />

        <Animated.View
          style={[styles.card, softDrop(), { paddingBottom: Math.max(insets.bottom, Spacing.md) }, cardAnim]}
        >
          <View style={styles.handle} />

          <View style={styles.headerRow}>
            <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.friends.codeSheetTitle}
            </Text>
          </View>

          <Pressable
            onPress={requestClose}
            hitSlop={12}
            style={({ pressed }) => [styles.closeBtn, pressed && styles.pressedDim]}
            accessibilityRole="button"
            accessibilityLabel={cs.friends.settingsClose}
          >
            <XIcon size={18} color={Colors.foamMuted} />
          </Pressable>

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
                <Text style={styles.handleText} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {`@${nickname}`}
                </Text>
              ) : (
                <View style={styles.noNick}>
                  <Text style={styles.noNickText} maxFontSizeMultiplier={FontScaleCap.body}>
                    {cs.friends.codeNoNick}
                  </Text>
                  <Pressable
                    onPress={() => {
                      requestClose();
                      router.push('/profile/edit' as Href);
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
                <Text style={styles.displayName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {profile.displayName}
                </Text>
              ) : null}
            </View>

            {/* QR on a foam card so it reads in a dark pub */}
            <View style={styles.qrWrap}>
              {loading ? (
                <SkeletonBlock width={QR_SIZE} height={QR_SIZE} radius={Radius.small} reduceMotion={reduceMotion} />
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
                  <QRCode value={link} size={QR_SIZE} color={Colors.stout} backgroundColor={Colors.foam} />
                </View>
              )}
            </View>

            <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.friends.codeSheetHint}
            </Text>

            {/* Actions */}
            <View style={styles.actions}>
              <Pressable
                onPress={handleShare}
                disabled={!link}
                style={({ pressed }) => [styles.actionBtn, (pressed || !link) && styles.pressedDim]}
                accessibilityRole="button"
                accessibilityLabel={cs.friends.codeShare}
              >
                <LinkIcon size={18} color={Colors.amber} />
                <Text style={styles.actionLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.friends.codeShare}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleQuickSend}
                disabled={!link}
                style={({ pressed }) => [styles.actionBtn, (pressed || !link) && styles.pressedDim]}
                accessibilityRole="button"
                accessibilityLabel={cs.friends.codeCopy}
              >
                <CopyIcon size={18} color={Colors.amber} />
                <Text style={styles.actionLabel} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.friends.codeCopy}
                </Text>
              </Pressable>
            </View>
          </ScrollView>
        </Animated.View>

        <Toast />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  card: {
    maxHeight: '90%',
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    marginBottom: Spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: HitArea.min,
  },
  title: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  closeBtn: {
    position: 'absolute',
    top: Spacing.sm,
    right: Spacing.sm,
    width: HitArea.min,
    height: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressedDim: {
    opacity: 0.6,
  },
  body: {
    flexShrink: 1,
    marginTop: Spacing.md,
  },
  identity: {
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  handleText: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 20,
    color: Colors.foam,
  },
  displayName: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    color: Colors.mutedText,
  },
  noNick: {
    alignItems: 'center',
    gap: Spacing.xs,
  },
  noNickText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    color: withAlpha(Colors.amberLight, 0.9),
    textAlign: 'center',
  },
  noNickCta: {
    fontFamily: Fonts.display.semibold,
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
    fontFamily: Fonts.ui.medium,
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
    fontFamily: Fonts.display.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
  },
  hint: {
    marginTop: Spacing.lg,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  actions: {
    marginTop: Spacing.lg,
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    minHeight: HitArea.min,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.1),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.28),
  },
  actionLabel: {
    fontFamily: Fonts.display.semibold,
    fontSize: 14,
    color: Colors.amber,
  },
});

export default CodeSheet;
