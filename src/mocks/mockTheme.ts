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
  /** Card corner. Packeta uses 12 / 16 / 24 / 40; we sit softer than that. */
  cardRadius: 28,
  /** Pictogram thumbnail in a row. */
  thumb: 48,
  thumbRadius: 16,
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
 * True-dark surfaces. The brown moved OUT of the background and INTO the light.
 *
 * Until now the app's ground was `stout #1F1308` — a warm brown panel. Against
 * Strava and Packeta, which both sit on near-black, that brown is what made
 * every screen read as tinted rather than deep. So the ground goes neutral and
 * almost black, and the brown survives only as a gradient at the top of a
 * screen — light falling on the room, not paint on the walls.
 *
 * Adopting this for real means rewriting §2.1 of the design system; these
 * tokens are mock-scoped until that call is made.
 */
export const MockColors = {
  /** Screen ground. Deep and almost neutral — but never black: pure black on a
   *  warm-accented app reads as a void, and OLED smear on scroll is worse than
   *  the tint it saves. A hair of warmth keeps it Na pivo without being brown. */
  bg: '#15120F',
  /** Card / raised surface. */
  surface: '#1C1815',
  /** Nested element inside a card: row, chip, thumbnail well. */
  surfaceHigh: '#262019',
  /** The one accent — unchanged, it is the brand. */
  accent: '#E8A317',
  /** A running session. The only time the app changes colour. */
  live: '#35D07F',
} as const;

/**
 * The brown answer to Packeta's pink header shader
 * (`#FFEBEC → #FCAAAF → #FF6F79`): a warm glow at the very top of a screen that
 * fades into the ground. Stops go top → bottom.
 *
 * Per design-system §16.2 this is chrome, not an ambient halo behind content —
 * it lives in the header band and nowhere else, and it never sits under a
 * number you have to read.
 */
export const HEADER_GRADIENT = ['#5A3418', '#2A1A0C', MockColors.bg] as const;

/**
 * The same band while a session is running. A night in progress is the one
 * state worth recolouring the whole screen for — you should be able to tell
 * across the table, at a glance, that the counter is live.
 */
export const LIVE_GRADIENT = ['#0F4429', '#122A1B', MockColors.bg] as const;
