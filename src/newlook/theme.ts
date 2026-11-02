import { StyleSheet, type TextStyle } from 'react-native';

// Values copied from the np-* variables of na-pivo-redesign.pen (dark mode).
export const C = {
  bg: '#0A0A0A',
  card: '#151515',
  dialog: '#161616',
  toast: '#262626',
  control: '#232323',
  yellow: '#FFC400',
  white: '#F7F7F2',
  text2: '#D4D4CE',
  muted: '#8F8F8A',
  dim: '#FFFFFF8C',
  hairline: '#FFFFFF1A',
  open: '#FFD54F',
  glass: '#2A2A2A61',
  glassFallback: '#1E1E1EF2',
  glassText: '#FFFFFFE6',
  ring: '#FFFFFF24',
  avatarBase: '#141414',
  danger: '#FF6B5E',
  scrim: '#000000A6',
  black: '#0A0A0A',
  onYellowMuted: '#0A0A0AB3',
} as const;

export const FontFiles = {
  'SofiaSans-Regular': require('../../assets/fonts/SofiaSans-Regular.ttf'),
  'SofiaSans-Medium': require('../../assets/fonts/SofiaSans-Medium.ttf'),
  'SofiaSans-SemiBold': require('../../assets/fonts/SofiaSans-SemiBold.ttf'),
  'SofiaSans-Bold': require('../../assets/fonts/SofiaSans-Bold.ttf'),
  'SofiaSans-ExtraBold': require('../../assets/fonts/SofiaSans-ExtraBold.ttf'),
  'SofiaSans-Black': require('../../assets/fonts/SofiaSans-Black.ttf'),
  'SofiaSansExtraCondensed-ExtraBold': require('../../assets/fonts/SofiaSansExtraCondensed-ExtraBold.ttf'),
  'CaveatRoman-Bold': require('../../assets/fonts/Caveat-Bold.ttf'),
} as const;

export type Weight = 400 | 500 | 600 | 700 | 800 | 900;

const TEXT_FONT: Record<Weight, string> = {
  400: 'SofiaSans-Regular',
  500: 'SofiaSans-Medium',
  600: 'SofiaSans-SemiBold',
  700: 'SofiaSans-Bold',
  800: 'SofiaSans-ExtraBold',
  900: 'SofiaSans-Black',
};

export const DISPLAY_FONT = 'SofiaSansExtraCondensed-ExtraBold';
export const HAND_FONT = 'CaveatRoman-Bold';

/** Sofia Sans at a size and weight. */
export function font(size: number, weight: Weight = 400, color: string = C.white): TextStyle {
  return { fontFamily: TEXT_FONT[weight], fontSize: size, color };
}

/** iOS clips glyphs that rise above the line box, so a tighter design line height becomes negative margins. */
const DISPLAY_MIN_LINE = 1.15;

/** Sofia Sans Extra Condensed, the numbers and headline face. */
export function display(size: number, color: string = C.white, lineHeight = 1.05): TextStyle {
  const line = Math.max(lineHeight, DISPLAY_MIN_LINE);
  const trim = Math.round((size * (line - lineHeight)) / 2);
  return { fontFamily: DISPLAY_FONT, fontSize: size, color, lineHeight: Math.round(size * line), marginVertical: -trim };
}

export const shadow = {
  raised: { boxShadow: 'inset 0 1px 0 #FFFFFF29, 0 6px 14px #00000073' },
  primary: { boxShadow: 'inset 0 1px 0 #FFFFFF73, 0 6px 16px #00000059' },
  glass: { boxShadow: 'inset 0 1px 2px #FFFFFF33, 0 10px 28px #00000073' },
  soft: { boxShadow: '0 2px 8px #00000066' },
} as const;

export const SCREEN_X = 20;
export const TAB_BAR_HEIGHT = 64;

export const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  fill: { flex: 1 },
  hairline: { height: StyleSheet.hairlineWidth, backgroundColor: C.hairline },
});
