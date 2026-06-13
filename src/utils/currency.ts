export type PriceCurrency = 'CZK' | 'EUR';

export const DEFAULT_PRICE_CURRENCY: PriceCurrency = 'CZK';

const EUR_TO_CZK = 25;

export function currencySuffix(currency: PriceCurrency): string {
  return currency === 'EUR' ? '€' : 'Kč';
}

export function pricePlaceholder(currency: PriceCurrency): string {
  return currency === 'EUR' ? 'Cena (€)' : 'Cena (Kč)';
}

function formatDecimal(value: number, maxFractionDigits: number): string {
  const rounded = value.toLocaleString('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
  return rounded.replace(/\u00a0/g, ' ');
}

export function formatPrice(czk: number, currency: PriceCurrency): string {
  if (currency === 'EUR') {
    return `${formatDecimal(czk / EUR_TO_CZK, 2)} €`;
  }
  return `${Math.round(czk)} Kč`;
}

export function formatPriceInputFromCzk(czk: number, currency: PriceCurrency): string {
  if (currency === 'EUR') {
    return formatDecimal(czk / EUR_TO_CZK, 2);
  }
  return String(Math.round(czk));
}

export function sanitizePriceInput(raw: string, currency: PriceCurrency): string {
  if (currency === 'CZK') {
    return raw.replace(/\D/g, '').slice(0, 4);
  }

  const normalized = raw.replace('.', ',').replace(/[^\d,]/g, '');
  const [integer = '', ...fractionParts] = normalized.split(',');
  const intPart = integer.slice(0, 3);
  const hasSeparator = normalized.includes(',');
  if (!hasSeparator) return intPart;

  const fraction = fractionParts.join('').slice(0, 2);
  return `${intPart || '0'},${fraction}`;
}

export function parsePriceInputToCzk(text: string, currency: PriceCurrency): number | null {
  const value = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(value)) return null;

  const czk = currency === 'EUR' ? Math.round(value * EUR_TO_CZK) : Math.round(value);
  if (czk < 1 || czk > 1000) return null;
  return czk;
}
