/**
 * NightStoryCard — the night as a transparent Instagram-story sticker.
 *
 * The user shoots their own story photo; this renders die-cut lettering that
 * gets pasted on top (the Spotify-share model). The whole sticker is pure
 * typography in the style of an enamel pub sign: city + date curved along a
 * top arc, the beer count huge in amber, the pub crawl beneath, the wordmark
 * curved along a bottom arc. Every glyph carries a thick cream outline
 * (stroke drawn behind the fill), so it reads over any photo, dark taproom
 * or sunny beer garden, with no background boxes at all.
 *
 * Rendered as SVG so the outlines stay razor-crisp at export; the view has
 * no background and react-native-view-shot captures it as PNG with alpha.
 * Height is content-driven — the modal measures it via onLayout.
 */

import { forwardRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, G, Path, Text as SvgText, TextPath } from 'react-native-svg';

import { cs } from '@/i18n/cs';
import { Colors } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import type { NightSummary } from '@/vycep/nightModel';

/** Logical sticker width; capture upscales 3x to ~1080px. */
export const STICKER_WIDTH = 360;

const W = STICKER_WIDTH;
const CX = W / 2;
/** Longest pub-name that still fits the canvas at 21pt. */
const MAX_PUB_CHARS = 24;

const INK = Colors.stout;
const OUTLINE = Colors.foam;
const ACCENT = Colors.amber;

function fit(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > MAX_PUB_CHARS
    ? `${trimmed.slice(0, MAX_PUB_CHARS - 1).trimEnd()}…`
    : trimmed;
}

/** Text with a thick rounded outline drawn behind the fill (die-cut look). */
function OutlinedText(props: {
  x: number;
  y: number;
  size: number;
  fill: string;
  strokeWidth: number;
  letterSpacing?: number;
  family?: string;
  children: string;
}) {
  const { x, y, size, fill, strokeWidth, letterSpacing, family, children } = props;
  const common = {
    x,
    y,
    fontSize: size,
    fontFamily: family ?? Fonts.display.extrabold,
    letterSpacing,
    textAnchor: 'middle' as const,
  };
  return (
    <>
      <SvgText
        {...common}
        fill="none"
        stroke={OUTLINE}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      >
        {children}
      </SvgText>
      <SvgText {...common} fill={fill}>
        {children}
      </SvgText>
    </>
  );
}

/** Outlined text flowing along an arc path (defined in <Defs>). */
function OutlinedArcText(props: {
  href: string;
  size: number;
  fill: string;
  strokeWidth: number;
  letterSpacing?: number;
  children: string;
}) {
  const { href, size, fill, strokeWidth, letterSpacing, children } = props;
  const common = {
    fontSize: size,
    fontFamily: Fonts.display.extrabold,
    letterSpacing,
    textAnchor: 'middle' as const,
  };
  const path = { href: `#${href}`, startOffset: '50%' as const };
  return (
    <>
      <SvgText
        {...common}
        fill="none"
        stroke={OUTLINE}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      >
        <TextPath {...path}>{children}</TextPath>
      </SvgText>
      <SvgText {...common} fill={fill}>
        <TextPath {...path}>{children}</TextPath>
      </SvgText>
    </>
  );
}

export type StickerMode = 'recap' | 'live';

/** Deterministic vertical layout of the sticker (SVG user units). The modal
 *  uses the same numbers to size the preview and the capture, so there is no
 *  onLayout round-trip and no blank frame while measuring. */
export function stickerLayout(night: NightSummary, mode: StickerMode) {
  const live = mode === 'live';
  // Live with zero beers so far: the hero becomes the invite itself.
  const numberHero = !live || night.beerCount > 0;
  const extras = live
    ? ''
    : cs.vycep.storySecondaryLine(
        night.wineCount,
        night.shotCount,
        night.softDrinkCount,
      );
  const pubCount = night.pubNames.length;

  const heroSize = !numberHero
    ? 54
    : night.beerCount < 10
      ? 150
      : night.beerCount < 100
        ? 118
        : 96;
  const numberBase = (numberHero ? 70 : 62) + heroSize * 0.9;
  const unitBase = numberHero ? numberBase + 47 : numberBase;
  const extrasBase = extras ? unitBase + 36 : 0;
  const pubsTop = (extras ? extrasBase + 42 : unitBase + 48) - 32;
  const pubBases = Array.from({ length: pubCount }, (_, i) => pubsTop + (i + 1) * 32);
  const afterPubs =
    pubBases.length > 0
      ? pubBases[pubBases.length - 1]
      : extras
        ? extrasBase
        : unitBase;
  const liveCtaBase = live ? afterPubs + 44 : 0;
  const lastBase = live ? liveCtaBase : afterPubs;
  const arcY = lastBase + 44;
  const height = arcY + 40;

  return {
    live,
    numberHero,
    extras,
    heroSize,
    numberBase,
    unitBase,
    extrasBase,
    pubBases,
    liveCtaBase,
    arcY,
    height,
  };
}

