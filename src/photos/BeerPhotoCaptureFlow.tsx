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

import React, { useCallback, useEffect, useRef, useState } from 'react';

import { showAppDialog } from '@/components/shared/AppDialog';
import { CameraIcon, InfoIcon } from '@/components/shared/IconGlyph';
import { openSystemSettings } from '@/compass/permissions';
import { pickAndPrepareBeerPhoto, type BeerPhotoSource } from '@/data/beerPhotoPicker';
import { t } from '@/i18n';
import { BeerPhotoComposeSheet } from '@/photos/BeerPhotoComposeSheet';
import { BeerPhotoSourceSheet } from '@/photos/BeerPhotoSourceSheet';
import { useToastStore } from '@/stores/toastStore';
import { useBeerPhotosStore } from '@/stores/beerPhotosStore';
import { Colors } from '@/theme/colors';

interface BeerPhotoCaptureFlowProps {
  /** Shows the source sheet; the compose sheet's lifecycle stays internal. */
  open: boolean;
  /** Fired when the source sheet dismisses (cancel or pick). */
  onClose: () => void;
  /** Optional extra hook after a photo is saved to the diary. */
  onSaved?: () => void;
  /** Launch this source immediately instead of showing the source sheet. */
  directSource?: BeerPhotoSource;
  /** Preselect the FotoPivař opt-in in the compose sheet. */
  initialContestEntry?: boolean;
  /** Fires after an online contest entry has landed. */
  onContestEntered?: () => void;
  /** Attach the upload to the private shared-evening record. */
  partyCode?: string | null;
  /** Reserved code while the table create request is still in flight. */
  pendingPartyCode?: string | null;
  /** Keeps a Party photo in the local recap before a server table exists. */
  partyDrinkingDay?: string | null;
}

export function BeerPhotoCaptureFlow({
  open,
  onClose,
  onSaved,
  directSource,
  initialContestEntry = false,
  onContestEntered,
  partyCode,
  pendingPartyCode,
  partyDrinkingDay,
}: BeerPhotoCaptureFlowProps) {
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
              ? t.photoDiary.permissionCameraBody
              : t.photoDiary.permissionLibraryBody,
            { icon: <CameraIcon size={18} color={Colors.amber} /> },
          );
          return;
        }
        if (picked.status === 'denied-permanent') {
          showAppDialog({
            title: t.photoDiary.title,
            message: t.photoDiary.permissionBlockedBody,
            buttons: [
              { text: t.common.cancel, style: 'cancel' },
              { text: t.photoDiary.openSettings, onPress: () => void openSystemSettings() },
            ],
          });
          return;
        }
        if (picked.status === 'error') {
          showToast(t.photoDiary.errorPick, {
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

  useEffect(() => {
    if (!open || !directSource) return;
    onClose();
    void handlePick(directSource);
  }, [open, directSource, handlePick, onClose]);

  return (
    <>
      <BeerPhotoSourceSheet
        visible={open && !directSource}
        onClose={onClose}
        onPick={(source) => {
          onClose();
          void handlePick(source);
        }}
      />

      {composeUri ? (
        <BeerPhotoComposeSheet
          pickedUri={composeUri}
          initialContestEntry={initialContestEntry}
          partyCode={partyCode}
          pendingPartyCode={pendingPartyCode}
          partyDrinkingDay={partyDrinkingDay}
          onClose={() => setComposeUri(null)}
          onSaved={({ clientId, contestRequested, completion }) => {
            setComposeUri(null);
            showToast(
              contestRequested ? t.photoDiary.savedForContest : t.photoDiary.saved,
              {
              icon: <CameraIcon size={18} color={Colors.amber} />,
              },
            );
            onSaved?.();
            if (!contestRequested) return;
            void completion.then(() => {
              const photo = useBeerPhotosStore
                .getState()
                .photos.find((item) => item.clientId === clientId);
              if (photo?.inContest) {
                showToast(t.photoContest.enteredToast, {
                  icon: <CameraIcon size={18} color={Colors.amber} />,
                });
                onContestEntered?.();
              } else if (photo?.syncState === 'synced') {
                showToast(t.photoDiary.contestEntryFailed, {
                  icon: <InfoIcon size={18} color={Colors.foamMuted} />,
                });
              }
            });
          }}
        />
      ) : null}
    </>
  );
}
