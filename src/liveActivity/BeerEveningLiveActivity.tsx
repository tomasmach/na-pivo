import { Button, HStack, Image, Spacer, Text, VStack } from '@expo/ui/swift-ui';
import {
  accessibilityLabel,
  activityBackgroundTint,
  buttonStyle,
  controlSize,
  font,
  foregroundStyle,
  frame,
  lineLimit,
  minimumScaleFactor,
  monospacedDigit,
  padding,
  privacySensitive,
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
  // animations. A restrained amber and darker background remain legible without
  // becoming a large bright patch on the dimmed display.
  const isDimmed = environment.isLuminanceReduced === true;
  const accent = isDimmed ? '#B79B63' : '#F5B642';
  const primaryText = isDimmed ? '#D8D0C0' : '#FBF3E0';
  const secondaryText = isDimmed ? '#8F8574' : '#C9B99B';
  const background = isDimmed ? '#090806' : '#1F1308';
  const latestBeerLabel = props.latestBeerName
    ? `Naposledy: ${props.latestBeerName}`
    : 'První kolo je na stole';

  return {
    banner: (
      <HStack
        alignment="center"
        spacing={14}
        modifiers={[
          padding({ horizontal: 16, vertical: 14 }),
          frame({ maxWidth: 1000, alignment: 'leading' }),
          foregroundStyle(primaryText),
          activityBackgroundTint(background),
        ]}
      >
        <VStack alignment="leading" spacing={4} modifiers={[frame({ maxWidth: 1000 })]}>
          <HStack alignment="center" spacing={6}>
            <Image systemName="mug.fill" size={12} color={accent} />
            <Text
              modifiers={[
                font({ size: 11, weight: 'semibold', design: 'rounded' }),
                foregroundStyle(accent),
              ]}
            >
              VEČER BĚŽÍ
            </Text>
          </HStack>
          <Text
            modifiers={[
              font({ size: 18, weight: 'bold', design: 'rounded' }),
              lineLimit(1),
              minimumScaleFactor(0.75),
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

        <VStack alignment="trailing" spacing={1}>
          <Text
            modifiers={[
              font({ size: 34, weight: 'bold', design: 'rounded' }),
              foregroundStyle(accent),
              monospacedDigit(),
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
            POČET PIV
          </Text>
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
          <Button
            label="+ pivo"
            target="add-beer"
            modifiers={[
              buttonStyle('borderedProminent'),
              controlSize('small'),
              tint(accent),
              accessibilityLabel('Přidat stejné pivo'),
            ]}
          />
        </VStack>
      </HStack>
    ),

    bannerSmall: (
      <HStack
        alignment="center"
        spacing={10}
        modifiers={[
          padding({ horizontal: 12, vertical: 10 }),
          foregroundStyle(primaryText),
          activityBackgroundTint(background),
        ]}
      >
        <Image systemName="mug.fill" size={15} color={accent} />
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
          ]}
        >
          {props.beerCount}×
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
          accessibilityLabel(`Počet piv ${props.beerCount}`),
        ]}
      >
        {props.beerCount}×
      </Text>
    ),
    minimal: (
      <Text
        modifiers={[
          font({ size: 13, weight: 'bold', design: 'rounded' }),
          foregroundStyle(accent),
          monospacedDigit(),
          accessibilityLabel(`Počet piv ${props.beerCount}`),
        ]}
      >
        {props.beerCount}
      </Text>
    ),

    expandedLeading: (
      <VStack alignment="leading" spacing={3} modifiers={[padding({ leading: 4 })]}>
        <Image systemName="mug.fill" size={18} color={accent} />
        <Text
          modifiers={[
            font({ size: 10, weight: 'semibold', design: 'rounded' }),
            foregroundStyle(secondaryText),
          ]}
        >
          NA PIVO
        </Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={0} modifiers={[padding({ trailing: 4 })]}>
        <Text
          modifiers={[
            font({ size: 26, weight: 'bold', design: 'rounded' }),
            foregroundStyle(accent),
            monospacedDigit(),
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
    expandedBottom: (
      <VStack
        alignment="leading"
        spacing={4}
        modifiers={[
          padding({ top: 5, bottom: 4 }),
          frame({ maxWidth: 1000, alignment: 'leading' }),
          foregroundStyle(primaryText),
        ]}
      >
        <Text
          modifiers={[
            font({ size: 16, weight: 'bold', design: 'rounded' }),
            lineLimit(1),
            minimumScaleFactor(0.75),
            privacySensitive(),
          ]}
        >
          {props.pubName}
        </Text>
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
        <HStack alignment="center" spacing={8}>
          <Spacer />
          <Button
            label="+ pivo"
            target="add-beer"
            modifiers={[
              buttonStyle('borderedProminent'),
              controlSize('small'),
              tint(accent),
              accessibilityLabel('Přidat stejné pivo'),
            ]}
          />
        </HStack>
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
