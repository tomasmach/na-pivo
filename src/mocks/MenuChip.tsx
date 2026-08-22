/**
 * A filter chip that drops a real iOS menu out of itself.
 *
 * This is the control Spendee uses on "add transaction" — tap the pill, a UIMenu
 * unfurls FROM it, anchored, with a checkmark on the current answer. We had an
 * `ActionSheetIOS` instead: the same system component, but presented from the
 * bottom of the screen, which loses the one thing that makes the anchored menu
 * good — you can see what you are changing while you change it.
 *
 * The earlier attempt at this went through `react-native-ios-context-menu`, and
 * that failed to link: `ld: cannot link directly with 'SwiftUICore'`. Fixing it
 * meant building React from source (`RCT_USE_PREBUILT_RNCORE=0`), which is a
 * permanent tax on every clean build for one control. None of that is needed —
 * `@expo/ui` ships SwiftUI's own `Menu`, it is already in the Podfile, and it
 * links because Expo's module already handles the SwiftUI dependency.
 *
 * The options are a `Picker`, not a list of `Button`s: SwiftUI renders a picker
 * inside a menu as a checkmarked single-choice list, which is exactly what a
 * filter is, and it means the tick is drawn by the system rather than by us
 * guessing which row is current.
 *
 * Android has no SwiftUI host, so it uses the app's own bottom-sheet list.
 */

import React from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, HStack, Host, Image, Menu, Picker, Text as UIText } from '@expo/ui/swift-ui';
import {
  environment,
  font,
  foregroundStyle,
  glassEffect,
  padding,
  pickerStyle,
  tag,
} from '@expo/ui/swift-ui/modifiers';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { CheckIcon, ChevronDownIcon } from '@/components/shared/IconGlyph';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import { MODAL_DISMISS_MS } from '@/stores/launchModalMutex';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

/** Warm enough to read as ours, weak enough that it is still glass and not
 *  paint — §15.1: the material has to show what is behind it. */
const GLASS_TINT = withAlpha(Colors.amber, 0.12);
const IOS_MENU_CHIP_MIN_WIDTH = 112;

interface AndroidMenuItem {
  label: string;
  selected?: boolean;
  destructive?: boolean;
  onPress: () => void;
}

function useAndroidMenuVisibility() {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const unmountTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(
    () => () => {
      if (unmountTimer.current) clearTimeout(unmountTimer.current);
    },
    [],
  );
  const show = () => {
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    setMounted(true);
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    if (unmountTimer.current) clearTimeout(unmountTimer.current);
    unmountTimer.current = setTimeout(() => {
      unmountTimer.current = null;
      setMounted(false);
    }, MODAL_DISMISS_MS + 20);
  };
  return { open, mounted, show, hide };
}

