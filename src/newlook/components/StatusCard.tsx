import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { C } from '../theme';
import type { IconName } from './Icon';
import { Button, T } from './ui';

/**
 * Empty, failed or still loading: one sentence and at most one action.
 * `reserve` keeps the action invisible but in place, so the card keeps its height when the real state arrives.
 */
export function StatusCard({
  text,
  action,
  actionIcon,
  onAction,
  reserve,
  style,
}: {
  text: string;
  action?: string;
  actionIcon?: IconName;
  onAction?: () => void;
  reserve?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ backgroundColor: C.card, borderRadius: 24, padding: 20, gap: 14 }, style]}>
      <T s={16} w={600} lh={1.35}>
        {text}
      </T>
      {action ? (
        <View
          pointerEvents={reserve ? 'none' : 'auto'}
          style={reserve ? { opacity: 0 } : null}
          accessibilityElementsHidden={reserve}
          importantForAccessibility={reserve ? 'no-hide-descendants' : 'auto'}
        >
          <Button label={action} icon={actionIcon} kind="raised" height={44} style={{ alignSelf: 'flex-start' }} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

/** Stand-in for content that is still loading, at the height of what will replace it. */
export function Ghost({ height, radius = 24, style }: { height: number; radius?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height, borderRadius: radius, backgroundColor: C.card, opacity: 0.6 }, style]} />;
}