export function stickerHeight(night: NightSummary, mode: StickerMode): number {
  return stickerLayout(night, mode).height;
}

interface NightStoryCardProps {
  night: NightSummary;
  dateLabel: string;
  /** 'recap' brags about a finished night; 'live' invites people right now. */
  mode?: StickerMode;
}

export const NightStoryCard = forwardRef<View, NightStoryCardProps>(
  function NightStoryCard({ night, dateLabel, mode = 'recap' }, ref) {
    const {
      live,
      numberHero,
      extras,
      heroSize,
      numberBase,
      unitBase,
      extrasBase,
      pubBases,
      liveCtaBase,
      arcY,
      height,
    } = stickerLayout(night, mode);
    const city = night.city?.trim();
    const topLabel = live
      ? cs.vycep.storyLiveTopArc
      : city
        ? `${city.toUpperCase()} · ${dateLabel}`
        : dateLabel;
    const heroUnit = cs.vycep.storyStatBeers(night.beerCount).toUpperCase();
    const pubs = night.pubNames.map(fit);

    return (
      <View ref={ref} style={styles.card} collapsable={false}>
        <Svg width={W} height={height} viewBox={`0 0 ${W} ${height}`}>
          <Defs>
            <Path id="arcTop" d={`M 34 58 Q ${CX} 30 ${W - 34} 58`} />
            <Path
              id="arcBottom"
              d={`M 34 ${arcY} Q ${CX} ${arcY + 28} ${W - 34} ${arcY}`}
            />
          </Defs>
          {/* Slight hand-slapped tilt; the canvas margins absorb the corners. */}
          <G rotation={-2} origin={`${CX}, ${height / 2}`}>
            <OutlinedArcText
              href="arcTop"
              size={19}
              fill={INK}
              strokeWidth={7}
              letterSpacing={3}
            >
              {topLabel}
            </OutlinedArcText>

            <OutlinedText
              x={CX}
              y={numberBase}
              size={heroSize}
              fill={ACCENT}
              strokeWidth={numberHero ? 16 : 12}
              letterSpacing={numberHero ? undefined : 2}
            >
              {numberHero ? String(night.beerCount) : cs.vycep.storyLiveHero}
            </OutlinedText>
            {numberHero ? (
              <OutlinedText
                x={CX}
                y={unitBase}
                size={46}
                fill={INK}
                strokeWidth={10}
                letterSpacing={6}
              >
                {heroUnit}
              </OutlinedText>
            ) : null}

            {extras ? (
              <OutlinedText
                x={CX}
                y={extrasBase}
                size={17}
                fill={INK}
                strokeWidth={6}
                family={Fonts.display.bold}
              >
                {extras}
              </OutlinedText>
            ) : null}

            {pubs.map((name, i) => (
              <OutlinedText
                key={`${name}-${i}`}
                x={CX}
                y={pubBases[i]}
                size={21}
                fill={INK}
                strokeWidth={7}
                family={Fonts.display.bold}
              >
                {i > 0 ? `→ ${name}` : name}
              </OutlinedText>
            ))}

            {live ? (
              <OutlinedText
                x={CX}
                y={liveCtaBase}
                size={30}
                fill={ACCENT}
                strokeWidth={9}
                letterSpacing={1}
              >
                {cs.vycep.storyLiveCta}
              </OutlinedText>
            ) : null}

            <OutlinedArcText
              href="arcBottom"
              size={20}
              fill={ACCENT}
              strokeWidth={8}
              letterSpacing={5}
            >
              {cs.vycep.storyBrand}
            </OutlinedArcText>
          </G>
        </Svg>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  card: {
    width: STICKER_WIDTH,
    backgroundColor: 'transparent',
    // Soft lift baked into the PNG so the lettering separates from any photo.
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
  },
});
