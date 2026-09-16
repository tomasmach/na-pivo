import { ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlowButton } from '@/components/shared/GlowButton';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Spacing } from '@/theme/layout';

/** Old table links remain understandable after removing the shared-table feature. */
export default function LegacyTableInviteScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + Spacing.xl, paddingBottom: insets.bottom + Spacing.xl },
      ]}
    >
      <Text style={styles.message} maxFontSizeMultiplier={FontScaleCap.heading}>
        {t.friends.legacyTableUnavailable}
      </Text>
      <GlowButton
        label={t.friends.claimBack}
        onPress={() => router.replace('/friends')}
        variant="secondary"
        glow="none"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.xl,
  },
  message: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    lineHeight: 30,
    color: Colors.foam,
    textAlign: 'center',
  },
});
