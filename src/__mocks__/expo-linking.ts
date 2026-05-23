export const openURL = jest.fn().mockResolvedValue(undefined);
export const createURL = jest.fn((path: string) => `napivo://${path}`);
export const parse = jest.fn();
export const addEventListener = jest.fn();
export const removeEventListener = jest.fn();
export const getInitialURL = jest.fn().mockResolvedValue(null);
export const canOpenURL = jest.fn().mockResolvedValue(true);
