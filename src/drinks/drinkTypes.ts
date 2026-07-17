export const DRINK_TYPES = ['beer', 'soft_drink', 'shot', 'wine'] as const;

export type DrinkType = (typeof DRINK_TYPES)[number];

export function isDrinkType(value: unknown): value is DrinkType {
  return typeof value === 'string' && DRINK_TYPES.includes(value as DrinkType);
}

export function normalizeDrinkType(value: unknown): DrinkType {
  return isDrinkType(value) ? value : 'beer';
}
