/**
 * What you can do with one beer on a pub's menu: fix its price or take it off
 * the menu. The counter opens it from "Co si dáš?" (the ⋯ button or a long
 * press) and the pub page from a "Na čepu" row, so both places offer the same
 * two doors. The price form stays about the price; deleting lives only here.
 */

import React from 'react';

import { MoreSheet, type MoreRow } from '@/components/shared/MoreSheet';
import { showAppDialog } from '@/components/shared/AppDialog';
import { PencilIcon, Trash2Icon } from '@/components/shared/IconGlyph';
import type { CommunityBeer } from '@/data/communityHours';
import { formatVolume, t } from '@/i18n';

export function MenuBeerActionsSheet({
  visible,
  beer,
  canRemove,
  onClose,
  onEditPrice,
  onRemove,
}: {
  visible: boolean;
  /** Kept by the parent after closing, so the title does not blank mid-fade. */
  beer: CommunityBeer | null;
  /** Only a beer the shared menu really holds can come off it. */
  canRemove: boolean;
  onClose: () => void;
  onEditPrice: (beer: CommunityBeer) => void;
  /** Asks first: see confirmRemoveFromMenu. */
  onRemove: (beer: CommunityBeer) => void;
}) {
  const rows: MoreRow[] = beer
    ? [
        {
          key: 'edit-price',
          label: t.counter.menuBeerEditPrice,
          icon: PencilIcon,
          onPress: () => onEditPrice(beer),
        },
        ...(canRemove
          ? [
              {
                key: 'remove',
                label: t.counter.removeFromMenu,
                icon: Trash2Icon,
                onPress: () => onRemove(beer),
              },
            ]
          : []),
      ]
    : [];

  return (
    <MoreSheet
      visible={visible}
      title={beer ? menuBeerLabel(beer) : undefined}
      rows={rows}
      onClose={onClose}
    />
  );
}

/** "Plzeň · 0,5 l": a pub may pour the same beer in two sizes. */
function menuBeerLabel(beer: CommunityBeer): string {
  return typeof beer.volumeMl === 'number'
    ? `${beer.name} · ${formatVolume(beer.volumeMl)}`
    : beer.name;
}

/** The delete changes the menu for everyone, so it always asks first. */
export function confirmRemoveFromMenu(
  beer: CommunityBeer,
  onConfirm: () => void,
  onKeep?: () => void,
): void {
  showAppDialog({
    title: t.counter.removeFromMenuTitle,
    message: t.counter.removeFromMenuBody(menuBeerLabel(beer)),
    buttons: [
      { text: t.counter.removeFromMenuKeep, style: 'cancel', onPress: onKeep },
      { text: t.counter.removeFromMenuConfirm, style: 'destructive', onPress: onConfirm },
    ],
  });
}
