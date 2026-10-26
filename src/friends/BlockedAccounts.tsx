import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { FriendProfile } from '@/data/friendsClient';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Spacing } from '@/theme/layout';

import { FriendMini, friendDisplayName } from './FriendMini';
import HairlineRow from './HairlineRow';
import SectionHeader from './SectionHeader';

interface BlockedAccountsProps {
  accounts: FriendProfile[];
  onUnblock: (account: FriendProfile) => void;
}

export function BlockedAccounts({ accounts, onUnblock }: BlockedAccountsProps) {
  return (
    <View>
      <SectionHeader label={t.friends.blockedHeader} />
      {accounts.map((account, i) => (
        <HairlineRow key={account.id} first={i === 0}>
          <View style={styles.row}>
            <FriendMini profile={account} />
            <Pressable
              onPress={() => onUnblock(account)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t.friends.unblockTitle(friendDisplayName(account))}
              style={({ pressed }) => [styles.unblock, pressed && styles.dim]}
            >
              <Text style={styles.unblockText} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.friends.unblockAction}
              </Text>
            </Pressable>
          </View>
        </HairlineRow>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  unblock: {
    minHeight: HitArea.min,
    justifyContent: 'center',
  },
  unblockText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.amber,
  },
  dim: {
    opacity: 0.65,
  },
});

export default BlockedAccounts;
