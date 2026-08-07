/**
 * DESIGN MOCK — getting the rest of the table in.
 *
 * Three doors, in the order they actually get used in a pub:
 *
 *   QR       the person is sitting opposite you — point a camera, done
 *   odkaz    the person is on their way — paste it in the group chat
 *   jména    the person is already your friend — one tap, no scanning
 *
 * The QR is real (`react-native-qrcode-svg`), not a drawn placeholder: a fake QR
 * is the one mock you cannot judge, because the whole question is whether it
 * scans across a dim table.
 *
 * The code is short and spoken-out-loud friendly, because the fourth door is
 * always someone reading it across the table.
 */

import React from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import QRCode from 'react-native-qrcode-svg';

import { CheckIcon, CopyIcon } from '@/components/shared/IconGlyph';
import { fetchFriendsDashboard, type FriendProfile } from '@/data/friendsClient';
import { Avatar } from '@/profile/Avatar';
import { useToastStore } from '@/stores/toastStore';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

export function InviteSheet({
  visible,
  present,
  code,
  link,
  onClose,
}: {
  visible: boolean;
  /** Who is already at the table — they get a tick instead of a button. */
  present: string[];
  /**
   * The real join code, or null while the evening is still being created.
   *
   * No placeholder: a code somebody reads across the table and that opens
   * nothing is worse than a moment of "zakládá se". This is the one thing in
   * the sheet that has to be true.
   */
  code: string | null;
  link: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((state) => state.show);
  const [friends, setFriends] = React.useState<FriendProfile[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  const loadFriends = React.useCallback((signal?: AbortSignal) => {
    setLoading(true);
    setFailed(false);
    void fetchFriendsDashboard(signal).then((dashboard) => {
      if (signal?.aborted) return;
      setLoading(false);
      if (!dashboard) {
        setFailed(true);
        return;
      }
      setFriends(dashboard.friends);
    });
  }, []);

  React.useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    const timer = setTimeout(() => loadFriends(controller.signal), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [visible, loadFriends]);

  const inviteMessage = React.useMemo(() => {
    if (!code) return null;
    return link
      ? `Přisedni ke stolu v Na pivo: ${link}\nKód: ${code}`
      : `Přisedni ke stolu v Na pivo. Kód: ${code}`;
  }, [code, link]);

  const shareLink = React.useCallback(() => {
    if (!inviteMessage) return;
    void Share.share({ message: inviteMessage });
  }, [inviteMessage]);

  const copyLink = React.useCallback(() => {
    if (!link) return;
    void Clipboard.setStringAsync(link).then(() => showToast('Odkaz je ve schránce.'));
  }, [link, showToast]);

  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Text
            style={styles.title}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            Přizvat ke stolu
          </Text>
          <CloseButton onPress={onClose} />
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingBottom: Math.max(insets.bottom, Spacing.lg),
          }}
          showsVerticalScrollIndicator={false}
        >
          {/* White quiet zone, because a QR on a dark surface is a QR that does
                not scan — the contrast has to be the code's, not the app's. */}
          <View style={styles.qrWrap}>
            {code ? (
              <>
                {link ? (
                  <View style={styles.qr}>
                    <QRCode
                      value={link}
                      size={148}
                      backgroundColor="#FFFFFF"
                      color="#000000"
                    />
                  </View>
                ) : null}
                <Text style={styles.code} allowFontScaling={false}>
                  {code}
                </Text>
                <Text
                  style={styles.codeHint}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {link
                    ? 'Nasnímej, nebo si kód přečti nahlas.'
                    : 'Přečti kód nahlas.'}
                </Text>
              </>
            ) : (
              <Text
                style={styles.codeHint}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                Kód se zakládá. Chvilku.
              </Text>
            )}
          </View>

          {link ? (
            <Pressable
              onPress={copyLink}
              style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Zkopírovat odkaz"
            >
              <Text
                style={styles.link}
                numberOfLines={1}
                allowFontScaling={false}
              >
                {link}
              </Text>
              <CopyIcon size={17} color={Colors.amber} />
            </Pressable>
          ) : null}

          <Text
            style={styles.section}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            Kamarádi
          </Text>
          {loading && friends.length === 0 ? (
            <ActivityIndicator color={Colors.amber} style={styles.loader} />
          ) : null}
          {failed ? (
            <Pressable onPress={() => loadFriends()} style={styles.retry} accessibilityRole="button">
              <Text style={styles.retryText}>Načíst znovu</Text>
            </Pressable>
          ) : null}
          {!loading && !failed && friends.length === 0 ? (
            <Text style={styles.empty}>V partě zatím nikdo není.</Text>
          ) : null}
          {friends.map((friend) => {
            const here = present.includes(friend.id);
            const name = friend.nickname ?? friend.displayName;
            return (
              <View key={friend.id} style={styles.friendRow}>
                <Avatar
                  uri={friend.avatarUrl}
                  nickname={friend.nickname}
                  displayName={friend.displayName}
                  size={34}
                  border="quiet"
                />
                <Text
                  style={styles.friendName}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {name}
                </Text>
                {here ? (
                  <View style={styles.hereRow}>
                    <CheckIcon size={15} color={Colors.amber} />
                    <Text style={styles.here} allowFontScaling={false}>
                      U stolu
                    </Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={shareLink}
                    style={({ pressed }) => [
                      styles.invite,
                      pressed && styles.pressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Poslat kód: ${name}`}
                  >
                    <Text style={styles.inviteText} allowFontScaling={false}>
                      Poslat kód
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.65 },

  card: {
    maxHeight: '86%',
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: MockLayout.cardRadius + 6,
    borderTopRightRadius: MockLayout.cardRadius + 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.foam, 0.14),
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: Spacing.sm,
  },
  title: { ...MockType.titleS, fontSize: 22, color: Colors.foam, flex: 1 },

  qrWrap: { alignItems: 'center', gap: 8, paddingVertical: Spacing.xl },
  qr: { padding: Spacing.md, borderRadius: 20, backgroundColor: '#FFFFFF' },
  code: {
    fontSize: 22,
    fontWeight: '800',
    color: Colors.foam,
    letterSpacing: 2,
    marginTop: Spacing.sm,
  },
  codeHint: { fontSize: 13, fontWeight: '400', color: Colors.mutedText },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 56,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    marginTop: Spacing.md,
  },
  link: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.foam },

  section: {
    ...MockType.titleS,
    color: Colors.foam,
    marginTop: MockLayout.sectionGap,
    marginBottom: Spacing.xs,
  },

  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 60,
  },
  friendName: { flex: 1, fontSize: 16, fontWeight: '600', color: Colors.foam },
  invite: {
    height: 38,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.14),
  },
  inviteText: { fontSize: 13, fontWeight: '700', color: Colors.amber },
  hereRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  here: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  loader: { marginVertical: Spacing.lg },
  retry: { alignSelf: 'flex-start', paddingVertical: Spacing.md },
  retryText: { fontSize: 14, fontWeight: '700', color: Colors.amber },
  empty: { paddingVertical: Spacing.lg, fontSize: 14, color: Colors.mutedText },
});
