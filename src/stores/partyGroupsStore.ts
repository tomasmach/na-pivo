import AsyncStorage from '@/data/privateAccountStorage';
import {
  guardPrivateAccountStateCreator,
  isPrivateAccountMutationFrozen,
} from '@/data/privateAccountBoundary';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { generateUuidV4 } from '@/data/account';

export interface PartyGroup {
  id: string;
  name: string;
  memberIds: string[];
  updatedAt: string;
}

interface PartyGroupsState {
  groups: PartyGroup[];
  upsertGroup: (name: string, memberIds: string[], id?: string) => string | null;
  removeGroup: (id: string) => void;
  pruneMemberIds: (validIds: string[]) => void;
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 28);
}

function uniqueIds(ids: string[]): string[] {
  return Array.from(new Set(ids.filter(Boolean)));
}

export const usePartyGroupsStore = create<PartyGroupsState>()(
  persist(
    guardPrivateAccountStateCreator((set, get) => ({
      groups: [],

      upsertGroup: (rawName, rawMemberIds, id) => {
        if (isPrivateAccountMutationFrozen()) return null;
        const name = cleanName(rawName);
        const memberIds = uniqueIds(rawMemberIds);
        if (!name || memberIds.length === 0) return null;

        const nextId = id ?? generateUuidV4();
        const updatedAt = new Date().toISOString();
        set((state) => {
          const withoutCurrent = state.groups.filter((group) => group.id !== nextId);
          const existingByName = withoutCurrent.find(
            (group) => group.name.toLocaleLowerCase('cs-CZ') === name.toLocaleLowerCase('cs-CZ'),
          );
          const finalId = existingByName?.id ?? nextId;
          const groups = [
            { id: finalId, name, memberIds, updatedAt },
            ...withoutCurrent.filter((group) => group.id !== finalId),
          ];
          return { groups };
        });
        return get().groups.find(
          (group) => group.name.toLocaleLowerCase('cs-CZ') === name.toLocaleLowerCase('cs-CZ'),
        )?.id ?? nextId;
      },

      removeGroup: (id) =>
        set((state) => ({
          groups: state.groups.filter((group) => group.id !== id),
        })),

      pruneMemberIds: (validIds) => {
        const valid = new Set(validIds);
        set((state) => ({
          groups: state.groups
            .map((group) => ({
              ...group,
              memberIds: group.memberIds.filter((id) => valid.has(id)),
            }))
            .filter((group) => group.memberIds.length > 0),
        }));
      },
    })),
    {
      name: 'na-pivo-party-groups',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        groups: state.groups,
      }),
    },
  ),
);
