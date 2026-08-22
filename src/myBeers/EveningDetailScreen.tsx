/**
 * Evening detail — the full breakdown of one evening, plus the private pub
 * rating and the public mapping entry. Reached from the diary by the session's
 * `startedAt` (a stable per-session identity). Drinks can be corrected, removed
 * or added back into the same evening while the personal rating stays editable.
 *
 * 3.0 pass. The screen used to be six bordered cards stacked on top of each
 * other, each opened by an amber 11pt uppercase kicker, with three filled amber
 * controls competing on one scroll. It is now the same content on the stout
 * ground, split by `SectionBreak` (§4.1), with exactly one filled amber surface
 * — "Vyvěsit na Výčep", the only action here that leaves the phone.
 *
 * The one structural change: "CO PADLO" and "ZAPSANÉ NÁPOJE" were two lists of
 * the same drinks, one read-only and one editable, differing only in whether
 * draft and bottled collapsed into one row. That is the duplicate surface §0.6
 * asks you to merge, so there is now one list — what you drank, what it cost,
 * and the two controls that fix it — with the total under it.
 *
 * Nothing moved off the screen: the rename dialog, the per-drink retract, the
 * back-dated add, publishing, sharing, rating and mapping are all still here.
 */

import React, { useMemo, useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { MockLayout } from '@/mocks/mockTheme';
import { SectionBreak } from '@/mocks/SectionBreak';
import { StatGrid, type Stat } from '@/mocks/StatGrid';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { cs, formatVolume } from '@/i18n/cs';
import { formatPrice } from '@/utils/currency';
import {
  enqueueDrink,
  updateQueuedDrinkBeerName,
  removeQueuedDrink,
  flushDrinksQueue,
} from '@/data/drinksQueue';
import { buildDrinkEntry } from '@/data/drinksClient';
import { enqueueDelete } from '@/data/deleteDrinksQueue';
import { enqueueDrinkUpdate, removeQueuedDrinkUpdate } from '@/data/updateDrinksQueue';
import { deleteVisitByClientId, syncVisit } from '@/data/visitsSync';
import {
  BeerIcon,
  ChevronLeftIcon,
  HandPlatterIcon,
  HouseIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  Share2Icon,
  TreePineIcon,
} from '@/components/shared/IconGlyph';
import { GlassIconButton } from '@/components/shared/GlassIconButton';
import {
  contextFromPubKey,
  isContextPubKey,
  normalizeDrinkType,
  normalizePlaceContext,
} from '@/drinks/drinkTypes';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  useTallyStore,
  findSessionByStart,
  sessionDrinkTypeCounts,
  sessionTotalCzk,
  drinkingDayKey,
  type TallyDrink,
  type TallySession,
} from '@/stores/tallyStore';
import { useVycepStore } from '@/stores/vycepStore';
import { buildNightSummary, sessionsOfNight } from '@/vycep/nightModel';
import { PublishNightSheet } from '@/vycep/PublishNightSheet';
import { ShareNightModal } from '@/vycep/ShareNightModal';
import {
  sessionDrinkActionGroups,
  eveningDateLabel,
  type DrinkActionGroup,
} from '@/myBeers/eveningModel';
import { PubRatingControl } from '@/myBeers/PubRatingControl';
import { MapPubEntry } from '@/components/amenities/MapPubEntry';
import { showAppDialog } from '@/components/shared/AppDialog';
import { RenamePromptSheet } from '@/components/shared/RenamePromptSheet';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { BeerFormModal, type BeerFormResult } from '@/counter/BeerFormModal';
import { generateUuidV4 } from '@/data/account';
import { decodeGeohash8 } from '@/data/geohash';
import { trackClientEvent } from '@/data/telemetryClient';
import { useToastStore } from '@/stores/toastStore';
import { useAccountStore } from '@/stores/accountStore';
import { deriveReconciledDiarySessions } from '@/data/diarySync';

function latestDrinkAt(session: TallySession): string {
  let latest = session.startedAt;
  let latestMs = Date.parse(latest);
  for (const drink of session.drinks) {
    const atMs = Date.parse(drink.at);
    if (Number.isFinite(atMs) && (!Number.isFinite(latestMs) || atMs > latestMs)) {
      latest = drink.at;
      latestMs = atMs;
    }
  }
  return latest;
}

