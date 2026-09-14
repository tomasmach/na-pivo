import {
  REACT_TEST_RENDERER_DEPRECATION,
  shouldSuppressJestConsoleError,
} from '../jestConsoleFilter';

describe('Jest React 19 console filter', () => {
  it('suppresses only the exact react-test-renderer framework deprecation', () => {
    expect(shouldSuppressJestConsoleError([REACT_TEST_RENDERER_DEPRECATION])).toBe(true);
    expect(shouldSuppressJestConsoleError([`${REACT_TEST_RENDERER_DEPRECATION}.`])).toBe(false);
  });

  it('keeps actionable React and application warnings visible', () => {
    expect(shouldSuppressJestConsoleError(['An update to BeerScreen was not wrapped in act(...)'])).toBe(
      false,
    );
    expect(shouldSuppressJestConsoleError(['Failed to save beer', new Error('offline')])).toBe(false);
  });
});
