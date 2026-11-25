import { Button, HStack, Image, Link, Spacer, Text, VStack } from '@expo/ui/swift-ui';
// The isolated widget runtime exposes modifier globals by their exported names.
// Keep these imports unaliased so the serialized layout can resolve them.
import {
  accessibilityLabel,
  activityBackgroundTint,
  background,
  buttonStyle,
  contentTransition,
  fixedSize,
  font,
  foregroundStyle,
  frame,
  kerning,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  multilineTextAlignment,
  padding,
  privacySensitive,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type HomeTransitSymbol =
  | 'tram.fill'
  | 'tram.fill.tunnel'
  | 'train.side.front.car'
  | 'ferry.fill'
  | 'cablecar.fill'
  | 'bus.fill';

/**
 * Complete render state for one running beer-counting evening.
 *
 * Keep this payload small: ActivityKit limits the combined static and dynamic
 * state of a Live Activity to 4 KB. Strings are already formatted for display
 * so the isolated widget runtime does not need app locale or store access.
 */
export interface BeerEveningLiveActivityProps {
  /** Stable tally session client id. Kept in state for reconciliation/debugging. */
  sessionId: string;
  pubName: string;
  beerCount: number;
  /** Localized amount such as "245 Kč"; empty when the total is unknown. */
  totalPrice: string;
  /** Most recently counted beer; empty when the name is unavailable. */
  latestBeerName: string;
  /** Localized wall-clock time such as "21:47" of the latest counted beer. */
  latestBeerAt: string;
  /** The noun under the numeral, already declined for `beerCount`. */
  beerWordLabel: string;
  /** Forms of `beerWordLabel` for 1, 2–4 and 5+. */
  beerWordForms?: { one: string; few: string; many: string };
  /** The latest beer's name, or the fallback when it has none. */
  latestBeerLabel: string;
  /** When the latest beer was counted, or the line for an evening with none. */
  latestTimeLabel: string;
  /** `latestTimeLabel` with `{time}` in place of `latestBeerAt`. */
  latestTimeTemplate?: string;
  addBeerLabel: string;
  addBeerA11yLabel: string;
  openCounterLabel: string;
  /** Exact metadata repeated by the native action; intentionally not rendered. */
  repeatBeerName: string;
  repeatBeerPriceCzk?: number;
  repeatBeerVolumeMl?: number;
  repeatBeerServingType?: string;
  /** AppIntent buttons work on iOS 17+; iOS 16 gets a deep-link fallback. */
  supportsInteractiveAdd?: boolean;
  /** Tonight's last direct connection home; absent without home or outside PID. */
  homeTransitLabel?: string;
  /** Departure as epoch ms. The countdown runs natively, so it stays right while the app sleeps. */
  homeTransitDepartsAtMs?: number;
  homeTransitCountdownPrefix?: string;
  homeTransitSymbol?: HomeTransitSymbol;
  homeTransitA11yLabel?: string;
  /** Replaces the ride once it left: "Už jedeš nočkou". */
  homeTransitMissedLabel?: string;
  /** Sent to ActivityKit as the stale date, so the lock screen redraws once the ride left. */
  staleDateMs?: number;
}

const BeerEveningLiveActivity = (
  props: BeerEveningLiveActivityProps,
  environment: LiveActivityEnvironment,
) => {
  'widget';

  // The serialized layout cannot see module scope, so every constant lives here.
  // Fonts are bundled into the widget extension by plugins/withLiveActivityFonts.js.
  const displayFont = 'SofiaSansExtraCondensed-ExtraBold';
  const semiboldFont = 'SofiaSans-SemiBold';
  const boldFont = 'SofiaSans-Bold';
  const extraboldFont = 'SofiaSans-ExtraBold';
  const counterDeepLink = 'napivo://beer';

  // Always-On dims the Lock Screen; the yellow there would be a bright patch.
  const isDimmed = environment.isLuminanceReduced === true;
  const c = isDimmed
    ? {
        ground: '#000000',
        count: '#A8891C',
        word: '#A3A39D',
        primary: '#C9C9C3',
        secondary: '#A3A39D',
        muted: '#6B6B66',
        ctaFill: '#141414',
        ctaEdge: '#A8891C66',
        ctaText: '#A8891C',
      }
    : {
        ground: '#0A0A0A',
        count: '#FFC400',
        word: '#D4D4CE',
        primary: '#F7F7F2',
        secondary: '#D4D4CE',
        muted: '#8F8F8A',
        ctaFill: '#FFC400',
        ctaEdge: '#FFC400',
        ctaText: '#0A0A0A',
      };
  // The Dynamic Island is never dimmed.
  const island = { count: '#FFC400', primary: '#F7F7F2', secondary: '#D4D4CE', muted: '#8F8F8A' };

  // Every word arrives from `liveBeerActivityModel`: this runtime has no strings
  // file and no locale. The native `+ pivo` intent bumps only `beerCount`,
  // `latestBeerAt` and clears `totalPrice`, so lines depending on them are put
  // together here.
  const count = props.beerCount;
  const forms = props.beerWordForms;
  const beerWord = !forms
    ? props.beerWordLabel
    : count === 1
      ? forms.one
      : count >= 2 && count <= 4
        ? forms.few
        : forms.many;
  const countA11y = `${count} ${beerWord}`;
  const latestTimeLabel =
    props.latestBeerAt && props.latestTimeTemplate
      ? props.latestTimeTemplate.replace('{time}', props.latestBeerAt)
      : props.latestTimeLabel;
  const departsAtMs = props.homeTransitDepartsAtMs;
  // The system redraws a stale activity at the departure even while the app
  // sleeps; a later update knows it from the clock.
  const transitMissed =
    !!props.homeTransitMissedLabel &&
    (environment.isStale === true || typeof departsAtMs !== 'number' || departsAtMs <= Date.now());
  const showHomeTransit =
    !transitMissed && !!props.homeTransitLabel && typeof departsAtMs === 'number';
  // The countdown only shrinks, so a width picked now stays wide enough.
  const transitLeftMs = (departsAtMs ?? 0) - Date.now();
  const transitTimerWidth =
    transitLeftMs < 60 * 60 * 1000 ? 37 : transitLeftMs < 10 * 60 * 60 * 1000 ? 48 : 56;

  // A 116 pt numeral needs more than its line height allows, so the text keeps
  // its own height and the frame trims the empty ascender and descender space.
  const bigNumber = (size: number, height: number, color: string, tracking: number) => (
    <Text
      modifiers={[
        font({ family: displayFont, size }),
        foregroundStyle(color),
        kerning(tracking),
        lineLimit(1),
        minimumScaleFactor(0.5),
        fixedSize({ vertical: true }),
        frame({ height }),
        contentTransition('numericText'),
        accessibilityLabel(countA11y),
      ]}
    >
      {count}
    </Text>
  );

  const pubHead = (nameSize: number, primary: string, secondary: string) => (
    <HStack alignment="center" spacing={8} modifiers={[frame({ maxWidth: 1000 })]}>
      <Text
        modifiers={[
          font({ family: boldFont, size: nameSize }),
          foregroundStyle(primary),
          lineLimit(1),
          privacySensitive(),
        ]}
      >
        {props.pubName}
      </Text>
      <Spacer />
      {props.totalPrice ? (
        <Text
          modifiers={[
            font({ family: boldFont, size: 15 }),
            foregroundStyle(secondary),
            lineLimit(1),
            fixedSize(),
            privacySensitive(),
          ]}
        >
          {props.totalPrice}
        </Text>
      ) : null}
    </HStack>
  );

  // A long beer name gets cut, never the time after it.
  const latest = (color: string) => (
    <HStack spacing={0}>
      <Text
        modifiers={[
          font({ family: semiboldFont, size: 13 }),
          foregroundStyle(color),
          lineLimit(1),
          privacySensitive(),
        ]}
      >
        {props.latestBeerLabel}
      </Text>
      <Text
        modifiers={[
          font({ family: semiboldFont, size: 13 }),
          foregroundStyle(color),
          lineLimit(1),
          fixedSize(),
          privacySensitive(),
        ]}
      >
        {` · ${latestTimeLabel}`}
      </Text>
    </HStack>
  );

  const ctaShape = (radius: number) =>
    shapes.roundedRectangle({ cornerRadius: radius, roundedCornerStyle: 'continuous' });
  const cta = (label: string, colors: { fill: string; edge: string; text: string }) => (
    <HStack
      alignment="center"
      spacing={6}
      modifiers={[
        frame({ maxWidth: 1000, minHeight: 38, maxHeight: 38 }),
        background(colors.fill, ctaShape(19)),
        padding({ all: 1 }),
        background(colors.edge, ctaShape(20)),
      ]}
    >
      {props.supportsInteractiveAdd === true ? (
        <Image systemName="plus" size={15} color={colors.text} />
      ) : null}
      <Text
        modifiers={[
          font({ family: extraboldFont, size: 15 }),
          foregroundStyle(colors.text),
          lineLimit(1),
        ]}
      >
        {label}
      </Text>
    </HStack>
  );
  // AppIntent buttons work on iOS 17+; iOS 16 opens the counter instead.
  const action = (colors: { fill: string; edge: string; text: string }) =>
    props.supportsInteractiveAdd === true ? (
      <Button
        target="add-beer"
        modifiers={[buttonStyle('plain'), accessibilityLabel(props.addBeerA11yLabel)]}
      >
        {cta(props.addBeerLabel, colors)}
      </Button>
    ) : (
      <Link
        destination={counterDeepLink}
        modifiers={[accessibilityLabel(props.openCounterLabel)]}
      >
        {cta(props.openCounterLabel, colors)}
      </Link>
    );

  return {
    banner: (
      <HStack
        alignment="center"
        spacing={14}
        modifiers={[
          padding({ top: 12, bottom: 12, leading: 12, trailing: 16 }),
          frame({ maxWidth: 1000 }),
          // iOS 26 lets the wallpaper show through the tint; the card is solid black.
          background(c.ground),
          activityBackgroundTint(c.ground),
        ]}
      >
        <VStack alignment="center" spacing={2} modifiers={[frame({ width: 76 })]}>
          {bigNumber(116, 99, c.count, -3)}
          <Text
            modifiers={[
              font({ family: boldFont, size: 13 }),
              foregroundStyle(c.word),
              lineLimit(1),
              minimumScaleFactor(0.8),
            ]}
          >
            {beerWord}
          </Text>
        </VStack>

        <VStack
          alignment="leading"
          spacing={8}
          modifiers={[frame({ maxWidth: 1000, alignment: 'leading' })]}
        >
          {pubHead(17, c.primary, c.secondary)}
          {latest(c.muted)}
          {action({ fill: c.ctaFill, edge: c.ctaEdge, text: c.ctaText })}

          {showHomeTransit ? (
            <HStack
              alignment="center"
              spacing={6}
              modifiers={[
                padding({ horizontal: 2 }),
                frame({ maxWidth: 1000 }),
                accessibilityLabel(props.homeTransitA11yLabel ?? props.homeTransitLabel ?? ''),
              ]}
            >
              <Image
                systemName={props.homeTransitSymbol ?? 'bus.fill'}
                size={12}
                color={c.muted}
              />
              <Text
                modifiers={[
                  font({ family: semiboldFont, size: 12 }),
                  foregroundStyle(c.secondary),
                  lineLimit(1),
                  minimumScaleFactor(0.8),
                  privacySensitive(),
                ]}
              >
                {props.homeTransitLabel}
              </Text>
              <Spacer />
              <Text
                modifiers={[
                  font({ family: semiboldFont, size: 12 }),
                  foregroundStyle(c.muted),
                ]}
              >
                {props.homeTransitCountdownPrefix ?? ''}
              </Text>
              {/* Counts down to the departure and stops at 0:00 once it leaves.
                  The lower bound only has to be in the past: a departure is
                  always before the next 04:00, so less than a day away. */}
              <Text
                timerInterval={{
                  lower: new Date(departsAtMs - 24 * 60 * 60 * 1000),
                  upper: new Date(departsAtMs),
                }}
                countsDown
                modifiers={[
                  font({ family: extraboldFont, size: 12 }),
                  foregroundStyle(c.primary),
                  monospacedDigit(),
                  lineLimit(1),
                  minimumScaleFactor(0.7),
                  multilineTextAlignment('trailing'),
                  // Just wide enough for the digits, so "za" stays next to them.
                  frame({ width: transitTimerWidth, alignment: 'trailing' }),
                ]}
              />
            </HStack>
          ) : null}

          {transitMissed ? (
            <HStack
              alignment="center"
              spacing={6}
              modifiers={[
                padding({ horizontal: 2 }),
                frame({ maxWidth: 1000, alignment: 'leading' }),
                accessibilityLabel(props.homeTransitMissedLabel ?? ''),
              ]}
            >
              <Image systemName="moon.stars.fill" size={12} color={c.muted} />
              <Text
                modifiers={[
                  font({ family: semiboldFont, size: 12 }),
                  foregroundStyle(c.muted),
                  lineLimit(1),
                ]}
              >
                {props.homeTransitMissedLabel}
              </Text>
            </HStack>
          ) : null}
        </VStack>
      </HStack>
    ),

    bannerSmall: (
      <HStack
        alignment="center"
        spacing={10}
        modifiers={[
          padding({ horizontal: 14, vertical: 12 }),
          background(c.ground),
          activityBackgroundTint(c.ground),
        ]}
      >
        <Text
          modifiers={[
            font({ family: boldFont, size: 14 }),
            foregroundStyle(c.primary),
            lineLimit(1),
            privacySensitive(),
          ]}
        >
          {props.pubName}
        </Text>
        <Spacer />
        <HStack alignment="lastTextBaseline" spacing={3}>
          <Text
            modifiers={[
              font({ family: displayFont, size: 26 }),
              foregroundStyle(c.count),
              kerning(-1),
              contentTransition('numericText'),
              accessibilityLabel(countA11y),
            ]}
          >
            {count}
          </Text>
          <Text
            modifiers={[font({ family: boldFont, size: 11 }), foregroundStyle(island.muted)]}
          >
            {beerWord}
          </Text>
        </HStack>
      </HStack>
    ),

    compactLeading: <Image systemName="mug.fill" size={15} color={island.primary} />,
    compactTrailing: (
      <HStack alignment="lastTextBaseline" spacing={3}>
        <Text
          modifiers={[
            font({ family: displayFont, size: 24 }),
            foregroundStyle(island.count),
            kerning(-1),
            contentTransition('numericText'),
            accessibilityLabel(countA11y),
          ]}
        >
          {count}
        </Text>
        <Text modifiers={[font({ family: boldFont, size: 11 }), foregroundStyle(island.muted)]}>
          {beerWord}
        </Text>
      </HStack>
    ),
    minimal: (
      <Text
        modifiers={[
          font({ family: displayFont, size: 22 }),
          foregroundStyle(island.count),
          kerning(-1),
          contentTransition('numericText'),
          accessibilityLabel(countA11y),
        ]}
      >
        {count}
      </Text>
    ),

    expandedLeading: (
      <VStack modifiers={[padding({ leading: 6, top: 4 })]}>
        {bigNumber(84, 71, island.count, -2)}
      </VStack>
    ),
    expandedCenter: (
      <VStack
        alignment="leading"
        spacing={3}
        modifiers={[frame({ maxWidth: 1000, alignment: 'leading' })]}
      >
        {pubHead(16, island.primary, island.secondary)}
        {latest(island.muted)}
      </VStack>
    ),
    expandedBottom: (
      <VStack modifiers={[padding({ top: 6, horizontal: 6, bottom: 4 })]}>
        {action({ fill: island.count, edge: island.count, text: '#0A0A0A' })}
      </VStack>
    ),
  };
};

/**
 * Native-backed factory used by the app lifecycle bridge:
 *
 *   BeerEveningLiveActivity.start(props, 'napivo://beer')
 *   BeerEveningLiveActivity.getInstances()[0]?.update(props)
 *   BeerEveningLiveActivity.getInstances()[0]?.end('immediate', props, new Date())
 *
 * The non-iOS expo-widgets implementation is a no-op stub. Callers should still
 * gate this behind Platform.OS === 'ios' so platform behavior stays explicit.
 */
export default createLiveActivity<BeerEveningLiveActivityProps>(
  'BeerEveningLiveActivity',
  BeerEveningLiveActivity,
);
