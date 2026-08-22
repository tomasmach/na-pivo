import { Redirect } from 'expo-router';

/** Keep old links working without exposing the retired design mock. */
export default function PubsMapCompatibilityRoute() {
  return <Redirect href="/" />;
}
