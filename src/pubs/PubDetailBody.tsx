/**
 * DESIGN MOCK — the pub, in detail: everything except the map.
 *
 * Split out because the same detail is now read in two places and must not be
 * two designs:
 *
 *   `/pub/[id]`   a pushed screen, with the map full-bleed above this
 *   the map sheet  the same body swapped into the places card, closed with an X
 *
 * On the map there is no second map above it — you are already looking at the
 * one behind the sheet, and drawing another of the same pin would be the screen
 * arguing with itself.
 *
 * The section that only this app can have is "Co se tu dělo": your own history
 * with the place and the parties that happened here. It is the answer to the
 * question the list row deliberately does NOT answer — the row shows a heart to
 * say "you have been here", and the count and the nights live down here.
 *
 * Deliberately absent: how much you have spent here. The product does not do
 * accounting. The reference price of a beer is a property of the PUB and stays.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  BeerIcon,
  MapPinIcon,
  StarIcon,
  UsersIcon,
} from '@/components/shared/IconGlyph';
import { CloseButton } from '@/components/shared/CloseButton';
import { SectionBreak } from '@/mocks/SectionBreak';
import { StatGrid } from '@/mocks/StatGrid';
import { MockLayout, MockType } from '@/mocks/mockTheme';
import type { MockPub } from '@/pubs/mockPubs';
import { UnderlineTabs } from '@/components/shared/UnderlineTabs';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';

/** What happened here. Real data comes from PartyEvening + PubVisit. */
const MOCK_NIGHTS = [
  { id: 'n1', title: 'Čtvrteční jízda', when: 've čtvrtek', people: 5, beers: 9 },
  { id: 'n2', title: 'Rychlovka po práci', when: '18. 7.', people: 2, beers: 4 },
  { id: 'n3', title: 'Po zápase', when: '2. 7.', people: 4, beers: 11 },
];

const MOCK_TAPS = [
  { name: 'Matuška Raptor', priceCzk: 69 },
  { name: 'Únětická 12°', priceCzk: 52 },
  { name: 'Pilsner Urquell', priceCzk: 59 },
];

/**
 * A wide pill, not a disc with a caption under it.
 *
 * Discs belong to the party hub, where five actions have to fit one row and
 * every one of them is a verb you already know. Here there are two, both need
 * their words, and a label hanging under a circle is a caption on a control —
 * the label IS the control, so it goes inside it.
 */
