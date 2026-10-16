import fs from 'node:fs';

/** Deliberately exclude observations, credentials, and model transcripts. */
export function summarize(file) {
  const { run } = JSON.parse(fs.readFileSync(file, 'utf8'));
  const metrics = {
    passed: run.summary.passed, failed: run.summary.failed, skipped: run.summary.skipped,
    seconds: Math.round((Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 100) / 10,
    modelTokens: run.usage.modelTokens, modelCachedTokens: run.usage.modelCachedTokens,
    modelCalls: 0, replayed: 0, handedOff: 0, missed: 0,
  };
  for (const result of run.results) for (const attempt of result.attempts) for (const step of attempt.steps) {
    metrics.modelCalls += step.metrics?.modelCalls ?? 0;
    if (step.cache?.mode === 'self-finalized') metrics.replayed++;
    if (step.cache?.mode === 'agent-concluded') metrics.handedOff++;
    if (step.cache?.mode === 'missed') metrics.missed++;
  }
  return metrics;
}
