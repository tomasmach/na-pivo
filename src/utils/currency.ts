import { intlLocale, t } from '@/i18n';

export type PriceCurrency = string;

/** Prices are Czech-pub prices, so the crown keeps its Czech symbol in English too. */
const CZK_SYMBOL = 'Kč';

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

export function currencyFractionDigits(currency: PriceCurrency): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2;
}

export function currencySuffix(currency: PriceCurrency): string {
  if (currency.toUpperCase() === 'CZK') return CZK_SYMBOL;
  try {
    const parts = new Intl.NumberFormat(intlLocale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0);
    return parts.find((part) => part.type === 'currency')?.value ?? currency;
  } catch {
    return currency;
  }
}

export function pricePlaceholder(currency: PriceCurrency): string {
  return t.currency.pricePlaceholder(currencySuffix(currency));
}

function formatDecimal(value: number, maxFractionDigits: number): string {
  const rounded = value.toLocaleString(intlLocale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
  return rounded.replace(/\u00a0/g, ' ');
}

export function formatPrice(czk: number, currency: PriceCurrency): string {
  const rate = getCurrencyRate(currency) ?? 1;
  const amount = czk / rate;
  // The crown is formatted by hand so the symbol stays "Kč" in both languages;
  // en-GB would otherwise print "CZK 45".
  if (currency.toUpperCase() === 'CZK') {
    return `${formatDecimal(amount, 0)} ${CZK_SYMBOL}`;
  }
  try {
    return new Intl.NumberFormat(intlLocale, {
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

export function formatPriceInputFromCzk(czk: number, currency: PriceCurrency): string {
  const rate = getCurrencyRate(currency) ?? 1;
  return formatDecimal(czk / rate, currencyFractionDigits(currency));
}

export function sanitizePriceInput(raw: string, currency: PriceCurrency): string {
  const fractionDigits = currencyFractionDigits(currency);
  if (fractionDigits === 0) return raw.replace(/\D/g, '').slice(0, 7);

  const normalized = raw.replace('.', ',').replace(/[^\d,]/g, '');
  const [integer = '', ...fractionParts] = normalized.split(',');
  const intPart = integer.slice(0, 7);
  if (!normalized.includes(',')) return intPart;

  const fraction = fractionParts.join('').slice(0, fractionDigits);
  return `${intPart || '0'},${fraction}`;
}

export function parsePriceInputToCzk(text: string, currency: PriceCurrency): number | null {
  const value = Number(text.trim().replace(',', '.'));
  const rate = getCurrencyRate(currency);
  if (!Number.isFinite(value) || !rate) return null;

  const czk = Math.round(value * rate);
  if (czk < 1 || czk > 1000) return null;
  return czk;
}
