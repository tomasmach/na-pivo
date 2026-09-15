import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { generateUuidV4 } from '@/data/account';
import {
  cancelCommunityEvent,
  createCommunityEvent,
  decideCommunityJoinRequest,
  fetchCommunityEvents,
  leaveCommunityEvent,
  reportCommunityEvent,
  requestCommunityEventJoin,
  type CommunityEvent,
  type CommunityEventsDashboard,
  type DistanceBand,
} from '@/data/communityEventsClient';
import { ensureLocationPermission, openSystemSettings } from '@/compass/permissions';
import {
  trackUiInteraction,
  type UiInteractionAction,
  type UiInteractionTarget,
} from '@/data/uxTelemetry';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import {
  CheckIcon,
  ChevronLeftIcon,
  FlagIcon,
  HouseIcon,
  MapPinIcon,
  MinusIcon,
  PlusIcon,
  UsersIcon,
  XIcon,
} from '@/components/shared/IconGlyph';
import { cs } from '@/i18n/cs';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

type Mode = 'nearby' | 'mine' | 'create';
type Coords = { lat: number; lng: number };

function hostName(event: CommunityEvent): string {
  return event.host.nickname ? `@${event.host.nickname}` : event.host.displayName || 'Pořadatel';
}

function formatTime(event: CommunityEvent): string {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const day = start.toLocaleDateString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric' });
  return `${day} · ${start.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}–${end.toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}`;
}

function distanceLabel(value: DistanceBand | null): string {
  return value ? cs.communityEvents.distance[value] : '';
}

function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      {icon}
      <Text style={[styles.buttonText, secondary && styles.buttonTextSecondary]}>{label}</Text>
    </Pressable>
  );
}

function Stepper({ value, onChange, min, max }: { value: number; onChange: (value: number) => void; min: number; max: number }) {
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange(Math.max(min, value - 1))} style={styles.stepButton}>
        <MinusIcon size={18} color={Colors.foam} />
      </Pressable>
      <Text style={styles.stepValue}>{value}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + 1))} style={styles.stepButton}>
        <PlusIcon size={18} color={Colors.foam} />
      </Pressable>
    </View>
  );
}

