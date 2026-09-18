import { Pressable, StyleSheet } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { SearchIcon } from '@/components/shared/IconGlyph';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { HitArea } from '@/theme/layout';

export function PubSearchButton({ onPress }: { onPress?: () => void }) {
  const router = useRouter();
  return (
    <Pressable
      onPress={onPress ?? (() => router.push('/pub-search' as Href))}
      accessibilityRole="button"
      accessibilityLabel={t.pubSearch.open}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <SearchIcon size={20} color={Colors.foam} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  button: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.65 },
});
