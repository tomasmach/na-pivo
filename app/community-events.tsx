import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
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
import { showAppDialog } from '@/components/shared/AppDialog';
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
import { intlLocale, t } from '@/i18n';
import { leaveRoute } from '@/navigation/leaveRoute';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { FontScaleCap } from '@/theme/fonts';
import { HitArea, Radius, Spacing } from '@/theme/layout';

type Mode = 'nearby' | 'mine' | 'create';
type Coords = { lat: number; lng: number };

function defaultEventStart(now = new Date()): { dayOffset: 0 | 1; hour: number } {
  const start = new Date(now);
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 2);
  return {
    dayOffset: start.toDateString() === now.toDateString() ? 0 : 1,
    hour: start.getHours(),
  };
}

function eventStatusLabel(event: CommunityEvent): string {
  if (event.status === 'cancelled') return t.communityEvents.statusCancelled;
  if (event.status === 'ended') return t.communityEvents.statusEnded;
  if (event.status === 'live') return t.communityEvents.statusLive;
  return t.communityEvents.statusAdults;
}

function hostName(event: CommunityEvent): string {
  return event.host.nickname ? `@${event.host.nickname}` : event.host.displayName || t.communityEvents.hostFallback;
}

function formatTime(event: CommunityEvent): string {
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const day = start.toLocaleDateString(intlLocale, { weekday: 'short', day: 'numeric', month: 'numeric' });
  return `${day} · ${start.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' })}-${end.toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' })}`;
}

