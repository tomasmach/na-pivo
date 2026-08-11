import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';

import { GlowButton } from '@/components/shared/GlowButton';
import { LinkIcon } from '@/components/shared/IconGlyph';
import { TAB_CHROME } from '@/components/shared/TabBar';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { fetchFriendInviteCode, type FriendInvite } from '@/data/friendsClient';
import { cs } from '@/i18n/cs';
import { MockLayout } from '@/mocks/mockTheme';
import { selectNeedsNickname, selectNickname, useAccountStore } from '@/stores/accountStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

import { AddFriendTools } from './AddFriendTools';
import { PartaScreenHeader } from './PartaScreenHeader';
import { usePartaDashboard } from './usePartaDashboard';

const QR_SIZE = 184;

export default function PartaAddScreen() {
  const insets = useSafeAreaInsets();
  const nickname = useAccountStore(selectNickname);
  const needsNickname = useAccountStore(selectNeedsNickname);
  const showToast = useToastStore((state) => state.show);
  const [invite, setInvite] = useState<FriendInvite | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(false);
  const mountedRef = useRef(true);
  const { reload } = usePartaDashboard();

  useEffect(() => () => { mountedRef.current = false; }, []);

  const loadInvite = useCallback(async () => {
    if (!nickname) return;
    setLoadingInvite(true);
    const result = await fetchFriendInviteCode();
    if (!mountedRef.current) return;
    setInvite(result);
    setLoadingInvite(false);
  }, [nickname]);

  useEffect(() => {
    const timer = setTimeout(() => void loadInvite(), 0);
    return () => clearTimeout(timer);
  }, [loadInvite]);

  const shareInvite = useCallback(async () => {
    const link = invite?.webUrl || invite?.url || '';
    if (!link) {
      showToast(cs.friends.codeOffline);
      return;
    }
    await Share.share({ message: cs.friends.shareMessage(link) });
  }, [invite, showToast]);

  const link = invite?.webUrl || invite?.url || '';

  return (
    <View style={[styles.root, { paddingTop: insets.top + Spacing.sm }]}>
      <PartaScreenHeader title={cs.friends.addPeopleTitle} />
      <KeyboardAwareScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + TAB_CHROME }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {nickname ? (
          <>
            <Text style={styles.codeTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {cs.friends.codeSheetTitle}
            </Text>
            <View style={styles.qrWrap}>
              {loadingInvite ? (
                <ActivityIndicator color={Colors.amber} size="large" />
              ) : link ? (
                <View style={styles.qrCard}>
                  <QRCode value={link} size={QR_SIZE} color={Colors.stout} backgroundColor={Colors.foam} />
                </View>
              ) : (
                <GlowButton
                  label={cs.friends.retry}
                  onPress={() => void loadInvite()}
                  variant="secondary"
                  glow="none"
                  height={48}
                />
              )}
            </View>
            <GlowButton
              label={cs.friends.codeShare}
              onPress={() => void shareInvite()}
              variant="primary"
              glow="none"
              icon={<LinkIcon size={18} color={Colors.stout} />}
            />
            <View style={styles.sectionBreak} />
          </>
        ) : null}
        <AddFriendTools
          hasIdentity={nickname != null}
          needsNickname={needsNickname}
          onOpenCode={() => undefined}
          onChanged={reload}
          showSearch
          showInviteActions={false}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: MockLayout.screenPad, backgroundColor: Colors.stout },
  content: { paddingTop: Spacing.xl },
  codeTitle: { color: Colors.foam, fontSize: 20, fontWeight: '800', marginBottom: Spacing.lg },
  qrWrap: { minHeight: QR_SIZE + Spacing.lg * 2, alignItems: 'center', justifyContent: 'center' },
  qrCard: { padding: Spacing.lg, borderRadius: Radius.card, backgroundColor: Colors.foam },
  sectionBreak: {
    height: 10,
    marginHorizontal: -MockLayout.screenPad,
    marginTop: Spacing.xl,
    marginBottom: Spacing.xl,
    backgroundColor: '#0F0A05',
  },
});