function PillAction({
  label,
  children,
  primary,
  onPress,
}: {
  label: string;
  children: React.ReactNode;
  /** Exactly one per screen (§6.1). */
  primary?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        primary && styles.actionPrimary,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      {children}
      <Text
        style={[styles.actionLabel, primary && styles.actionLabelPrimary]}
        numberOfLines={1}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * "Info", not "Statistiky". The tab holds what the place IS — your history with
 * it and what is on tap — and calling three counters and a price list
 * "statistics" promised a chart that was never coming.
 */
const TABS = ['Info', 'Aktivita'] as const;

export function PubDetailBody({
  pub,
  onClose,
}: {
  pub: MockPub;
  /** Only in the sheet: there is no stack to go back through, so the detail
   *  needs its own way out. On the pushed screen the native back button is it. */
  onClose?: () => void;
}) {
  const [tab, setTab] = React.useState<(typeof TABS)[number]>('Info');
  const visited = pub.lastParty !== null;

  return (
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text
            style={styles.title}
            numberOfLines={2}
            maxFontSizeMultiplier={FontScaleCap.heading}
          >
            {pub.name}
          </Text>
          {onClose ? <CloseButton onPress={onClose} label="Zavřít detail" /> : null}
        </View>

        <View style={styles.metaRow}>
          <StarIcon size={13} color={Colors.amber} />
          <Text style={styles.meta} allowFontScaling={false}>
            {pub.rating.toFixed(1)}
          </Text>
          <Text style={styles.metaDot} allowFontScaling={false}>
            ·
          </Text>
          <Text
            style={[styles.meta, { color: pub.open ? Colors.open : Colors.mutedText }]}
            allowFontScaling={false}
          >
            {pub.open ? `Otevřeno ${pub.hours}` : `Zavřeno, ${pub.hours}`}
          </Text>
          <Text style={styles.metaDot} allowFontScaling={false}>
            ·
          </Text>
          <Text style={styles.meta} allowFontScaling={false}>
            {pub.distance}
          </Text>
        </View>

        <Text style={styles.address} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {pub.address}
        </Text>

        {/* The two things you do from here. Starting a night is the primary;
            navigating is the escape hatch to another app. */}
        <View style={styles.actions}>
          <PillAction label="Navigovat">
            <MapPinIcon size={18} color={Colors.foam} />
          </PillAction>
          <PillAction label="Začít tu večer" primary>
            <BeerIcon size={18} color={Colors.stout} />
          </PillAction>
        </View>

        {/* Two tabs, the same split the profile uses: where this pub stands,
            and what has happened in it. Stacked, the history pushed the tap
            list off the bottom of a screen nobody scrolled that far. */}
        <UnderlineTabs
                options={TABS}
                value={tab}
                onChange={setTab}
                inset={MockLayout.screenPad}
              />

        {tab === 'Info' && visited ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
              Co se tu dělo
            </Text>
            <StatGrid
              columns={3}
              compact
              stats={[
                { label: 'Byli jste tu', value: '3×' },
                { label: 'Vypito', value: '24' },
                { label: 'Naposled', value: 'čt' },
              ]}
            />
          </View>
        ) : null}

        {tab === 'Info' ? (
          <View style={styles.tapSection}>
            <SectionBreak title="Na čepu" />
            {MOCK_TAPS.map((tap, index) => (
              <View key={tap.name} style={[styles.tapRow, index === 0 && styles.tapFirst]}>
                <Text
                  style={styles.tapName}
                  numberOfLines={1}
                  maxFontSizeMultiplier={FontScaleCap.body}
                >
                  {tap.name}
                </Text>
                <Text style={styles.tapPrice} allowFontScaling={false}>
                  {tap.priceCzk} Kč
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {tab === 'Aktivita' ? (
          <View style={styles.section}>
            {MOCK_NIGHTS.map((night) => (
              <Pressable
                key={night.id}
                style={({ pressed }) => [styles.nightRow, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={night.title}
              >
                <View style={styles.grow}>
                  <Text
                    style={styles.nightTitle}
                    numberOfLines={1}
                    maxFontSizeMultiplier={FontScaleCap.body}
                  >
                    {night.title}
                  </Text>
                  <Text style={styles.nightMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                    {night.when} · {night.beers} piv
                  </Text>
                </View>
                <View style={styles.nightPeople}>
                  <UsersIcon size={13} color={Colors.mutedText} />
                  <Text style={styles.nightMeta} allowFontScaling={false}>
                    {night.people}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={styles.mockNote} maxFontSizeMultiplier={FontScaleCap.body}>
          Design mock — data jsou napevno.
        </Text>
      </View>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  grow: { flex: 1 },
  pressed: { opacity: 0.65 },
  body: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.md },

  back: { position: 'absolute', left: MockLayout.screenPad },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha('#000000', 0.6),
  },

  title: {
    flex: 1, fontSize: 30, fontWeight: '800', color: Colors.foam, letterSpacing: -0.6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 4 },
  meta: { fontSize: 14, fontWeight: '600', color: Colors.foam },
  metaDot: { fontSize: 14, color: Colors.mutedText },
  address: { fontSize: 14, fontWeight: '400', color: Colors.mutedText, marginTop: 2 },

  // Packeta's proportions: the pair does not stretch to the full width, and each
  // is a touch taller than the standard row button. Edge-to-edge they read as a
  // segmented control rather than as two separate actions.
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.lg,
    alignSelf: 'flex-start',
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 52,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout3,
  },
  actionPrimary: { backgroundColor: Colors.amber },
  actionLabel: { fontSize: 15, fontWeight: '700', color: Colors.foam },
  actionLabelPrimary: { color: Colors.stout },


  section: { marginTop: MockLayout.sectionGap, gap: Spacing.sm },
  yours: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.amber,
    marginTop: Spacing.xs,
  },
  tapSection: { gap: Spacing.sm },
  sectionTitle: { ...MockType.titleS, color: Colors.foam },

  nightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  nightTitle: { ...MockType.bodySemibold, color: Colors.foam },
  nightMeta: { fontSize: 13, fontWeight: '400', color: Colors.mutedText, marginTop: 1 },
  nightPeople: { flexDirection: 'row', alignItems: 'center', gap: 4 },

  tapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  tapFirst: { borderTopWidth: 0 },
  tapName: { flex: 1, ...MockType.body, color: Colors.foam },
  tapPrice: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.foam,
    fontVariant: ['tabular-nums'],
  },

  mockNote: {
    fontSize: 12,
    fontWeight: '400',
    color: Colors.mutedText,
    textAlign: 'center',
    marginTop: MockLayout.sectionGap,
  },
});
