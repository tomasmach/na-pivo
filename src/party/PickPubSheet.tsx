/**
 * "Kde sedíš?" — choosing the pub without leaving the hub.
 *
 * The row used to push `/pick-pub`, which is the whole Hospody screen — map,
 * filters, detail — raised as a modal. From a hub that already shows the map
 * that read as jumping to another tab and back. One intent, one sheet (§8):
 * the pubs around you, a field for the one that is not, and "Mimo hospodu".
 * One tap picks and closes; the map behind the scrim never moves.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheetModal } from '@/components/shared/BottomSheetModal';
import { CloseButton } from '@/components/shared/CloseButton';
import { SearchIcon, XIcon } from '@/components/shared/IconGlyph';
import type { NearbyCandidate } from '@/counter/useNearbyPub';
import { geohash8 } from '@/data/geohash';
import { suggestPubLocations } from '@/data/mapyClient';
import { getAllLoadedPubs, hydratePubsSnapshot, type Pub } from '@/data/pubs';
import { t } from '@/i18n';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import {
  dedupePubs,
  mergePickPubResults,
  pickPubRowMeta,
  pubIdentity,
  pubMatchesTerm,
  type PickRow,
} from '@/party/pickPubModel';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { softDrop } from '@/theme/shadows';

/** Around you: the counter's own candidates, nearest first. */
const NEARBY_LIMIT = 6;
const RESULT_LIMIT = 8;
const SEARCH_DEBOUNCE_MS = 250;

