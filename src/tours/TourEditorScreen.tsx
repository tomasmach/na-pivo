import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Keyboard, Modal, PanResponder, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useNavigation, useRouter, type Href } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePreventRemove } from 'expo-router/react-navigation';
import type { Region } from 'react-native-maps';
import { ArrowDownIcon, ArrowUpIcon, GripVerticalIcon } from '@/components/shared/IconGlyph';
import { showAppDialog, AppDialogHost } from '@/components/shared/AppDialog';
import { KeyboardAwareScrollView } from '@/components/shared/KeyboardAwareScrollView';
import { useToursStore } from '@/stores/toursStore';
import { t } from '@/i18n';
import { Colors } from '@/theme/colors';
import { Spacing } from '@/theme/layout';
import { useKeyboardHeight } from '@/utils/useKeyboardHeight';
import { TourButton, TourError, TourHeader, TourStopRow, TourText, ui } from './TourChrome';
import { TourMap } from './TourMap';
import { TourPubPicker } from './TourPubPicker';
import { TourChallengeSheet } from './TourChallengeSheet';
import type { TourStop } from './model';

function dateDisplay(value: string | null) { return value ? value.split('-').reverse().join('. ') : ''; }
function dateValue(value: string): string | null | false {
  if (!value.trim()) return null;
  const match = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/.exec(value.trim());
  if (!match) return false;
  const iso = `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  const parsed = new Date(`${iso}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : false;
}
function DragHandle({ onDrop, onDrag }: { onDrop: (dy: number) => void; onDrag: (active: boolean, dy: number) => void }) {
  const callbacks = useRef({ onDrop, onDrag });
  useLayoutEffect(() => { callbacks.current = { onDrop, onDrag }; }, [onDrop, onDrag]);
  // PanResponder invokes these callbacks on touch events, never during render.
  // eslint-disable-next-line react-hooks/refs
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => callbacks.current.onDrag(true, 0),
    onPanResponderMove: (_, state) => callbacks.current.onDrag(true, state.dy),
    onPanResponderRelease: (_, state) => { callbacks.current.onDrag(false, 0); callbacks.current.onDrop(state.dy); },
    onPanResponderTerminate: () => callbacks.current.onDrag(false, 0),
  }), []);
  return <View {...pan.panHandlers} style={ui.iconButton} accessible accessibilityRole="adjustable" accessibilityLabel={t.tours.reorder} accessibilityHint={t.tours.dragHint}>
    <GripVerticalIcon size={20} color={Colors.foamMuted} />
  </View>;
}
export default function TourEditorScreen() {
  const draft = useToursStore((s) => s.draft);
  const error = useToursStore((s) => s.error);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useEffect(() => { void useToursStore.getState().hydrate(); }, []);
  return draft ? <TourEditor key={draft.id} /> : <View style={[ui.screen, { paddingTop: insets.top }]}><TourHeader title={t.tours.editTour} onBack={() => router.replace('/tours' as Href)} /><TourError code={error} /></View>;
}
function TourEditor() {
  const router = useRouter(); const navigation = useNavigation(); const insets = useSafeAreaInsets();
  const store = useToursStore(); const draft = store.draft;
  const keyboardHeight = useKeyboardHeight();
  const [title, setTitle] = useState(draft?.title ?? '');
  // Typing persists the draft after a short pause, not on every keystroke; blur and leaving flush it.
  const pendingTitle = useRef<string | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushTitle = useCallback(() => {
    if (titleTimer.current) clearTimeout(titleTimer.current);
    titleTimer.current = null;
    const value = pendingTitle.current;
    pendingTitle.current = null;
    if (value !== null) void useToursStore.getState().updateDraft({ title: value });
  }, []);
  useEffect(() => flushTitle, [flushTitle]);
  const [date, setDate] = useState(() => dateDisplay(draft?.scheduledDate ?? null));
  const [time, setTime] = useState(draft?.scheduledTime ?? '');
  const [dateError, setDateError] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [picker, setPicker] = useState(false); const [replace, setReplace] = useState<TourStop | null>(null);
  const [challengeStop, setChallengeStop] = useState<TourStop | null>(null);
  const [mapHeight, setMapHeight] = useState(300);
  const [largeMap, setLargeMap] = useState(false); const [region, setRegion] = useState<Region>();
  const [reorder, setReorder] = useState(false); const [undo, setUndo] = useState<TourStop[] | null>(null);
  const [undoLabel, setUndoLabel] = useState(t.tours.moved);
  const [drag, setDrag] = useState<{ id: string; dy: number } | null>(null);
  const scroll = useRef<ScrollView>(null); const rowY = useRef<Record<string, { y: number; height: number }>>({});
  const listY = useRef(0); const sectionY = useRef(0); const saving = useRef(false); const [allowExit, setAllowExit] = useState(false);

  async function persistDate() {
    const parsed = dateValue(date); const normalizedTime = time.trim() || null;
    if (parsed === false || (normalizedTime && (!parsed || !/^([01]\d|2[0-3]):[0-5]\d$/.test(normalizedTime)))) { setDateError(true); return false; }
    const result = await store.updateDraft({ scheduledDate: parsed, scheduledTime: normalizedTime });
    setDateError(!result.ok); return result.ok;
  }
  async function save() {
    if (saving.current) return;
    saving.current = true;
    pendingTitle.current = null;
    if (titleTimer.current) clearTimeout(titleTimer.current);
    if (!(await store.updateDraft({ title })).ok) { saving.current = false; return; }
    if (!(await persistDate())) { saving.current = false; return; }
    const result = await store.saveDraft(); saving.current = false;
    if (result.ok && result.id) { setAllowExit(true); requestAnimationFrame(() => router.replace({ pathname: '/tours/[id]', params: { id: result.id! } } as Href)); }
  }
  const askExit = (leave: () => void) => {
    showAppDialog({ title: t.tours.unsavedTitle, buttons: [
      { text: t.tours.saveChanges, onPress: () => { void save(); } },
      { text: t.tours.discard, style: 'destructive', onPress: () => { void store.discardDraft().then((r) => { if (r.ok) { setAllowExit(true); requestAnimationFrame(leave); } }); } },
      { text: t.tours.stay, style: 'cancel' },
    ] });
  };
  usePreventRemove(!!draft && !allowExit, ({ data }) => {
    if (challengeStop) { setChallengeStop(null); return; }
    if (picker) { setPicker(false); return; }
    if (largeMap) { setLargeMap(false); return; }
    askExit(() => navigation.dispatch(data.action));
  });
  const select = (id: string) => { setSelected(id); const row = rowY.current[id]; if (row) scroll.current?.scrollTo({ y: Math.max(0, sectionY.current + listY.current + row.y - 16), animated: true }); };
  async function move(id: string, delta: number) {
    if (!draft || !delta) return;
    const previous = draft.stops;
    const result = await store.moveStop(id, delta);
    if (result.ok) { setUndo(previous); setUndoLabel(t.tours.moved); AccessibilityInfo.announceForAccessibility(t.tours.moved); }
  }
  function stopActions(stop: TourStop) {
    setSelected(stop.id);
    showAppDialog({ title: stop.name, message: stop.address || t.tours.openingHoursUnknown, buttons: [
      { text: stop.challenge ? t.tours.editChallenge : t.tours.addChallenge, onPress: () => { Keyboard.dismiss(); setChallengeStop(stop); } },
      { text: t.tours.replaceStop, onPress: () => { setReplace(stop); setPicker(true); } },
      { text: t.tours.removeStop, style: 'destructive', onPress: () => { const previous = draft!.stops; void store.removeStop(stop.id).then((r) => { if (r.ok) { setUndo(previous); setUndoLabel(t.tours.stopRemoved); setSelected(null); } }); } },
      { text: t.tours.cancel, style: 'cancel' },
    ] });
  }
  if (!draft) return <View style={[ui.screen, { paddingTop: insets.top }]}><TourHeader title={t.tours.editTour} onBack={() => router.back()} /><TourError code={store.error} /></View>;
  return <View style={[ui.screen, { paddingTop: insets.top }]}>
    <View style={ui.grow} accessibilityElementsHidden={picker || !!challengeStop} importantForAccessibility={picker || challengeStop ? 'no-hide-descendants' : 'auto'}>
    <TourHeader title={draft.revision || store.plans.some((p) => p.id === draft.id) ? t.tours.editTour : t.tours.newTour} onBack={() => router.canGoBack() ? router.back() : askExit(() => router.replace('/tours' as Href))} />
    <KeyboardAwareScrollView ref={scroll} scrollEnabled={!drag} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
      <View style={ui.field}><TourText style={ui.section}>{t.tours.name}</TourText>
        <TextInput returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} testID="tour-title" accessibilityLabel={t.tours.name} maxLength={60} value={title} onChangeText={(value) => { setTitle(value); pendingTitle.current = value; if (titleTimer.current) clearTimeout(titleTimer.current); titleTimer.current = setTimeout(flushTitle, 300); }} onBlur={flushTitle} placeholder={t.tours.namePlaceholder} placeholderTextColor={Colors.foamMuted} style={ui.input} maxFontSizeMultiplier={1.3} />
      </View>
      <View style={[ui.row, { alignItems: 'flex-start' }]}>
        <View style={[ui.field, { flex: 3 }]}><TourText style={ui.section}>{t.tours.date}</TourText>
          <TextInput returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} testID="tour-date" accessibilityLabel={t.tours.date} value={date} onChangeText={(value) => { setDate(value); setDateError(false); const parsed = dateValue(value); if (parsed !== false) void store.updateDraft({ scheduledDate: parsed, ...(!parsed ? { scheduledTime: null } : {}) }); }} onBlur={() => { void persistDate(); }} placeholder={t.tours.datePlaceholder} placeholderTextColor={Colors.foamMuted} style={ui.input} keyboardType="numbers-and-punctuation" maxLength={12} maxFontSizeMultiplier={1.2} />
        </View>
        <View style={[ui.field, { flex: 2 }]}><TourText style={ui.section}>{t.tours.time}</TourText>
          <TextInput returnKeyType="done" onSubmitEditing={() => Keyboard.dismiss()} testID="tour-time" accessibilityLabel={t.tours.time} value={time} onChangeText={(value) => { setTime(value); if (!value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) { void store.updateDraft({ scheduledTime: value || null }); } }} onBlur={() => { void persistDate(); }} placeholder={t.tours.timePlaceholder} placeholderTextColor={Colors.foamMuted} style={ui.input} keyboardType="numbers-and-punctuation" maxLength={5} maxFontSizeMultiplier={1.2} />
        </View>
      </View>
      <TourError code={store.error} message={dateError ? t.tours.errors.date : null} />
      {!keyboardHeight && draft.stops.length > 0 && <TourMap key={draft.stops.map((s) => s.id).sort().join()} stops={draft.stops} selectedId={selected} onSelect={select} height={116} region={region} onRegionChange={setRegion} onExpand={() => setLargeMap(true)} />}
      <View onLayout={(event) => { sectionY.current = event.nativeEvent.layout.y; }}>
        <View style={ui.row}><TourText style={ui.section}>{t.tours.stops} ({draft.stops.length}/8)</TourText>
          {draft.stops.length > 1 && <Pressable style={ui.link} accessibilityRole="button" accessibilityLabel={reorder ? t.tours.reorderDone : t.tours.reorder} onPress={() => { Keyboard.dismiss(); setReorder(!reorder); }}><TourText style={ui.linkText}>{reorder ? t.tours.reorderDone : t.tours.reorder}</TourText></Pressable>}
        </View>
        {reorder && <TourText style={ui.notice}>{t.tours.firstStopChanges}</TourText>}
        <View onLayout={(event) => { listY.current = event.nativeEvent.layout.y; }}>
          {draft.stops.map((stop, index) => <View key={stop.id} onLayout={(event) => { rowY.current[stop.id] = event.nativeEvent.layout; }} style={drag?.id === stop.id ? { transform: [{ translateY: drag.dy }], zIndex: 10, backgroundColor: Colors.stout3 } : undefined}>
            <TourStopRow stop={stop} index={index} selected={selected === stop.id} onPress={() => stopActions(stop)}>
              {reorder && <View style={ui.row}>
                <Pressable style={ui.iconButton} accessibilityRole="button" accessibilityLabel={`${t.tours.moveUp}: ${stop.name}`} disabled={index === 0} onPress={() => { void move(stop.id, -1); }}><ArrowUpIcon color={index ? Colors.foam : Colors.mutedText} size={20} /></Pressable>
                <Pressable style={ui.iconButton} accessibilityRole="button" accessibilityLabel={`${t.tours.moveDown}: ${stop.name}`} disabled={index === draft.stops.length - 1} onPress={() => { void move(stop.id, 1); }}><ArrowDownIcon color={index < draft.stops.length - 1 ? Colors.foam : Colors.mutedText} size={20} /></Pressable>
              </View>}
              {!reorder && <DragHandle onDrag={(active, dy) => setDrag(active ? { id: stop.id, dy } : null)} onDrop={(dy) => {
                const source = rowY.current[stop.id]; if (!source) return;
                const middle = source.y + source.height / 2 + dy;
                let target = index;
                draft.stops.forEach((s, i) => { const row = rowY.current[s.id]; if (row && middle >= row.y && middle <= row.y + row.height) target = i; });
                void move(stop.id, target - index);
              }} />}
            </TourStopRow>
          </View>)}
        </View>
      </View>
      {undo && <View style={ui.row}><TourText style={ui.grow}>{undoLabel}</TourText><TourButton label={t.tours.undo} secondary onPress={() => { void store.updateDraft({ stops: undo }).then((r) => { if (r.ok) setUndo(null); }); }} /></View>}
      <TourButton label={t.tours.addStop} secondary disabled={draft.stops.length >= 8} onPress={() => { Keyboard.dismiss(); setReplace(null); setPicker(true); }} />
    </KeyboardAwareScrollView>
    {!keyboardHeight && <View style={[ui.footer, { paddingBottom: Math.max(insets.bottom, Spacing.md) }]}><TourButton testID="tour-save" label={t.tours.saveChanges} onPress={() => { void save(); }} /></View>}
    </View>
    <TourPubPicker visible={picker} stops={draft.stops} replaceStop={replace} onClose={() => setPicker(false)} onSelect={(pub) => {
      const action = replace ? store.replaceStop(replace.id, pub) : store.addStop(pub);
      void action.then((r) => { if (r.ok) { setPicker(false); setRegion(undefined); setUndo(null); } });
    }} />
    {challengeStop && <TourChallengeSheet key={challengeStop.id} stop={challengeStop} error={store.error} onClose={() => setChallengeStop(null)}
      onSave={async (text) => {
        const result = await store.setChallenge(challengeStop.id, text);
        // Undo restores a whole stop list; it must not bring back a list without this challenge.
        if (result.ok) setUndo(null);
        return result.ok;
      }} />}
    <Modal visible={largeMap} animationType="slide" onRequestClose={() => setLargeMap(false)}>
      <View style={[ui.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}><TourHeader title={t.tours.map} onBack={() => setLargeMap(false)} />
        <View style={ui.grow} onLayout={(event) => setMapHeight(event.nativeEvent.layout.height)}><TourMap key={draft.stops.map((s) => s.id).sort().join()} stops={draft.stops} selectedId={selected} onSelect={setSelected} height={mapHeight} region={region} onRegionChange={setRegion} /></View>
        <TourButton label={t.tours.back} onPress={() => setLargeMap(false)} secondary /><AppDialogHost />
      </View>
    </Modal>
  </View>;
}
