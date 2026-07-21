import { Button, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
// The isolated widget runtime exposes modifier globals by their exported names.
// Keep these imports unaliased so the serialized layout can resolve them.
import {
  accessibilityLabel,
  activityBackgroundTint,
  background,
  buttonBorderShape,
  buttonStyle,
  clipShape,
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
  resizable,
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
  /** `file://` URI of the staged app icon in the app-group container. */
  iconUri?: string;
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
  const secondaryText = isDimmed ? '#817767' : '#C4AE8E';
  const activityBackground = isDimmed ? '#080604' : '#150D06';
  const raisedSurface = isDimmed ? '#17120C' : '#2E1C0D';
  const buttonText = '#241404';
  // Poured-beer gold gradient for the hero number; flat on the dimmed display.
  const countStyle:
    | string
    | {
        type: 'linearGradient';
        colors: string[];
        startPoint: { x: number; y: number };
        endPoint: { x: number; y: number };
      } = isDimmed
    ? accent
    : {
        type: 'linearGradient',
        colors: ['#FFD98F', '#FFB84D', '#E8953A'],
        startPoint: { x: 0.5, y: 0 },
        endPoint: { x: 0.5, y: 1 },
      };

  const beerWord =
    props.beerCount === 1
      ? 'pivo'
      : props.beerCount >= 2 && props.beerCount <= 4
        ? 'piva'
        : 'piv';
  // Single metadata line: latest beer plus the running total, one dot max.
  const metaLabel = props.latestBeerName
    ? props.totalPrice
      ? `${props.latestBeerName} · ${props.totalPrice}`
      : props.latestBeerName
    : props.totalPrice
      ? props.totalPrice
      : 'První pivo se teprve točí';

  return {
    banner: (
      <VStack
        alignment="leading"
        spacing={12}
        modifiers={[
          padding({ horizontal: 16, vertical: 14 }),
          frame({ maxWidth: 1000, alignment: 'leading' }),
          foregroundStyle(primaryText),
          activityBackgroundTint(activityBackground),
        ]}
      >
        <HStack
          alignment="center"
          spacing={12}
          modifiers={[frame({ maxWidth: 1000 })]}
        >
          {props.iconUri && !isDimmed ? (
            <Image
              uiImage={props.iconUri}
              modifiers={[
                resizable(),
                frame({ width: 42, height: 42 }),
                clipShape('roundedRectangle', 13),
              ]}
            />
          ) : (
            <Image
              systemName="mug.fill"
              size={20}
              modifiers={[
                foregroundStyle(countStyle),
                frame({ width: 42, height: 42 }),
                background(
                  raisedSurface,
                  shapes.roundedRectangle({
                    cornerRadius: 13,
                    roundedCornerStyle: 'continuous',
                  }),
                ),
              ]}
            />
          )}
          <VStack
            alignment="leading"
            spacing={3}
            modifiers={[frame({ maxWidth: 1000 })]}
          >
            <Text
              modifiers={[
                font({ size: 19, weight: 'bold', design: 'rounded' }),
                lineLimit(1),
                minimumScaleFactor(0.72),
                privacySensitive(),
              ]}
            >
              {props.pubName}
            </Text>
            <Text
              modifiers={[
                font({ size: 12, weight: 'medium', design: 'rounded' }),
                foregroundStyle(secondaryText),
                lineLimit(1),
                privacySensitive(),
              ]}
            >
              {metaLabel}
            </Text>
          </VStack>
          <Spacer />
          <VStack alignment="trailing" spacing={0}>
            <Text
              modifiers={[
                font({ size: 40, weight: 'heavy', design: 'rounded' }),
                foregroundStyle(countStyle),
                monospacedDigit(),
                contentTransition('numericText'),
                accessibilityLabel(`${props.beerCount} ${beerWord}`),
              ]}
            >
              {props.beerCount}
            </Text>
            <Text
              modifiers={[
                font({ size: 11, weight: 'semibold', design: 'rounded' }),
                foregroundStyle(secondaryText),
              ]}
            >
              {beerWord}
            </Text>
          </VStack>
        </HStack>

        <Button
          label="Přidat další"
          systemImage="plus"
          target="add-beer"
          modifiers={[
            font({ size: 15, weight: 'semibold', design: 'rounded' }),
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
            foregroundStyle(countStyle),
            monospacedDigit(),
            contentTransition('numericText'),
          ]}
        >
          {`${props.beerCount} ${beerWord}`}
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
      <Image
        systemName="mug.fill"
        size={18}
        modifiers={[foregroundStyle(countStyle), padding({ leading: 4 })]}
      />
    ),
    expandedTrailing: (
      <VStack
        alignment="trailing"
        spacing={0}
        modifiers={[padding({ trailing: 4 })]}
      >
        <Text
          modifiers={[
            font({ size: 26, weight: 'heavy', design: 'rounded' }),
            foregroundStyle(countStyle),
            monospacedDigit(),
            contentTransition('numericText'),
            accessibilityLabel(`${props.beerCount} ${beerWord}`),
          ]}
        >
          {props.beerCount}
        </Text>
        <Text
          modifiers={[
            font({ size: 9, weight: 'semibold', design: 'rounded' }),
            foregroundStyle(secondaryText),
          ]}
        >
          {beerWord}
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
        <Text
          modifiers={[
            font({ size: 11, weight: 'medium', design: 'rounded' }),
            foregroundStyle(secondaryText),
            lineLimit(1),
            privacySensitive(),
          ]}
        >
          {metaLabel}
        </Text>
        <Button
          label="Přidat další"
          systemImage="plus"
          target="add-beer"
          modifiers={[
            font({ size: 15, weight: 'semibold', design: 'rounded' }),
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
