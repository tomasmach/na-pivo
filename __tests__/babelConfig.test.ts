const getBabelConfig = require('../babel.config');

describe('babel config', () => {
  it('loads the Reanimated worklets plugin last', () => {
    const config = getBabelConfig({ cache: jest.fn() });
    const plugins = config.plugins ?? [];

    expect(plugins[plugins.length - 1]).toBe('react-native-worklets/plugin');
  });
});
