import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { TourChallengeSheet } from '../TourChallengeSheet';
import type { TourStop } from '../model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('@/utils/useKeyboardHeight', () => ({ useKeyboardHeight: () => 0 }));
jest.mock('@/components/shared/IconGlyph', () => ({ XIcon: () => null, ChevronLeftIcon: () => null, ChevronRightIcon: () => null }));

const stop: TourStop = { id: '00000000-0000-4000-8000-000000000001', pubId: '1', cacheKey: null, name: 'U Tří růží', address: 'Husova 10', lat: 50, lon: 14 };

it('says why it cannot save yet, then saves the cleaned line and closes', async () => {
  const onSave = jest.fn(async () => true);
  const onClose = jest.fn();
  const screen = render(<TourChallengeSheet stop={stop} onSave={onSave} onClose={onClose} />);
  expect(screen.getByText('Napiš výzvu')).toBeTruthy();
  fireEvent.press(screen.getByTestId('tour-challenge-save'));
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByTestId('tour-challenge'), ' Objednej si pivo,\n které nikdo neměl ');
  expect(screen.getByText('Uložit výzvu')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('tour-challenge-save')); });
  expect(onSave).toHaveBeenCalledWith('Objednej si pivo, které nikdo neměl');
  expect(onClose).toHaveBeenCalled();
});

it('turns clearing an existing challenge into an explicit removal and stays open when saving fails', async () => {
  const onSave = jest.fn(async () => false);
  const onClose = jest.fn();
  const screen = render(<TourChallengeSheet stop={{ ...stop, challenge: 'Najdi pípu' }} onSave={onSave} onClose={onClose} />);
  fireEvent.changeText(screen.getByTestId('tour-challenge'), '');
  expect(screen.getByText('Odebrat výzvu')).toBeTruthy();
  await act(async () => { fireEvent.press(screen.getByTestId('tour-challenge-save')); });
  expect(onSave).toHaveBeenCalledWith('');
  expect(onClose).not.toHaveBeenCalled();
});
