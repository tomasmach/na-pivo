import { Redirect, type Href } from 'expo-router';

export default function Index() {
  return <Redirect href={'/nv' as Href} />;
}
