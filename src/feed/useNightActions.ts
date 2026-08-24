import { useCallback } from 'react';

import { showAppDialog } from '@/components/shared/AppDialog';
import { reportProfileContent } from '@/data/auth';
import {
  isRetriableNightError,
  unpublishNight,
  type PublishedNight,
} from '@/data/nightsClient';
import { enqueueNightOp } from '@/data/nightsQueue';
import { trackUiInteraction } from '@/data/uxTelemetry';
import { cs } from '@/i18n/cs';
import { useToastStore } from '@/stores/toastStore';
import { useVycepStore } from '@/stores/vycepStore';

/**
 * Shared owner/moderation action behind the redesigned night-card ellipsis.
 *
 * Owners remove the publication (their private diary stays intact); everyone
 * else reports the concrete night, not merely its author. Transient removals
 * use the same durable queue as the original Výčep card.
 */
export function useNightActions(onRemoved?: (night: PublishedNight) => void) {
  const showToast = useToastStore((state) => state.show);
  const markUnpublished = useVycepStore((state) => state.markUnpublished);

  return useCallback(
    (night: PublishedNight) => {
      if (night.isMine) {
        showAppDialog({
          title: cs.vycep.unpublishCta,
          message: cs.vycep.unpublishConfirmBody,
          buttons: [
            { text: cs.common.cancel, style: 'cancel' },
            {
              text: cs.vycep.unpublishCta,
              style: 'destructive',
              onPress: () => {
                const clientId = night.clientId;
                if (!clientId) {
                  showToast(cs.vycep.unpublishErrorToast);
                  return;
                }
                trackUiInteraction('night_unpublish', 'submit');
                void unpublishNight(clientId).then(async (result) => {
                  if (!result.ok) {
                    if (isRetriableNightError(result)) {
                      const queued = await enqueueNightOp({ op: 'unpublish', clientId }).catch(
                        () => false,
                      );
                      if (!queued) {
                        trackUiInteraction('night_unpublish', 'failure');
                        showToast(cs.vycep.unpublishErrorToast);
                        return;
                      }
                    } else {
                      trackUiInteraction('night_unpublish', 'failure');
                      showToast(cs.vycep.unpublishErrorToast);
                      return;
                    }
                  }
                  trackUiInteraction('night_unpublish', 'success');
                  markUnpublished(clientId);
                  showToast(cs.vycep.unpublishedToast);
                  onRemoved?.(night);
                });
              },
            },
          ],
        });
        return;
      }

      showAppDialog({
        title: cs.vycep.reportTitle,
        message: cs.vycep.reportBody,
        buttons: [
          { text: cs.common.cancel, style: 'cancel' },
          {
            text: cs.vycep.reportConfirm,
            style: 'destructive',
            onPress: () => {
              if (!night.author.id) {
                showToast(cs.vycep.reportErrorToast);
                return;
              }
              void reportProfileContent({
                targetAccountId: night.author.id,
                reason: 'spam',
                nightId: night.id,
              }).then((result) => {
                showToast(
                  result.ok ? cs.vycep.reportSentToast : cs.vycep.reportErrorToast,
                );
              });
            },
          },
        ],
      });
    },
    [markUnpublished, onRemoved, showToast],
  );
}
