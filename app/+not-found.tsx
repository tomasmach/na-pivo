import { Redirect, type Href } from 'expo-router';

/** Links the released apps still open (napivo://beer from the Live Activity, old screens) land on the map. */
export default function NotFound() {
  return <Redirect href={'/nv' as Href} />;
}
