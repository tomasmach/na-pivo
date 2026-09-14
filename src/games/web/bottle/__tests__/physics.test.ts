import {
  advanceBottleSpin,
  BOTTLE_DISTANCE_PER_INITIAL_SPEED,
  BOTTLE_FIXED_STEP_SECONDS,
  BOTTLE_MAX_FRAME_DELTA_SECONDS,
  BOTTLE_SPIN_SECONDS,
  plannedBottleSpeed,
  randomTableHeading,
  seatForHeading,
  startBottleSpin,
  type BottleSpinState,
} from '@/games/web/bottle/physics';

const FAIRNESS_SAMPLES = 1_000_008;
const FIXED_HEADINGS = [-9876.54321, 0, Math.PI / 7, Math.PI * 246 + 0.001, 1.23456789];

function landingFromPlannedSpeed(
  heading: number,
  playerCount: number,
  seatRandom: number,
  offsetRandom: number,
): number {
  const speed = plannedBottleSpeed(heading, playerCount, seatRandom, offsetRandom);
  return heading + speed * BOTTLE_DISTANCE_PER_INITIAL_SPEED;
}

function distribution(playerCount: number, heading: number): number[] {
  const counts = Array.from({ length: playerCount }, () => 0);
  for (let index = 0; index < FAIRNESS_SAMPLES; index += 1) {
    const seatRandom = (index + 0.5) / FAIRNESS_SAMPLES;
    const offsetRandom = ((index * 104_729) % FAIRNESS_SAMPLES + 0.5) / FAIRNESS_SAMPLES;
    const landing = landingFromPlannedSpeed(
      heading,
      playerCount,
      seatRandom,
      offsetRandom,
    );
    counts[seatForHeading(landing, playerCount)] += 1;
  }
  return counts;
}

function finishAtHz(
  refreshRate: number,
  heading: number,
  speed: number,
): BottleSpinState {
  let state = startBottleSpin(heading, speed);
  for (let frame = 0; frame < refreshRate * 8 && !state.done; frame += 1) {
    state = advanceBottleSpin(state, 1 / refreshRate);
  }
  return state;
}

function finishUnderLoad(heading: number, speed: number): BottleSpinState {
  const deltas = [1 / 30, 1 / 240, 1 / 75, 1 / 48, 1 / 144, 1 / 60];
  let state = startBottleSpin(heading, speed);
  for (let frame = 0; frame < 1_000 && !state.done; frame += 1) {
    state = advanceBottleSpin(state, deltas[frame % deltas.length]);
  }
  return state;
}

describe('bottle physics', () => {
  it.each([2, 4, 12])(
    'gives every one of %i players an equal chance from every visible heading',
    (playerCount) => {
      const expected = FAIRNESS_SAMPLES / playerCount;
      for (const heading of FIXED_HEADINGS) {
        const counts = distribution(playerCount, heading);
        for (const count of counts) {
          expect(Math.abs(count - expected)).toBeLessThanOrEqual(1);
        }
      }
    },
  );

  it.each([2, 4, 12])(
    'physically lands planned shoves in every %i-player sector from fixed headings',
    (playerCount) => {
      const samples = playerCount * 20;
      for (const heading of FIXED_HEADINGS) {
        for (let index = 0; index < samples; index += 1) {
          const seatRandom = (index + 0.5) / samples;
          const offsetRandom = ((index * 17) % samples + 0.5) / samples;
          const speed = plannedBottleSpeed(
            heading,
            playerCount,
            seatRandom,
            offsetRandom,
          );
          const stopped = finishAtHz(120, heading, speed);

          expect(seatForHeading(stopped.heading, playerCount)).toBe(
            Math.floor(seatRandom * playerCount),
          );
        }
      }
    },
  );

  it('keeps the initial visual orientation inside one turn', () => {
    expect(randomTableHeading(0)).toBe(0);
    expect(randomTableHeading(0.5)).toBe(Math.PI);
    expect(randomTableHeading(1)).toBeLessThan(Math.PI * 2);
  });

  it.each([2, 4, 12])(
    'lands on the same %i-player seat at 60 Hz, 120 Hz and under uneven load',
    (playerCount) => {
      const heading = 1.23456789;
      const seatRandom = 0.73;
      const speed = plannedBottleSpeed(heading, playerCount, seatRandom, 0.19);
      const at60 = finishAtHz(60, heading, speed);
      const at120 = finishAtHz(120, heading, speed);
      const loaded = finishUnderLoad(heading, speed);

      expect(at60.done).toBe(true);
      expect(at120.done).toBe(true);
      expect(loaded.done).toBe(true);
      expect(at60.elapsed).toBe(BOTTLE_SPIN_SECONDS);
      expect(at60.elapsed).toBe(at120.elapsed);
      expect(at60.heading).toBeCloseTo(at120.heading, 10);
      expect(loaded.elapsed).toBe(at120.elapsed);
      expect(loaded.heading).toBeCloseTo(at120.heading, 10);
      expect(seatForHeading(at60.heading, playerCount)).toBe(
        Math.floor(seatRandom * playerCount),
      );
      expect(seatForHeading(at120.heading, playerCount)).toBe(
        seatForHeading(at60.heading, playerCount),
      );
      expect(seatForHeading(loaded.heading, playerCount)).toBe(
        seatForHeading(at60.heading, playerCount),
      );
    },
  );

  it.each([2, 4, 12])(
    'keeps consecutive spins independently fair for %i players',
    (playerCount) => {
      const initialHeading = 2.7182818;
      const firstSeatRandom = 0.91;
      const first = finishAtHz(
        120,
        initialHeading,
        plannedBottleSpeed(initialHeading, playerCount, firstSeatRandom, 0.12),
      );
      const secondSeatRandom = 0.08;
      const second = finishAtHz(
        120,
        first.heading,
        plannedBottleSpeed(first.heading, playerCount, secondSeatRandom, 0.84),
      );

      expect(seatForHeading(first.heading, playerCount)).toBe(
        Math.floor(firstSeatRandom * playerCount),
      );
      expect(seatForHeading(second.heading, playerCount)).toBe(
        Math.floor(secondSeatRandom * playerCount),
      );
      expect(second.elapsed).toBe(BOTTLE_SPIN_SECONDS);
    },
  );

  it('clamps a resume gap instead of jumping straight to a result', () => {
    const state = advanceBottleSpin(startBottleSpin(0, 24), 30);
    expect(state.done).toBe(false);
    expect(state.elapsed).toBeCloseTo(BOTTLE_MAX_FRAME_DELTA_SECONDS, 10);
    expect(state.elapsed / BOTTLE_FIXED_STEP_SECONDS).toBeCloseTo(12, 10);
  });
});
