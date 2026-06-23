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

interface MapPubEntryProps {
  pubKey: string;
  pubName: string;
}

export function MapPubEntry({ pubKey, pubName }: MapPubEntryProps) {
  const [open, setOpen] = useState(false);
  const handleOpen = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  return (
    <>
      <MapPubButton pubKey={pubKey} pubName={pubName} onPress={handleOpen} />
      <MapPubSheet visible={open} pubKey={pubKey} pubName={pubName} onClose={handleClose} />
    </>
  );
}
