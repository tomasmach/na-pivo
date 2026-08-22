/**
 * The dismiss control on a sheet or an overlay.
 *
 * Every sheet had its own: a 32 pt disc of flat `stout3`. Two problems. It is
 * under the 44 pt minimum target, which is the one size rule that is not a
 * matter of taste — and on a surface that is itself glass, a flat plate reads
 * as a hole punched in the material.
 *
 * So it is one component, 44 pt, on the same glass as everything else floating
 * (§15.1), with the solid fallback below iOS 26 and on Android (§15.2).
 */

import React from 'react';

import { GlassIconButton } from '@/components/shared/GlassIconButton';
import { XIcon } from '@/components/shared/IconGlyph';
import { Colors } from '@/theme/colors';

export function CloseButton({
  onPress,
  label = 'Zavřít',
  disabled = false,
}: {
  onPress: () => void;
  /** Say what closes when it is not obviously the sheet you are in. */
  label?: string;
  disabled?: boolean;
}) {
  return (
    <GlassIconButton
      size={44}
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
    >
      <XIcon size={18} color={Colors.foam} />
    </GlassIconButton>
  );
}
