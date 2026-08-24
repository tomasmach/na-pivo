import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CompassIcon, MapIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius } from '@/theme/layout';

type ExploreView = 'compass' | 'map';

interface ExploreSwitchProps {
  activeView: ExploreView;
  onSelectCompass: () => void;
  onSelectMap: () => void;
  /**
   * `floating` (default) is the pill that hovers over the map: opaque, bordered,
   * dropped. `flat` is the one that sits in the compass header — a plain
   * segmented track on the stout background, because there is nothing under it
   * that needs hiding and a shadowed pill in a header reads as a stray button.
   */
  variant?: 'floating' | 'flat';
}

export function ExploreSwitch({
  activeView,
  onSelectCompass,
  onSelectMap,
  variant = 'floating',
}: ExploreSwitchProps) {
  return (
    <View
      style={[styles.container, variant === 'flat' && styles.containerFlat]}
      accessibilityRole="tablist"
    >
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
      {/* Icon and label share one tone per state. An amber glyph on the inactive
          half pulled the eye, but next to the foam one it just read as two
          different kinds of button. The active fill says which is which. */}
      <Icon size={15} color={active ? Colors.foam : Colors.foamMuted} />
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
  // In a header there is nothing to hide behind the pill, so it stops being a
  // pill: the neutral segmented track from §2.2, foam at 4 % with an 8 % edge.
  containerFlat: {
    backgroundColor: withAlpha(Colors.foam, 0.04),
    borderColor: withAlpha(Colors.foam, 0.08),
    shadowOpacity: 0,
    shadowRadius: 0,
    elevation: 0,
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
    fontWeight: '700',
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
