/**
 * BeerPhotoCaptureFlow — the reusable "Cvakni pivo" capture flow:
 * source sheet → system picker → compose sheet → saved toast.
 *
 * The parent owns only the trigger (`open` shows the source sheet, `onClose`
 * fires when it dismisses); everything after the tap lives here, so the flow
 * behaves identically wherever it's mounted — the profile album strip and the
 * counter (Štamgast) both use it. The compose sheet already pre-suggests the
 * pub from the active tally session, which is what makes the counter mount
 * feel native: the photo lands tagged with tonight's pub.
 */

import React, { useCallback, useRef, useState } from 'react';

import { showAppDialog } from '@/components/shared/AppDialog';
import { CameraIcon, InfoIcon } from '@/components/shared/IconGlyph';
import { openSystemSettings } from '@/compass/permissions';
import { pickAndPrepareBeerPhoto, type BeerPhotoSource } from '@/data/beerPhotoPicker';
import { cs } from '@/i18n/cs';
import { BeerPhotoComposeSheet } from '@/photos/BeerPhotoComposeSheet';
import { BeerPhotoSourceSheet } from '@/photos/BeerPhotoSourceSheet';
import { useToastStore } from '@/stores/toastStore';
import { Colors } from '@/theme/colors';

interface BeerPhotoCaptureFlowProps {
  /** Shows the source sheet; the compose sheet's lifecycle stays internal. */
  open: boolean;
  /** Fired when the source sheet dismisses (cancel or pick). */
  onClose: () => void;
  /** Optional extra hook after a photo is saved to the diary. */
  onSaved?: () => void;
}

export function BeerPhotoCaptureFlow({ open, onClose, onSaved }: BeerPhotoCaptureFlowProps) {
  const showToast = useToastStore((s) => s.show);
  const [composeUri, setComposeUri] = useState<string | null>(null);
  // Synchronous double-fire guard — the sheet rows stay tappable through the
  // fade-out (ScanMenuSheet caller idiom).
  const pickInFlightRef = useRef(false);

  const handlePick = useCallback(
    async (source: BeerPhotoSource) => {
      if (pickInFlightRef.current) return;
      pickInFlightRef.current = true;
      try {
        const picked = await pickAndPrepareBeerPhoto(source);
        if (picked.status === 'cancelled') return;
        if (picked.status === 'denied') {
          showToast(
            source === 'camera'
              ? cs.photoDiary.permissionCameraBody
              : cs.photoDiary.permissionLibraryBody,
            { icon: <CameraIcon size={18} color={Colors.amber} /> },
          );
          return;
        }
        if (picked.status === 'denied-permanent') {
          showAppDialog({
            title: cs.photoDiary.title,
            message: cs.photoDiary.permissionBlockedBody,
            buttons: [
              { text: cs.common.cancel, style: 'cancel' },
              { text: cs.photoDiary.openSettings, onPress: () => void openSystemSettings() },
            ],
          });
          return;
        }
        if (picked.status === 'error') {
          showToast(cs.photoDiary.errorPick, {
            icon: <InfoIcon size={18} color={Colors.foamMuted} />,
          });
          return;
        }
        setComposeUri(picked.uri);
      } finally {
        pickInFlightRef.current = false;
      }
    },
    [showToast],
  );

  return (
    <>
      <BeerPhotoSourceSheet
        visible={open}
        onClose={onClose}
        onPick={(source) => {
          onClose();
          void handlePick(source);
        }}
      />

      {composeUri ? (
        <BeerPhotoComposeSheet
          pickedUri={composeUri}
          onClose={() => setComposeUri(null)}
          onSaved={() => {
            setComposeUri(null);
            showToast(cs.photoDiary.saved, {
              icon: <CameraIcon size={18} color={Colors.amber} />,
            });
            onSaved?.();
          }}
        />
      ) : null}
    </>
  );
}
