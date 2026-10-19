/**
 * The blood alcohol estimate: one quiet row on the counter card and the sheet
 * it opens. Both read the estimate themselves, so only they re-render each minute.
 */

import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CardSurface } from '@/components/shared/CardSurface';
import { ChevronRightIcon, InfoIcon, XIcon } from '@/components/shared/IconGlyph';
import { drinkAbv, drinkVolumeMl, type AlcoholEstimate, type BodyProfile } from '@/drinks/alcoholEstimate';
import { formatVolume, intlLocale, t } from '@/i18n';
import { useSettingsStore } from '@/stores/settingsStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';
import {
  cautiousCeil,
  formatClock,
  formatPromile,
  formatZeroAt,
  formatZeroAtShort,
  isMorning,
  useAlcoholEstimate,
} from '@/counter/useAlcoholEstimate';

/**
 * Owns the minute tick, so the counter itself does not re-render every minute.
 * Without body numbers it still shows, as the way to set them up.
 */
export function AlcoholEstimateRow({ onPress }: { onPress: () => void }) {
  const hasProfile = useSettingsStore((s) => s.bodyProfile !== null);
  const { estimate, nowMs } = useAlcoholEstimate();
  let main: string;
  let side: string | null = null;
  let a11y: string;
  let shrinkMain = false;
  if (!hasProfile) {
    main = t.alcohol.moreRow;
    side = t.alcohol.rowSetup;
    a11y = t.alcohol.rowSetupA11y;
  } else if (!estimate) {
    main = t.alcohol.rowNow(formatPromile(0));
    a11y = t.alcohol.rowEmptyA11y;
  } else if (isMorning(estimate)) {
    main = t.alcohol.rowMorning(formatZeroAtShort(estimate.zeroAt, nowMs));
    a11y = t.alcohol.rowMorningA11y(formatZeroAt(estimate.zeroAt, nowMs));
    shrinkMain = true;
  } else {
    const when = formatZeroAt(estimate.zeroAt, nowMs);
    const promile = formatPromile(estimate.now);
    main = t.alcohol.rowNow(promile);
    if (estimate.rising) {
      const peak = formatPromile(estimate.rising.promile);
      side = t.alcohol.rowRising(peak);
      a11y = t.alcohol.rowRisingA11y(promile, peak, when);
    } else {
      side = t.alcohol.rowZero(when);
      a11y = t.alcohol.rowA11y(promile, when);
    }
  }
  return (
    <Pressable
      testID="alcohol-estimate-row"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => [styles.coasterRow, pressed && styles.pressed]}
    >
      <Text
        style={[styles.coasterMain, shrinkMain && styles.coasterMainShrink]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {main}
      </Text>
      {side === null ? (
        <View style={styles.coasterSpacer} />
      ) : (
        <Text style={styles.coasterSide} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {side}
        </Text>
      )}
      <ChevronRightIcon size={15} color={Colors.mutedText} />
    </Pressable>
  );
}

interface DrinkLine {
  key: string;
  name: string;
  count: number;
  abv: number;
}

function drinkLines(estimate: AlcoholEstimate): DrinkLine[] {
  const lines = new Map<string, DrinkLine>();
  for (const drink of estimate.drinks) {
    const volume = drinkVolumeMl(drink);
    const abv = drinkAbv(drink);
    const key = `${drink.beerName}|${volume}|${abv}`;
    const line = lines.get(key);
    if (line) line.count += 1;
    else lines.set(key, { key, name: `${drink.beerName} · ${formatVolume(volume)}`, count: 1, abv });
  }
  return [...lines.values()];
}

export interface AlcoholEstimateSheetProps {
  visible: boolean;
  profile: BodyProfile | null;
  onEdit: () => void;
  onTurnOff: () => void;
  onClose: () => void;
}

