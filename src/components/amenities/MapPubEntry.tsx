/**
 * Convenience host that pairs the MapPubButton trigger with the MapPubSheet for
 * one pub. Owns the sheet's open/close state so a screen can drop a single
 * <MapPubEntry pubKey pubName /> next to its private rating control. The sheet
 * animates up from the trigger (the locked entry-point decision, spec §3.6).
 *
 * Public-vs-private framing: this lives below the private PubRatingControl on
 * the evening card, and the button + sheet both label the data as veřejné /
 * community, so the user understands amenities are shared (unlike the rating).
 */

import React, { useCallback, useState } from 'react';

import { MapPubButton } from '@/components/amenities/MapPubButton';
import { MapPubSheet } from '@/components/amenities/MapPubSheet';
import type { PubInfoContext } from '@/components/amenities/pubInfoContext';

interface MapPubEntryProps {
  pubKey: string;
  pubName: string;
  /** Pub-info context — when set, the entry covers all three info groups
   *  (otevíračka + piva + vybavení) instead of amenities only. */
  info?: PubInfoContext;
}

export function MapPubEntry({ pubKey, pubName, info }: MapPubEntryProps) {
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <MapPubButton pubKey={pubKey} pubName={pubName} onPress={handleOpen} info={info} />
      <MapPubSheet visible={open} pubKey={pubKey} pubName={pubName} info={info} onClose={handleClose} />
    </>
  );
}
