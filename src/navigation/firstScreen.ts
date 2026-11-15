const FALLBACK_MS = 3000;

let shown = false;
const waiting = new Set<() => void>();

export function markFirstScreenShown(): void {
  if (shown) return;
  shown = true;
  const runs = [...waiting];
  waiting.clear();
  for (const run of runs) run();
}

/** Runs `run` once the tabs have rendered for the first time, or after a few seconds when they never do. */
export function afterFirstScreen(run: () => void): () => void {
  if (shown) {
    run();
    return () => undefined;
  }
  const start = () => {
    clearTimeout(timer);
    waiting.delete(start);
    run();
  };
  const timer = setTimeout(start, FALLBACK_MS);
  waiting.add(start);
  return () => {
    clearTimeout(timer);
    waiting.delete(start);
  };
}

export function resetFirstScreenForTests(): void {
  shown = false;
  waiting.clear();
}
