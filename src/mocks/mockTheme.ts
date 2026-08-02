/**
 * DESIGN MOCK — Packeta's structure, Na pivo's colour.
 *
 * Lifted 1:1 from `~/Development/projects/Packeta/PacketaApp/DESIGN.md` and
 * `MEASUREMENTS.md` (Figma source of truth, 402pt design width), with the
 * palette remapped: where Packeta is red on warm light, Na pivo is amber on
 * stout, and the pink header shader becomes a brown one.
 *
 * The mapping, explicitly:
 *
 *   Packeta                          Na pivo
 *   Brand/Primary   #BF000D     →    Colors.amber   #E8A317
 *   Surface/Background #EAE8E2   →    Colors.stout   #1F1308
 *   Surface/Primary #F4F3F0      →    Colors.stout2  #2B1A0E
 *   Card/Off-White  #FDFDFC      →    Colors.stout3  #3A2515
 *   Text/Primary    #343222      →    Colors.foam
 *   Text/Secondary  #6B695F      →    Colors.mutedText
 *   Header shader   pink         →    HEADER_GRADIENT (brown)
 *
 * What matters more than the colour is the SHAPE, and this is where the first
 * pass was wrong: Packeta's section headers are 18pt Bold in sentence case, not
 * 11pt uppercase with letter-spacing. Uppercase micro-kickers are a Tácek habit
 * and they are most of what still made the mocks read as the current app.
 */

import { Colors } from '@/theme/colors';

export const MockType = {
  /** Screen title, top left. Packeta `titleXL`. */
  titleXL: { fontSize: 30, fontWeight: '700' as const, letterSpacing: -0.5 },
  /** Section header. Packeta `titleS` — sentence case, never uppercase. */
  titleS: { fontSize: 18, fontWeight: '700' as const, letterSpacing: -0.2 },
  /** Row title. */
  body: { fontSize: 16, fontWeight: '500' as const },
  bodySemibold: { fontSize: 16, fontWeight: '600' as const },
  /** Row subtitle / secondary line. */
  bodySmall: { fontSize: 14, fontWeight: '500' as const },
  /** Capsule and caption text. */
  label: { fontSize: 12, fontWeight: '600' as const },
  buttonLabel: { fontSize: 16, fontWeight: '700' as const },
} as const;

export const MockLayout = {
  /**
   * Screen padding. 20, not 16 — at 16 the content sat right on the edge of a
   * dark screen and every list read as tighter than it is.
   */
  screenPad: 20,
  /** Vertical gap between top-level sections. */
  sectionGap: 32,
  /** Internal gap inside a section. */
  sectionInnerGap: 12,
  /**
   * Air above a control that follows a heading — a tab row under a large title,
   * a filter row under a section. Baked into the shared controls rather than
   * re-added per screen, because that is exactly what kept getting forgotten.
   */
  controlGap: 24,
  /** Card corner. Packeta uses 12 / 16 / 24 / 40; we sit softer than that. */
  cardRadius: 28,
  /** Pictogram thumbnail in a row. */
  thumb: 48,
  thumbRadius: 16,
  /** Filter pills and row action pills. Deliberately small: a filter row is
   *  navigation furniture sitting under a heading, and at 40pt it competed with
   *  the content it was meant to filter. */
  pillHeight: 32,
  /** CTA inside a card. */
  buttonHeight: 48,
  /** CTA in a sheet. */
  sheetButtonHeight: 56,
  /** A standard list row (pictogram + two lines + action). */
  rowHeight: 68,
} as const;

/**
 * Kept as an alias, not a second palette.
 *
 * These used to hold their own hexes while the darker ground was still a
 * proposal. It was accepted (§2.1), so `Colors` carries it and this exists only
 * so the mocks' call sites keep reading. New code should use `Colors` directly.
 */
export const MockColors = {
  /** Screen ground. */
  bg: Colors.stout,
  /** Card / raised surface. */
  surface: Colors.stout2,
  /** Nested element inside a card: row, chip, thumbnail well. */
  surfaceHigh: Colors.stout3,
  /** The one accent — it is the brand. */
  accent: Colors.amber,
  /** A running session. The only time the app changes colour. */
  live: '#35D07F',
} as const;

export const HEADER_GRADIENT = ['#5A3418', '#2A1A0C', MockColors.bg] as const;

/**
 * The same band while a session is running. A night in progress is the one
 * state worth recolouring the whole screen for — you should be able to tell
 * across the table, at a glance, that the counter is live.
 */
export const LIVE_GRADIENT = ['#0F4429', '#122A1B', MockColors.bg] as const;
