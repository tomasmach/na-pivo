/**
 * Evening detail — the full breakdown of one drinking evening plus the private
 * pub rating. Reached from the "Moje piva" list by the session's `startedAt`
 * (a stable per-session identity). Drinks can be corrected, removed or added
 * back into the same evening while the personal pub rating stays editable.
 */

import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';

import { Colors } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
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
  MapPinIcon,
  MinusIcon,
  PencilIcon,
  PlusIcon,
  Share2Icon,
  TreePineIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
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
  sessionBreakdown,
  sessionDrinkActionGroups,
  sessionDrinkSummary,
  eveningDateLabel,
  type DrinkActionGroup,
} from '@/myBeers/eveningModel';
import { EveningBreakdown } from '@/myBeers/EveningBreakdown';
import { PubRatingControl } from '@/myBeers/PubRatingControl';
import { MapPubEntry } from '@/components/amenities/MapPubEntry';
import { showAppDialog } from '@/components/shared/AppDialog';
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

  const breakdown = useMemo(() => sessionBreakdown(session), [session]);
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
    void enqueueDrink(entry).then((delivered) => {
      if (delivered) markDrinkSynced(id);
    });
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel={cs.a11y.backButton}
          hitSlop={4}
        >
          <ChevronLeftIcon size={22} color={Colors.foam} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {session ? eveningDateLabel(session.startedAt, now) : cs.myBeers.title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>

      {!session ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
            {cs.myBeers.emptyTitle}
          </Text>
        </View>
      ) : (
        <KeyboardAwareScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
        >
          {/* Place + summary (an outside evening shows its context icon) */}
          <View style={styles.card}>
            <View style={styles.pubRow}>
              {(() => {
                const context = contextFromPubKey(session.pubKey);
                const Icon =
                  context === 'private' ? HouseIcon : context === 'outdoors' ? TreePineIcon : MapPinIcon;
                return <Icon size={18} color={Colors.amber} />;
              })()}
              <Text style={styles.pubName} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
                {session.pubName || cs.diary.noPub}
              </Text>
            </View>
            <Text style={styles.summary} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.myBeers.summary(
                sessionDrinkSummary(session),
                formatPrice(sessionTotalCzk(session), priceCurrency),
              )}
            </Text>
          </View>

          {/* Breakdown */}
          <View style={styles.card}>
            <View style={styles.cardSectionHeader}>
              <Text style={styles.cardSectionHeaderText}>{cs.myBeers.breakdownHeader}</Text>
            </View>
            <EveningBreakdown
              lines={breakdown}
              totalCzk={sessionTotalCzk(session)}
              priceCurrency={priceCurrency}
            />
          </View>

          {isEditable ? (
            <View style={styles.card}>
              <View style={styles.cardSectionHeader}>
                <Text style={styles.cardSectionHeaderText}>{cs.myBeers.drinkActionsHeader}</Text>
                <View style={styles.headerFlex} />
                <Pressable
                  onPress={openAddDrink}
                  style={({ pressed }) => [
                    styles.addDrinkButton,
                    pressed && styles.iconButtonPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.myBeersAddDrinkToEvening}
                >
                  <PlusIcon size={15} color={Colors.stout} />
                  <Text style={styles.addDrinkButtonText}>{cs.myBeers.addDrinkToEvening}</Text>
                </Pressable>
              </View>
              {drinkActionGroups.map((group, index) => (
                <View key={group.key} style={[styles.drinkRow, index > 0 && styles.drinkRowBorder]}>
                  <View style={styles.drinkInfo}>
                    <Text style={styles.drinkName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                      {group.volumeMl ? `${group.name} · ${formatVolume(group.volumeMl)}` : group.name}
                      {group.drinkType !== 'beer' ? ` · ${cs.counter.drinkTypeLabel(group.drinkType)}` : ''}
                      {group.count > 1 ? ` · ${group.count}×` : ''}
                    </Text>
                    <Text style={styles.drinkMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                      {[
                        group.servingType
                          ? cs.counter.servingTypeLabel(group.servingType)
                          : null,
                        group.pricedCount === group.count
                          ? group.count > 1
                            ? cs.myBeers.drinkGroupTotal(
                                formatPrice(group.totalCzk, priceCurrency),
                              )
                            : formatPrice(group.totalCzk, priceCurrency)
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </Text>
                  </View>
                  <View style={styles.drinkActions}>
                    <Pressable
                      onPress={() => setEditingGroup(group)}
                      style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={cs.myBeers.editDrink}
                    >
                      <PencilIcon size={17} color={Colors.amber} />
                    </Pressable>
                    <Pressable
                      onPress={() => handleDeleteDrink(group.drinks[group.drinks.length - 1])}
                      style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
                      hitSlop={6}
                      accessibilityRole="button"
                      accessibilityLabel={cs.myBeers.deleteDrink}
                    >
                      <MinusIcon size={17} color={Colors.mutedText} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {/* Výčep — hang the night on the feed and/or share it as a story.
              Only a night with something on it qualifies. */}
          {nightSummary ? (
            <View style={styles.card}>
              <View style={styles.cardSectionHeader}>
                <Text style={styles.cardSectionHeaderText}>{cs.vycep.sectionHeader}</Text>
              </View>
              <Text style={styles.vycepBody} maxFontSizeMultiplier={FontScaleCap.body}>
                {cs.vycep.publishEntryBody}
              </Text>
              {publishedRecord ? (
                <Text style={styles.vycepState} maxFontSizeMultiplier={FontScaleCap.body}>
                  {cs.vycep.publishedState(
                    publishedRecord.visibility === 'public'
                      ? cs.vycep.visibilityChipWorld
                      : cs.vycep.visibilityChipFriends,
                  )}
                </Text>
              ) : null}
              <View style={styles.vycepActions}>
                <Pressable
                  onPress={() => setPublishSheetVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.publishNightButton}
                  style={({ pressed }) => [styles.vycepPrimary, pressed && styles.iconButtonPressed]}
                >
                  <HandPlatterIcon size={16} color={Colors.stout} />
                  <Text style={styles.vycepPrimaryText} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {publishedRecord ? cs.vycep.updateCta : cs.vycep.publishEntryTitle}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setShareModalVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel={cs.a11y.shareNightButton}
                  style={({ pressed }) => [styles.vycepGhost, pressed && styles.iconButtonPressed]}
                >
                  <Share2Icon size={16} color={Colors.foamMuted} />
                  <Text style={styles.vycepGhostText} maxFontSizeMultiplier={FontScaleCap.heading}>
                    {cs.vycep.shareNightCta}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {/* Rating + public mapping are pub concepts — an outside evening
              ("Doma / na chatě") has nothing to rate or map. */}
          {!isContextPubKey(session.pubKey) ? (
            <>
              {/* Rating */}
              <View style={styles.card}>
                <PubRatingControl pubKey={session.pubKey} pubName={session.pubName} />
              </View>

              {/* Public community mapping — separate card so the public/private
                  split is visually obvious next to the private rating above. */}
              <View style={styles.card}>
                <MapPubEntry pubKey={session.pubKey} pubName={session.pubName} />
              </View>
            </>
          ) : null}

          <View style={{ height: Spacing.lg }} />
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
  return (
    <Modal visible={!!group} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior="padding"
      >
        {group ? (
          <EditDrinkNameForm
            key={group.key}
            group={group}
            onCancel={onCancel}
            onSave={onSave}
          />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
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

  return (
    <View style={styles.modalCard}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.myBeers.editDrinkGroupTitle(group.count)}
        </Text>
        <Pressable
          onPress={onCancel}
          style={({ pressed }) => [styles.modalClose, pressed && styles.iconButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel={cs.myBeers.editDrinkCancel}
        >
          <XIcon size={18} color={Colors.mutedText} />
        </Pressable>
      </View>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder={cs.myBeers.editDrinkPlaceholder}
        placeholderTextColor={Colors.mutedText}
        style={styles.nameInput}
        autoCapitalize="words"
        autoCorrect
        maxLength={80}
        returnKeyType="done"
        onSubmitEditing={() => onSave(group, name)}
      />
      <View style={styles.modalActions}>
        <Pressable onPress={onCancel} style={styles.modalSecondaryButton} accessibilityRole="button">
          <Text style={styles.modalSecondaryText}>{cs.myBeers.editDrinkCancel}</Text>
        </Pressable>
        <Pressable
          onPress={() => onSave(group, name)}
          style={styles.modalPrimaryButton}
          accessibilityRole="button"
        >
          <Text style={styles.modalPrimaryText}>{cs.myBeers.editDrinkSave}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.stout,
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    paddingHorizontal: 20,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout2,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.display.extrabold,
    fontSize: 24,
    color: Colors.foam,
  },
  headerSpacer: {
    width: 44,
    height: 44,
  },

  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm + 2,
  },

  card: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
  },
  pubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  pubName: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  summary: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.amber,
  },
  cardSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  cardSectionHeaderText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 11,
    letterSpacing: 1.5,
    color: Colors.amber,
  },
  headerFlex: { flex: 1 },
  addDrinkButton: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    paddingHorizontal: 11,
  },
  addDrinkButtonText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 12,
    color: Colors.stout,
  },
  drinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  drinkRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  drinkInfo: {
    flex: 1,
    minWidth: 0,
  },
  drinkName: {
    fontFamily: Fonts.ui.semibold,
    fontSize: 15,
    color: Colors.foam,
  },
  drinkMeta: {
    marginTop: 2,
    fontFamily: Fonts.ui.semibold,
    fontSize: 12,
    color: Colors.amber,
  },
  drinkActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconButtonPressed: {
    opacity: 0.75,
  },

  vycepBody: {
    fontFamily: Fonts.ui.medium,
    fontSize: 13,
    lineHeight: 19,
    color: Colors.foamMuted,
  },
  vycepState: {
    marginTop: 6,
    fontFamily: Fonts.ui.semibold,
    fontSize: 12.5,
    color: Colors.amber,
  },
  vycepActions: {
    marginTop: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  vycepPrimary: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    paddingHorizontal: 16,
  },
  vycepPrimaryText: {
    fontFamily: Fonts.display.bold,
    fontSize: 14,
    color: Colors.stout,
  },
  vycepGhost: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: Radius.pill,
    backgroundColor: Colors.stout,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
  },
  vycepGhostText: {
    fontFamily: Fonts.display.semibold,
    fontSize: 14,
    color: Colors.foamMuted,
  },

  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: Spacing.lg,
    backgroundColor: 'rgba(12, 8, 5, 0.72)',
  },
  modalCard: {
    backgroundColor: Colors.stout2,
    borderRadius: Radius.cardLarge,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 18,
    gap: 14,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalTitle: {
    flex: 1,
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameInput: {
    minHeight: 50,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.stout,
    paddingHorizontal: 14,
    fontFamily: Fonts.ui.semibold,
    fontSize: 16,
    color: Colors.foam,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalSecondaryButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSecondaryText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.mutedText,
  },
  modalPrimaryButton: {
    minHeight: 44,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    backgroundColor: Colors.amber,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalPrimaryText: {
    fontFamily: Fonts.ui.bold,
    fontSize: 14,
    color: Colors.stout,
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 36,
    paddingBottom: 60,
  },
  emptyTitle: {
    fontFamily: Fonts.display.extrabold,
    fontSize: 22,
    color: Colors.foam,
    textAlign: 'center',
  },
});
