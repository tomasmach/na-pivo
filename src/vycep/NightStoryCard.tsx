/**
 * NightStoryCard — the 9:16 Instagram-story image of one night, rendered as a
 * plain RN view so react-native-view-shot can rasterize it at 1080x1920.
 *
 * Design: the dark pub-table backdrop carries a single hero object, the beer
 * coaster with the night's tally scratched on it, exactly like the real
 * "čárky na tácku". The number does the bragging; everything else stays
 * quiet: date up top, pubs + stat trio below, the app wordmark at the bottom.
 * All text is rendered natively (never baked into the generated assets), so
 * the card stays crisp at export size.
 */

import { forwardRef, useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { BeerIcon } from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { formatEveningDate } from '@/myBeers/eveningModel';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts } from '@/theme/fonts';
import { nightHours, type NightSummary } from '@/vycep/nightModel';
import { TallyMarks } from '@/vycep/TallyMarks';

/** Logical size; capture upscales to 1080x1920 (ratio 3). */
export const STORY_WIDTH = 360;
export const STORY_HEIGHT = 640;

const COASTER_SIZE = 296;
/** Pencil-graphite tally on the cream coaster. */
const TALLY_INK = Colors.stout3;

interface NightStoryCardProps {
  night: NightSummary;
}

export const NightStoryCard = forwardRef<View, NightStoryCardProps>(
  function NightStoryCard({ night }, ref) {
    const now = useMemo(() => new Date(), []);
    const hours = nightHours(night.durationMinutes);

    const stats: { value: number; label: string }[] = [
      { value: night.beerCount, label: cs.vycep.storyStatBeers(night.beerCount) },
    ];
    if (night.pubNames.length > 0) {
      stats.push({
        value: night.pubNames.length,
        label: cs.vycep.storyStatPubs(night.pubNames.length),
      });
    }
    if (hours > 0) {
      stats.push({ value: hours, label: cs.vycep.storyStatHours(hours) });
    }

    return (
      <View ref={ref} style={styles.card} collapsable={false}>
        <Image
          source={require('../../assets/images/story-bg.png')}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />

        <Text style={styles.date} allowFontScaling={false}>
          {formatEveningDate(night.startedAt, now)}
        </Text>

        <View style={styles.coasterWrap}>
          <Image
            source={require('../../assets/images/story-coaster.png')}
            style={styles.coaster}
            resizeMode="contain"
          />
          <View style={styles.tallyOverlay}>
            <TallyMarks
              count={night.beerCount}
              color={TALLY_INK}
              markHeight={30}
              strokeWidth={4}
              overflowColor={TALLY_INK}
            />
          </View>
        </View>

        {night.pubNames.length > 0 ? (
          <Text style={styles.pubs} numberOfLines={2} allowFontScaling={false}>
            {night.pubNames.join('  →  ')}
          </Text>
        ) : null}

        <View style={styles.statsRow}>
          {stats.map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Text style={styles.statValue} allowFontScaling={false}>
                {stat.value}
              </Text>
              <Text style={styles.statLabel} allowFontScaling={false}>
                {stat.label}
              </Text>
            </View>
          ))}
        </View>

        <View style={styles.brandRow}>
          <BeerIcon size={16} color={Colors.amber} />
          <Text style={styles.brandText} allowFontScaling={false}>
            {cs.vycep.storyBrand}
          </Text>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  card: {
    width: STORY_WIDTH,
    height: STORY_HEIGHT,
    backgroundColor: Colors.stout,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 64,
    paddingBottom: 40,
    overflow: 'hidden',
  },
  date: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 14,
    letterSpacing: 3,
    color: Colors.foamMuted,
  },
  coasterWrap: {
    marginTop: 34,
    width: COASTER_SIZE,
    height: COASTER_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coaster: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: COASTER_SIZE,
    height: COASTER_SIZE,
  },
  tallyOverlay: {
    maxWidth: COASTER_SIZE * 0.66,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pubs: {
    marginTop: 30,
    maxWidth: STORY_WIDTH - 64,
    fontFamily: Fonts.display.bold,
    fontSize: 17,
    lineHeight: 23,
    color: Colors.foam,
    textAlign: 'center',
  },
  statsRow: {
    marginTop: 26,
    flexDirection: 'row',
    gap: 36,
  },
  stat: {
    alignItems: 'center',
  },
  statValue: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 34,
    lineHeight: 38,
    color: Colors.amber,
  },
  statLabel: {
    marginTop: 2,
    fontFamily: Fonts.ui.semibold,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: withAlpha(Colors.foamMuted, 0.85),
  },
  brandRow: {
    marginTop: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  brandText: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 15,
    letterSpacing: 4,
    color: Colors.foam,
  },
});
