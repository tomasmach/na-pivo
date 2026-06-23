/**
 * One shared reduce-motion flag for the whole app. Reads the OS
 * "Reduce Motion" accessibility setting once on mount and keeps it live via the
 * change listener. Animations gate on this so a user who asked the system to
 * calm motion never gets springs, tweens, or scale-pops.
 *
 * Defaults to `false` (motion allowed) until the async query resolves, matching
 * the platform default; the first read flips it synchronously enough that no
 * animation has fired yet on a cold screen open.
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

export function useReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
      setReduceMotion(enabled);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  return reduceMotion;
}
