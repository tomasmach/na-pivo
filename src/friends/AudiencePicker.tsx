/**
 * AudiencePicker — the "KOMU" block every cinknutí goes through: the whole
 * party, a saved group, or friends picked one by one (and saved as a group).
 *
 * Controlled: the host keeps the {@link Audience} and turns it into recipient
 * ids with {@link audienceIds} when it sends.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CheckIcon, PlusIcon, UsersIcon } from '@/components/shared/IconGlyph';
import type { FriendProfile } from '@/data/friendsClient';
import { t } from '@/i18n';
import { usePartyGroupsStore } from '@/stores/partyGroupsStore';
import { useToastStore } from '@/stores/toastStore';
import { Colors, withAlpha } from '@/theme/colors';
import { Fonts, FontScaleCap } from '@/theme/fonts';
import { Radius, Spacing } from '@/theme/layout';
import { friendDisplayName } from './FriendMini';
import SectionHeader from './SectionHeader';

export interface Audience {
  mode: 'all' | 'custom';
  /** The saved group the pick came from, if any. */
  groupId: string | null;
  ids: string[];
}

export const EVERYONE: Audience = { mode: 'all', groupId: null, ids: [] };

/** The chosen friends, or undefined for the whole party. Picks of people no longer in the party drop out. */
export function audienceIds(audience: Audience, friends: FriendProfile[]): string[] | undefined {
  if (audience.mode === 'all') return undefined;
  const known = new Set(friends.map((friend) => friend.id));
  return audience.ids.filter((id) => known.has(id));
}

function RecipientChip({ label, selected, onPress, icon }: { label: string; selected: boolean; onPress: () => void; icon?: ReactNode }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.recipientChip, selected && styles.recipientChipActive, pressed && styles.dim]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      {icon}
      <Text style={[styles.recipientChipText, selected && styles.recipientChipTextActive]} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
        {label}
      </Text>
    </Pressable>
  );
}