function PubRow({
  name,
  meta,
  picked,
  first,
  onPress,
}: {
  name: string;
  meta: string;
  picked: boolean;
  first: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityState={{ selected: picked }}
      accessibilityLabel={name}
    >
      <View style={styles.rowText}>
        <View style={styles.rowNameLine}>
          <Text style={styles.rowName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {name}
          </Text>
          {/* Its own element, so a long name truncates and the mark stays. */}
          {picked ? (
            <Text style={styles.picked} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.liveParty.pickPubPicked}
            </Text>
          ) : null}
        </View>
        {meta ? (
          <Text style={styles.rowMeta} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
            {meta}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function PickPubSheet({
  visible,
  candidates,
  position,
  selectedKey,
  onPick,
  onPickOutside,
  onClose,
}: {
  visible: boolean;
  candidates: NearbyCandidate[];
  /** Stable identity, please: the search effect keys on it. */
  position: { lat: number; lng: number } | null;
  /** The place the hub has — a geohash, `ctx:*` for outside — or null before any pick. */
  selectedKey: string | null;
  onPick: (pub: Pub) => void;
  onPickOutside: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [term, setTerm] = React.useState('');
  // Tagged with the query they answer, so the empty state never shows for a
  // query that is still being answered.
  const [results, setResults] = React.useState<{ query: string; rows: PickRow[]; done: boolean }>({
    query: '',
    rows: [],
    done: true,
  });

  // The local half of search reads the pubs snapshot; the hub fills it only as
  // a side effect of GPS, so with location denied or no fix it would be empty.
  React.useEffect(() => {
    if (visible) void hydratePubsSnapshot();
  }, [visible]);

  // Nothing typed carries over to the next opening: the sheet answers one
  // question at a time.
  const finish = (action: () => void) => {
    setTerm('');
    action();
  };

  const query = term.trim();
  React.useEffect(() => {
    if (query.length < 2) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      // What the phone already knows answers instantly and offline; the
      // backend's suggestions fill in the rest when they arrive.
      const local = dedupePubs(getAllLoadedPubs().filter((pub) => pubMatchesTerm(pub, query)));
      setResults({
        query,
        rows: mergePickPubResults(local, [], position, RESULT_LIMIT),
        done: false,
      });
      void suggestPubLocations({ name: query, near: position }, controller.signal)
        .then((suggestions) => {
          if (controller.signal.aborted) return;
          setResults({
            query,
            rows: mergePickPubResults(local, suggestions, position, RESULT_LIMIT),
            done: true,
          });
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setResults((current) =>
            current.query === query ? { ...current, done: true } : current,
          );
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [position, query]);

  const nearby = React.useMemo<PickRow[]>(
    () =>
      [...candidates]
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, NEARBY_LIMIT)
        .map((candidate) => ({ pub: candidate.pub, distanceMeters: candidate.distanceMeters })),
    [candidates],
  );
  const isPicked = (pub: Pub) => selectedKey !== null && geohash8(pub.lat, pub.lng) === selectedKey;
  const outsidePicked = selectedKey !== null && selectedKey.startsWith('ctx:');
  const showingSearch = query.length >= 2;
  // The previous answer stays on screen while the next one is on its way —
  // a list that blanks between keystrokes reads as broken.
  const rows = showingSearch ? results.rows : nearby;
  const answered = !showingSearch || (results.query === query && results.done);

  return (
    <BottomSheetModal visible={visible} onClose={() => finish(onClose)} keyboardLift>
      <View style={[styles.cardWrap, { marginBottom: -insets.bottom }]}>
        <View style={[styles.card, { paddingBottom: insets.bottom + Spacing.lg }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>
              {t.liveParty.pickPubTitle}
            </Text>
            <CloseButton onPress={() => finish(onClose)} />
          </View>

          <View style={styles.field}>
            <SearchIcon size={17} color={Colors.mutedText} />
            <TextInput
              value={term}
              onChangeText={setTerm}
              placeholder={t.liveParty.pickPubSearch}
              placeholderTextColor={MockColors.fieldHint}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              style={styles.input}
              accessibilityLabel={t.liveParty.pickPubSearch}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
            {/* Our own clear, on both platforms; iOS' clearButtonMode is iOS only
                and the way back to "Kolem tebe" must not depend on backspace. */}
            {term.length > 0 ? (
              <Pressable
                onPress={() => setTerm('')}
                style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
                accessibilityRole="button"
                accessibilityLabel={t.liveParty.pickPubClear}
                hitSlop={8}
              >
                <XIcon size={16} color={Colors.mutedText} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {showingSearch ? null : (
              <Text style={styles.section} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.liveParty.pickPubNearby}
              </Text>
            )}
            {rows.map((row, index) => (
              <PubRow
                key={pubIdentity(row.pub)}
                name={row.pub.name}
                meta={pickPubRowMeta(row.pub, row.distanceMeters)}
                picked={isPicked(row.pub)}
                first={index === 0}
                onPress={() => finish(() => onPick(row.pub))}
              />
            ))}
            {rows.length === 0 && answered ? (
              <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>
                {showingSearch ? t.liveParty.pickPubNoResults : t.liveParty.pickPubNoNearby}
              </Text>
            ) : null}

            {/* The one place that is not a pub, shaped like every other row:
                "doma na zahradě" answers the same question the pubs do. */}
            {showingSearch ? null : (
              <PubRow
                name={t.pubPicker.outsideTitle}
                meta={t.pubPicker.outsideFact}
                picked={outsidePicked}
                first={false}
                onPress={() => finish(onPickOutside)}
              />
            )}
          </ScrollView>
        </View>
      </View>
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.65 },
  cardWrap: { width: '100%', maxHeight: '92%' },
  card: {
    flexShrink: 1,
    backgroundColor: Colors.stout,
    borderTopLeftRadius: Radius.card,
    borderTopRightRadius: Radius.card,
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.sm,
    ...softDrop(),
  },
  grabber: {
    width: 44,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.foam, 0.22),
    alignSelf: 'center',
    marginBottom: Spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...MockType.titleS, color: Colors.foam },
  // Every text field, everywhere (§20.9): lighter than what it sits on, with
  // a hairline, placeholder in foam.
  field: {
    marginTop: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    height: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: MockColors.field,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: MockColors.fieldBorder,
  },
  input: { flex: 1, ...MockType.body, color: Colors.foam, paddingVertical: 0 },
  clear: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  list: { flexGrow: 0, flexShrink: 1 },
  listContent: { paddingBottom: Spacing.sm },
  // Quieter than the sheet title: the list is the content, this only says
  // what the distances are measured from.
  section: { ...MockType.bodySmall, color: Colors.mutedText, marginTop: MockLayout.controlGap },
  // The canonical sheet row (§7.3).
  row: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  rowFirst: { borderTopWidth: 0, marginTop: Spacing.xs },
  rowText: { flex: 1, minWidth: 0 },
  rowNameLine: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.sm },
  rowName: { ...MockType.bodySemibold, color: Colors.foam, flexShrink: 1 },
  rowMeta: { ...MockType.bodySmall, color: Colors.mutedText, marginTop: 2 },
  picked: { ...MockType.label, color: Colors.amber, flexShrink: 0 },
  empty: {
    ...MockType.bodySmall,
    color: Colors.mutedText,
    minHeight: HitArea.min,
    paddingVertical: Spacing.md,
  },
});
