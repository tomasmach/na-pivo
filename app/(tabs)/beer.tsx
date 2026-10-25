import BeerScreen from '@/beer/BeerScreen';
import { TabScreen } from '@/navigation/TabScreen';

export default function BeerTab() {
  return (
    <TabScreen>
      <BeerScreen />
    </TabScreen>
  );
}
