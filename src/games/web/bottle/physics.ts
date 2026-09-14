const TAU = Math.PI * 2;

export const BOTTLE_FIXED_STEP_SECONDS = 1 / 120;
export const BOTTLE_MAX_FRAME_DELTA_SECONDS = 0.1;
export const BOTTLE_MAX_SUBSTEPS = 12;
export const BOTTLE_ANGULAR_DAMPING = 0.74;
export const BOTTLE_SPIN_SECONDS = 4.2;
export const BOTTLE_SPIN_STEPS = Math.round(
  BOTTLE_SPIN_SECONDS / BOTTLE_FIXED_STEP_SECONDS,
);

const BOTTLE_FULL_TURNS = 3;
const LANDING_SECTOR_SPAN = 0.78;
const DAMPING_PER_STEP = Math.pow(
  1 - BOTTLE_ANGULAR_DAMPING,
  BOTTLE_FIXED_STEP_SECONDS,
);

/** Total angular distance travelled by a shove whose initial speed is 1 rad/s. */
export const BOTTLE_DISTANCE_PER_INITIAL_SPEED =
  BOTTLE_FIXED_STEP_SECONDS *
  DAMPING_PER_STEP *
  (1 - Math.pow(DAMPING_PER_STEP, BOTTLE_SPIN_STEPS)) /
  (1 - DAMPING_PER_STEP);

export interface BottleSpinState {
  heading: number;
  angularVelocity: number;
  elapsed: number;
  steps: number;
  accumulator: number;
  done: boolean;
}

const unitInterval = (value: number): number =>
  Math.min(1 - Number.EPSILON, Math.max(0, value));

/** A random visual orientation before anybody asks for the first spin. */
export function randomTableHeading(unitRandom: number): number {
  return unitInterval(unitRandom) * TAU;
}

export function seatForHeading(heading: number, playerCount: number): number {
  if (!Number.isInteger(playerCount) || playerCount < 1) return 0;
  const step = TAU / playerCount;
  const normalised = ((heading % TAU) + TAU) % TAU;
  return Math.round(normalised / step) % playerCount;
}

/**
 * Turn two independent uniform samples into one physical shove.
 *
 * The first sample gives every seat exactly the same chance. The second picks a
 * landing point safely inside that seat's sector. From there we solve only the
 * initial angular velocity: after the shove, the fixed-step simulation receives
 * no target, steering or final correction and simply coasts under friction.
 */
export function plannedBottleSpeed(
  currentHeading: number,
  playerCount: number,
  seatRandom: number,
  offsetRandom: number,
): number {
  if (!Number.isInteger(playerCount) || playerCount < 1) return 0;

  const sectorStep = TAU / playerCount;
  const targetSeat = Math.floor(unitInterval(seatRandom) * playerCount);
  const landingOffset =
    (unitInterval(offsetRandom) - 0.5) * sectorStep * LANDING_SECTOR_SPAN;
  const targetHeading = targetSeat * sectorStep + landingOffset;
  const currentNormalised = ((currentHeading % TAU) + TAU) % TAU;
  const clockwiseDistance = ((targetHeading - currentNormalised) % TAU + TAU) % TAU;
  const totalDistance = BOTTLE_FULL_TURNS * TAU + clockwiseDistance;

  return totalDistance / BOTTLE_DISTANCE_PER_INITIAL_SPEED;
}

export function startBottleSpin(heading: number, angularVelocity: number): BottleSpinState {
  return {
    heading,
    angularVelocity,
    elapsed: 0,
    steps: 0,
    accumulator: 0,
    done: false,
  };
}

/** Fixed-step motion: RAF supplies time, but never changes the physics path. */
export function advanceBottleSpin(
  state: BottleSpinState,
  frameDeltaSeconds: number,
): BottleSpinState {
  if (state.done) return state;

  const frameDelta = Math.min(
    BOTTLE_MAX_FRAME_DELTA_SECONDS,
    Math.max(0, Number.isFinite(frameDeltaSeconds) ? frameDeltaSeconds : 0),
  );
  let accumulator = state.accumulator + frameDelta;
  let heading = state.heading;
  let angularVelocity = state.angularVelocity;
  let steps = state.steps;
  let done = false;
  let substeps = 0;

  while (
    accumulator + Number.EPSILON >= BOTTLE_FIXED_STEP_SECONDS &&
    substeps < BOTTLE_MAX_SUBSTEPS
  ) {
    accumulator -= BOTTLE_FIXED_STEP_SECONDS;
    angularVelocity *= DAMPING_PER_STEP;
    heading += angularVelocity * BOTTLE_FIXED_STEP_SECONDS;
    steps += 1;
    substeps += 1;

    if (steps >= BOTTLE_SPIN_STEPS) {
      done = true;
      angularVelocity = 0;
      accumulator = 0;
      break;
    }
  }

  // A suspended tab may owe more work than is useful to animate. The frame gap
  // is already clamped; discard any impossible remainder instead of fast-forwarding.
  if (substeps >= BOTTLE_MAX_SUBSTEPS && accumulator >= BOTTLE_FIXED_STEP_SECONDS) {
    accumulator %= BOTTLE_FIXED_STEP_SECONDS;
  }

  return {
    heading,
    angularVelocity,
    elapsed: steps * BOTTLE_FIXED_STEP_SECONDS,
    steps,
    accumulator,
    done,
  };
}
