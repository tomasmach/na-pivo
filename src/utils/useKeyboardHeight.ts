/**
 * Live keyboard height (0 when hidden).
 *
 * Needed because Android runs edge-to-edge (Expo SDK 53+), which disables the
 * old `adjustResize` window behavior — the keyboard just overlays the app. Any
 * screen with a text input near the bottom must lift or pad its content by
 * this height. Also reliable inside a React Native `Modal`, where
 * `KeyboardAvoidingView` measures against the wrong window on iOS.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => setHeight(e.endCoordinates?.height ?? 0);
    const onHide = () => setHeight(0);
    const showSub = Keyboard.addListener(showEvt, onShow);
    const hideSub = Keyboard.addListener(hideEvt, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  return height;
}
