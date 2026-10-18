/**
 * Blood alcohol estimate from the drinks logged in the last 24 hours and the
 * body numbers the user typed in. It is a guess and every surface says so.
 *
 * Model: Watson total body water from sex, age, height and weight, Widmark
 * distribution into that water, each drink absorbed evenly over 45 minutes,
 * linear elimination. Three runs give the shown range; the cautious run (slow
 * elimination, 20 % more alcohol than logged) decides when you are at zero, so
 * the morning answer errs late rather than early.
 */

import { normalizeDrinkType, type DrinkType } from './drinkTypes';

export type BodySex = 'male' | 'female';

export interface BodyProfile {
  sex: BodySex;
  age: number;
  heightCm: number;
  weightKg: number;
}

export const BODY_LIMITS = {
  age: { min: 18, max: 99 },
  heightCm: { min: 140, max: 220 },
  weightKg: { min: 40, max: 200 },
} as const;

type BodyField = keyof typeof BODY_LIMITS;

export function isBodyValueValid(field: BodyField, value: number): boolean {
  const { min, max } = BODY_LIMITS[field];
  return Number.isInteger(value) && value >= min && value <= max;
}

export function isBodyProfile(value: unknown): value is BodyProfile {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    (v.sex === 'male' || v.sex === 'female') &&
    typeof v.age === 'number' &&
    isBodyValueValid('age', v.age) &&
    typeof v.heightCm === 'number' &&
    isBodyValueValid('heightCm', v.heightCm) &&
    typeof v.weightKg === 'number' &&
    isBodyValueValid('weightKg', v.weightKg)
  );
}

export interface EstimateDrink {
  id: string;
  beerName: string;
  drinkType?: DrinkType;
  volumeMl?: number;
  at: string;
}

const NON_ALCOHOLIC = /nealko|birell|\bfree\b|(^|\s)0[,.]0(\s|%|$)|alkoholfrei|non[- ]?alc|alcohol[- ]?free/i;
const RADLER = /radler|shandy/i;
const DEGREES = /(\d{1,2}(?:[,.]\d)?)\s*°/;

/** Alcohol by volume in percent, inferred from the drink type and the name. */
export function drinkAbv(drink: Pick<EstimateDrink, 'beerName' | 'drinkType'>): number {
  const type = normalizeDrinkType(drink.drinkType);
  if (type === 'soft_drink') return 0;
  if (type === 'shot') return 40;
  if (type === 'wine') return 12;
  const name = drink.beerName;
  if (NON_ALCOHOLIC.test(name)) return 0;
  if (RADLER.test(name)) return 2.5;
  const degrees = name.match(DEGREES);
  if (degrees) {
    const plato = Number(degrees[1].replace(',', '.'));
    if (plato >= 3 && plato <= 30) return Math.round(plato * 0.42 * 10) / 10;
  }
  // Unknown strength: assume a strong-ish beer so the guess errs high.
  return 6;
}

export function drinkVolumeMl(drink: Pick<EstimateDrink, 'drinkType' | 'volumeMl'>): number {
  if (typeof drink.volumeMl === 'number' && drink.volumeMl > 0) return drink.volumeMl;
  const type = normalizeDrinkType(drink.drinkType);
  if (type === 'shot') return 40;
  if (type === 'wine') return 200;
  return 500;
}

const ETHANOL_DENSITY = 0.789;
const BLOOD_WATER = 0.8;
const BLOOD_DENSITY = 1.055;
const ABSORPTION_MIN = 45;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const STEP_MS = 60 * 1000;
const HALF_HOUR_MS = 30 * 60 * 1000;

function bodyWaterLitres({ sex, age, heightCm, weightKg }: BodyProfile): number {
  return sex === 'male'
    ? 2.447 - 0.09516 * age + 0.1074 * heightCm + 0.3362 * weightKg
    : -2.097 + 0.1069 * heightCm + 0.2466 * weightKg;
}

interface Scenario {
  alcohol: number;
  eliminationPerHour: number;
}

const MID: Scenario = { alcohol: 1, eliminationPerHour: 0.15 };
const LOW: Scenario = { alcohol: 0.9, eliminationPerHour: 0.2 };
const CAUTIOUS: Scenario = { alcohol: 1.2, eliminationPerHour: 0.1 };

interface Dose {
  startMs: number;
  promile: number;
}

/** Promile at `untilMs`, or the first minute the curve is back at zero. */
function simulate(doses: Dose[], scenario: Scenario, untilMs: number): { at: number; zeroAt: number } {
  const firstMs = doses[0].startMs;
  const lastAbsorbedMs = doses[doses.length - 1].startMs + ABSORPTION_MIN * STEP_MS;
  const eliminationPerStep = scenario.eliminationPerHour / 60;
  let level = 0;
  let at = 0;
  for (let ms = firstMs; ; ms += STEP_MS) {
    let absorbed = 0;
    for (const dose of doses) {
      if (ms >= dose.startMs && ms < dose.startMs + ABSORPTION_MIN * STEP_MS) {
        absorbed += (dose.promile * scenario.alcohol) / ABSORPTION_MIN;
      }
    }
    level = Math.max(0, level + absorbed - (level > 0 ? eliminationPerStep : 0));
    if (ms <= untilMs) at = level;
    if (ms >= lastAbsorbedMs && level <= 0) return { at, zeroAt: ms };
  }
}

export interface AlcoholEstimate {
  /** Middle guess right now, in promile. */
  now: number;
  low: number;
  high: number;
  /** When the cautious run reaches zero, rounded up to the half hour. */
  zeroAt: Date;
  /** The drinks that went into the guess, alcoholic only. */
  drinks: EstimateDrink[];
}

/**
 * Null when nothing alcoholic was logged in the last 24 hours or the cautious
 * run is already back at zero.
 */
export function estimateAlcohol(
  drinks: readonly EstimateDrink[],
  profile: BodyProfile,
  nowMs: number,
): AlcoholEstimate | null {
  const promilePerGram = BLOOD_WATER / (bodyWaterLitres(profile) * BLOOD_DENSITY);
  const counted = drinks
    .filter((drink) => {
      const atMs = Date.parse(drink.at);
      return Number.isFinite(atMs) && atMs <= nowMs && atMs > nowMs - WINDOW_MS && drinkAbv(drink) > 0;
    })
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (counted.length === 0) return null;

  const doses = counted.map((drink) => ({
    startMs: Date.parse(drink.at),
    promile:
      drinkVolumeMl(drink) * (drinkAbv(drink) / 100) * ETHANOL_DENSITY * promilePerGram,
  }));

  const cautious = simulate(doses, CAUTIOUS, nowMs);
  const zeroAtMs = Math.ceil(cautious.zeroAt / HALF_HOUR_MS) * HALF_HOUR_MS;
  if (zeroAtMs <= nowMs) return null;

  return {
    now: simulate(doses, MID, nowMs).at,
    low: simulate(doses, LOW, nowMs).at,
    high: cautious.at,
    zeroAt: new Date(zeroAtMs),
    drinks: counted,
  };
}
