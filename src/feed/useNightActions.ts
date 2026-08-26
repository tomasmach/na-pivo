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
import { t } from '@/i18n';
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
          title: t.vycep.unpublishCta,
          message: t.vycep.unpublishConfirmBody,
          buttons: [
            { text: t.common.cancel, style: 'cancel' },
            {
              text: t.vycep.unpublishCta,
              style: 'destructive',
              onPress: () => {
                const clientId = night.clientId;
                if (!clientId) {
                  showToast(t.vycep.unpublishErrorToast);
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
                        showToast(t.vycep.unpublishErrorToast);
                        return;
                      }
                    } else {
                      trackUiInteraction('night_unpublish', 'failure');
                      showToast(t.vycep.unpublishErrorToast);
                      return;
                    }
                  }
                  trackUiInteraction('night_unpublish', 'success');
                  markUnpublished(clientId);
                  showToast(t.vycep.unpublishedToast);
                  onRemoved?.(night);
                });
              },
            },
          ],
        });
        return;
      }

      showAppDialog({
        title: t.vycep.reportTitle,
        message: t.vycep.reportBody,
        buttons: [
          { text: t.common.cancel, style: 'cancel' },
          {
            text: t.vycep.reportConfirm,
            style: 'destructive',
            onPress: () => {
              if (!night.author.id) {
                showToast(t.vycep.reportErrorToast);
                return;
              }
              void reportProfileContent({
                targetAccountId: night.author.id,
                reason: 'spam',
                nightId: night.id,
              }).then((result) => {
                showToast(
                  result.ok ? t.vycep.reportSentToast : t.vycep.reportErrorToast,
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
