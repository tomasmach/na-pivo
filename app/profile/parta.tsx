import { Redirect, type Href } from 'expo-router';

/** Compatibility door for old profile links. The people inbox has one canonical home. */
export default function LegacyManagePartaRoute() {
  return <Redirect href={'/friends/parta/people' as Href} />;
}
