/** Minimal expo-haptics mock for jest tests that do not mock it themselves. */

export const ImpactFeedbackStyle = { Light: 'light', Medium: 'medium', Heavy: 'heavy', Soft: 'soft', Rigid: 'rigid' };
export const NotificationFeedbackType = { Success: 'success', Warning: 'warning', Error: 'error' };
export const impactAsync = jest.fn(async () => undefined);
export const notificationAsync = jest.fn(async () => undefined);
export const selectionAsync = jest.fn(async () => undefined);
