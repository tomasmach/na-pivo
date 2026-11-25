
import { numberFormat } from '@/utils/intlFormat';

export type PriceCurrency = string;

export const DEFAULT_PRICE_CURRENCY: PriceCurrency = 'CZK';

/** CZK paid for one unit of currency. Updated by locationCurrency at runtime. */
const czkPerUnit: Record<string, number> = {
  CZK: 1,
  EUR: 25,
  THB: 0.68,
};

const ZERO_DECIMAL_CURRENCIES = new Set([
  'BIF', 'CLP', 'CZK', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF',
  'XOF', 'XPF',
]);

export function setCurrencyRate(currency: PriceCurrency, rateCzkPerUnit: number): void {
  if (Number.isFinite(rateCzkPerUnit) && rateCzkPerUnit > 0) {
    czkPerUnit[currency.toUpperCase()] = rateCzkPerUnit;
  }
}

export function getCurrencyRate(currency: PriceCurrency): number | null {
  return czkPerUnit[currency.toUpperCase()] ?? null;
}

function currencyFractionDigits(currency: PriceCurrency): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

function formatDecimal(value: number, maxFractionDigits: number): string {
  const rounded = numberFormat({
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
  return rounded.replace(/\u00a0/g, ' ');
}

export function formatPrice(czk: number, currency: PriceCurrency): string {
  const rate = getCurrencyRate(currency) ?? 1;
  const amount = czk / rate;
  try {
    return numberFormat({
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: 0,
      maximumFractionDigits: currencyFractionDigits(currency),
    }).format(amount).replace(/\u00a0/g, ' ');
  } catch {
    return `${formatDecimal(amount, currencyFractionDigits(currency))} ${currency}`;
  }
}

export function parsePriceInputToCzk(text: string, currency: PriceCurrency): number | null {
  const value = Number(text.trim().replace(',', '.'));
  const rate = getCurrencyRate(currency);
  if (!Number.isFinite(value) || !rate) return null;

  const czk = Math.round(value * rate);
  if (czk < 1 || czk > 1000) return null;
  return czk;
}
