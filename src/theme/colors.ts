/**
 * Color tokens extracted from the Pencil design file (na-pivo-design.pen).
 * Names mirror the `na-pivo-*` variables defined there.
 */

export const Colors = {
  // Backgrounds — deep and nearly neutral, the ground of the pub page (DESIGN.md §2.1).
  // Never pure black: on a warm-accented app that reads as a void.
  stout: '#15120F',
  stout2: '#1C1815',
  stout3: '#262019',
  border: '#3A322A',

  // Amber accent
  amber: '#E8A317',
  amberLight: '#F5B642',
  glow: '#FF7A1A',
  neon: '#FFD27A',

  // Text — foam / muted
  foam: '#FBF3E0',
  foamMuted: '#E8DCC0',
  mutedText: '#A8896A',

  // Status
  success: '#7DD66B',

  // Opening-hours status — hours-forward & warm, on the stout/amber palette
  open: '#F0BE5C', // warm foam-amber tone that sits beside the amber accent
  closed: '#A8896A', // muted clay/foam tone — calm, never an alarming red

  // Pure
  black: '#000000',
  white: '#FFFFFF',
} as const;

/**
 * Add an alpha channel to a 6-digit hex color. `alpha` is 0–1.
 */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const aHex = Math.round(a * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `${hex}${aHex}`;
}
