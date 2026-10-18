import React from 'react';

import type { MoreRow } from '@/components/shared/MoreSheet';
import { t } from '@/i18n';
import { useBeerWatchStore } from '@/stores/beerWatchStore';

import { MenuBeerActionsSheet } from '../MenuBeerActionsSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mockRows: MoreRow[] = [];
jest.mock('@/components/shared/MoreSheet', () => ({
  MoreSheet: ({ rows }: { rows: MoreRow[] }) => {
    mockRows = rows;
    return null;
  },
}));
jest.mock('@/components/shared/AppDialog', () => ({ showAppDialog: jest.fn() }));
jest.mock('@/components/shared/IconGlyph', () => ({
  BellRingIcon: () => null,
  PencilIcon: () => null,
  Trash2Icon: () => null,
}));
const mockToggle = jest.fn();
jest.mock('@/beerWatch/toggleBeerWatch', () => ({
  toggleBeerWatch: (...args: unknown[]) => mockToggle(...args),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require('react-test-renderer');

const beer = { name: 'Únětická 12', volumeMl: 500 };

function render(props: { canEdit?: boolean; canRemove: boolean }) {
  const onClose = jest.fn();
  TestRenderer.act(() => {
    TestRenderer.create(
      <MenuBeerActionsSheet
        visible
        beer={beer}
        onClose={onClose}
        onEditPrice={jest.fn()}
        onRemove={jest.fn()}
        {...props}
      />,
    );
  });
  return { onClose, keys: mockRows.map((row) => row.key) };
}

beforeEach(() => {
  jest.clearAllMocks();
  useBeerWatchStore.getState().reset();
});

it('offers only watching on a row the user cannot edit', () => {
  expect(render({ canEdit: false, canRemove: false }).keys).toEqual(['watch']);
});

it('keeps edit and remove on the counter menu beer', () => {
  expect(render({ canRemove: true }).keys).toEqual(['edit-price', 'watch', 'remove']);
});

it('closes the sheet and toggles the watch', () => {
  const { onClose } = render({ canRemove: false });
  const row = mockRows.find((r) => r.key === 'watch')!;
  expect(row.label).toBe(t.beerWatch.sheetWatch);
  expect(row.testID).toBe('menu-beer-watch');
  row.onPress();
  expect(onClose).toHaveBeenCalled();
  expect(mockToggle).toHaveBeenCalledWith('Únětická 12');
});

it('says stop watching for a watched beer, matched by alias', () => {
  useBeerWatchStore.setState({
    watches: [{ productKey: 'unetice-12', name: 'Únětická 12°', aliases: ['Únětická 12'] }],
  });
  render({ canRemove: false });
  expect(mockRows.find((r) => r.key === 'watch')!.label).toBe(t.beerWatch.sheetUnwatch);
});
