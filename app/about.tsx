import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AboutScreen from '@/about/AboutScreen';
import {
  DiscordIcon,
  InstagramIcon,
  LinkedinIcon,
} from '@/components/shared/BrandIcon';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const creatorLinks = [
  {
    key: 'instagram',
    label: t.profile.creator.instagram,
    url: t.profile.creator.instagramUrl,
    Icon: InstagramIcon,
  },
  {
    key: 'linkedin',
    label: t.profile.creator.linkedin,
    url: t.profile.creator.linkedinUrl,
    Icon: LinkedinIcon,
  },
  {
    key: 'discord',
    label: t.profile.creator.discord,
    url: t.profile.creator.discordUrl,
    Icon: DiscordIcon,
  },
];

export default function AboutRoute() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <AboutScreen />
      <View
        style={[
          styles.follow,
          { paddingBottom: Math.max(insets.bottom, Spacing.sm) },
        ]}
      >
        <Text style={styles.followEyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.profile.creator.header}
        </Text>
        <Text style={styles.followTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {t.profile.creator.title}
        </Text>
        <Text style={styles.followBody} maxFontSizeMultiplier={FontScaleCap.body}>
          {t.profile.creator.subtitle}
        </Text>
        <View style={styles.links}>
          {creatorLinks.map(({ key, label, url, Icon }) => (
            <Pressable
              key={key}
              onPress={() => void Linking.openURL(url)}
              style={({ pressed }) => [styles.link, pressed && styles.pressed]}
              accessibilityRole="link"
              accessibilityLabel={label}
            >
              <Icon size={18} color={Colors.foam} />
              <Text
                style={styles.linkLabel}
                numberOfLines={1}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {label}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
  },
  follow: {
    gap: 4,
    paddingTop: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: Colors.stout2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  followEyebrow: {
    fontWeight: '700',
    fontSize: 10,
    letterSpacing: 1.3,
    color: Colors.amber,
    includeFontPadding: false,
  },
  followTitle: {
    fontWeight: '800',
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  followBody: {
    marginBottom: 4,
    fontWeight: '400',
    fontSize: 12,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  links: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  link: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.medium,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  linkLabel: {
    flexShrink: 1,
    fontWeight: '600',
    fontSize: 12,
    color: Colors.foam,
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.7,
  },
});
