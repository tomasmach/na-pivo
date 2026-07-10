/**
 * Native social sign-in wrappers (Apple + Google).
 *
 * These talk to the NATIVE SDKs and return the provider token the backend
 * verifies (Apple identity token / Google ID token). They do NOT talk to our
 * backend — see src/data/auth.ts for the exchange.
 *
 * The SDK modules are `require`d LAZILY inside each function so:
 *  - importing this file never pulls native code into the JS bundle (safe in
 *    Jest / on web / before a dev-client rebuild adds the native modules);
 *  - a misconfigured/absent provider fails only when the user actually taps its
 *    button, as a typed SocialAuthError the UI can handle.
 *
 * Requires a custom dev client (the app already uses `expo run:ios`). After
 * adding the config plugins, run `expo prebuild` + rebuild. Configure the Google
 * client ids via EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID / EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID
 * and the reversed iOS scheme via EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME (app.config.ts).
 */

import { Platform } from 'react-native';

export type SocialAuthErrorCode =
  | 'cancelled'
  | 'unsupported'
  | 'unavailable'
  | 'misconfigured'
  | 'failed';

export class SocialAuthError extends Error {
  code: SocialAuthErrorCode;
  constructor(code: SocialAuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SocialAuthError';
    this.code = code;
  }
}

export interface AppleCredentialResult {
  /** The identity token (JWT) to send to the backend for verification. */
  identityToken: string;
  /** The authorization code, exchanged server-side for a revocable refresh token. */
  authorizationCode: string;
  /** Full name — Apple provides it ONLY on the first authorization; "" otherwise. */
  fullName: string;
}

/** Sign in with Apple is iOS-only (native). */
export function isAppleSignInSupported(): boolean {
  return Platform.OS === 'ios';
}

function looksCancelled(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? '';
  const message = (err as { message?: string })?.message ?? '';
  return (
    /cancel/i.test(String(code)) ||
    /cancel/i.test(message) ||
    code === 'ERR_REQUEST_CANCELED' ||
    code === 'SIGN_IN_CANCELLED' ||
    code === '-5' // google statusCodes.SIGN_IN_CANCELLED on some platforms
  );
}

function isGoogleConfigurationError(err: unknown): boolean {
  const code = String((err as { code?: unknown })?.code ?? '');
  const message = String((err as { message?: unknown })?.message ?? '');
  // Android returns Google Play services status 10 after account selection when
  // the package/signing-certificate pair is missing from the OAuth client.
  return code === '10' || /DEVELOPER_ERROR/i.test(code) || /DEVELOPER_ERROR/i.test(message);
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------
let googleConfigured = false;

export function isGoogleSignInConfigured(): boolean {
  const webClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
  if (!webClientId) return false;
  if (Platform.OS !== 'ios') return true;
  const iosUrlScheme = (process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME ?? '').trim();
  return !!iosUrlScheme && !iosUrlScheme.includes('PLACEHOLDER');
}

function loadGoogleModule(): typeof import('@react-native-google-signin/google-signin') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@react-native-google-signin/google-signin');
  } catch {
    throw new SocialAuthError('unavailable', 'Google Sign-In native module is not available.');
  }
}

function ensureGoogleConfigured(): void {
  if (googleConfigured) return;
  const { GoogleSignin } = loadGoogleModule();
  const webClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
  const iosClientId = (process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '').trim();
  if (!isGoogleSignInConfigured()) {
    // webClientId is required to receive an idToken at all.
    throw new SocialAuthError('unavailable', 'Google Sign-In is not configured.');
  }
  GoogleSignin.configure({
    webClientId,
    iosClientId: iosClientId || undefined,
    offlineAccess: false,
  });
  googleConfigured = true;
}

/**
 * Run the native Google account picker and return a Google ID token.
 * Throws SocialAuthError('cancelled') if the user dismisses the picker.
 */
export async function getGoogleIdToken(): Promise<string> {
  const mod = loadGoogleModule();
  const { GoogleSignin } = mod;
  ensureGoogleConfigured();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();
    // google-signin v13+ returns { type: 'success', data: { idToken } }; older
    // versions returned the userInfo object directly. Support both shapes.
    const idToken =
      (response as { data?: { idToken?: string | null } })?.data?.idToken ??
      (response as { idToken?: string | null })?.idToken ??
      null;
    if (!idToken) {
      throw new SocialAuthError('cancelled');
    }
    return idToken;
  } catch (err) {
    if (err instanceof SocialAuthError) throw err;
    if (looksCancelled(err)) throw new SocialAuthError('cancelled');
    if (isGoogleConfigurationError(err)) {
      throw new SocialAuthError(
        'misconfigured',
        'Google Sign-In release certificate is not configured.',
      );
    }
    throw new SocialAuthError('failed', (err as Error)?.message);
  }
}

// ---------------------------------------------------------------------------
// Apple
// ---------------------------------------------------------------------------
function loadAppleModule(): typeof import('expo-apple-authentication') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-apple-authentication');
  } catch {
    throw new SocialAuthError('unavailable', 'Apple Authentication native module is not available.');
  }
}

/**
 * Run the native Sign in with Apple flow and return the identity token (+ the
 * authorization code and the one-time full name).
 * Throws SocialAuthError('unsupported') off iOS, ('cancelled') on dismissal.
 */
export async function getAppleCredential(): Promise<AppleCredentialResult> {
  if (!isAppleSignInSupported()) {
    throw new SocialAuthError('unsupported', 'Sign in with Apple is iOS-only.');
  }
  const AppleAuthentication = loadAppleModule();
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new SocialAuthError('cancelled');
    }
    const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ');
    return {
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode ?? '',
      fullName,
    };
  } catch (err) {
    if (err instanceof SocialAuthError) throw err;
    if (looksCancelled(err)) throw new SocialAuthError('cancelled');
    throw new SocialAuthError('failed', (err as Error)?.message);
  }
}
