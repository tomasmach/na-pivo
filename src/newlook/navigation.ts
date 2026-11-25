import type { useRouter } from 'expo-router';

/** Back, or the first tab when the screen was opened without history (deep link, push, replace). */
export function nvBack(router: ReturnType<typeof useRouter>): void {
  if (router.canGoBack()) router.back();
  else router.replace('/nv/kompas');
}
