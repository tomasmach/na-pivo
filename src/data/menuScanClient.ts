/**
 * Menu-scan client — uploads ONE beer-menu photo to the backend OCR helper
 * (POST /v1/pub-menu-scan) and maps the extracted beers into the app's
 * CommunityBeer shape so ContributeScreen can prefill them for review.
 *
 * This endpoint is a PURE extraction helper: it writes nothing, awards no XP and
 * stores no image. The user reviews/edits the returned beers and the EXISTING
 * /v1/pub-community path does the real save + XP — this module never touches that.
 *
 * Like uploadAvatar, the multipart body MUST go through expo-file-system's native
 * uploader: Expo SDK 56's WinterCG fetch rejects the legacy RN {uri,name,type}
 * FormData part with "Unsupported FormDataPart implementation". A manual 30s
 * AbortController budget caps the upload because it is slower than the shared 12s
 * API budget.
 *
 * Returns a discriminated result and NEVER throws, so the caller can render one
 * toast per outcome.
 */

import { File, UploadType } from 'expo-file-system';

import { ensureAccount } from './account';
import { getBackendEndpoint } from './backendConfig';
import { chainAbortSignal } from './apiFetch';
import {
  MAX_MENU_BEERS,
  beerFromWire,
  type CommunityBeer,
  type WireBeer,
} from './communityHours';
import { isDrinkType, type DrinkType } from '@/drinks/drinkTypes';

/** Upload budget — wider than the shared API timeout (uploads are slower). */
const UPLOAD_TIMEOUT_MS = 30000;

export interface ScannedDrink extends CommunityBeer {
  drinkType: DrinkType;
}

export type MenuScanResult =
  | { status: 'ok'; beers: CommunityBeer[]; drinks: ScannedDrink[]; model?: string }
  | { status: 'empty' }
  | { status: 'unavailable' }
  | { status: 'daily-cap' }
  | { status: 'rate-limited' }
  | { status: 'bad-image'; code?: string }
  | { status: 'error' };

/**
 * Upload `localUri` to the OCR helper and map the response. Mirrors the contract:
 *   200 {beers,model}   → {status:'ok'} (or {status:'empty'} when beers is [])
 *   400 {detail,code}   → {status:'bad-image', code}
 *   429                 → {status:'rate-limited'}
 *   503 code=daily_cap  → {status:'daily-cap'}
 *   503 anything else   → {status:'unavailable'}
 *   anything else/throw → {status:'error'}
 */
export async function scanMenuPhoto(localUri: string): Promise<MenuScanResult> {
  const endpoint = getBackendEndpoint('/v1/pub-menu-scan');
  if (!endpoint) return { status: 'error' };

  const session = await ensureAccount();
  if (!session) return { status: 'error' };

  const abort = chainAbortSignal(undefined, UPLOAD_TIMEOUT_MS);

  try {
    const resp = await new File(localUri).upload(endpoint, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'image',
      mimeType: 'image/jpeg',
      headers: { Authorization: `Bearer ${session.token}` },
      signal: abort.signal,
    });

    let data: Record<string, unknown> = {};
    try {
      data = resp.body ? (JSON.parse(resp.body) as Record<string, unknown>) : {};
    } catch {
      data = {};
    }

    if (resp.status === 429) return { status: 'rate-limited' };
    if (resp.status === 503) {
      return data.code === 'daily_cap' ? { status: 'daily-cap' } : { status: 'unavailable' };
    }

    if (resp.status === 400) {
      return { status: 'bad-image', code: typeof data.code === 'string' ? data.code : undefined };
    }
    if (resp.status < 200 || resp.status >= 300) {
      return { status: 'error' };
    }

    const rawBeers = Array.isArray(data.beers) ? (data.beers as WireBeer[]) : [];
    const beers = rawBeers
      .filter((b) => b && typeof b.name === 'string' && b.name.trim().length > 0)
      .slice(0, MAX_MENU_BEERS)
      .map(beerFromWire);
    const rawDrinks = Array.isArray(data.drinks)
      ? (data.drinks as (WireBeer & { drink_type?: unknown })[])
      : [];
    const drinks: ScannedDrink[] = rawDrinks
      .filter(
        (drink) =>
          drink &&
          typeof drink.name === 'string' &&
          drink.name.trim().length > 0 &&
          isDrinkType(drink.drink_type),
      )
      .slice(0, 24)
      .map((drink) => ({ ...beerFromWire(drink), drinkType: drink.drink_type as DrinkType }));

    // Older backends only return ``beers``. Promote them to categorized scan
    // rows so the counter picker works throughout a rolling backend deploy.
    const categorized = drinks.length > 0
      ? drinks
      : beers.map((beer): ScannedDrink => ({ ...beer, drinkType: 'beer' }));
    if (categorized.length === 0) return { status: 'empty' };

    return {
      status: 'ok',
      beers,
      drinks: categorized,
      model: typeof data.model === 'string' ? data.model : undefined,
    };
  } catch {
    return { status: 'error' };
  } finally {
    abort.cleanup();
  }
}
