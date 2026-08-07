import { Linking, Platform } from 'react-native';

interface NavigablePub {
  name: string;
  lat: number;
  lng: number;
}

export function buildPubNavigationUrl(
  pub: NavigablePub,
  platform: typeof Platform.OS = Platform.OS,
): string {
  const coords = `${pub.lat},${pub.lng}`;
  if (platform === 'ios') {
    return `http://maps.apple.com/?daddr=${coords}&q=${encodeURIComponent(pub.name)}`;
  }
  if (platform === 'android') {
    return `geo:${coords}?q=${coords}(${encodeURIComponent(pub.name)})`;
  }
  return `https://www.google.com/maps/dir/?api=1&destination=${coords}`;
}

export async function openPubNavigation(pub: NavigablePub): Promise<void> {
  await Linking.openURL(buildPubNavigationUrl(pub));
}
