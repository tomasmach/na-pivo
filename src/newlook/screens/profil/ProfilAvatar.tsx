import React from 'react';
import { Image } from 'react-native';

import { Person } from '../../components/ui';

/** Person with the uploaded photo when there is one; initials otherwise. */
export function ProfilAvatar({
  uri,
  initial,
  size = 40,
  ring = true,
}: {
  uri?: string | null;
  initial: string;
  size?: number;
  ring?: boolean;
}) {
  if (!uri) return <Person initial={initial} size={size} ring={ring} />;
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      resizeMode="cover"
      accessibilityIgnoresInvertColors
    />
  );
}