function FriendRecipientRow({ friend, selected, onToggle }: { friend: FriendProfile; selected: boolean; onToggle: () => void }) {
  const name = friendDisplayName(friend);
  return (
    <Pressable
      onPress={onToggle}
      style={({ pressed }) => [styles.recipientRow, selected && styles.recipientRowSelected, pressed && styles.dim]}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={name}
    >
      <View style={[styles.recipientCheck, selected && styles.recipientCheckActive]}>
        {selected ? <CheckIcon size={14} color={Colors.stout} /> : null}
      </View>
      <View style={styles.recipientNameWrap}>
        <Text style={styles.recipientName} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
          {name}
        </Text>
        {friend.displayName && friend.nickname ? (
          <Text style={styles.recipientSub} numberOfLines={1} maxFontSizeMultiplier={FontScaleCap.body}>
            {friend.displayName}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function AudiencePicker({ friends, value, onChange }: { friends: FriendProfile[]; value: Audience; onChange: (next: Audience) => void }) {
  const showToast = useToastStore((s) => s.show);
  const groups = usePartyGroupsStore((s) => s.groups);
  const upsertGroup = usePartyGroupsStore((s) => s.upsertGroup);
  const pruneMemberIds = usePartyGroupsStore((s) => s.pruneMemberIds);
  const [groupName, setGroupName] = useState('');
  const picked = useMemo(() => audienceIds(value, friends) ?? [], [friends, value]);
  const count = value.mode === 'all' ? friends.length : picked.length;

  useEffect(() => {
    pruneMemberIds(friends.map((friend) => friend.id));
  }, [friends, pruneMemberIds]);

  const selectGroup = useCallback((groupId: string) => {
    const group = usePartyGroupsStore.getState().groups.find((item) => item.id === groupId);
    if (!group) return;
    const known = new Set(friends.map((friend) => friend.id));
    onChange({ mode: 'custom', groupId: group.id, ids: group.memberIds.filter((id) => known.has(id)) });
    setGroupName(group.name);
  }, [friends, onChange]);

  // Picking starts from nobody, so "only some" never begins as everyone.
  const startCustomSelection = useCallback(() => {
    onChange({ mode: 'custom', groupId: null, ids: value.mode === 'custom' ? value.ids : [] });
  }, [onChange, value.ids, value.mode]);

  const toggleRecipient = useCallback((id: string) => {
    onChange({ mode: 'custom', groupId: null, ids: value.ids.includes(id) ? value.ids.filter((item) => item !== id) : [...value.ids, id] });
  }, [onChange, value.ids]);

  const saveCurrentGroup = useCallback(() => {
    const savedId = upsertGroup(groupName, picked, value.groupId ?? undefined);
    if (!savedId) {
      showToast(t.friends.recipientGroupSaveHint);
      return;
    }
    onChange({ ...value, groupId: savedId });
    showToast(t.friends.recipientGroupSaved);
  }, [groupName, onChange, picked, showToast, upsertGroup, value]);

  return (
    <>
      <SectionHeader label={t.friends.composeAudienceLabel} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recipientChips}>
        <RecipientChip
          label={t.friends.recipientAll}
          selected={value.mode === 'all'}
          onPress={() => onChange(EVERYONE)}
          icon={<UsersIcon size={16} color={value.mode === 'all' ? Colors.stout : Colors.amber} />}
        />
        {groups.map((group) => (
          <RecipientChip
            key={group.id}
            label={group.name}
            selected={value.mode === 'custom' && value.groupId === group.id}
            onPress={() => selectGroup(group.id)}
          />
        ))}
        <RecipientChip
          label={t.friends.recipientCustom}
          selected={value.mode === 'custom' && value.groupId == null}
          onPress={startCustomSelection}
          icon={<PlusIcon size={16} color={value.mode === 'custom' && value.groupId == null ? Colors.stout : Colors.amber} />}
        />
      </ScrollView>
      <Text style={styles.recipientSummary} numberOfLines={2} maxFontSizeMultiplier={FontScaleCap.body}>
        {value.mode === 'all' ? t.friends.recipientAllSummary(count) : t.friends.recipientCustomSummary(count)}
      </Text>
      {value.mode === 'custom' ? (
        <View style={styles.recipientPanel}>
          {friends.length === 0 ? (
            <Text style={styles.emptyText} maxFontSizeMultiplier={FontScaleCap.body}>
              {t.friends.recipientNoFriends}
            </Text>
          ) : (
            friends.map((friend) => (
              <FriendRecipientRow key={friend.id} friend={friend} selected={picked.includes(friend.id)} onToggle={() => toggleRecipient(friend.id)} />
            ))
          )}
          <View style={styles.groupSaveRow}>
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              placeholder={t.friends.recipientGroupPlaceholder}
              placeholderTextColor={Colors.mutedText}
              style={styles.groupNameInput}
              maxLength={28}
              maxFontSizeMultiplier={FontScaleCap.body}
            />
            <Pressable
              onPress={saveCurrentGroup}
              disabled={picked.length === 0}
              style={({ pressed }) => [styles.groupSaveButton, picked.length === 0 && styles.groupSaveButtonDisabled, pressed && picked.length > 0 && styles.dim]}
              accessibilityRole="button"
              accessibilityState={{ disabled: picked.length === 0 }}
              accessibilityLabel={t.friends.recipientGroupSave}
            >
              <Text style={styles.groupSaveText} maxFontSizeMultiplier={FontScaleCap.body}>
                {t.friends.recipientGroupSave}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  dim: { opacity: 0.6 },
  recipientChips: { gap: Spacing.sm, paddingTop: Spacing.sm, paddingRight: Spacing.lg },
  recipientChip: {
    minHeight: 40,
    maxWidth: 180,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.7),
    backgroundColor: withAlpha(Colors.foam, 0.05),
  },
  recipientChipActive: { borderColor: withAlpha(Colors.amber, 0.42), backgroundColor: Colors.amber },
  recipientChipText: { flexShrink: 1, fontFamily: Fonts.ui.semibold, fontSize: 14, color: Colors.foamMuted },
  recipientChipTextActive: { color: Colors.stout },
  recipientSummary: { marginTop: Spacing.sm, fontFamily: Fonts.ui.medium, fontSize: 13, color: Colors.mutedText },
  recipientPanel: { marginTop: Spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: withAlpha(Colors.border, 0.45) },
  recipientRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: withAlpha(Colors.border, 0.36),
  },
  recipientRowSelected: { backgroundColor: withAlpha(Colors.amber, 0.06) },
  recipientCheck: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: withAlpha(Colors.border, 0.8),
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withAlpha(Colors.foam, 0.04),
  },
  recipientCheckActive: { borderColor: Colors.amber, backgroundColor: Colors.amber },
  recipientNameWrap: { flex: 1, minWidth: 0 },
  recipientName: { fontFamily: Fonts.ui.bold, fontSize: 15, color: Colors.foam },
  recipientSub: { marginTop: 1, fontFamily: Fonts.ui.medium, fontSize: 12, color: Colors.mutedText },
  groupSaveRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingTop: Spacing.md },
  groupNameInput: {
    flex: 1,
    minHeight: 44,
    fontFamily: Fonts.ui.semibold,
    color: Colors.foam,
    fontSize: 15,
    backgroundColor: Colors.stout2,
    borderRadius: Radius.medium,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
  },
  groupSaveButton: {
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    backgroundColor: withAlpha(Colors.amber, 0.14),
    borderWidth: 1,
    borderColor: withAlpha(Colors.amber, 0.34),
    alignItems: 'center',
    justifyContent: 'center',
  },
  groupSaveButtonDisabled: { opacity: 0.5 },
  groupSaveText: { fontFamily: Fonts.ui.bold, fontSize: 14, color: Colors.amber },
  emptyText: { fontFamily: Fonts.ui.medium, fontSize: 14, color: Colors.mutedText, paddingVertical: Spacing.md },
});
