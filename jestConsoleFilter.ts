export const REACT_TEST_RENDERER_DEPRECATION =
  'react-test-renderer is deprecated. See https://react.dev/warnings/react-test-renderer';

export function shouldSuppressJestConsoleError(args: readonly unknown[]): boolean {
  return args.length === 1 && args[0] === REACT_TEST_RENDERER_DEPRECATION;
}
