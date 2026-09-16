/**
 * Full-screen three-card release note, used for the 2.1.0 "sorry, the old app
 * is back" message (see src/data/localReleaseNote.ts). Same bones as the
 * onboarding pager in app/onboarding.tsx: stout background, illustration on
 * top, Baloo title, dots in the header, one amber CTA whose label says what
 * the tap does. The last card offers to open the store rating form; both
 * buttons there dismiss the note so it never shows twice.
 */

import React, { useCallback, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type ViewToken,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { t } from '@/i18n';
import { CounterCta } from '@/counter/CounterCta';
import { openStoreReview } from '@/utils/storeLinks';

interface Slide {
  key: string;
  title: string;
  body: string;
  next: string;
  image: number;
}

const copy = t.whatsNew.apology;

const SLIDES: Slide[] = [
  {
    key: 'sorry',
    title: copy.slide1Title,
    body: copy.slide1Body,
    next: copy.slide1Next,
    image: require('../../../assets/images/whats-new/sorry-overflow.png'),
  },
  {
    key: 'back',
    title: copy.slide2Title,
    body: copy.slide2Body,
    next: copy.slide2Next,
    image: require('../../../assets/images/whats-new/back-classic.png'),
  },
  {
    key: 'review',
    title: copy.slide3Title,
    body: copy.slide3Body,
    next: copy.slide3Review,
    image: require('../../../assets/images/whats-new/five-stars.png'),
  },
];

const LAST_INDEX = SLIDES.length - 1;

function PagerSlide({ item, width }: { item: Slide; width: number }) {
  const [artHeight, setArtHeight] = useState(0);
  const side =
    artHeight > 0
      ? Math.max(160, Math.min(400, Math.min(width * 0.82, artHeight - 24)))
      : 240;

  const handleArtLayout = useCallback((event: LayoutChangeEvent) => {
    setArtHeight(event.nativeEvent.layout.height);
  }, []);

  return (
    <View style={[styles.slide, { width }]}>
      <View style={styles.illustrationArea} onLayout={handleArtLayout}>
        <Image
          source={item.image}
          style={{ width: side, height: side }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      </View>
      <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
        {item.title}
      </Text>
      <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
        {item.body}
      </Text>
    </View>
  );
}

export function ReleasePagerModal({
  visible,
  version,
  onDismiss,
}: {
  visible: boolean;
  version: string;
  onDismiss: () => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const listRef = useRef<FlatList<Slide>>(null);
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDismiss();
  }, [onDismiss]);

  const handlePrimary = useCallback(() => {
    if (indexRef.current >= LAST_INDEX) {
      finish();
      void openStoreReview().catch(() => {
        // The store app is missing or refused the URL; the note is done anyway.
      });
      return;
    }
    listRef.current?.scrollToIndex({ index: indexRef.current + 1, animated: true });
  }, [finish]);

  const [viewabilityConfig] = useState(() => ({ itemVisiblePercentThreshold: 60 }));
  const [onViewableItemsChanged] = useState(
    () =>
      ({ viewableItems }: { viewableItems: ViewToken[] }) => {
        const first = viewableItems[0];
        if (first?.index != null) {
          indexRef.current = first.index;
          setIndex(first.index);
        }
      },
  );

  const renderSlide = useCallback(
    ({ item }: ListRenderItemInfo<Slide>) => <PagerSlide item={item} width={width} />,
    [width],
  );

  const isLast = index === LAST_INDEX;
  const primaryLabel = SLIDES[index]?.next ?? copy.slide3Review;
  const secondaryLabel = isLast ? copy.slide3Done : copy.skip;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      statusBarTranslucent
      onRequestClose={finish}
    >
      <View
        style={[
          styles.root,
          {
            paddingTop: insets.top + Spacing.sm,
            paddingBottom: Math.max(insets.bottom, Spacing.sm),
          },
        ]}
      >
        <View style={styles.header}>
          <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
            {t.whatsNew.eyebrow}
            <Text style={styles.versionText}>{`  ${t.whatsNew.versionLabel(version)}`}</Text>
          </Text>
          <View
            style={styles.dots}
            accessibilityRole="text"
            accessibilityLabel={t.a11y.onboardingStep(index + 1, SLIDES.length)}
          >
            {SLIDES.map((slide, i) => (
              <View
                key={slide.key}
                style={[styles.dot, i === index && styles.dotActive, i < index && styles.dotDone]}
              />
            ))}
          </View>
        </View>

        <FlatList
          ref={listRef}
          style={styles.pager}
          data={SLIDES}
          keyExtractor={(item) => item.key}
          renderItem={renderSlide}
          horizontal
          pagingEnabled
          bounces={false}
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        />

        <View style={styles.ctaWrap}>
          <CounterCta
            label={primaryLabel}
            onPress={handlePrimary}
            accessibilityLabel={primaryLabel}
          />
        </View>

        <View style={styles.secondaryCtaSlot}>
          <Pressable
            onPress={finish}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel={secondaryLabel}
            hitSlop={8}
          >
            <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
              {secondaryLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.stout,
    gap: 12,
  },
  header: {
    height: 44,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: Spacing.sm,
  },
  eyebrow: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 11,
    letterSpacing: 2,
    color: Colors.amber,
  },
  versionText: {
    fontFamily: Fonts.ui.medium,
    fontSize: 12,
    letterSpacing: 0.4,
    fontVariant: ['tabular-nums'],
    color: Colors.mutedText,
  },
  pager: { flex: 1 },
  slide: {
    flex: 1,
    paddingHorizontal: Spacing.xl,
    paddingBottom: Spacing.sm,
  },
  illustrationArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 30,
    lineHeight: 38,
    color: Colors.foam,
    textAlign: 'center',
    includeFontPadding: false,
  },
  body: {
    fontFamily: Fonts.ui.regular,
    fontSize: 16,
    lineHeight: 24,
    color: Colors.foamMuted,
    textAlign: 'center',
    marginTop: Spacing.sm,
    includeFontPadding: false,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 20,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  dotActive: {
    backgroundColor: Colors.amber,
  },
  dotDone: {
    backgroundColor: withAlpha(Colors.amber, 0.5),
  },
  ctaWrap: { paddingHorizontal: 24 },
  secondaryCtaSlot: {
    height: 48,
    paddingHorizontal: 24,
  },
  secondaryButton: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.7,
  },
});
