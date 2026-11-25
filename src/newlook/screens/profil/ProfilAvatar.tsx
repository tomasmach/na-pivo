import React from 'react';
import { View } from 'react-native';

import { Icon } from '../../components/Icon';
import { Person } from '../../components/ui';
import { C, s } from '../../theme';

/** Person with the uploaded photo when there is one; initials otherwise, a person icon without a name. */
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
  if (uri || initial) return <Person initial={initial} uri={uri} size={size} ring={ring} />;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.avatarBase, borderWidth: ring ? 2 : 0, borderColor: C.yellow }, s.center]}>
      <Icon name="user" size={Math.round(size * 0.4)} color={C.yellow} />
    </View>
  );
}
