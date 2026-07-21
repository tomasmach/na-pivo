import { Button, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
// The isolated widget runtime exposes modifier globals by their exported names.
// Keep these imports unaliased so the serialized layout can resolve them.
import {
  accessibilityLabel,
  activityBackgroundTint,
  background,
  buttonBorderShape,
  buttonStyle,
  contentTransition,
  controlSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  privacySensitive,
  shapes,
  tint,
} from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

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
}

const BeerEveningLiveActivity = (
  props: BeerEveningLiveActivityProps,
  environment: LiveActivityEnvironment,
) => {
  'widget';

  // Always-On renders the Lock Screen with reduced luminance and without
  // animations. The palette keeps the warm pub character while avoiding a
  // large bright patch on the dimmed display.
  const isDimmed = environment.isLuminanceReduced === true;
  const accent = isDimmed ? '#A98E58' : '#FFB84D';
  const primaryText = isDimmed ? '#CFC5B3' : '#FFF7E8';
  const secondaryText = isDimmed ? '#817767' : '#BDA98B';
  const activityBackground = isDimmed ? '#080604' : '#170E07';
  const raisedSurface = isDimmed ? '#17120C' : '#2B1A0E';
  const buttonText = '#241404';
  const latestBeerLabel = props.latestBeerName
    ? `Poslední · ${props.latestBeerName}`
    : 'První kolo čeká na ťuknutí';

  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={10}
        modifiers={[
          padding({ horizontal: 16, vertical: 14 }),
          frame({ maxWidth: 1000, alignment: 'leading' }),
          foregroundStyle(primaryText),
          activityBackgroundTint(activityBackground),
        ]}
      >
        <HStack
          alignment="center"
          spacing={6}
          modifiers={[frame({ maxWidth: 1000 })]}
        >
          <Image systemName="circle.fill" size={6} color={accent} />
          <Text
            modifiers={[
              font({ size: 10, weight: 'bold', design: 'rounded' }),
              foregroundStyle(accent),
            ]}
          >
            VEČER BĚŽÍ
          </Text>
          <Spacer />
          {props.totalPrice ? (
            <Text
              modifiers={[
                font({ size: 12, weight: 'semibold', design: 'rounded' }),
                foregroundStyle(primaryText),
                padding({ horizontal: 10, vertical: 5 }),
                background(raisedSurface, shapes.capsule()),
                lineLimit(1),
                privacySensitive(),
              ]}
            >
              {props.totalPrice}
            </Text>
          ) : null}
        </HStack>

        <HStack
          alignment="bottom"
          spacing={12}
          modifiers={[frame({ maxWidth: 1000 })]}
        >
          <VStack
            alignment="leading"
            spacing={4}
            modifiers={[frame({ maxWidth: 1000 })]}
          >
            <Text
              modifiers={[
                font({ size: 21, weight: 'bold', design: 'rounded' }),
                lineLimit(1),
                minimumScaleFactor(0.72),
                privacySensitive(),
              ]}
            >
              {props.pubName}
            </Text>
            <Text
              modifiers={[
                font({ size: 12, weight: 'regular', design: 'rounded' }),
                foregroundStyle(secondaryText),
                lineLimit(1),
                privacySensitive(),
              ]}
            >
              {latestBeerLabel}
            </Text>
          </VStack>
          <Spacer />
          <HStack alignment="firstTextBaseline" spacing={4}>
            <Text
              modifiers={[
                font({ size: 42, weight: 'bold', design: 'rounded' }),
                foregroundStyle(accent),
                monospacedDigit(),
                contentTransition('numericText'),
              ]}
            >
              {props.beerCount}
            </Text>
            <Text
              modifiers={[
                font({ size: 10, weight: 'bold', design: 'rounded' }),
                foregroundStyle(secondaryText),
              ]}
            >
              PIV
            </Text>
          </HStack>
        </HStack>

        <Button
          label="Přidat další"
          systemImage="plus"
          target="add-beer"
          modifiers={[
            buttonStyle('borderedProminent'),
            buttonBorderShape('capsule'),
            controlSize('regular'),
            frame({ maxWidth: 1000 }),
            tint(accent),
            foregroundStyle(buttonText),
            accessibilityLabel('Přidat stejné pivo'),
          ]}
        />
      </VStack>
    ),

    bannerSmall: (
      <HStack
        alignment="center"
        spacing={10}
        modifiers={[
          padding({ horizontal: 12, vertical: 10 }),
          foregroundStyle(primaryText),
          activityBackgroundTint(activityBackground),
        ]}
      >
        <Image systemName="mug.fill" size={14} color={accent} />
        <Text
          modifiers={[
            font({ size: 14, weight: 'semibold', design: 'rounded' }),
            lineLimit(1),
            privacySensitive(),
          ]}
        >
          {props.pubName}
        </Text>
        <Spacer />
        <Text
          modifiers={[
            font({ size: 18, weight: 'bold', design: 'rounded' }),
            foregroundStyle(accent),
            monospacedDigit(),
            contentTransition('numericText'),
          ]}
        >
          {props.beerCount} piv
        </Text>
      </HStack>
    ),

    compactLeading: <Image systemName="mug.fill" size={15} color={accent} />,
    compactTrailing: (
      <Text
        modifiers={[
          font({ size: 15, weight: 'bold', design: 'rounded' }),
          foregroundStyle(accent),
          monospacedDigit(),
          contentTransition('numericText'),
          accessibilityLabel(`Počet piv ${props.beerCount}`),
        ]}
      >
        {props.beerCount}
      </Text>
    ),
    minimal: (
      <Text
        modifiers={[
          font({ size: 13, weight: 'bold', design: 'rounded' }),
          foregroundStyle(accent),
          monospacedDigit(),
          contentTransition('numericText'),
          accessibilityLabel(`Počet piv ${props.beerCount}`),
        ]}
      >
        {props.beerCount}
      </Text>
    ),

    expandedLeading: (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[padding({ leading: 4 })]}
      >
        <Image systemName="circle.fill" size={7} color={accent} />
        <Text
          modifiers={[
            font({ size: 10, weight: 'bold', design: 'rounded' }),
            foregroundStyle(accent),
          ]}
        >
          BĚŽÍ
        </Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack
        alignment="trailing"
        spacing={0}
        modifiers={[padding({ trailing: 4 })]}
      >
        <Text
          modifiers={[
            font({ size: 26, weight: 'bold', design: 'rounded' }),
            foregroundStyle(accent),
            monospacedDigit(),
            contentTransition('numericText'),
          ]}
        >
          {props.beerCount}
        </Text>
        <Text
          modifiers={[
            font({ size: 9, weight: 'bold', design: 'rounded' }),
            foregroundStyle(secondaryText),
          ]}
        >
          PIV
        </Text>
      </VStack>
    ),
    expandedCenter: (
      <Text
        modifiers={[
          padding({ horizontal: 10 }),
          font({ size: 15, weight: 'bold', design: 'rounded' }),
          foregroundStyle(primaryText),
          lineLimit(1),
          minimumScaleFactor(0.72),
          privacySensitive(),
        ]}
      >
        {props.pubName}
      </Text>
    ),
    expandedBottom: (
      <VStack
        alignment="leading"
        spacing={8}
        modifiers={[
          padding({ top: 5, bottom: 4 }),
          frame({ maxWidth: 1000, alignment: 'leading' }),
          foregroundStyle(primaryText),
        ]}
      >
        <HStack alignment="firstTextBaseline" spacing={8}>
          <Text
            modifiers={[
              font({ size: 11, weight: 'regular', design: 'rounded' }),
              foregroundStyle(secondaryText),
              lineLimit(1),
              privacySensitive(),
            ]}
          >
            {latestBeerLabel}
          </Text>
          <Spacer />
          {props.totalPrice ? (
            <Text
              modifiers={[
                font({ size: 12, weight: 'semibold', design: 'rounded' }),
                foregroundStyle(primaryText),
                lineLimit(1),
                privacySensitive(),
              ]}
            >
              {props.totalPrice}
            </Text>
          ) : null}
        </HStack>
        <Button
          label="Přidat další"
          systemImage="plus"
          target="add-beer"
          modifiers={[
            buttonStyle('borderedProminent'),
            buttonBorderShape('capsule'),
            controlSize('small'),
            frame({ maxWidth: 1000 }),
            tint(accent),
            foregroundStyle(buttonText),
            accessibilityLabel('Přidat stejné pivo'),
          ]}
        />
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
