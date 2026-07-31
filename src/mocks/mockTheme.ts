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
  /** Screen padding; content = screen − 32. */
  screenPad: 16,
  /** Vertical gap between top-level sections. */
  sectionGap: 32,
  /** Internal gap inside a section. */
  sectionInnerGap: 12,
  /** Card corner. Packeta uses 12 / 16 / 24 / 40; 24 is the card. */
  cardRadius: 24,
  /** Pictogram thumbnail in a row. */
  thumb: 48,
  thumbRadius: 12,
  /** Filter pills and row action pills. */
  pillHeight: 40,
  /** CTA inside a card. */
  buttonHeight: 48,
  /** CTA in a sheet. */
  sheetButtonHeight: 56,
  /** A standard list row (pictogram + two lines + action). */
  rowHeight: 68,
} as const;

/**
 * The brown answer to Packeta's pink header shader
 * (`#FFEBEC → #FCAAAF → #FF6F79`): a warm glow at the very top of a screen that
 * fades into the background. Stops go top → bottom.
 *
 * Per design-system §16.2 this is chrome, not an ambient halo behind content —
 * it lives in the header band and nowhere else.
 */
export const HEADER_GRADIENT = ['#4A2C12', '#33200E', '#1F1308'] as const;