function AndroidActionSheet({
  visible,
  title,
  items,
  onClose,
}: {
  visible: boolean;
  title: string;
  items: AndroidMenuItem[];
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <BottomSheetModal visible={visible} onClose={onClose}>
      <View style={[styles.sheetWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.sheetCard, { paddingBottom: insets.bottom + Spacing.md }]}>
          <View style={styles.sheetGrabber} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              {title}
            </Text>
            <CloseButton onPress={onClose} />
          </View>
          <ScrollView style={styles.sheetRows} showsVerticalScrollIndicator={false}>
            {items.map((item, index) => (
              <Pressable
                key={`${item.label}-${index}`}
                onPress={() => {
                  onClose();
                  item.onPress();
                }}
                style={({ pressed }) => [
                  styles.sheetRow,
                  index > 0 && styles.sheetRowBorder,
                  pressed && styles.pressed,
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: item.selected }}
                accessibilityLabel={item.label}
              >
                <Text
                  style={[styles.sheetRowText, item.destructive && styles.sheetRowDestructive]}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {item.label}
                </Text>
                {item.selected ? <CheckIcon size={18} color={Colors.amber} /> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </BottomSheetModal>
  );
}

function AndroidMenuChip({
  value,
  options,
  title,
  onChange,
}: {
  value: string;
  options: readonly string[];
  title: string;
  onChange: (next: string) => void;
}) {
  const menu = useAndroidMenuVisibility();
  return (
    <>
      <Pressable
        onPress={menu.show}
        style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${value}`}
      >
        <Text style={styles.chipText} maxFontSizeMultiplier={FontScaleCap.body}>
          {value}
        </Text>
        <ChevronDownIcon size={13} color={Colors.amber} />
      </Pressable>
      {menu.mounted ? (
        <AndroidActionSheet
          visible={menu.open}
          title={title}
          onClose={menu.hide}
          items={options.map((option) => ({
            label: option,
            selected: option === value,
            onPress: () => onChange(option),
          }))}
        />
      ) : null}
    </>
  );
}

export function MenuChip({
  value,
  options,
  title,
  onChange,
}: {
  value: string;
  options: readonly string[];
  /** The question the menu answers, shown as its header. */
  title: string;
  onChange: (next: string) => void;
}) {
  if (Platform.OS === 'ios') {
    // Fixed height, not bare `matchContents`: the SwiftUI host measured a hair
    // taller than the RN chips beside it, so the first chip sat a couple of
    // points off the row.
    return (
      <Host
        matchContents={{ horizontal: true }}
        // SwiftUI's first intrinsic-width pass can report zero inside a
        // horizontal RN ScrollView. Without a floor the following chip takes
        // its place and the menu label overflows past the left edge.
        style={{ height: MockLayout.pillHeight + 6, minWidth: IOS_MENU_CHIP_MIN_WIDTH }}
        colorScheme="dark"
        seedColor={Colors.amber}
      >
        <Menu
          modifiers={[environment('colorScheme', 'dark')]}
          // The label is composed in SwiftUI, not left as a bare string: a
          // string renders as text with a leading SF symbol and no chip at all,
          // which next to the app's own pills read as a broken control. This is
          // Spendee's shape — a liquid-glass capsule, the label, then a trailing
          // chevron — and being real glass it picks up whatever is behind it.
          label={
            <HStack
              spacing={5}
              modifiers={[
                padding({ horizontal: 14, vertical: 7 }),
                glassEffect({
                  glass: { variant: 'regular', interactive: true, tint: GLASS_TINT },
                  shape: 'capsule',
                }),
              ]}
            >
              <UIText modifiers={[font({ size: 13, weight: 'semibold' }), foregroundStyle(Colors.amber)]}>
                {value}
              </UIText>
              <Image systemName="chevron.down" size={10} color={Colors.amber} />
            </HStack>
          }
        >
          <Picker
            label={title}
            selection={value}
            onSelectionChange={(next) => {
              if (typeof next === 'string') onChange(next);
            }}
            modifiers={[pickerStyle('inline')]}
          >
            {options.map((option) => (
              <UIText key={option} modifiers={[tag(option)]}>
                {option}
              </UIText>
            ))}
          </Picker>
        </Menu>
      </Host>
    );
  }

  return <AndroidMenuChip value={value} options={options} title={title} onChange={onChange} />;
}

/**
 * The same anchored menu, but as a row affordance rather than a filter chip —
 * this is Spendee's "…" on a transaction: tap the glyph on the row and the
 * UIMenu unfurls FROM that row, with a destructive item at the bottom.
 *
 * It answers "can we use the Spendee context menu here" with: yes, but it has
 * to be a BUTTON in the row. SwiftUI's `Menu` draws its own label, so it can
 * anchor to a glyph we hand it — it cannot wrap an existing React Native row and
 * turn a long-press on it into a menu. That would need
 * `react-native-ios-context-menu`, which is the library that would not link.
 */
export function RowMenu({
  value,
  options,
  title,
  onChange,
  repeat,
  actions,
  destructive,
}: {
  value?: string;
  /** Omitted when there is nothing to choose between — a photo is a photo, and
   *  then the menu is just its actions. */
  options?: readonly string[];
  title: string;
  onChange?: (next: string) => void;
  /** The obvious thing to do with a beer you already had: have it again. */
  repeat?: { label: string; onPress: () => void };
  actions?: readonly { label: string; onPress: () => void }[];
  /** The one item that is not a choice — "Smazat". */
  destructive?: { label: string; onPress: () => void };
}) {
  if (Platform.OS === 'ios') {
    return (
      <Host matchContents style={{ height: HitArea.min }} colorScheme="dark" seedColor={Colors.amber}>
        <Menu
          modifiers={[environment('colorScheme', 'dark')]}
          label={
            <HStack modifiers={[padding({ horizontal: 8, vertical: 8 })]}>
              <Image systemName="ellipsis" size={17} color={Colors.mutedText} />
            </HStack>
          }
        >
          {repeat ? (
            <Button systemImage="plus" onPress={repeat.onPress}>
              <UIText>{repeat.label}</UIText>
            </Button>
          ) : null}
          {actions?.map((action) => (
            <Button key={action.label} onPress={action.onPress}>
              <UIText>{action.label}</UIText>
            </Button>
          ))}
          {options && options.length > 0 ? (
            <Picker
              label={title}
              selection={value}
              onSelectionChange={(next) => {
                if (typeof next === 'string') onChange?.(next);
              }}
              modifiers={[pickerStyle('inline')]}
            >
              {options.map((option) => (
                <UIText key={option} modifiers={[tag(option)]}>
                  {option}
                </UIText>
              ))}
            </Picker>
          ) : null}
          {destructive ? (
            <Button role="destructive" onPress={destructive.onPress}>
              <UIText>{destructive.label}</UIText>
            </Button>
          ) : null}
        </Menu>
      </Host>
    );
  }

  return (
    <AndroidRowMenu
      value={value}
      options={options}
      title={title}
      onChange={onChange}
      repeat={repeat}
      actions={actions}
      destructive={destructive}
    />
  );
}

function AndroidRowMenu({
  value,
  options,
  title,
  onChange,
  repeat,
  actions,
  destructive,
}: {
  value?: string;
  options?: readonly string[];
  title: string;
  onChange?: (next: string) => void;
  repeat?: { label: string; onPress: () => void };
  actions?: readonly { label: string; onPress: () => void }[];
  destructive?: { label: string; onPress: () => void };
}) {
  const menu = useAndroidMenuVisibility();
  const items: AndroidMenuItem[] = [
    ...(repeat ? [{ label: repeat.label, onPress: repeat.onPress }] : []),
    ...(actions ?? []),
    ...(options ?? []).map((option) => ({
      label: option,
      selected: option === value,
      onPress: () => onChange?.(option),
    })),
    ...(destructive
      ? [{ label: destructive.label, destructive: true, onPress: destructive.onPress }]
      : []),
  ];
  return (
    <>
      <Pressable
        onPress={menu.show}
        style={({ pressed }) => [styles.rowMenu, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={title}
        hitSlop={8}
      >
        <Text style={styles.rowMenuGlyph} allowFontScaling={false}>
          ···
        </Text>
      </Pressable>
      {menu.mounted ? (
        <AndroidActionSheet
          visible={menu.open}
          title={title}
          items={items}
          onClose={menu.hide}
        />
      ) : null}
    </>
  );
}

/** The plain toggle chip beside the menus — no menu, one bit of state. */
export function ToggleChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipOn, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Text
        style={[styles.chipText, !active && styles.chipTextOff]}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.65 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: MockLayout.pillHeight,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  chipOn: { borderColor: withAlpha(Colors.amber, 0.5) },
  rowMenu: { paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs },
  rowMenuGlyph: { fontSize: 17, fontWeight: '800', color: Colors.mutedText },
  chipText: { fontSize: 13, fontWeight: '600', color: Colors.amber },
  chipTextOff: { color: Colors.mutedText },
  sheetWrap: { width: '100%', maxHeight: '92%' },
  sheetCard: {
    flexShrink: 1,
    paddingTop: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
  },
  sheetGrabber: {
    width: 44,
    height: 4,
    alignSelf: 'center',
    marginBottom: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  sheetTitle: { ...MockType.titleS, flex: 1, color: Colors.foam },
  sheetRows: { flexShrink: 1 },
  sheetRow: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  sheetRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.12),
  },
  sheetRowText: { flex: 1, fontSize: 16, fontWeight: '600', color: Colors.foam },
  sheetRowDestructive: { color: Colors.amberLight },
});

/** Kept so screens can render the row without re-deriving the gap. */
export const CHIP_GAP = Spacing.xs;
export const ChipRow = View;
