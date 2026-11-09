import React from 'react';
import { ActionSheetIOS, View, useWindowDimensions } from 'react-native';

import { t } from '@/i18n';

import { GlassButton, tabBarBottom } from '../components/chrome';
import { useBook, useWindowInsets, type RailSide } from './layout';
import type { ColumnAction, ColumnBackItem } from './paneContext';

const BACK = 52;
const ACTION = 44;
const GAP = 8;
// Where the status bar ends in the column, measured on the iPhone Duo simulator (iOS 27.1):
// folded the camera sits above the clock, open as a book the clock starts at the top.
const BELOW_STATUS_FOLDED = 160;
const BELOW_STATUS_BOOK = 108;
// The standing tab bar: two pills of two 58 pt tabs with 5 pt padding, the 64 pt circle and two 8 pt gaps.
const RAIL_HEIGHT = 2 * (2 * 58 + 10) + 64 + 2 * GAP;

/**
 * The iPhone Duo's toolbar in the side column: Back first under the clock,
 * then the screen's actions. Actions that do not fit above the tab bar go to
 * a "…" that opens the system's action sheet, as the system's toolbar does.
 */
export function ColumnToolbar({
  side,
  back,
  actions,
  besideTabs,
}: {
  side: RailSide;
  back: ColumnBackItem | null;
  actions: ColumnAction[];
  /** The tab bar stands in the column too, so the toolbar stops above it. */
  besideTabs: boolean;
}) {
  const insets = useWindowInsets();
  const { book } = useBook();
  const { height } = useWindowDimensions();
  const column = side === 'right' ? insets.right : insets.left;
  const top = book ? BELOW_STATUS_BOOK : BELOW_STATUS_FOLDED;
  const bottom = height - (besideTabs ? tabBarBottom(insets.bottom) + RAIL_HEIGHT + 2 * GAP : Math.max(insets.bottom, 16));
  const room = Math.max(0, Math.floor((bottom - top - (back ? BACK + GAP : 0) + GAP) / (ACTION + GAP)));
  const fits = actions.length <= room;
  const shown = fits ? actions : actions.slice(0, Math.max(0, room - 1));
  const rest = fits ? [] : actions.slice(shown.length);
  const more = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { options: [...rest.map((a) => a.menuLabel ?? a.label), t.nv.kompas.cancel], cancelButtonIndex: rest.length, userInterfaceStyle: 'dark' },
      (i) => rest[i]?.onPress(),
    );
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top, [side]: 0, width: column, alignItems: 'center', gap: GAP }}>
      {back ? <GlassButton icon={back.icon} size={BACK} label={back.icon === 'x' ? t.nv.common.close : t.nv.profil.chrome.back} onPress={back.onPress} /> : null}
      {shown.map((action) => (
        <GlassButton key={`${action.icon}-${action.label}`} icon={action.icon} size={ACTION} label={action.label} color={action.color} onPress={action.onPress} />
      ))}
      {rest.length ? <GlassButton icon="ellipsis" size={ACTION} label={t.nv.kompas.more} onPress={more} /> : null}
    </View>
  );
}
