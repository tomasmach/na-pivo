/** Review and publish the real shared night. */

import React from 'react';
import {
  BackHandler,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { CameraIcon, XIcon } from '@/components/shared/IconGlyph';
import {
  isRetriableNightError,
  publishNight as publishNightToServer,
} from '@/data/nightsClient';
import { enqueueNightOp } from '@/data/nightsQueue';
import { buildRoast } from '@/feed/roast';
import { BeerPhotoCaptureFlow } from '@/photos/BeerPhotoCaptureFlow';
import {
  defaultNightTitle,
  nightPhotoReferences,
  nightPublishPayload,
} from '@/party/nightPublish';
import { nightByBeer, nightMe, nightMinutes, nightTally } from '@/party/nightRecord';
import { rememberNightRecord, useNightRecord } from '@/party/useNightRecord';
import { finishPartyToRecap } from '@/party/partyRouting';
import { usePartyEveningStore } from '@/stores/partyEveningStore';
import { useAccountStore } from '@/stores/accountStore';
import { useBeerPhotosStore } from '@/stores/beerPhotosStore';
import { usePartyGamesStore } from '@/stores/partyGamesStore';
import { drinkingDayKey, useTallyStore } from '@/stores/tallyStore';
import { StatGrid } from '@/mocks/StatGrid';
import { formatElapsed, useLivePartyStore, useNightClock } from '@/mocks/livePartyStore';
import { MockColors, MockLayout, MockType } from '@/mocks/mockTheme';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';
import { cs } from '@/i18n/cs';

function currentTime(): number {
  return Date.now();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usualBeerPace(
  history: ReturnType<typeof useTallyStore.getState>['history'],
): number | null {
  const rates = history.flatMap((session) => {
    const beers = session.drinks.filter((drink) => (drink.drinkType ?? 'beer') === 'beer');
    if (beers.length < 2) return [];
    const stamps = beers.map((drink) => Date.parse(drink.at)).filter(Number.isFinite).sort((a, b) => a - b);
    if (stamps.length < 2) return [];
    const hours = Math.max(0.5, (stamps.at(-1)! - stamps[0]) / 3_600_000);
    return [beers.length / hours];
  });
  if (rates.length === 0) return null;
  return rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
}

export default function FinishNightScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const night = useNightRecord();
  const accountId = useAccountStore((state) => state.session?.accountId);

  const clockStartedAt = useLivePartyStore((state) => state.startedAt);
  const clockMinutes = useNightClock(clockStartedAt);
  const endParty = useLivePartyStore((state) => state.end);
  const evening = usePartyEveningStore((state) => state.evening);
  const confirmedIdentity = usePartyEveningStore((state) => state.confirmedIdentity);
  const endEvening = usePartyEveningStore((state) => state.end);
  const leaveEvening = usePartyEveningStore((state) => state.leave);
  const archiveCurrent = useTallyStore((state) => state.archiveCurrent);
  const history = useTallyStore((state) => state.history);
  const ownPhotos = useBeerPhotosStore((state) => state.photos);
  const sharedGames = usePartyGamesStore((state) => state.games);

  const [photoOpen, setPhotoOpen] = React.useState(false);
  const [publishing, setPublishing] = React.useState(false);
  const publishingRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!publishing) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => subscription.remove();
  }, [publishing]);

  const now = night.endedAt
    ? new Date(night.endedAt).getTime()
    : clockStartedAt !== null
      ? clockStartedAt + clockMinutes * 60_000
      : new Date(night.startedAt).getTime();
  const minutes = nightMinutes(night, now);
  const me = nightMe(night);
  const activePeopleCount = night.people.filter((person) => person.active !== false).length;
  const tally = nightTally(night);
  const ownerId = accountId ?? me?.id;
  const myDrinks = night.drinks.filter((drink) => drink.by === ownerId);
  const byType = nightByBeer({ ...night, drinks: myDrinks });
  // The server refuses a night with no drinks of its own ("A published night
  // must contain at least one drink"), which at a shared table where only the
  // other person drank meant an endless retry loop behind a generic error.
  const canPublish = myDrinks.length > 0;
  const played = night.games.filter((game) => game.result);
  const partyCode = evening?.joinCode ?? confirmedIdentity?.joinCode ?? night.code ?? undefined;
  const partyDrinkingDay = drinkingDayKey(new Date(night.startedAt));
  const defaultTitle = defaultNightTitle(night.stops[0]);
  const roast = React.useMemo(
    () => buildRoast({
      beers: tally.beers,
      duration: minutes,
      pubs: new Set(night.stops.map((stop) => stop.pubName)).size,
      people: night.people.length,
      photos: night.photos.length,
      games: played.length,
      gamesWon: played.filter((game) => game.result?.winner === me?.name).length,
      usualPerHour: usualBeerPace(history),
      visitsToSamePub: history.filter(
        (session) => session.pubName === night.stops[0]?.pubName,
      ).length,
    }),
    [history, me?.name, minutes, night.people.length, night.photos.length, night.stops, played, tally.beers],
  );
  const [roastEnabled, setRoastEnabled] = React.useState(() => roast !== null);
  const [customTitle, setCustomTitle] = React.useState(defaultTitle);
  const publishTitle = roastEnabled && roast ? roast.line : customTitle.trim() || defaultTitle;

  const closeSharedEvening = async (published: boolean): Promise<boolean> => {
    const isHost = evening?.isHost ?? confirmedIdentity?.isHost;
    if (isHost === undefined) return true;
    const closed = isHost ? await endEvening() : await leaveEvening();
    if (closed) return true;
    setError(
      published
        ? isHost
          ? 'Příspěvek je uložený, ale stůl se nepodařilo zavřít. Zkus to znovu.'
          : 'Příspěvek je uložený, ale od stolu se nepodařilo odejít. Zkus to znovu.'
        : isHost
          ? 'Stůl se nepodařilo zavřít. Zkus to znovu.'
          : 'Od stolu se nepodařilo odejít. Zkus to znovu.',
    );
    return false;
  };

  const finishLocally = async (endedAt: string): Promise<void> => {
    // Persist the private recap before clearing the live stores or navigating.
    await rememberNightRecord({ ...night, endedAt }, accountId);
    archiveCurrent('manual');
    endParty();
    finishPartyToRecap(router, '/party-finish');
  };

  const publish = async () => {
    if (publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    setError(null);
    try {
      const photoIds = nightPhotoReferences(
        ownPhotos,
        partyCode,
        partyDrinkingDay,
      );
      const payload = nightPublishPayload(night, {
        visibility: 'friends',
        now: currentTime(),
        city: evening?.pubCity || undefined,
        ownerId,
        title: publishTitle,
        roastLine: roastEnabled && roast ? roast.line : '',
        roastBasis: roastEnabled && roast ? roast.basis : '',
        ...(photoIds.length > 0 ? { photoIds } : {}),
        ...(partyCode ? {
          partyCode,
          participantIds: night.people
            .map((person) => person.id)
            .filter(
              (id, index, all) =>
                id !== accountId && UUID_RE.test(id) && all.indexOf(id) === index,
            )
            .slice(0, 8),
          gameIds: sharedGames
            .map((game) => game.id)
            .filter((id, index, all) => UUID_RE.test(id) && all.indexOf(id) === index)
            .slice(0, 3),
        } : {}),
      });
      const result = await publishNightToServer(payload);
      if (!result.ok) {
        if (isRetriableNightError(result)) {
          const queued = await enqueueNightOp({ op: 'publish', payload });
          if (!queued) {
            setError('Příspěvek se nepodařilo uložit. Zkus to znovu.');
            return;
          }
        } else {
          setError(result.detail);
          return;
        }
      }

      // A host closes the table; a guest only leaves it. The record hook has a
      // last-good snapshot before either membership-changing call runs.
      if (!(await closeSharedEvening(true))) {
        return;
      }
      await finishLocally(payload.endedAt);
    } catch {
      setError('Večer se nepodařilo dokončit. Zkus to znovu.');
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  };

  const finishPrivately = async () => {
    if (publishingRef.current) return;
    publishingRef.current = true;
    setPublishing(true);
    setError(null);
    try {
      if (!(await closeSharedEvening(false))) return;
      await finishLocally(new Date(currentTime()).toISOString());
    } catch {
      setError('Večer se nepodařilo dokončit. Zkus to znovu.');
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={[styles.top, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable
          onPress={() => router.back()}
          disabled={publishing}
          style={({ pressed }) => [
            styles.close,
            publishing && styles.publishDisabled,
            pressed && styles.pressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel="Zpátky do večera"
          accessibilityState={{ disabled: publishing }}
          hitSlop={8}
        >
          <XIcon size={18} color={Colors.foam} />
        </Pressable>
        <Text style={styles.topTitle} maxFontSizeMultiplier={FontScaleCap.body}>
          Ukončit večer
        </Text>
      </View>

      <KeyboardAwareScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <StatGrid
          columns={4}
          compact
          stats={[
            { label: 'Piva', value: String(tally.beers) },
            { label: 'Večer', value: formatElapsed(minutes) },
            { label: 'U stolu', value: String(activePeopleCount) },
            { label: 'Druhů', value: String(byType.length) },
          ]}
        />

        <View style={styles.field}>
          <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
            Fotky
          </Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.photoRow}
          >
            <Pressable
              onPress={() => setPhotoOpen(true)}
              style={({ pressed }) => [styles.addPhoto, pressed && styles.pressed]}
              accessibilityRole="button"
              accessibilityLabel="Přidat fotku"
            >
              <CameraIcon size={20} color={Colors.stout} />
            </Pressable>
            {night.photos.map((photo) => (
              <Image key={photo.id} source={{ uri: photo.url }} style={styles.photo} />
            ))}
          </ScrollView>
        </View>

        {played.length > 0 ? (
          <View style={styles.field}>
            <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
              Hry
            </Text>
            {played.map((game) => (
              <Text
                key={`${game.key}:${game.startedAt}`}
                style={styles.gameLine}
                maxFontSizeMultiplier={FontScaleCap.body}
              >
                {game.result?.paying
                  ? `${game.name} · platí ${game.result.paying}`
                  : game.result?.winner
                    ? `${game.name} · vyhrál ${game.result.winner}`
                    : `${game.name} · odehráno`}
              </Text>
            ))}
          </View>
        ) : null}

        <View style={styles.field}>
          <View style={styles.roastRow}>
            <Text style={styles.roastLabel} maxFontSizeMultiplier={FontScaleCap.body}>
              Roast večera
            </Text>
            <Switch
              value={roastEnabled && roast !== null}
              disabled={roast === null}
              onValueChange={setRoastEnabled}
              trackColor={{ false: withAlpha(Colors.foam, 0.14), true: Colors.amber }}
              thumbColor={Colors.foam}
              accessibilityLabel="Přidat roast k příspěvku"
            />
          </View>
          {roastEnabled && roast ? (
            <View style={styles.roastPreview}>
              <Text style={styles.roastLine} maxFontSizeMultiplier={FontScaleCap.body}>
                {roast.line}
              </Text>
              <Text style={styles.roastBasis} maxFontSizeMultiplier={FontScaleCap.body}>
                {roast.basis}
              </Text>
            </View>
          ) : (
            <TextInput
              value={customTitle}
              onChangeText={setCustomTitle}
              maxLength={120}
              placeholder="Jak to nazveš"
              placeholderTextColor={Colors.mutedText}
              style={styles.titleInput}
              accessibilityLabel="Název večera"
              maxFontSizeMultiplier={FontScaleCap.body}
            />
          )}
        </View>

        <View style={styles.field}>
          <Text style={styles.label} maxFontSizeMultiplier={FontScaleCap.body}>
            Takhle to půjde ven
          </Text>
          <View style={styles.postPreview}>
            <Text style={styles.postPreviewTitle} maxFontSizeMultiplier={FontScaleCap.body}>
              {publishTitle}
            </Text>
            {roastEnabled && roast ? (
              <Text style={styles.postPreviewBasis} maxFontSizeMultiplier={FontScaleCap.body}>
                {roast.basis}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.visibility}>
          <Text style={styles.visibilityTitle} maxFontSizeMultiplier={FontScaleCap.body}>
            Uvidí tvoje parta
          </Text>
        </View>
      </KeyboardAwareScrollView>

      <View style={[styles.foot, { paddingBottom: insets.bottom + Spacing.md }]}>
        {error ? (
          <Text style={styles.error} maxFontSizeMultiplier={FontScaleCap.body}>
            {error}
          </Text>
        ) : null}
        {canPublish ? (
          <>
            <Pressable
              onPress={() => void publish()}
              disabled={publishing}
              style={({ pressed }) => [
                styles.publish,
                publishing && styles.publishDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Ukončit a zveřejnit večer"
              accessibilityState={{ disabled: publishing, busy: publishing }}
            >
              <Text style={styles.publishText} maxFontSizeMultiplier={FontScaleCap.heading}>
                {publishing ? 'Ukládám…' : 'Ukončit a zveřejnit'}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => void finishPrivately()}
              disabled={publishing}
              style={({ pressed }) => [
                styles.privateFinish,
                publishing && styles.publishDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Ukončit večer bez zveřejnění"
              accessibilityState={{ disabled: publishing }}
            >
              <Text style={styles.privateFinishText} maxFontSizeMultiplier={FontScaleCap.body}>
                Ukončit bez zveřejnění
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.reason} maxFontSizeMultiplier={FontScaleCap.body}>
              {cs.party.nothingToPublish}
            </Text>
            <Pressable
              onPress={() => void finishPrivately()}
              disabled={publishing}
              style={({ pressed }) => [
                styles.publish,
                publishing && styles.publishDisabled,
                pressed && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Ukončit večer bez zveřejnění"
              accessibilityState={{ disabled: publishing, busy: publishing }}
            >
              <Text style={styles.publishText} maxFontSizeMultiplier={FontScaleCap.heading}>
                {publishing ? 'Ukládám…' : 'Ukončit bez zveřejnění'}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      <BeerPhotoCaptureFlow
        open={photoOpen}
        onClose={() => setPhotoOpen(false)}
        partyCode={partyCode}
        partyDrinkingDay={partyDrinkingDay}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: MockColors.bg },
  pressed: { opacity: 0.7 },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  close: {
    width: HitArea.min,
    height: HitArea.min,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.09),
  },
  topTitle: { fontSize: 17, fontWeight: '700', color: Colors.foam },
  body: { paddingHorizontal: MockLayout.screenPad, paddingTop: Spacing.md, gap: Spacing.xl },
  field: { gap: Spacing.sm },
  label: { fontSize: 13, fontWeight: '600', color: Colors.mutedText },
  roastRow: {
    minHeight: HitArea.min,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roastLabel: { fontSize: 16, fontWeight: '700', color: Colors.foam },
  roastPreview: {
    gap: 4,
    padding: Spacing.md,
    borderRadius: Radius.medium,
    backgroundColor: MockColors.surfaceHigh,
  },
  roastLine: { fontSize: 19, fontWeight: '800', color: Colors.foam, lineHeight: 25 },
  roastBasis: { fontSize: 13, fontWeight: '500', color: Colors.mutedText, lineHeight: 19 },
  titleInput: {
    minHeight: HitArea.min,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.medium,
    color: Colors.foam,
    backgroundColor: MockColors.surfaceHigh,
    fontSize: 16,
    fontWeight: '600',
  },
  postPreview: {
    gap: 4,
    padding: Spacing.md,
    borderRadius: Radius.medium,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: withAlpha(Colors.amber, 0.28),
    backgroundColor: withAlpha(Colors.amber, 0.07),
  },
  postPreviewTitle: { fontSize: 18, fontWeight: '800', color: Colors.foam, lineHeight: 24 },
  postPreviewBasis: { fontSize: 13, fontWeight: '500', color: Colors.mutedText, lineHeight: 18 },
  photoRow: { alignItems: 'center', gap: Spacing.sm },
  addPhoto: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
  },
  photo: { width: 62, height: 62, borderRadius: 18, backgroundColor: Colors.stout3 },
  gameLine: { fontSize: 15, fontWeight: '600', color: Colors.foam },
  visibility: {
    minHeight: HitArea.min,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: MockColors.surfaceHigh,
  },
  visibilityTitle: { fontSize: 14, fontWeight: '700', color: Colors.foam },
  foot: {
    paddingHorizontal: MockLayout.screenPad,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: withAlpha(Colors.foam, 0.1),
  },
  error: { fontSize: 13, color: Colors.amber },
  reason: { fontSize: 13, color: Colors.mutedText, textAlign: 'center' },
  publish: {
    height: MockLayout.sheetButtonHeight,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.amber,
    minWidth: HitArea.min,
  },
  publishDisabled: { opacity: 0.55 },
  publishText: { ...MockType.buttonLabel, color: Colors.stout },
  privateFinish: {
    minHeight: HitArea.min,
    alignItems: 'center',
    justifyContent: 'center',
  },
  privateFinishText: { fontSize: 14, fontWeight: '700', color: Colors.mutedText },
});
