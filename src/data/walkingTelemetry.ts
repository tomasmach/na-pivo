/**
 * Local walking-distance accumulator for product stats.
 *
 * GPS samples stay on-device. The backend receives only meter increments, so
 * it can build "top walkers" stats without storing coordinates or routes.
 */

import { haversineMeters, type LatLng } from '@/compass/distance';
import { trackClientEvent } from './telemetryClient';

interface WalkingSample extends LatLng {
  accuracyMeters: number;
  atMs: number;
}

const MAX_ACCURACY_M = 80;
const MIN_STEP_M = 3;
const MAX_WALKING_SPEED_MPS = 3.2;
const MIN_FLUSH_M = 250;
const BACKGROUND_FLUSH_M = 50;

let lastSample: WalkingSample | null = null;
let pendingDistanceM = 0;

function sendDistance(distanceM: number): void {
  if (distanceM <= 0) return;
  void trackClientEvent({
    event: 'walking_distance',
    severity: 'info',
    context: { distance_m: distanceM },
  });
}

export function recordWalkingSample(sample: {
  lat: number;
  lng: number;
  accuracyMeters: number;
}): void {
  if (sample.accuracyMeters > MAX_ACCURACY_M) {
    lastSample = null;
    return;
  }

  const current: WalkingSample = {
    lat: sample.lat,
    lng: sample.lng,
    accuracyMeters: sample.accuracyMeters,
    atMs: Date.now(),
  };

  if (!lastSample) {
    lastSample = current;
    return;
  }

  const elapsedSec = Math.max((current.atMs - lastSample.atMs) / 1000, 1);
  const movedM = haversineMeters(lastSample, current);
  lastSample = current;

  if (movedM < MIN_STEP_M) return;
  if (movedM / elapsedSec > MAX_WALKING_SPEED_MPS) return;

  pendingDistanceM += movedM;
  if (pendingDistanceM >= MIN_FLUSH_M) {
    const flushed = Math.floor(pendingDistanceM);
    pendingDistanceM -= flushed;
    sendDistance(flushed);
  }
}

export function flushWalkingDistance(): void {
  if (pendingDistanceM < BACKGROUND_FLUSH_M) return;
  const flushed = Math.floor(pendingDistanceM);
  pendingDistanceM = 0;
  sendDistance(flushed);
}

export function resetWalkingTelemetryForTests(): void {
  lastSample = null;
  pendingDistanceM = 0;
}