export function AlcoholEstimateSheet({ visible, profile, onEdit, onTurnOff, onClose }: AlcoholEstimateSheetProps) {
  const insets = useSafeAreaInsets();
  const { estimate, nowMs } = useAlcoholEstimate();
  const morning = estimate !== null && isMorning(estimate);
  const cautiousNow = estimate ? cautiousCeil(estimate.high) : 0;

  return (
    <Modal
      visible={visible}
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
          <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
            <View style={styles.grabber} />
            <View style={styles.header}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
                {t.alcohol.title}
              </Text>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t.a11y.counterCloseModal}
              >
                <XIcon size={20} color={Colors.foamMuted} />
              </Pressable>
            </View>

            <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
              {estimate === null ? (
                <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.alcohol.empty}
                </Text>
              ) : (
                <>
                  <View style={styles.hero} testID="alcohol-estimate-hero">
                    <View style={styles.bigRow}>
                      <Text style={styles.big} maxFontSizeMultiplier={FontScaleCap.display}>
                        {morning ? formatClock(estimate.zeroAt) : formatPromile(estimate.now)}
                      </Text>
                      {morning ? null : (
                        <Text style={styles.bigUnit} maxFontSizeMultiplier={FontScaleCap.display}>
                          ‰
                        </Text>
                      )}
                    </View>
                    <Text style={styles.bigCaption} maxFontSizeMultiplier={FontScaleCap.body}>
                      {morning
                        ? t.alcohol.morningCaption(formatZeroAt(estimate.zeroAt, nowMs))
                        : t.alcohol.nowCaption(formatPromile(estimate.low), formatPromile(estimate.high))}
                    </Text>
                  </View>

                  {estimate.rising ? (
                    <View style={styles.row} testID="alcohol-estimate-rising">
                      <View style={styles.rowText}>
                        <Text style={styles.rowName} maxFontSizeMultiplier={FontScaleCap.body}>
                          {t.alcohol.risingTitle(formatPromile(estimate.rising.promile), formatClock(estimate.rising.at))}
                        </Text>
                        <Text style={styles.rowMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                          {t.alcohol.risingHint}
                        </Text>
                      </View>
                    </View>
                  ) : null}

                  {morning && cautiousNow === 0 ? null : (
                    <View style={styles.row}>
                      <View style={styles.rowText}>
                        <Text style={styles.rowName} maxFontSizeMultiplier={FontScaleCap.body}>
                          {morning
                            ? t.alcohol.morningNow(formatPromile(cautiousNow))
                            : t.alcohol.zeroTitle(formatZeroAt(estimate.zeroAt, nowMs))}
                        </Text>
                        <Text style={styles.rowMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                          {morning ? t.alcohol.morningHint : t.alcohol.zeroHint}
                        </Text>
                      </View>
                    </View>
                  )}
                </>
              )}

              <View style={styles.warning}>
                <InfoIcon size={18} color={Colors.foamMuted} />
                <Text style={styles.warningText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.alcohol.warning}
                </Text>
              </View>

              {estimate !== null ? (
                <>
                  <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {t.alcohol.drinksTitle}
                  </Text>
                  {drinkLines(estimate).map((line, index) => (
                    <View key={line.key} style={[styles.row, index > 0 && styles.rowDivided]}>
                      <View style={styles.rowText}>
                        <Text style={styles.rowName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                          {t.alcohol.drinkRow(line.count, line.name)}
                        </Text>
                        <Text style={styles.rowMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                          {t.alcohol.drinkAbv(line.abv.toLocaleString(intlLocale, { maximumFractionDigits: 1 }))}
                        </Text>
                      </View>
                    </View>
                  ))}
                </>
              ) : null}

              {profile ? (
                <View style={[styles.row, styles.rowDivided]}>
                  <Text style={[styles.rowName, styles.rowText]} maxFontSizeMultiplier={FontScaleCap.body}>
                    {t.alcohol.profileRow(
                      profile.sex === 'male' ? t.alcohol.male : t.alcohol.female,
                      profile.age,
                      profile.heightCm,
                      profile.weightKg,
                    )}
                  </Text>
                  <Pressable
                    testID="alcohol-estimate-edit"
                    onPress={onEdit}
                    hitSlop={10}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.door, pressed && styles.pressed]}
                  >
                    <Text style={styles.doorLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                      {t.alcohol.edit}
                    </Text>
                  </Pressable>
                </View>
              ) : null}

              <Pressable
                testID="alcohol-estimate-off"
                onPress={onTurnOff}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, styles.rowDivided, pressed && styles.pressed]}
              >
                <Text style={styles.offLabel} maxFontSizeMultiplier={FontScaleCap.body}>
                  {t.alcohol.turnOff}
                </Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  coasterRow: {
    ...CardSurface.footer,
    marginTop: 12,
    paddingTop: 0,
    paddingBottom: 0,
    minHeight: 48,
  },
  coasterMain: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
    includeFontPadding: false,
    flexShrink: 0,
  },
  coasterMainShrink: {
    flex: 1,
    flexShrink: 1,
  },
  coasterSpacer: {
    flex: 1,
  },
  coasterSide: {
    flex: 1,
    textAlign: 'right',
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  pressed: {
    opacity: 0.75,
  },
  backdrop: {
    flex: 1,
    backgroundColor: withAlpha(Colors.black, 0.6),
    justifyContent: 'flex-end',
  },
  // Bounds live on the wrapper so the ScrollView inside can actually scroll (§7.5).
  cardWrap: {
    width: '100%',
    maxHeight: '92%',
  },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout2,
    borderTopLeftRadius: Radius.cardLarge,
    borderTopRightRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingTop: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    ...softDrop(),
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flexShrink: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  closeButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingTop: Spacing.sm,
  },
  empty: {
    fontFamily: Fonts.ui.medium,
    fontSize: 15,
    lineHeight: 21,
    color: Colors.foamMuted,
    paddingVertical: Spacing.lg,
  },
  hero: {
    alignItems: 'center',
    paddingBottom: Spacing.md,
  },
  bigRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  big: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 72,
    lineHeight: 72 * 1.24,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  bigUnit: {
    fontFamily: Fonts.display.bold,
    fontSize: 30,
    color: Colors.foamMuted,
    includeFontPadding: false,
  },
  bigCaption: {
    marginTop: -8,
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    color: Colors.mutedText,
    textAlign: 'center',
  },
  row: {
    minHeight: 56,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowText: {
    flex: 1,
  },
  rowName: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  rowMeta: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
    marginTop: 2,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: Colors.stout3,
    borderRadius: Radius.medium,
    padding: Spacing.md,
    marginTop: Spacing.xs,
  },
  warningText: {
    flex: 1,
    fontFamily: Fonts.ui.medium,
    fontSize: 14,
    lineHeight: 20,
    color: Colors.foamMuted,
  },
  section: {
    marginTop: Spacing.lg,
    fontFamily: Fonts.display.extrabold,
    fontSize: 18,
    color: Colors.foam,
  },
  door: {
    minHeight: 44,
    justifyContent: 'center',
    paddingLeft: Spacing.sm,
  },
  doorLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
  },
  offLabel: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.mutedText,
  },
});