/** How long the evening ran, measured between its first and last drink. */
function sessionSpanMs(session: TallySession): number {
  const stamps = session.drinks
    .map((drink) => Date.parse(drink.at))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  return stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0] : 0;
}

export default function EveningDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const now = new Date();

  const params = useLocalSearchParams<{ startedAt?: string; visitClientId?: string }>();
  const startedAt = typeof params.startedAt === 'string' ? params.startedAt : '';
  const visitClientId =
    typeof params.visitClientId === 'string' ? params.visitClientId : '';

  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const removeDrinkFromSession = useTallyStore((s) => s.removeDrinkFromSession);
  const updateDrinkNameInSession = useTallyStore((s) => s.updateDrinkNameInSession);
  const addDrinkToSession = useTallyStore((s) => s.addDrinkToSession);
  const markDrinkSynced = useTallyStore((s) => s.markDrinkSynced);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const showToast = useToastStore((s) => s.show);
  const diarySnapshot = useAccountStore((state) => {
    const snapshot = state.diarySnapshot;
    if (!snapshot || snapshot.accountId !== state.session?.accountId) return null;
    return snapshot.data;
  });
  const [editingGroup, setEditingGroup] = useState<DrinkActionGroup | null>(null);
  const [addingDrink, setAddingDrink] = useState(false);
  const [addDrinkFormNonce, setAddDrinkFormNonce] = useState(0);
  const [publishSheetVisible, setPublishSheetVisible] = useState(false);
  const [shareModalVisible, setShareModalVisible] = useState(false);

  const localSession = useMemo(
    () => findSessionByStart(current, history, startedAt),
    [current, history, startedAt],
  );
  const remoteSession = useMemo(() => {
    if (!visitClientId || !diarySnapshot) return null;
    const localSessions = current && current.drinks.length > 0 ? [current, ...history] : history;
    return (
      deriveReconciledDiarySessions(diarySnapshot, localSessions).find(
        (item) => item.source === 'remote' && item.session.clientId === visitClientId,
      )?.session ?? null
    );
  }, [current, diarySnapshot, history, visitClientId]);
  const session = localSession ?? remoteSession;
  const isEditable = localSession !== null;

  // The Výčep publishes the whole drinking day (a pub crawl is one night), so
  // the summary re-groups every session sharing this evening's drinking day.
  const nightSummary = useMemo(() => {
    if (!session || !isEditable) return null;
    const dayKey = drinkingDayKey(new Date(session.startedAt));
    return buildNightSummary(sessionsOfNight(current, history, dayKey));
  }, [session, isEditable, current, history]);
  const publishedRecord = useVycepStore((s) =>
    nightSummary ? s.published[nightSummary.clientKey] : undefined,
  );
  const drinkActionGroups = useMemo(() => sessionDrinkActionGroups(session), [session]);

  // The hero numbers. Beers lead because beers are what this app counts; the
  // rest of the glasses get one honest column rather than four.
  const heroStats: Stat[] = useMemo(() => {
    if (!session) return [];
    const counts = sessionDrinkTypeCounts(session);
    const others = counts.wine + counts.shot + counts.soft_drink;
    const spentCzk = sessionTotalCzk(session);
    const spanMs = sessionSpanMs(session);
    const stats: Stat[] = [{ label: cs.myBeers.statBeers, value: String(counts.beer) }];
    if (others > 0) stats.push({ label: cs.myBeers.statOther, value: String(others) });
    stats.push({
      label: cs.diary.factSpent,
      value: spentCzk > 0 ? formatPrice(spentCzk, priceCurrency) : cs.diary.factEmpty,
    });
    stats.push({
      label: cs.diary.factSpan,
      value: spanMs > 0 ? cs.stats.span(spanMs) : cs.diary.factEmpty,
    });
    return stats;
  }, [priceCurrency, session]);

  const addDrinkSeed = useMemo(() => {
    if (!session?.drinks.length) return null;
    const drink = session.drinks[session.drinks.length - 1];
    return {
      name: drink.beerName,
      priceCzk: drink.priceCzk,
      volumeMl: drink.volumeMl,
    };
  }, [session]);

  const handleSaveDrinkName = (group: DrinkActionGroup, beerName: string) => {
    if (!session) return;
    const trimmed = beerName.trim();
    if (!trimmed) {
      showAppDialog({
        title: cs.myBeers.editDrinkTitle,
        message: cs.myBeers.editDrinkEmpty,
      });
      return;
    }
    const changedDrinks = group.drinks.filter((drink) => drink.beerName !== trimmed);
    setEditingGroup(null);
    if (changedDrinks.length === 0) return;

    for (const drink of changedDrinks) {
      updateDrinkNameInSession(session.startedAt, drink.id, trimmed);
    }

    const nextSession = findSessionByStart(
      useTallyStore.getState().current,
      useTallyStore.getState().history,
      session.startedAt,
    );
    if (nextSession) syncVisit(nextSession, new Date().toISOString());

    for (const drink of changedDrinks) {
      void updateQueuedDrinkBeerName(drink.id, trimmed).then((updateState) => {
        if (updateState !== 'queued') {
          void enqueueDrinkUpdate({ client_id: drink.id, beer_name: trimmed });
        }
      });
    }
  };

  const handleDeleteDrink = (drink: TallyDrink) => {
    if (!session) return;
    showAppDialog({
      title: cs.myBeers.deleteDrinkTitle,
      message: cs.myBeers.deleteDrinkBody,
      buttons: [
        { text: cs.myBeers.deleteDrinkCancel, style: 'cancel' },
        {
          text: cs.myBeers.deleteDrinkConfirm,
          style: 'destructive',
          onPress: () => {
            const removed = removeDrinkFromSession(session.startedAt, drink.id);
            if (!removed) return;
            if (removed.remainingDrinks > 0) {
              const nextSession = findSessionByStart(
                useTallyStore.getState().current,
                useTallyStore.getState().history,
                session.startedAt,
              );
              syncVisit(nextSession, new Date().toISOString());
            } else {
              deleteVisitByClientId(removed.sessionClientId);
            }
            void removeQueuedDrinkUpdate(removed.drinkId);
            void removeQueuedDrink(removed.drinkId).then((pulledFromQueue) => {
              // Already delivered (or its POST is in flight): wait for the active
              // flush to settle before the DELETE so it can't race ahead of an
              // in-flight POST and recreate the drink after we deleted it.
              if (!pulledFromQueue) {
                void flushDrinksQueue()
                  .then(() => enqueueDelete(removed.drinkId))
                  .catch(() => undefined);
              }
            });
          },
        },
      ],
    });
  };

  const openAddDrink = () => {
    setAddDrinkFormNonce((value) => value + 1);
    setAddingDrink(true);
  };

  const handleAddDrink = (result: BeerFormResult) => {
    if (!session) return;
    setAddingDrink(false);

    const id = generateUuidV4();
    const isCurrentEvening = current?.clientId === session.clientId;
    const drankAt = isCurrentEvening ? new Date().toISOString() : latestDrinkAt(session);
    const placeContext = normalizePlaceContext(
      session.placeContext ?? contextFromPubKey(session.pubKey),
    );
    const updatedSession = addDrinkToSession(session.clientId, {
      id,
      beerName: result.name,
      drinkType: result.drinkType,
      priceCzk: result.priceCzk,
      volumeMl: result.volumeMl,
      servingType: result.servingType,
      at: drankAt,
    });
    if (!updatedSession) return;

    syncVisit(updatedSession, new Date().toISOString());
    const pubIdentity =
      placeContext === 'pub'
        ? {
            externalId: session.pubExternalId ?? null,
            name: session.pubName,
            city: session.pubCity,
            ...decodeGeohash8(session.pubKey),
          }
        : { placeContext };
    const entry = buildDrinkEntry(
      {
        ...pubIdentity,
        drinkType: result.drinkType,
        beer: {
          name: result.name,
          priceCzk: result.priceCzk,
          volumeMl: result.volumeMl,
          servingType: result.servingType,
        },
        drankAt,
      },
      id,
    );
    void enqueueDrink(entry).then((result) => {
      if (result === 'delivered') markDrinkSynced(id);
    }).catch(() => undefined);
    void trackClientEvent({
      event: 'drink_added',
      context: {
        had_active_session: isCurrentEvening,
        backdated: !isCurrentEvening,
        source: 'evening_detail',
        ...(result.drinkType === 'beer' ? {} : { drink_type: result.drinkType }),
        ...(placeContext === 'pub' ? {} : { place_context: placeContext }),
      },
    });
    showToast(cs.myBeers.addDrinkToEveningSaved, {
      icon: <BeerIcon size={20} color={Colors.amber} />,
    });
  };

  const context = session ? contextFromPubKey(session.pubKey) : 'pub';
  // An icon in a detail usually decorates a title that already said everything
  // (§19) — but "Doma" and "Venku" are the two cases where the place is not a
  // pub name and the glyph carries what the words cannot.
  const ContextIcon = context === 'private' ? HouseIcon : context === 'outdoors' ? TreePineIcon : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {/* The bar carries the way out and nothing else: the date and the place
          are the page's own title block, where a name too long for a centred
          header still gets the whole width. */}
      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <GlassIconButton size={HitArea.min} accessibilityLabel={cs.a11y.backButton} onPress={() => router.back()}>
          <ChevronLeftIcon size={20} color={Colors.foam} />
        </GlassIconButton>
      </View>

      {!session ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.myBeers.eveningGoneTitle}
          </Text>
        </View>
      ) : (
        <KeyboardAwareScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
        >
          <Text style={styles.eyebrow} maxFontSizeMultiplier={FontScaleCap.body}>
            {eveningDateLabel(session.startedAt, now)}
          </Text>
          <View style={styles.titleRow}>
            {ContextIcon ? <ContextIcon size={20} color={Colors.mutedText} /> : null}
            <Text style={styles.title} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
              {session.pubName || cs.diary.noPub}
            </Text>
          </View>
          {/* Four columns only when there genuinely is a fourth number —
              `StatGrid` does not space a wrapped row, so the four-stat evening
              has to fit on one line rather than fold under itself. */}
          <View style={styles.heroStats}>
            <StatGrid
              columns={heroStats.length > 3 ? 4 : 3}
              compact={heroStats.length > 3}
              stats={heroStats}
            />
          </View>

          {/* One list, not two. Each row is what you drank, how many and what it
              cost, and carries the two controls that fix it. */}
          <SectionBreak title={cs.myBeers.breakdownTitle} inset={MockLayout.screenPad} />
          {drinkActionGroups.map((group, index) => (
            <View key={group.key} style={[styles.drinkRow, index > 0 && styles.drinkRowDivider]}>
              <View style={styles.drinkInfo}>
                <Text style={styles.drinkName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                  {group.volumeMl ? `${group.name} · ${formatVolume(group.volumeMl)}` : group.name}
                  {group.drinkType !== 'beer' ? ` · ${cs.counter.drinkTypeLabel(group.drinkType)}` : ''}
                  {group.count > 1 ? ` · ${group.count}×` : ''}
                </Text>
                <Text style={styles.drinkMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                  {[
                    group.servingType ? cs.counter.servingTypeLabel(group.servingType) : null,
                    group.pricedCount === group.count
                      ? group.count > 1
                        ? cs.myBeers.drinkGroupTotal(formatPrice(group.totalCzk, priceCurrency))
                        : formatPrice(group.totalCzk, priceCurrency)
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || cs.diary.factEmpty}
                </Text>
              </View>
              {/* Bare glyphs on 44pt targets. Two bordered discs inside a
                  bordered card was a frame on a frame on a frame (§14.10).
                  Remote evenings are factual records, so they render without
                  the controls that would mutate local state. */}
              {isEditable ? (
                <View style={styles.drinkActions}>
                  <Pressable
                    onPress={() => setEditingGroup(group)}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.myBeers.editDrink}
                  >
                    <PencilIcon size={18} color={Colors.foamMuted} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteDrink(group.drinks[group.drinks.length - 1])}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                    accessibilityRole="button"
                    accessibilityLabel={cs.myBeers.deleteDrink}
                  >
                    <MinusIcon size={18} color={Colors.mutedText} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))}

          <View style={[styles.drinkRow, styles.totalRow]}>
            <Text style={styles.totalLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.myBeers.totalLabel}
            </Text>
            <Text style={styles.totalValue} allowFontScaling={false}>
              {formatPrice(sessionTotalCzk(session), priceCurrency)}
            </Text>
          </View>

          {isEditable ? (
            <Pressable
              onPress={openAddDrink}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel={cs.a11y.myBeersAddDrinkToEvening}
            >
              <PlusIcon size={16} color={Colors.amber} />
              <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.myBeers.addDrinkToEvening}
              </Text>
            </Pressable>
          ) : null}

          {/* Výčep — hang the night on the feed and/or share it as a story.
              Only a night with something on it qualifies. */}
          {nightSummary ? (
            <>
              <SectionBreak title={cs.vycep.sectionTitle} inset={MockLayout.screenPad} />
              <Text style={styles.body} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.vycep.publishEntryBody}
              </Text>
              {publishedRecord ? (
                <Text style={styles.publishedState} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.vycep.publishedState(
                    publishedRecord.visibility === 'public'
                      ? cs.vycep.visibilityChipWorld
                      : cs.vycep.visibilityChipFriends,
                  )}
                </Text>
              ) : null}
              {/* The one filled amber surface on this screen (§2.2): the single
                  action that takes the evening off this phone. */}
              <Pressable
                onPress={() => setPublishSheetVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.publishNightButton}
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
              >
                <HandPlatterIcon size={17} color={Colors.stout} />
                <Text style={styles.primaryText} maxFontSizeMultiplier={FontScaleCap.heading}>
                  {publishedRecord ? cs.vycep.updateCta : cs.vycep.publishEntryTitle}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setShareModalVisible(true)}
                accessibilityRole="button"
                accessibilityLabel={cs.a11y.shareNightButton}
                style={({ pressed }) => [styles.secondary, styles.secondaryTight, pressed && styles.pressed]}
              >
                <Share2Icon size={16} color={Colors.amber} />
                <Text style={styles.secondaryText} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.vycep.shareNightCta}
                </Text>
              </Pressable>
            </>
          ) : null}

          {/* Rating + public mapping are pub concepts — an outside evening
              ("Doma / na chatě") has nothing to rate or map. The band between
              them keeps the private/public split obvious now that neither of
              them is a card of its own. */}
          {!isContextPubKey(session.pubKey) ? (
            <>
              <SectionBreak inset={MockLayout.screenPad} />
              <PubRatingControl pubKey={session.pubKey} pubName={session.pubName} />

              <SectionBreak inset={MockLayout.screenPad} />
              <View style={styles.mapEntry}>
                <MapPubEntry pubKey={session.pubKey} pubName={session.pubName} />
              </View>
            </>
          ) : null}
        </KeyboardAwareScrollView>
      )}
      {nightSummary ? (
        <>
          <PublishNightSheet
            visible={publishSheetVisible}
            night={nightSummary}
            onClose={() => setPublishSheetVisible(false)}
          />
          <ShareNightModal
            visible={shareModalVisible}
            night={nightSummary}
            onClose={() => setShareModalVisible(false)}
          />
        </>
      ) : null}
      <EditDrinkNameModal
        group={editingGroup}
        onCancel={() => setEditingGroup(null)}
        onSave={handleSaveDrinkName}
      />
      <BeerFormModal
        visible={addingDrink}
        mode="add"
        beer={addDrinkSeed}
        initialDrinkType={normalizeDrinkType(
          session?.drinks[session.drinks.length - 1]?.drinkType,
        )}
        placeContext={normalizePlaceContext(
          session?.placeContext ?? contextFromPubKey(session?.pubKey ?? ''),
        )}
        initialServingType={session?.drinks[session.drinks.length - 1]?.servingType}
        formKey={addDrinkFormNonce}
        titleOverride={cs.myBeers.addDrinkToEveningTitle}
        submitLabelOverride={cs.myBeers.addDrinkToEveningSubmit}
        onCancel={() => setAddingDrink(false)}
        onSubmit={handleAddDrink}
      />
    </SafeAreaView>
  );
}

