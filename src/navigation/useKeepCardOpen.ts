import { useEffect } from 'react';
import { useNavigation } from 'expo-router';

/**
 * A screen shown as a card pulls down to close. While it holds unsaved input,
 * or waits on a save that closes it, the pull bounces back instead: closing
 * would throw the input away. The close button in its header still works.
 */
export function useKeepCardOpen(keepOpen: boolean): void {
  const navigation = useNavigation();
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: !keepOpen });
  }, [keepOpen, navigation]);
}
