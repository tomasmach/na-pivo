import { Redirect, type Href } from 'expo-router';

/** Links to screens the new look no longer has land on the map. */
export default function NotFound() {
  return <Redirect href={'/nv' as Href} />;
}
