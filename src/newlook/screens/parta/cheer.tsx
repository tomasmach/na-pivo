import React from 'react';

import type { FriendPresence } from '@/data/friendsClient';
import { t } from '@/i18n';

import { Icon } from '../../components/Icon';
import { Press, T } from '../../components/ui';
import { C, s } from '../../theme';
import { toggleCheer } from './cheerActions';

export function CheerButton({ presence }: { presence: FriendPresence }) {
  const given = presence.myReaction === 'cheers';
  const count = presence.reactions?.cheers ?? 0;
  return (
    <Press
      haptic
      onPress={() => void toggleCheer(presence.account.id)}
      accessibilityRole="button"
      accessibilityState={{ selected: given }}
      style={[
        s.row,
        { height: 34, borderRadius: 18, paddingHorizontal: 14, gap: 6, backgroundColor: given ? C.yellowTint : C.card, borderWidth: 1, borderColor: given ? C.yellowLine : C.hairline },
      ]}
    >
      <Icon name="beer" size={16} color={C.yellow} />
      <T s={14} w={600} c={given ? C.yellow : C.white}>
        {count > 0 ? t.nv.parta.cheerCount(count) : t.nv.parta.cheer}
      </T>
    </Press>
  );
}
