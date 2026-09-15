import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import AboutScreen from '@/about/AboutScreen';
import {
  DiscordIcon,
  InstagramIcon,
  LinkedinIcon,
} from '@/components/shared/BrandIcon';
import { cs } from '@/i18n/cs';
import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

const creatorLinks = [
  {
    key: 'instagram',
    label: cs.profile.creator.instagram,
    url: cs.profile.creator.instagramUrl,
    Icon: InstagramIcon,
  },
  {
    key: 'linkedin',
    label: cs.profile.creator.linkedin,
    url: cs.profile.creator.linkedinUrl,
    Icon: LinkedinIcon,
  },
  {
    key: 'discord',
    label: cs.profile.creator.discord,
    url: cs.profile.creator.discordUrl,
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
          {cs.profile.creator.header}
        </Text>
        <Text style={styles.followTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.profile.creator.title}
        </Text>
        <Text style={styles.followBody} maxFontSizeMultiplier={FontScaleCap.body}>
          {cs.profile.creator.subtitle}
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
    fontFamily: Fonts.ui.bold,
    fontSize: 10,
    letterSpacing: 1.3,
    color: Colors.amber,
    includeFontPadding: false,
  },
  followTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
    includeFontPadding: false,
  },
  followBody: {
    marginBottom: 4,
    fontFamily: Fonts.ui.regular,
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
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.foam,
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.7,
  },
});
