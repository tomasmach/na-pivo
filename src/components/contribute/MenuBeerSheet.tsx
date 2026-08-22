import React from 'react';

import {
  BeerFormModal,
  type BeerFormResult,
} from '@/counter/BeerFormModal';
import type { CommunityBeer } from '@/data/communityClient';
import { cs } from '@/i18n/cs';

interface MenuBeerSheetProps {
  visible: boolean;
  beer: CommunityBeer | null;
  formKey: string | number;
  onClose: () => void;
  onSubmit: (result: BeerFormResult) => void;
}

/**
 * The contribute screen's menu editor is a deliberately thin configuration of
 * the app's existing BeerFormModal. Name suggestions, price parsing, allowed
 * volumes and keyboard behaviour therefore stay in one implementation.
 */
export function MenuBeerSheet({
  visible,
  beer,
  formKey,
  onClose,
  onSubmit,
}: MenuBeerSheetProps) {
  return (
    <BeerFormModal
      visible={visible}
      mode="menu"
      beer={beer}
      formKey={formKey}
      titleOverride={
        beer ? cs.contribute.editBeerSheetTitle : cs.contribute.addBeerSheetTitle
      }
      submitLabelOverride={cs.contribute.done}
      onCancel={onClose}
      onSubmit={onSubmit}
    />
  );
}