function distanceLabel(value: DistanceBand | null): string {
  return value ? t.communityEvents.distance[value] : '';
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
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        secondary && styles.buttonSecondary,
        (pressed || disabled) && styles.pressed,
      ]}
    >
      {icon}
      <Text
        style={[styles.buttonText, secondary && styles.buttonTextSecondary]}
        maxFontSizeMultiplier={FontScaleCap.body}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Stepper({ value, onChange, min, max }: { value: number; onChange: (value: number) => void; min: number; max: number }) {
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <View style={styles.stepper}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={atMin}
        style={[styles.stepButton, atMin && styles.controlDisabled]}
        accessibilityRole="button"
        accessibilityLabel={t.communityEvents.stepperDecrease}
        accessibilityState={{ disabled: atMin }}
      >
        <MinusIcon size={18} color={Colors.foam} />
      </Pressable>
      <Text style={styles.stepValue} maxFontSizeMultiplier={FontScaleCap.body}>{value}</Text>
      <Pressable
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={atMax}
        style={[styles.stepButton, atMax && styles.controlDisabled]}
        accessibilityRole="button"
        accessibilityLabel={t.communityEvents.stepperIncrease}
        accessibilityState={{ disabled: atMax }}
      >
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
  const actionInFlightRef = useRef(false);
  const [joinMessage, setJoinMessage] = useState('');
  const run = useCallback(async (
    action: () => Promise<{ ok: boolean; detail?: string }>,
    success: string,
    target: UiInteractionTarget,
    interactionAction: UiInteractionAction = 'submit',
  ) => {
    if (busy || actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    trackUiInteraction(target, interactionAction);
    setActing(true);
    try {
      const result = await action();
      trackUiInteraction(target, result.ok ? 'success' : 'failure');
      showToast(result.ok ? success : result.detail || t.communityEvents.loadError);
      if (result.ok) await reload();
    } catch {
      trackUiInteraction(target, 'failure');
      showToast(t.communityEvents.loadError);
    } finally {
      actionInFlightRef.current = false;
      setActing(false);
    }
  }, [busy, reload, showToast]);
  const disabled = busy || acting;
  const isOpen = event.status === 'upcoming' || event.status === 'live';

  const cancel = () => {
    if (disabled) return;
    showAppDialog({
      title: t.communityEvents.cancelConfirmTitle,
      message: event.title,
      buttons: [
        { text: t.communityEvents.cancelConfirmBack, style: 'cancel' },
        {
          text: t.communityEvents.cancelEvent,
          style: 'destructive',
          onPress: () => void run(
            () => cancelCommunityEvent(event.id),
            t.communityEvents.cancelled,
            'community_cancel_event',
            'cancel',
          ),
        },
      ],
    });
  };

  const report = () => {
    if (disabled) return;
    showAppDialog({
      title: t.communityEvents.reportTitle,
      message: event.title,
      buttons: [
      { text: t.communityEvents.reportCancel, style: 'cancel' },
      {
        text: t.communityEvents.report,
        style: 'destructive',
        onPress: () => void run(
          () => reportCommunityEvent(event.id),
          t.communityEvents.reported,
          'community_report',
        ),
      },
      ],
    });
  };
  return (
    <View style={styles.eventCard}>
      <View style={styles.eventTop}>
        <View style={styles.eventCopy}>
          <Text style={styles.eventTitle} maxFontSizeMultiplier={FontScaleCap.heading}>{event.title}</Text>
          <Text style={styles.eventMeta} maxFontSizeMultiplier={FontScaleCap.body}>{formatTime(event)}</Text>
        </View>
        <Text style={styles.status} maxFontSizeMultiplier={FontScaleCap.body}>
          {eventStatusLabel(event)}
        </Text>
      </View>
      {event.description ? <Text style={styles.eventDescription} maxFontSizeMultiplier={FontScaleCap.body}>{event.description}</Text> : null}
      <View style={styles.metaRow}>
        <MapPinIcon size={15} color={Colors.amber} />
        <Text style={styles.metaText} maxFontSizeMultiplier={FontScaleCap.body}>
          {[event.areaLabel, event.city, distanceLabel(event.distanceBand)].filter(Boolean).join(' · ')}
        </Text>
      </View>
      <View style={styles.metaRow}>
        <UsersIcon size={15} color={Colors.mutedText} />
        <Text style={styles.metaText} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.spots(event.availableSpots)} · {t.communityEvents.host(hostName(event))}</Text>
      </View>
      {event.exactAddress ? (
        <View style={styles.addressStrip}>
          <Text style={styles.addressLabel} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.addressApproved}</Text>
          <Text style={styles.addressText} maxFontSizeMultiplier={FontScaleCap.body}>{event.exactAddress}</Text>
        </View>
      ) : (
        <Text style={styles.hiddenAddress} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.addressHidden}</Text>
      )}

      {!event.isHost && isOpen ? (
        event.membershipStatus === 'approved' ? (
          <Button label={t.communityEvents.leave} secondary disabled={disabled} onPress={() => void run(() => leaveCommunityEvent(event.id), t.communityEvents.leave, 'community_leave')} />
        ) : event.membershipStatus === 'pending' ? (
          <Button label={t.communityEvents.cancelRequest} secondary disabled={disabled} onPress={() => void run(() => leaveCommunityEvent(event.id), t.communityEvents.cancelRequest, 'community_cancel_request', 'cancel')} />
        ) : (
          <>
            <TextInput
              value={joinMessage}
              onChangeText={setJoinMessage}
              placeholder={t.communityEvents.requestPlaceholder}
              placeholderTextColor={Colors.mutedText}
              style={styles.input}
              maxLength={240}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
            <Button label={t.communityEvents.join} disabled={disabled || event.availableSpots < 1} onPress={() => void run(() => requestCommunityEventJoin(event.id, joinMessage), t.communityEvents.joinSent, 'community_join_request')} />
          </>
        )
      ) : null}

      {event.isHost && event.joinRequests.length > 0 ? (
        <View style={styles.requests}>
          <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.requests}</Text>
          {event.joinRequests.map((request) => (
            <View key={request.id} style={styles.requestRow}>
              <View style={styles.requestCopy}>
                <Text style={styles.requestName} maxFontSizeMultiplier={FontScaleCap.body}>{request.account.nickname ? `@${request.account.nickname}` : request.account.displayName || t.communityEvents.guestFallback}</Text>
                {request.message ? <Text style={styles.requestMessage} maxFontSizeMultiplier={FontScaleCap.body}>{request.message}</Text> : null}
              </View>
              {request.status === 'pending' ? (
                <View style={styles.requestActions}>
                  <Pressable
                    onPress={() => void run(() => decideCommunityJoinRequest(event.id, request.id, 'reject'), t.communityEvents.reject, 'community_request_decline', 'decline')}
                    disabled={disabled}
                    style={[styles.iconButton, disabled && styles.controlDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel={t.communityEvents.reject}
                    accessibilityState={{ disabled, busy: acting }}
                  >
                    <XIcon size={18} color={Colors.mutedText} />
                  </Pressable>
                  <Pressable
                    onPress={() => void run(() => decideCommunityJoinRequest(event.id, request.id, 'approve'), t.communityEvents.approve, 'community_request_accept', 'accept')}
                    disabled={disabled}
                    style={[styles.iconButton, styles.approveButton, disabled && styles.controlDisabled]}
                    accessibilityRole="button"
                    accessibilityLabel={t.communityEvents.approve}
                    accessibilityState={{ disabled, busy: acting }}
                  >
                    <CheckIcon size={18} color={Colors.stout} />
                  </Pressable>
                </View>
              ) : <Text style={styles.approvedLabel} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.approved}</Text>}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.textActions}>
        {event.isHost && isOpen ? (
          <Pressable
            onPress={cancel}
            disabled={disabled}
            style={styles.textActionTarget}
            accessibilityRole="button"
            accessibilityState={{ disabled, busy: acting }}
          >
            <Text style={styles.dangerAction} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.cancelEvent}</Text>
          </Pressable>
        ) : !event.isHost ? (
          <Pressable
            onPress={report}
            disabled={disabled}
            style={[styles.reportAction, disabled && styles.controlDisabled]}
            accessibilityRole="button"
            accessibilityLabel={t.communityEvents.report}
            accessibilityState={{ disabled, busy: acting }}
          >
            <FlagIcon size={14} color={Colors.mutedText} />
            <Text style={styles.reportText} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.report}</Text>
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadRequestRef = useRef(0);
  const [draftClientId, setDraftClientId] = useState(() => generateUuidV4());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState('');
  const [area, setArea] = useState('');
  const [address, setAddress] = useState('');
  const [initialStart] = useState(() => defaultEventStart());
  const [dayOffset, setDayOffset] = useState(initialStart.dayOffset);
  const [hour, setHour] = useState(initialStart.hour);
  const [duration, setDuration] = useState(4);
  const [capacity, setCapacity] = useState(6);
  const [adultsConfirmed, setAdultsConfirmed] = useState(false);

  const load = useCallback(async (coords: Coords | null) => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    setLoadError(null);
    try {
      const result = await fetchCommunityEvents(coords ?? undefined);
      if (requestId !== loadRequestRef.current) return;
      if (result.ok) {
        setDashboard(result.dashboard);
      } else {
        const message = result.code === 'auth' ? t.communityEvents.authError : result.detail;
        setLoadError(message || t.communityEvents.loadError);
      }
    } catch {
      if (requestId !== loadRequestRef.current) return;
      setLoadError(t.communityEvents.loadError);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(null), 0);
    return () => clearTimeout(kickoff);
  }, [load]);

  const locate = useCallback(async (forEvent: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    trackUiInteraction('community_locate');
    setBusy(true);
    try {
      const permission = await ensureLocationPermission();
      if (permission !== 'granted') {
        showToast(t.addPub.locationPermissionDenied);
        if (permission === 'denied') await openSystemSettings();
        return;
      }
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { lat: fix.coords.latitude, lng: fix.coords.longitude };
      if (forEvent) setEventLocation(coords);
      else {
        setLocation(coords);
        await load(coords);
      }
    } catch {
      showToast(t.addPub.locationUnavailable);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [load, showToast]);

  const create = useCallback(async () => {
    if (busyRef.current) return;
    const validationError = !title.trim()
      ? t.communityEvents.titleRequired
      : !city.trim()
        ? t.communityEvents.cityRequired
        : !address.trim()
          ? t.communityEvents.addressRequired
          : !eventLocation
            ? t.communityEvents.locationRequired
            : !adultsConfirmed
              ? t.communityEvents.adultsRequired
              : null;
    if (validationError) {
      trackUiInteraction('community_publish', 'submit');
      trackUiInteraction('community_publish', 'failure');
      showToast(validationError);
      return;
    }
    const starts = new Date();
    starts.setDate(starts.getDate() + dayOffset);
    starts.setHours(hour, 0, 0, 0);
    if (starts.getTime() <= Date.now()) {
      trackUiInteraction('community_publish', 'submit');
      trackUiInteraction('community_publish', 'failure');
      showToast(t.communityEvents.startPastError);
      return;
    }
    const confirmedLocation = eventLocation;
    if (!confirmedLocation) return;
    busyRef.current = true;
    trackUiInteraction('community_publish', 'submit');
    setBusy(true);
    const ends = new Date(starts.getTime() + duration * 60 * 60 * 1000);
    try {
      const result = await createCommunityEvent({
        clientId: draftClientId,
        title: title.trim(),
        description: description.trim(),
        city: city.trim(),
        areaLabel: area.trim(),
        exactAddress: address.trim(),
        lat: confirmedLocation.lat,
        lng: confirmedLocation.lng,
        startsAt: starts.toISOString(),
        endsAt: ends.toISOString(),
        capacity,
      });
      if (!result.ok) {
        trackUiInteraction('community_publish', 'failure');
        showToast(result.detail);
        return;
      }
      trackUiInteraction('community_publish', 'success');
      const nextStart = defaultEventStart();
      setDraftClientId(generateUuidV4());
      setTitle('');
      setDescription('');
      setCity('');
      setArea('');
      setAddress('');
      setEventLocation(null);
      setDayOffset(nextStart.dayOffset);
      setHour(nextStart.hour);
      setDuration(4);
      setCapacity(6);
      setAdultsConfirmed(false);
      showToast(t.communityEvents.created);
      setMode('mine');
      await load(location);
    } catch {
      trackUiInteraction('community_publish', 'failure');
      showToast(t.communityEvents.loadError);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [address, adultsConfirmed, area, capacity, city, dayOffset, description, draftClientId, duration, eventLocation, hour, load, location, showToast, title]);

  const mine = useMemo(() => [...dashboard.hosted, ...dashboard.joined].filter((event, index, all) => all.findIndex((item) => item.id === event.id) === index), [dashboard]);
  const events = mode === 'mine' ? mine : dashboard.nearby;

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={styles.root} behavior="padding" enabled={Platform.OS === 'android'}>
        <KeyboardAwareScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom + Spacing.xl }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Pressable onPress={() => leaveRoute(router)} accessibilityRole="button" accessibilityLabel={t.a11y.backButton} style={styles.backButton}>
              <ChevronLeftIcon size={24} color={Colors.foam} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.title} maxFontSizeMultiplier={FontScaleCap.heading}>{t.communityEvents.title}</Text>
            </View>
          </View>
          <Text style={styles.intro} maxFontSizeMultiplier={FontScaleCap.heading}>{t.communityEvents.intro}</Text>
          <View style={styles.safetyStrip}><Text style={styles.safetyText} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.safety}</Text></View>

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
                accessibilityRole="tab"
                accessibilityState={{ selected: mode === item }}
                accessibilityLabel={item === 'nearby' ? t.communityEvents.nearby : item === 'mine' ? t.communityEvents.mine : t.communityEvents.create}
                style={[styles.tab, mode === item && styles.tabActive]}
              >
                <Text style={[styles.tabText, mode === item && styles.tabTextActive]} maxFontSizeMultiplier={FontScaleCap.body}>{item === 'nearby' ? t.communityEvents.nearby : item === 'mine' ? t.communityEvents.mine : t.communityEvents.create}</Text>
              </Pressable>
            ))}
          </View>

          {mode === 'create' ? (
            <View style={styles.form}>
              <Text style={styles.inputLabel} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.formTitle}</Text>
              <TextInput value={title} onChangeText={setTitle} placeholder={t.communityEvents.formTitlePlaceholder} placeholderTextColor={Colors.mutedText} style={styles.input} maxLength={120} maxFontSizeMultiplier={FontScaleCap.body} />
              <Text style={styles.inputLabel} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.description}</Text>
              <TextInput value={description} onChangeText={setDescription} placeholder={t.communityEvents.descriptionPlaceholder} placeholderTextColor={Colors.mutedText} style={[styles.input, styles.multiline]} multiline maxLength={800} maxFontSizeMultiplier={FontScaleCap.body} />
              <Text style={styles.inputLabel} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.city}</Text>
              <TextInput value={city} onChangeText={setCity} placeholder={t.communityEvents.cityPlaceholder} placeholderTextColor={Colors.mutedText} style={styles.input} maxLength={120} maxFontSizeMultiplier={FontScaleCap.body} />
              <Text style={styles.inputLabel} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.area}</Text>
              <TextInput value={area} onChangeText={setArea} placeholder={t.communityEvents.areaPlaceholder} placeholderTextColor={Colors.mutedText} style={styles.input} maxLength={120} maxFontSizeMultiplier={FontScaleCap.body} />
              <Text style={styles.inputLabel} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.exactAddress}</Text>
              <TextInput value={address} onChangeText={setAddress} placeholder={t.communityEvents.exactAddressPlaceholder} placeholderTextColor={Colors.mutedText} style={styles.input} maxLength={300} maxFontSizeMultiplier={FontScaleCap.body} />
              <Text style={styles.hint} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.exactAddressHint}</Text>
              <Button label={eventLocation ? t.communityEvents.locationReady : t.communityEvents.useLocation} secondary onPress={() => void locate(true)} disabled={busy} icon={<MapPinIcon size={18} color={Colors.amber} />} />

              <View style={styles.formGroup}>
                <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.start}</Text>
                <View style={styles.choiceRow}>
                  {([0, 1] as const).map((value) => <Pressable key={value} onPress={() => setDayOffset(value)} accessibilityRole="tab" accessibilityState={{ selected: dayOffset === value }} style={[styles.choice, dayOffset === value && styles.choiceActive]}><Text style={[styles.choiceText, dayOffset === value && styles.choiceTextActive]} maxFontSizeMultiplier={FontScaleCap.body}>{value === 0 ? t.communityEvents.today : t.communityEvents.tomorrow}</Text></Pressable>)}
                </View>
                <Stepper value={hour} onChange={setHour} min={0} max={23} />
              </View>
              <View style={styles.formGroup}>
                <Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.duration}</Text>
                <View style={styles.choiceRow}>{[2, 4, 6].map((value) => <Pressable key={value} onPress={() => setDuration(value)} accessibilityRole="tab" accessibilityState={{ selected: duration === value }} style={[styles.choice, duration === value && styles.choiceActive]}><Text style={[styles.choiceText, duration === value && styles.choiceTextActive]} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.durationHours(value)}</Text></Pressable>)}</View>
              </View>
              <View style={styles.formGroup}><Text style={styles.sectionLabel} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.capacity}</Text><Stepper value={capacity} onChange={setCapacity} min={2} max={20} /></View>
              <Pressable onPress={() => setAdultsConfirmed((value) => !value)} style={styles.confirmRow} accessibilityRole="checkbox" accessibilityState={{ checked: adultsConfirmed }}>
                <View style={[styles.checkbox, adultsConfirmed && styles.checkboxActive]}>{adultsConfirmed ? <CheckIcon size={16} color={Colors.stout} /> : null}</View>
                <Text style={styles.confirmText} maxFontSizeMultiplier={FontScaleCap.body}>{t.communityEvents.adultsConfirm}</Text>
              </Pressable>
              <Button label={t.communityEvents.publish} onPress={() => void create()} disabled={busy} icon={<HouseIcon size={18} color={Colors.stout} />} />
            </View>
          ) : loading ? <ActivityIndicator color={Colors.amber} style={styles.loader} /> : loadError ? (
            <View style={styles.errorState}>
              <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>{loadError}</Text>
              <Button label={t.communityEvents.retry} onPress={() => {
                setLoading(true);
                void load(location);
              }} />
            </View>
          ) : (
            <View style={styles.list}>
              {mode === 'nearby' && !location ? <Button label={busy ? t.communityEvents.locating : t.communityEvents.locate} onPress={() => void locate(false)} disabled={busy} secondary icon={<MapPinIcon size={18} color={Colors.amber} />} /> : null}
              {events.length === 0 ? <Text style={styles.empty} maxFontSizeMultiplier={FontScaleCap.body}>{mode === 'nearby' ? t.communityEvents.noNearby : t.communityEvents.noMine}</Text> : events.map((event) => <EventCard key={event.id} event={event} busy={busy} reload={() => load(location)} />)}
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
  title: { fontWeight: '800', fontSize: 30, lineHeight: 34, color: Colors.foam },
  intro: { fontWeight: '700', fontSize: 19, lineHeight: 25, color: Colors.foam },
  safetyStrip: { borderLeftWidth: 2, borderLeftColor: Colors.amber, paddingLeft: Spacing.md },
  safetyText: { fontWeight: '400', fontSize: 13, lineHeight: 19, color: Colors.foamMuted },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.amber },
  tabText: { fontWeight: '500', fontSize: 12, color: Colors.mutedText, textAlign: 'center' },
  tabTextActive: { color: Colors.foam },
  loader: { marginTop: Spacing.xl },
  list: { gap: Spacing.lg },
  empty: { fontWeight: '400', fontSize: 15, lineHeight: 22, color: Colors.mutedText },
  eventCard: { borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.border, paddingVertical: Spacing.lg, gap: Spacing.sm },
  eventTop: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  eventCopy: { flex: 1 },
  eventTitle: { fontWeight: '800', fontSize: 21, lineHeight: 25, color: Colors.foam },
  eventMeta: { marginTop: 3, fontWeight: '500', fontSize: 13, color: Colors.foamMuted },
  status: { fontWeight: '600', fontSize: 10, letterSpacing: 1, color: Colors.amber },
  eventDescription: { fontWeight: '400', fontSize: 14, lineHeight: 20, color: Colors.foamMuted },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flex: 1, fontWeight: '400', fontSize: 13, color: Colors.mutedText },
  addressStrip: { marginTop: Spacing.xs, padding: Spacing.md, borderRadius: Radius.small, backgroundColor: withAlpha(Colors.amber, 0.1) },
  addressLabel: { fontWeight: '600', fontSize: 10, letterSpacing: 1, color: Colors.amber },
  addressText: { marginTop: 4, fontWeight: '500', fontSize: 15, color: Colors.foam },
  hiddenAddress: { fontWeight: '500', fontSize: 12, color: Colors.amberLight },
  button: { minHeight: 48, marginTop: Spacing.xs, borderRadius: Radius.medium, backgroundColor: Colors.amber, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md },
  buttonSecondary: { backgroundColor: Colors.stout3 },
  buttonText: { fontWeight: '700', fontSize: 14, color: Colors.stout },
  buttonTextSecondary: { color: Colors.foam },
  pressed: { opacity: 0.55 },
  controlDisabled: { opacity: 0.4 },
  input: { minHeight: 48, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.medium, backgroundColor: Colors.stout2, paddingHorizontal: Spacing.md, fontWeight: '400', fontSize: 15, letterSpacing: 0, color: Colors.foam },
  multiline: { minHeight: 100, paddingTop: Spacing.md, textAlignVertical: 'top' },
  inputLabel: { fontWeight: '500', fontSize: 13, color: Colors.foamMuted },
  hint: { fontWeight: '400', fontSize: 12, lineHeight: 17, color: Colors.mutedText },
  form: { gap: Spacing.sm },
  formGroup: { gap: Spacing.sm, marginTop: Spacing.sm },
  sectionLabel: { fontWeight: '600', fontSize: 10, letterSpacing: 1.25, color: Colors.amber },
  choiceRow: { flexDirection: 'row', gap: Spacing.sm },
  choice: { flex: 1, minHeight: HitArea.min, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.small, alignItems: 'center', justifyContent: 'center' },
  choiceActive: { borderColor: Colors.amber, backgroundColor: withAlpha(Colors.amber, 0.1) },
  choiceText: { fontWeight: '500', fontSize: 13, color: Colors.mutedText },
  choiceTextActive: { color: Colors.foam },
  stepper: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.border },
  stepButton: { width: HitArea.min, height: HitArea.min, alignItems: 'center', justifyContent: 'center' },
  stepValue: { fontWeight: '700', fontSize: 20, color: Colors.foam },
  confirmRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxActive: { borderColor: Colors.amber, backgroundColor: Colors.amber },
  confirmText: { flex: 1, fontWeight: '500', fontSize: 13, lineHeight: 18, color: Colors.foamMuted },
  requests: { marginTop: Spacing.md, gap: Spacing.sm },
  requestRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderTopWidth: 1, borderTopColor: Colors.border, paddingTop: Spacing.sm },
  requestCopy: { flex: 1 },
  requestName: { fontWeight: '600', fontSize: 14, color: Colors.foam },
  requestMessage: { marginTop: 2, fontWeight: '400', fontSize: 12, color: Colors.mutedText },
  requestActions: { flexDirection: 'row', gap: Spacing.xs },
  iconButton: { width: HitArea.min, height: HitArea.min, borderRadius: HitArea.min / 2, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  approveButton: { backgroundColor: Colors.amber, borderColor: Colors.amber },
  approvedLabel: { fontWeight: '600', fontSize: 12, color: Colors.amber },
  textActions: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end' },
  textActionTarget: { minHeight: HitArea.min, justifyContent: 'center' },
  errorState: { gap: Spacing.md },
  dangerAction: { fontWeight: '500', fontSize: 12, color: Colors.amberLight },
  reportAction: { minHeight: HitArea.min, flexDirection: 'row', alignItems: 'center', gap: 5 },
  reportText: { fontWeight: '500', fontSize: 12, color: Colors.mutedText },
});
