/**
 * Font family names. Mapped to the actual TTF files in `assets/fonts/`
 * and loaded via `expo-font` in `app/_layout.tsx`.
 *
 * Baloo 2 — display, numbers, button labels. Heaviest weight is
 * ExtraBold (800); the Pencil design uses `fontWeight: 900` in some
 * places but Baloo 2 has no Black weight, so `black` aliases ExtraBold.
 *
 * Inter — UI text, captions.
 */

export const Fonts = {
  display: {
    regular: 'Baloo2-Regular',
    medium: 'Baloo2-Medium',
    semibold: 'Baloo2-SemiBold',
    bold: 'Baloo2-Bold',
    extrabold: 'Baloo2-ExtraBold',
    black: 'Baloo2-ExtraBold',
  },
  ui: {
    regular: 'Inter-Regular',
    medium: 'Inter-Medium',
    semibold: 'Inter-SemiBold',
    bold: 'Inter-Bold',
  },
} as const;

/**
 * The full map passed to `useFonts`. Keep this in sync with the .ttf files
 * sitting under `assets/fonts/`.
 */
export const fontAssets = {
  'Baloo2-Regular': require('../../assets/fonts/Baloo2-Regular.ttf'),
  'Baloo2-Medium': require('../../assets/fonts/Baloo2-Medium.ttf'),
  'Baloo2-SemiBold': require('../../assets/fonts/Baloo2-SemiBold.ttf'),
  'Baloo2-Bold': require('../../assets/fonts/Baloo2-Bold.ttf'),
  'Baloo2-ExtraBold': require('../../assets/fonts/Baloo2-ExtraBold.ttf'),
  'Inter-Regular': require('../../assets/fonts/Inter-Regular.ttf'),
  'Inter-Medium': require('../../assets/fonts/Inter-Medium.ttf'),
  'Inter-SemiBold': require('../../assets/fonts/Inter-SemiBold.ttf'),
  'Inter-Bold': require('../../assets/fonts/Inter-Bold.ttf'),
} as const;
