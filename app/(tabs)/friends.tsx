import FriendsScreen from '@/friends/FriendsScreen';
import { BookSpread } from '@/layout/BookSpread';
import { TabScreen } from '@/navigation/TabScreen';

export default function FriendsTab() {
  return (
    <TabScreen>
      <BookSpread tab="parta" primary={<FriendsScreen />} />
    </TabScreen>
  );
}
