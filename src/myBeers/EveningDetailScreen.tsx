/**
 * Evening detail — the full breakdown of one drinking evening plus the private
 * pub rating. Reached from the "Moje piva" list by the session's `startedAt`
 * (a stable per-session identity). Read-only over tallyStore; the only writable
 * thing here is the personal rating.
 */

import React, { useMemo, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
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
import { beerCountLabel } from '@/i18n/plural';
import { formatPrice } from '@/utils/currency';
import { updateQueuedDrinkBeerName, removeQueuedDrink } from '@/data/drinksQueue';
import { enqueueDelete } from '@/data/deleteDrinksQueue';
import { enqueueDrinkUpdate, removeQueuedDrinkUpdate } from '@/data/updateDrinksQueue';
import { deleteVisitByClientId, syncVisit } from '@/data/visitsSync';
import { ChevronLeftIcon, MapPinIcon, PencilIcon, Trash2Icon, XIcon } from '@/components/shared/IconGlyph';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  useTallyStore,
  findSessionByStart,
  sessionCount,
  sessionTotalCzk,
  type TallyDrink,
} from '@/stores/tallyStore';
import { sessionBreakdown, eveningDateLabel } from '@/myBeers/eveningModel';
import { EveningBreakdown } from '@/myBeers/EveningBreakdown';
import { PubRatingControl } from '@/myBeers/PubRatingControl';
import { MapPubEntry } from '@/components/amenities/MapPubEntry';

export default function EveningDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const now = new Date();

  const params = useLocalSearchParams<{ startedAt?: string }>();
  const startedAt = typeof params.startedAt === 'string' ? params.startedAt : '';

  const current = useTallyStore((s) => s.current);
  const history = useTallyStore((s) => s.history);
  const removeDrinkFromSession = useTallyStore((s) => s.removeDrinkFromSession);
  const updateDrinkNameInSession = useTallyStore((s) => s.updateDrinkNameInSession);
  const priceCurrency = useSettingsStore((s) => s.priceCurrency);
  const [editingDrink, setEditingDrink] = useState<TallyDrink | null>(null);

  const session = useMemo(
    () => findSessionByStart(current, history, startedAt),
    [current, history, startedAt],
  );

  const breakdown = useMemo(() => sessionBreakdown(session), [session]);

  const handleSaveDrinkName = (drink: TallyDrink, beerName: string) => {
    if (!session) return;
    const trimmed = beerName.trim();
    if (!trimmed) {
      Alert.alert(cs.myBeers.editDrinkTitle, cs.myBeers.editDrinkEmpty);
      return;
    }
    const changed = updateDrinkNameInSession(session.startedAt, drink.id, trimmed);
    setEditingDrink(null);
    if (!changed) return;

    const nextSession = findSessionByStart(
      useTallyStore.getState().current,
      useTallyStore.getState().history,
      session.startedAt,
    );
    if (nextSession) syncVisit(nextSession, new Date().toISOString());

    void updateQueuedDrinkBeerName(drink.id, trimmed).then((updateState) => {
      if (updateState !== 'queued') void enqueueDrinkUpdate({ client_id: drink.id, beer_name: trimmed });
    });
  };

  const handleDeleteDrink = (drink: TallyDrink) => {
    if (!session) return;
    Alert.alert(cs.myBeers.deleteDrinkTitle, cs.myBeers.deleteDrinkBody, [
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
            if (!pulledFromQueue) void enqueueDelete(removed.drinkId);
          });
        },
      },
    ]);
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
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >
          {/* Pub + summary */}
          <View style={styles.card}>
            <View style={styles.pubRow}>
              <MapPinIcon size={18} color={Colors.amber} />
              <Text style={styles.pubName} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.heading}>
                {session.pubName}
              </Text>
            </View>
            <Text style={styles.summary} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.myBeers.summary(
                beerCountLabel(sessionCount(session)),
                formatPrice(sessionTotalCzk(session), priceCurrency),
              )}
            </Text>
            <Text style={styles.trailNote} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.beerTrail.eveningTrailNote}
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

          <View style={styles.card}>
            <View style={styles.cardSectionHeader}>
              <Text style={styles.cardSectionHeaderText}>{cs.myBeers.drinkActionsHeader}</Text>
            </View>
            {session.drinks.map((drink, index) => (
              <View key={`${drink.id}-${index}`} style={[styles.drinkRow, index > 0 && styles.drinkRowBorder]}>
                <View style={styles.drinkInfo}>
                  <Text style={styles.drinkName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
                    {drink.volumeMl ? `${drink.beerName} · ${formatVolume(drink.volumeMl)}` : drink.beerName}
                  </Text>
                  <Text style={styles.drinkMeta} maxFontSizeMultiplier={FontScaleCap.body}>
                    {formatPrice(drink.priceCzk, priceCurrency)}
                  </Text>
                </View>
                <View style={styles.drinkActions}>
                  <Pressable
                    onPress={() => setEditingDrink(drink)}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={cs.myBeers.editDrink}
                  >
                    <PencilIcon size={17} color={Colors.amber} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleDeleteDrink(drink)}
                    style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
                    hitSlop={6}
                    accessibilityRole="button"
                    accessibilityLabel={cs.myBeers.deleteDrink}
                  >
                    <Trash2Icon size={17} color={Colors.mutedText} />
                  </Pressable>
                </View>
              </View>
            ))}
          </View>

          {/* Rating */}
          <View style={styles.card}>
            <PubRatingControl pubKey={session.pubKey} pubName={session.pubName} />
          </View>

          {/* Public community mapping — separate card so the public/private split
              is visually obvious next to the private rating above. */}
          <View style={styles.card}>
            <MapPubEntry pubKey={session.pubKey} pubName={session.pubName} />
          </View>

          <View style={{ height: Spacing.lg }} />
        </ScrollView>
      )}
      <EditDrinkNameModal
        drink={editingDrink}
        onCancel={() => setEditingDrink(null)}
        onSave={handleSaveDrinkName}
      />
    </SafeAreaView>
  );
}

function EditDrinkNameModal({
  drink,
  onCancel,
  onSave,
}: {
  drink: TallyDrink | null;
  onCancel: () => void;
  onSave: (drink: TallyDrink, beerName: string) => void;
}) {
  return (
    <Modal visible={!!drink} transparent animationType="fade" statusBarTranslucent onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {drink ? (
          <EditDrinkNameForm
            key={drink.id}
            drink={drink}
            onCancel={onCancel}
            onSave={onSave}
          />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function EditDrinkNameForm({
  drink,
  onCancel,
  onSave,
}: {
  drink: TallyDrink;
  onCancel: () => void;
  onSave: (drink: TallyDrink, beerName: string) => void;
}) {
  const [name, setName] = useState(drink.beerName);

  return (
    <View style={styles.modalCard}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle} maxFontSizeMultiplier={FontScaleCap.heading}>
          {cs.myBeers.editDrinkTitle}
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
        onSubmitEditing={() => onSave(drink, name)}
      />
      <View style={styles.modalActions}>
        <Pressable onPress={onCancel} style={styles.modalSecondaryButton} accessibilityRole="button">
          <Text style={styles.modalSecondaryText}>{cs.myBeers.editDrinkCancel}</Text>
        </Pressable>
        <Pressable
          onPress={() => onSave(drink, name)}
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
  trailNote: {
    marginTop: 8,
    fontFamily: Fonts.ui.regular,
    fontSize: 13,
    lineHeight: 18,
    color: Colors.mutedText,
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
