import type { ToGame } from '@/games/protocol';

const GAME_READY_TIMEOUT_MS = 5000;

/** Buffer bridge commands until the bundled page confirms its listener is ready. */
export function createGameCommandQueue(
  post: (message: ToGame) => void,
  onTimeout: () => void,
  timeoutMs = GAME_READY_TIMEOUT_MS,
) {
  let listening = false;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending: ToGame[] = [];
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    send(message: ToGame) {
      if (listening) {
        post(message);
        return;
      }
      expired = false;
      pending.push(message);
      if (!timer) timer = setTimeout(() => {
        timer = null;
        expired = true;
        pending.splice(0);
        onTimeout();
      }, timeoutMs);
    },
    ready() {
      listening = true;
      clearTimer();
      if (expired) return;
      for (const message of pending.splice(0)) post(message);
    },
    dispose() {
      clearTimer();
      pending.splice(0);
    },
  };
}