function EditDrinkNameModal({
  group,
  onCancel,
  onSave,
}: {
  group: DrinkActionGroup | null;
  onCancel: () => void;
  onSave: (group: DrinkActionGroup, beerName: string) => void;
}) {
  return group ? (
    <EditDrinkNameForm key={group.key} group={group} onCancel={onCancel} onSave={onSave} />
  ) : null;
}

function EditDrinkNameForm({
  group,
  onCancel,
  onSave,
}: {
  group: DrinkActionGroup;
  onCancel: () => void;
  onSave: (group: DrinkActionGroup, beerName: string) => void;
}) {
  const [name, setName] = useState(group.name);
  const canSubmit = name.trim().length > 0 && name.trim() !== group.name.trim();

  return (
    <RenamePromptSheet
      visible
      title={cs.myBeers.editDrinkGroupTitle(group.count)}
      value={name}
      placeholder={cs.myBeers.editDrinkPlaceholder}
      inputLabel={cs.myBeers.editDrinkPlaceholder}
      cancelLabel={cs.myBeers.editDrinkCancel}
      saveLabel={cs.myBeers.editDrinkSave}
      maxLength={80}
      canSubmit={canSubmit}
      onChange={setName}
      onCancel={onCancel}
      onSubmit={() => onSave(group, name)}
    />
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.stout },
  pressed: { opacity: 0.65 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: Spacing.sm,
    paddingHorizontal: MockLayout.screenPad,
  },

  scroll: { flex: 1 },
  // One width through the whole app (§20.1). The sections bleed past exactly
  // this much, so no host may add a second padding on top of it.
  scrollContent: {
    paddingHorizontal: MockLayout.screenPad,
    paddingBottom: Spacing.xxl,
  },

  eyebrow: {
    fontWeight: '500',
    fontSize: 14,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: 2,
  },
  title: {
    flexShrink: 1,
    fontWeight: '800',
    fontSize: 28,
    letterSpacing: -0.5,
    color: Colors.foam,
    includeFontPadding: false,
  },
  heroStats: { marginTop: MockLayout.controlGap },

  // 60 is the reading minimum for a one-line row; 44 is the minimum for
  // touching it, and a list packed to the touch minimum reads as a table (§4.1).
  drinkRow: {
    minHeight: 60,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: Spacing.sm,
  },
  drinkRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.08),
  },
  drinkInfo: { flex: 1, minWidth: 0 },
  drinkName: {
    fontWeight: '600',
    fontSize: 16,
    color: Colors.foam,
    includeFontPadding: false,
  },
  drinkMeta: {
    marginTop: 2,
    fontWeight: '400',
    fontSize: 13,
    color: Colors.mutedText,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },
  drinkActions: { flexDirection: 'row', alignItems: 'center' },
  iconButton: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },

  totalRow: {
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  totalLabel: {
    fontWeight: '600',
    fontSize: 16,
    color: Colors.mutedText,
    includeFontPadding: false,
  },
  totalValue: {
    fontWeight: '800',
    fontSize: 20,
    color: Colors.foam,
    includeFontPadding: false,
    fontVariant: ['tabular-nums'],
  },

  body: {
    fontWeight: '400',
    fontSize: 15,
    lineHeight: 21,
    color: Colors.foamMuted,
  },
  publishedState: {
    marginTop: 6,
    fontWeight: '600',
    fontSize: 13,
    color: Colors.amber,
  },

  primary: {
    marginTop: MockLayout.controlGap,
    height: MockLayout.buttonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
  },
  primaryText: {
    fontWeight: '700',
    fontSize: 16,
    color: Colors.stout,
    includeFontPadding: false,
  },
  // Outline, never filled (§6.2).
  secondary: {
    marginTop: MockLayout.controlGap,
    minHeight: MockLayout.buttonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.18),
    backgroundColor: withAlpha(Colors.amber, 0.06),
  },
  secondaryTight: { marginTop: Spacing.sm },
  secondaryText: {
    fontWeight: '600',
    fontSize: 15,
    color: Colors.amber,
    includeFontPadding: false,
  },

  mapEntry: { marginTop: Spacing.lg },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
    paddingBottom: 60,
  },
  emptyTitle: {
    fontWeight: '800',
    fontSize: 22,
    color: Colors.foam,
    textAlign: 'center',
  },
});
