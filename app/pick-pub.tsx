import React from 'react';

import PubListMockScreen from '@/pubs/PubListMockScreen';

// The Hospody screen presented over the running night. `picker` is what makes
// it a modal instead of a tab: a close button, a "Mimo hospodu" row, and the
// pickingPub flag owned by this instance's lifecycle.
export default function PickPubScreen() {
  return <PubListMockScreen picker />;
}
