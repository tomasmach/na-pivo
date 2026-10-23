import { NativeTabs } from 'expo-router/native-tabs';
import { Platform } from 'react-native';

import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { t } from '@/i18n';
import { handleTabPress, partaBadge } from '@/navigation/tabs';
import { TabsInsetsRoot } from '@/navigation/TabScreen';
import { usePartaSignalStore } from '@/stores/partaSignalStore';

// iOS would inset only the first scroll view of each tab. Screens pad for the
// bar themselves via useBottomInset(); Android keeps its own wrapper, which
// ends the screen above the bar.
const SCREEN = {
  contentStyle: { backgroundColor: Colors.stout },
  disableAutomaticContentInsets: Platform.OS === 'ios',
};

// iOS always draws the badge text white, which amber cannot carry.
const BADGE_BACKGROUND = Platform.OS === 'ios' ? Colors.amberDeep : Colors.amber;

/**
 * The system tab bar, so iOS can place it where the device wants it (bottom
 * pill on iPhone, side rail on the folded iPhone Duo). The background, shadow
 * and inactive colors reach Android and iOS before 26; iOS 26 draws its own glass.
 * Icons are the Lucide glyphs as template PNGs, tinted by the bar.
 */
export default function TabsLayout() {
  const pendingRequests = usePartaSignalStore((s) => s.pendingRequests);
  const unread = usePartaSignalStore((s) => s.unread);
  const liveNow = usePartaSignalStore((s) => s.liveNow);
  const badge = partaBadge(pendingRequests, unread, liveNow);

  return (
    <TabsInsetsRoot>
      <NativeTabs
        tintColor={Colors.amber}
        iconColor={{ default: Colors.mutedText, selected: Colors.amber }}
        labelStyle={{
          default: { color: Colors.mutedText, fontFamily: Fonts.display.bold, fontSize: 12 },
          selected: { color: Colors.amber },
        }}
        backgroundColor={Colors.stout2}
        shadowColor={Colors.border}
        disableTransparentOnScrollEdge
        indicatorColor={Colors.stout3}
        badgeBackgroundColor={BADGE_BACKGROUND}
        badgeTextColor={Colors.stout}
        screenListeners={({ navigation, route }) => ({
          tabPress: () => handleTabPress(route.name, navigation.isFocused()),
        })}
      >
        <NativeTabs.Trigger name="index" testID="tab-index" accessibilityLabel={t.a11y.tabCompass} {...SCREEN}>
          <NativeTabs.Trigger.Icon src={require('../../assets/images/tabs/compass.png')} renderingMode="template" />
          <NativeTabs.Trigger.Label>{t.tabs.compass}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="beer" testID="tab-beer" accessibilityLabel={t.a11y.tabBeer} {...SCREEN}>
          <NativeTabs.Trigger.Icon src={require('../../assets/images/tabs/beer.png')} renderingMode="template" />
          <NativeTabs.Trigger.Label>{t.tabs.beer}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
        <NativeTabs.Trigger
          name="friends"
          testID="tab-friends"
          accessibilityLabel={
            pendingRequests > 0 ? t.a11y.tabFriendsBadge(pendingRequests) : t.a11y.tabFriends
          }
          {...SCREEN}
        >
          <NativeTabs.Trigger.Icon src={require('../../assets/images/tabs/users.png')} renderingMode="template" />
          <NativeTabs.Trigger.Label>{t.tabs.friends}</NativeTabs.Trigger.Label>
          {badge === null ? null : badge ? (
            <NativeTabs.Trigger.Badge>{badge}</NativeTabs.Trigger.Badge>
          ) : (
            <NativeTabs.Trigger.Badge />
          )}
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="profile" testID="tab-profile" accessibilityLabel={t.a11y.tabProfile} {...SCREEN}>
          <NativeTabs.Trigger.Icon src={require('../../assets/images/tabs/user.png')} renderingMode="template" />
          <NativeTabs.Trigger.Label>{t.tabs.profile}</NativeTabs.Trigger.Label>
        </NativeTabs.Trigger>
      </NativeTabs>
    </TabsInsetsRoot>
  );
}
