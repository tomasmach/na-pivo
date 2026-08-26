/* eslint-disable import/first */

/**
 * The prompt deck's two physical promises.
 *
 * The card is the target — the gesture that survives being drunk is a tap
 * anywhere on the thing you are reading, not finding a pill. And the deal is an
 * animation, so it has to disappear entirely when the phone asks for less
 * motion; a card that still slides is the kind of thing nobody notices until
 * somebody who needs it does.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

let mockReduceMotion = false;

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('react-native-reanimated', () => {
  const ReactModule: typeof import('react') = jest.requireActual('react');
  const { View: RNView }: typeof import('react-native') = jest.requireActual('react-native');
  const transition = (name: string) => ({ duration: () => name });
  return {
    __esModule: true,
    default: {
      View: ({ children, ...props }: { children?: React.ReactNode }) =>
        ReactModule.createElement(RNView, props, children),
    },
    FadeIn: transition('FadeIn'),
    FadeOut: transition('FadeOut'),
    SlideInRight: transition('SlideInRight'),
    SlideOutLeft: transition('SlideOutLeft'),
    useReducedMotion: () => mockReduceMotion,
  };
});

import { PromptShell, promptDeck } from '@/party/shells/PromptShell';

const PROMPTS = ['Kategorie: pivo', 'Kategorie: hospody', 'Kategorie: filmy'];
const SEED = 7;

beforeEach(() => {
  mockReduceMotion = false;
});

/** The one card that is dealt for these prompts at this step. */
const firstCard = () => promptDeck(PROMPTS, SEED, 0)[0];

it('makes the whole card the tap target, not just the pill', () => {
  const onNext = jest.fn();
  render(<PromptShell prompts={PROMPTS} seed={SEED} step={0} onNext={onNext} />);

  const card = screen.getByLabelText(`${firstCard()} Ťukni pro další.`);
  expect(card.props.accessibilityRole).toBe('button');
  fireEvent.press(card);
  expect(onNext).toHaveBeenCalledTimes(1);

  // The dealt card itself lets taps through, so the target really is the whole
  // surface and not a ring around a dead middle.
  const dealt = screen
    .UNSAFE_getAllByType(View)
    .filter((node) => node.props.pointerEvents === 'none');
  expect(dealt.length).toBeGreaterThan(0);
});

it('deals without any animation when the phone asks for less motion', () => {
  mockReduceMotion = true;
  render(<PromptShell prompts={PROMPTS} seed={SEED} step={0} onNext={jest.fn()} />);

  const dealt = screen
    .UNSAFE_getAllByType(View)
    .filter((node) => node.props.pointerEvents === 'none');
  for (const node of dealt) {
    expect(node.props.entering).toBeUndefined();
    expect(node.props.exiting).toBeUndefined();
  }
});

it('slides the deal only while motion is allowed', () => {
  render(<PromptShell prompts={PROMPTS} seed={SEED} step={0} onNext={jest.fn()} />);

  const dealt = screen
    .UNSAFE_getAllByType(View)
    .filter((node) => node.props.entering === 'SlideInRight');
  expect(dealt).toHaveLength(1);
  expect(dealt[0].props.exiting).toBe('SlideOutLeft');
});
