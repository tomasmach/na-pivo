/**
 * VycepTeaser — the Parta-hero entry into the Výčep feed, sitting under the
 * FotoPivař strip in the same visual language. Static lure on purpose: the
 * feed itself is one tap away and a fetch here would double the Parta tab's
 * request fan-out for a single subtitle.
 */

import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';

import { ChevronRightIcon, HandPlatterIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

export function VycepTeaser() {
  const router = useRouter();

  const open = useCallback(() => {
    router.push('/vycep' as Href);
  }, [router]);

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={cs.a11y.vycepLink}
      style={({ pressed }) => [styles.strip, pressed && styles.pressed]}
    >
      <View style={styles.iconWell}>
        <HandPlatterIcon size={20} color={Colors.amber} />
      </View>
      <View style={styles.textCol}>
        <Text style={styles.title} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.vycep.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.vycep.teaserSubtitle}
        </Text>
      </View>
      <ChevronRightIcon size={18} color={Colors.mutedText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.55),
    backgroundColor: withAlpha(Colors.stout2, 0.88),
  },
  pressed: {
    opacity: 0.7,
  },
  iconWell: {
    width: 40,
    height: 40,
    borderRadius: Radius.medium,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.amber, 0.12),
  },
  textCol: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontFamily: Fonts.display.bold,
    fontSize: 15,
    color: Colors.foam,
  },
  subtitle: {
    marginTop: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 12.5,
    color: Colors.foamMuted,
  },
});
