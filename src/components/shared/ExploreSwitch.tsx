import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompassIcon, MapIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';

type ExploreView = 'compass' | 'map';

interface ExploreSwitchProps {
  activeView: ExploreView;
  onSelectCompass: () => void;
  onSelectMap: () => void;
}

export function ExploreSwitch({
  activeView,
  onSelectCompass,
  onSelectMap,
}: ExploreSwitchProps) {
  return (
    <View style={styles.container} accessibilityRole="tablist">
      <Segment
        active={activeView === 'compass'}
        icon="compass"
        label={cs.map.compass}
        accessibilityLabel={
          activeView === 'compass' ? cs.a11y.mapSwitchCompassSelected : cs.a11y.mapSwitchCompass
        }
        onPress={onSelectCompass}
      />
      <Segment
        active={activeView === 'map'}
        icon="map"
        label={cs.map.map}
        accessibilityLabel={
          activeView === 'map' ? cs.a11y.mapSwitchMap : cs.a11y.mapSwitchToMap
        }
        onPress={onSelectMap}
      />
    </View>
  );
}

function Segment({
  active,
  icon,
  label,
  accessibilityLabel,
  onPress,
}: {
  active: boolean;
  icon: ExploreView;
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
}) {
  const Icon = icon === 'compass' ? CompassIcon : MapIcon;

  return (
    <Pressable
      onPress={onPress}
      disabled={active}
      style={({ pressed }) => [
        styles.segment,
        active && styles.segmentActive,
        pressed && styles.pressed,
      ]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active, disabled: active }}
      accessibilityLabel={accessibilityLabel}
    >
      <Icon size={15} color={active ? Colors.foam : Colors.mutedText} />
      <Text
        style={[styles.label, active && styles.labelActive]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 44,
    padding: 3,
    borderRadius: Radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: withAlpha(Colors.stout, 0.94),
    borderWidth: 1,
    borderColor: withAlpha(Colors.foam, 0.16),
    shadowColor: Colors.black,
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
  },
  segment: {
    minWidth: 94,
    height: 36,
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  // Unlit on purpose: this switch floats over the map, which already carries
  // one amber button. A filled amber segment made two amber surfaces compete
  // — §14.2, the same mistake the three-segment beer tab once had.
  segmentActive: {
    backgroundColor: withAlpha(Colors.foam, 0.1),
  },
  label: {
    fontFamily: Fonts.ui.bold,
    color: Colors.foamMuted,
    fontSize: 13,
  },
  labelActive: {
    color: Colors.foam,
  },
  pressed: {
    opacity: 0.76,
    transform: [{ scale: 0.98 }],
  },
});
