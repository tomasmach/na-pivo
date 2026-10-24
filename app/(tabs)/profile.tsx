import { BookSpread } from '@/layout/BookSpread';
import { TabScreen } from '@/navigation/TabScreen';
import ProfileScreen from '@/profile/ProfileScreen';

export default function ProfileTab() {
  return (
    <TabScreen>
      <BookSpread tab="profil" primary={<ProfileScreen />} />
    </TabScreen>
  );
}