function EventCard({
  event,
  busy,
  reload,
}: {
  event: CommunityEvent;
  busy: boolean;
  reload: () => Promise<void>;
}) {
  const showToast = useToastStore((state) => state.show);
  const [acting, setActing] = useState(false);
  const [joinMessage, setJoinMessage] = useState('');
  const run = useCallback(async (
    action: () => Promise<{ ok: boolean; detail?: string }>,
    success: string,
    target: UiInteractionTarget,
    interactionAction: UiInteractionAction = 'submit',
  ) => {
    trackUiInteraction(target, interactionAction);
    setActing(true);
    const result = await action();
    trackUiInteraction(target, result.ok ? 'success' : 'failure');
    showToast(result.ok ? success : result.detail || cs.communityEvents.loadError);
    if (result.ok) await reload();
    setActing(false);
  }, [reload, showToast]);

  const report = () => {
    Alert.alert(cs.communityEvents.reportTitle, event.title, [
      { text: 'Nechat být', style: 'cancel' },
      {
        text: cs.communityEvents.report,
        style: 'destructive',
        onPress: () => void run(
          () => reportCommunityEvent(event.id),
          cs.communityEvents.reported,
          'community_report',
        ),
      },
    ]);
  };
  const disabled = busy || acting;
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventTop}>
        <View style={styles.eventCopy}>
          <Text style={styles.eventTitle}>{event.title}</Text>
          <Text style={styles.eventMeta}>{formatTime(event)}</Text>
        </View>
        <Text style={styles.status}>{event.status === 'live' ? 'PRÁVĚ TEĎ' : '18+'}</Text>
      </View>
      {event.description ? <Text style={styles.eventDescription}>{event.description}</Text> : null}
      <View style={styles.metaRow}>
        <MapPinIcon size={15} color={Colors.amber} />
        <Text style={styles.metaText}>
          {[event.areaLabel, event.city, distanceLabel(event.distanceBand)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={styles.metaRow}>
        <UsersIcon size={15} color={Colors.mutedText} />
        <Text style={styles.metaText}>{cs.communityEvents.spots(event.availableSpots)} · {cs.communityEvents.host(hostName(event))}</Text>
      </View>
      {event.exactAddress ? (
        <View style={styles.addressStrip}>
          <Text style={styles.addressLabel}>{cs.communityEvents.addressApproved}</Text>
          <Text style={styles.addressText}>{event.exactAddress}</Text>
        </View>
      ) : (
        <Text style={styles.hiddenAddress}>{cs.communityEvents.addressHidden}</Text>
      )}

      {!event.isHost && event.status !== 'cancelled' ? (
        event.membershipStatus === 'approved' ? (
          <Button label={cs.communityEvents.leave} secondary disabled={disabled} onPress={() => void run(() => leaveCommunityEvent(event.id), cs.communityEvents.leave, 'community_leave')} />
        ) : event.membershipStatus === 'pending' ? (
          <Button label={cs.communityEvents.cancelRequest} secondary disabled={disabled} onPress={() => void run(() => leaveCommunityEvent(event.id), cs.communityEvents.cancelRequest, 'community_cancel_request', 'cancel')} />
        ) : (
          <>
            <TextInput
              value={joinMessage}
              onChangeText={setJoinMessage}
              placeholder={cs.communityEvents.requestPlaceholder}
              placeholderTextColor={Colors.mutedText}
              style={styles.input}
              maxLength={240}
            />
            <Button label={cs.communityEvents.join} disabled={disabled || event.availableSpots < 1} onPress={() => void run(() => requestCommunityEventJoin(event.id, joinMessage), cs.communityEvents.joinSent, 'community_join_request')} />
          </>
        )
      ) : null}

      {event.isHost && event.joinRequests.length > 0 ? (
        <View style={styles.requests}>
          <Text style={styles.sectionLabel}>{cs.communityEvents.requests}</Text>
          {event.joinRequests.map((request) => (
            <View key={request.id} style={styles.requestRow}>
              <View style={styles.requestCopy}>
                <Text style={styles.requestName}>{request.account.nickname ? `@${request.account.nickname}` : request.account.displayName || 'Návštěvník'}</Text>
                {request.message ? <Text style={styles.requestMessage}>{request.message}</Text> : null}
              </View>
              {request.status === 'pending' ? (
                <View style={styles.requestActions}>
                  <Pressable onPress={() => void run(() => decideCommunityJoinRequest(event.id, request.id, 'reject'), cs.communityEvents.reject, 'community_request_decline', 'decline')} style={styles.iconButton}>
                    <XIcon size={18} color={Colors.mutedText} />
                  </Pressable>
                  <Pressable onPress={() => void run(() => decideCommunityJoinRequest(event.id, request.id, 'approve'), cs.communityEvents.approve, 'community_request_accept', 'accept')} style={[styles.iconButton, styles.approveButton]}>
                    <CheckIcon size={18} color={Colors.stout} />
                  </Pressable>
                </View>
              ) : <Text style={styles.approvedLabel}>{cs.communityEvents.approved}</Text>}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.textActions}>
        {event.isHost && event.status !== 'cancelled' ? (
          <Pressable onPress={() => void run(() => cancelCommunityEvent(event.id), cs.communityEvents.cancelled, 'community_cancel_event', 'cancel')}>
            <Text style={styles.dangerAction}>{cs.communityEvents.cancelEvent}</Text>
          </Pressable>
        ) : !event.isHost ? (
          <Pressable onPress={report} style={styles.reportAction}>
            <FlagIcon size={14} color={Colors.mutedText} />
            <Text style={styles.reportText}>{cs.communityEvents.report}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export default function CommunityEventsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const showToast = useToastStore((state) => state.show);
  const [mode, setMode] = useState<Mode>('nearby');
  const [dashboard, setDashboard] = useState<CommunityEventsDashboard>({ nearby: [], hosted: [], joined: [] });
  const [location, setLocation] = useState<Coords | null>(null);
  const [eventLocation, setEventLocation] = useState<Coords | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const loadRequestRef = useRef(0);
  const [draftClientId, setDraftClientId] = useState(() => generateUuidV4());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [address, setAddress] = useState('');
  const [dayOffset, setDayOffset] = useState(0);
  const [hour, setHour] = useState(() => Math.min(23, new Date().getHours() + 2));
  const [duration, setDuration] = useState(4);
  const [capacity, setCapacity] = useState(6);
  const [adultsConfirmed, setAdultsConfirmed] = useState(false);

  const load = useCallback(async (coords: Coords | null) => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    const result = await fetchCommunityEvents(coords ?? undefined);
    if (requestId !== loadRequestRef.current) return;
    if (result.ok) setDashboard(result.dashboard);
    else showToast(result.code === 'auth' ? cs.communityEvents.authError : result.detail);
    setLoading(false);
  }, [showToast]);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(null), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const locate = useCallback(async (forEvent: boolean) => {
    trackUiInteraction('community_locate');
    setBusy(true);
    const permission = await ensureLocationPermission();
    if (permission !== 'granted') {
      showToast(cs.addPub.locationPermissionDenied);
      if (permission === 'denied') await openSystemSettings();
      setBusy(false);
      return;
    }
    try {
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { lat: fix.coords.latitude, lng: fix.coords.longitude };
      if (forEvent) setEventLocation(coords);
      else {
        setLocation(coords);
        await load(coords);
      }
    } catch {
      showToast(cs.addPub.locationUnavailable);
    }
    setBusy(false);
  }, [load, showToast]);

  const create = useCallback(async () => {
    trackUiInteraction('community_publish', 'submit');
    if (!eventLocation || !title.trim() || !city.trim() || !address.trim() || !adultsConfirmed || busy) {
      trackUiInteraction('community_publish', 'failure');
      showToast(cs.communityEvents.privacyError);
      return;
    }
    setBusy(true);
    const starts = new Date();
    starts.setDate(starts.getDate() + dayOffset);
    starts.setHours(hour, 0, 0, 0);
    const ends = new Date(starts.getTime() + duration * 60 * 60 * 1000);
    const result = await createCommunityEvent({
      clientId: draftClientId,
      title: title.trim(),
      description: description.trim(),
      city: city.trim(),
      areaLabel: area.trim(),
      exactAddress: address.trim(),
      lat: eventLocation.lat,
      lng: eventLocation.lng,
      startsAt: starts.toISOString(),
      endsAt: ends.toISOString(),
      capacity,
    });
    if (result.ok) {
      trackUiInteraction('community_publish', 'success');
      setDraftClientId(generateUuidV4());
      showToast(cs.communityEvents.created);
      setMode('mine');
      await load(location);
    } else {
      trackUiInteraction('community_publish', 'failure');
      showToast(result.detail);
    }
    setBusy(false);
  }, [address, adultsConfirmed, area, busy, capacity, city, dayOffset, description, draftClientId, duration, eventLocation, hour, load, location, showToast, title]);

  const mine = useMemo(() => [...dashboard.hosted, ...dashboard.joined].filter((event, index, all) => all.findIndex((item) => item.id === event.id) === index), [dashboard]);
  const events = mode === 'mine' ? mine : dashboard.nearby;

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={styles.root} behavior="padding" enabled={Platform.OS === 'android'}>
        <KeyboardAwareScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + Spacing.sm, paddingBottom: insets.bottom + Spacing.xl }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={cs.a11y.backButton} style={styles.backButton}>
              <ChevronLeftIcon size={24} color={Colors.foam} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.kicker}>{cs.communityEvents.kicker}</Text>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>{cs.communityEvents.title}</Text>
            </View>
          </View>
          <Text style={styles.intro}>{cs.communityEvents.intro}</Text>
          <View style={styles.safetyStrip}><Text style={styles.safetyText}>{cs.communityEvents.safety}</Text></View>

          <View style={styles.tabs}>
            {(['nearby', 'mine', 'create'] as Mode[]).map((item) => (
              <Pressable
                key={item}
                onPress={() => {
                  trackUiInteraction(
                    item === 'nearby'
                      ? 'community_nearby_tab'
                      : item === 'mine'
                        ? 'community_mine_tab'
                        : 'community_create_tab',
                    'select',
                  );
                  setMode(item);
                }}
                style={[styles.tab, mode === item && styles.tabActive]}
              >
                <Text style={[styles.tabText, mode === item && styles.tabTextActive]}>{item === 'nearby' ? cs.communityEvents.nearby : item === 'mine' ? cs.communityEvents.mine : cs.communityEvents.create}</Text>
              </Pressable>
            ))}
          </View>

          {mode === 'create' ? (
            <View style={styles.form}>
              <Text style={styles.inputLabel}>{cs.communityEvents.formTitle}</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder={cs.communityEvents.formTitlePlaceholder} placeholderTextColor={Colors.mutedText} style={styles.input} maxLength={120} />
              <Text style={styles.inputLabel}>{cs.communityEvents.description}</Text>
              <TextInput value={description} onChangeText={setDescription} placeholder={cs.communityEvents.descriptionPlaceholder} placeholderTextColor={Colors.mutedText} style={[styles.input, styles.multiline]} multiline maxLength={800} />
              <Text style={styles.inputLabel}>{cs.communityEvents.city}</Text>
              <TextInput value={city} onChangeText={setCity} placeholder={cs.communityEvents.cityPlaceholder} placeholderTextColor={Colors.mutedText} style={styles.input} maxLength={120} />
              <Text style={styles.inputLabel}>{cs.communityEvents.area}</Text>
              <TextInput value={area} onChangeText={setArea} placeholder={cs.communityEvents.areaPlaceholder} placeholderTextColor={Colors.mutedText} style={styles.input} maxLength={120} />
              <Text style={styles.inputLabel}>{cs.communityEvents.exactAddress}</Text>
              <TextInput value={address} onChangeText={setAddress} placeholder={cs.communityEvents.exactAddressPlaceholder} placeholderTextColor={Colors.mutedText} style={styles.input} maxLength={300} />
              <Text style={styles.hint}>{cs.communityEvents.exactAddressHint}</Text>
              <Button label={eventLocation ? cs.communityEvents.locationReady : cs.communityEvents.useLocation} secondary onPress={() => void locate(true)} disabled={busy} icon={<MapPinIcon size={18} color={Colors.amber} />} />

              <View style={styles.formGroup}>
                <Text style={styles.sectionLabel}>{cs.communityEvents.start}</Text>
                <View style={styles.choiceRow}>
                  {[0, 1].map((value) => <Pressable key={value} onPress={() => setDayOffset(value)} style={[styles.choice, dayOffset === value && styles.choiceActive]}><Text style={[styles.choiceText, dayOffset === value && styles.choiceTextActive]}>{value === 0 ? cs.communityEvents.today : cs.communityEvents.tomorrow}</Text></Pressable>)}
                </View>
                <Stepper value={hour} onChange={setHour} min={0} max={23} />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.sectionLabel}>{cs.communityEvents.duration}</Text>
                <View style={styles.choiceRow}>{[2, 4, 6].map((value) => <Pressable key={value} onPress={() => setDuration(value)} style={[styles.choice, duration === value && styles.choiceActive]}><Text style={[styles.choiceText, duration === value && styles.choiceTextActive]}>{cs.communityEvents.durationHours(value)}</Text></Pressable>)}</View>
              </View>
              <View style={styles.formGroup}><Text style={styles.sectionLabel}>{cs.communityEvents.capacity}</Text><Stepper value={capacity} onChange={setCapacity} min={2} max={20} /></View>
              <Pressable onPress={() => setAdultsConfirmed((value) => !value)} style={styles.confirmRow}>
                <View style={[styles.checkbox, adultsConfirmed && styles.checkboxActive]}>{adultsConfirmed ? <CheckIcon size={16} color={Colors.stout} /> : null}</View>
                <Text style={styles.confirmText}>{cs.communityEvents.adultsConfirm}</Text>
              </Pressable>
              <Button label={cs.communityEvents.publish} onPress={() => void create()} disabled={busy} icon={<HouseIcon size={18} color={Colors.stout} />} />
            </View>
          ) : loading ? <ActivityIndicator color={Colors.amber} style={styles.loader} /> : (
            <View style={styles.list}>
              {mode === 'nearby' && !location ? <Button label={busy ? cs.communityEvents.locating : cs.communityEvents.locate} onPress={() => void locate(false)} disabled={busy} secondary icon={<MapPinIcon size={18} color={Colors.amber} />} /> : null}
              {events.length === 0 ? <Text style={styles.empty}>{mode === 'nearby' ? cs.communityEvents.noNearby : cs.communityEvents.noMine}</Text> : events.map((event) => <EventCard key={event.id} event={event} busy={busy} reload={() => load(location)} />)}
            </View>
          )}
        </KeyboardAwareScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.stout },
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.lg },
  header: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  backButton: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center', marginLeft: -Spacing.sm },
  headerCopy: { flex: 1 },
  kicker: { fontFamily: Fonts.ui.semibold, fontSize: 10, letterSpacing: 1.4, color: Colors.amber },
  title: { fontFamily: Fonts.display.extrabold, fontSize: 30, lineHeight: 34, color: Colors.foam },
  intro: { fontFamily: Fonts.display.bold, fontSize: 19, lineHeight: 25, color: Colors.foam },
  safetyStrip: { borderLeftWidth: 2, borderLeftColor: Colors.amber, paddingLeft: Spacing.md },
  safetyText: { fontFamily: Fonts.ui.regular, fontSize: 13, lineHeight: 19, color: Colors.foamMuted },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.amber },
  tabText: { fontFamily: Fonts.ui.medium, fontSize: 12, color: Colors.mutedText, textAlign: 'center' },
  tabTextActive: { color: Colors.foam },
  loader: { marginTop: Spacing.xl },
  list: { gap: Spacing.lg },
  empty: { fontFamily: Fonts.ui.regular, fontSize: 15, lineHeight: 22, color: Colors.mutedText },
  eventCard: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.border, paddingVertical: Spacing.lg, gap: Spacing.sm },
  eventTop: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  eventCopy: { flex: 1 },
  eventTitle: { fontFamily: Fonts.display.extrabold, fontSize: 21, lineHeight: 25, color: Colors.foam },
  eventMeta: { marginTop: 3, fontFamily: Fonts.ui.medium, fontSize: 13, color: Colors.foamMuted },
  status: { fontFamily: Fonts.ui.semibold, fontSize: 10, letterSpacing: 1, color: Colors.amber },
  eventDescription: { fontFamily: Fonts.ui.regular, fontSize: 14, lineHeight: 20, color: Colors.foamMuted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flex: 1, fontFamily: Fonts.ui.regular, fontSize: 13, color: Colors.mutedText },
  addressStrip: { marginTop: Spacing.xs, padding: Spacing.md, borderRadius: Radius.small, backgroundColor: withAlpha(Colors.amber, 0.1) },
  addressLabel: { fontFamily: Fonts.ui.semibold, fontSize: 10, letterSpacing: 1, color: Colors.amber },
  addressText: { marginTop: 4, fontFamily: Fonts.ui.medium, fontSize: 15, color: Colors.foam },
  hiddenAddress: { fontFamily: Fonts.ui.medium, fontSize: 12, color: Colors.amberLight },
  button: { minHeight: 48, marginTop: Spacing.xs, borderRadius: Radius.medium, backgroundColor: Colors.amber, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md },
  buttonSecondary: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.border },
  buttonText: { fontFamily: Fonts.ui.bold, fontSize: 14, color: Colors.stout },
  buttonTextSecondary: { color: Colors.foam },
  pressed: { opacity: 0.55 },
  input: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.medium, backgroundColor: Colors.stout2, paddingHorizontal: Spacing.md, fontFamily: Fonts.ui.regular, fontSize: 15, letterSpacing: 0, color: Colors.foam },
  multiline: { minHeight: 100, paddingTop: Spacing.md, textAlignVertical: 'top' },
  inputLabel: { fontFamily: Fonts.ui.medium, fontSize: 13, color: Colors.foamMuted },
  hint: { fontFamily: Fonts.ui.regular, fontSize: 12, lineHeight: 17, color: Colors.mutedText },
  form: { gap: Spacing.sm },
  formGroup: { gap: Spacing.sm, marginTop: Spacing.sm },
  sectionLabel: { fontFamily: Fonts.ui.semibold, fontSize: 10, letterSpacing: 1.25, color: Colors.amber },
  choiceRow: { flexDirection: 'row', gap: Spacing.sm },
  choice: { flex: 1, minHeight: 40, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.small, alignItems: 'center', justifyContent: 'center' },
  choiceActive: { borderColor: Colors.amber, backgroundColor: withAlpha(Colors.amber, 0.1) },
  choiceText: { fontFamily: Fonts.ui.medium, fontSize: 13, color: Colors.mutedText },
  choiceTextActive: { color: Colors.foam },
  stepper: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.border },
  stepButton: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontFamily: Fonts.display.bold, fontSize: 20, color: Colors.foam },
  confirmRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { borderColor: Colors.amber, backgroundColor: Colors.amber },
  confirmText: { flex: 1, fontFamily: Fonts.ui.medium, fontSize: 13, lineHeight: 18, color: Colors.foamMuted },
  requests: { marginTop: Spacing.md, gap: Spacing.sm },
  requestRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm },
  requestCopy: { flex: 1 },
  requestName: { fontFamily: Fonts.ui.semibold, fontSize: 14, color: Colors.foam },
  requestMessage: { marginTop: 2, fontFamily: Fonts.ui.regular, fontSize: 12, color: Colors.mutedText },
  requestActions: { flexDirection: 'row', gap: Spacing.xs },
  iconButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  approveButton: { backgroundColor: Colors.amber, borderColor: Colors.amber },
  approvedLabel: { fontFamily: Fonts.ui.semibold, fontSize: 12, color: Colors.amber },
  textActions: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  dangerAction: { fontFamily: Fonts.ui.medium, fontSize: 12, color: Colors.amberLight },
  reportAction: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  reportText: { fontFamily: Fonts.ui.medium, fontSize: 12, color: Colors.mutedText },
});
