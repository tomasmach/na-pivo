import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { ChevronLeftIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea } from '@/theme/layout';

export function PartaScreenHeader({ title, trailing }: { title: string; trailing?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable
        onPress={() => (router.canGoBack() ? router.back() : router.replace('/friends'))}
        accessibilityRole="button"
        accessibilityLabel={t.a11y.backButton}
        hitSlop={8}
        style={({ pressed }) => [styles.side, pressed && styles.pressed]}
      >
        <ChevronLeftIcon size={26} color={Colors.foam} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
        {title}
      </Text>
      <View style={styles.side}>{trailing}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center' },
  side: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', color: Colors.foam, fontSize: 20, fontWeight: '800' },
  pressed: { opacity: 0.6 },
});
