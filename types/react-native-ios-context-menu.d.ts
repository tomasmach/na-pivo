/**
 * `react-native-ios-context-menu` 3.2.1 ships without a built `lib/` directory,
 * so `main` (`lib/commonjs/index`) resolves to nothing for TypeScript. Metro is
 * fine — the package's `react-native` field points at `src/index` — but tsc
 * needs the shape declared. Only the slice we actually call is typed here.
 *
 * This is the same workaround the Spendee app carries in its `globals.d.ts`.
 * Drop this file the day the package ships its build output.
 */
declare module 'react-native-ios-context-menu' {
  import { Component } from 'react';
  import { ViewProps } from 'react-native';

  type MenuState = 'on' | 'off' | 'mixed';

  interface MenuActionConfig {
    actionKey: string;
    actionTitle: string;
    actionSubtitle?: string;
    menuState?: MenuState;
    icon?: {
      type: 'IMAGE_SYSTEM';
      imageValue: { systemName: string };
    };
    menuAttributes?: string[];
  }

  interface MenuConfig {
    menuTitle: string;
    menuOptions?: string[];
    menuItems: (MenuActionConfig | MenuConfig)[];
  }

  interface OnPressMenuItemEvent {
    nativeEvent: {
      actionKey: string;
      actionTitle: string;
      menuState?: MenuState;
    };
  }

  interface ContextMenuViewProps extends ViewProps {
    menuConfig: MenuConfig;
    onPressMenuItem?: (event: OnPressMenuItemEvent) => void;
    /** Opens on a single tap instead of a long press — what a dropdown wants. */
    isMenuPrimaryAction?: boolean;
    children?: React.ReactNode;
  }

  export class ContextMenuView extends Component<ContextMenuViewProps> {}
  export class ContextMenuButton extends Component<ContextMenuViewProps> {}
  export type { MenuConfig, MenuActionConfig, OnPressMenuItemEvent, MenuState };
}
