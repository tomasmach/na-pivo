const { withXcodeProject } = require('expo/config-plugins');

/**
 * Keep watchOS targets watch-only after every other config plugin has run.
 *
 * @bacons/apple-targets creates these build settings correctly, but another
 * root plugin currently rewrites every TARGETED_DEVICE_FAMILY to iPhone (1).
 * Matching SDKROOT avoids coupling this repair to generated target UUIDs or
 * names and covers both the watch app and its WidgetKit extension.
 */
module.exports = function withWatchDeviceFamily(config) {
  return withXcodeProject(config, (config) => {
    const configurations =
      config.modResults.pbxXCBuildConfigurationSection();

    for (const configuration of Object.values(configurations)) {
      if (
        !configuration ||
        typeof configuration !== 'object' ||
        configuration.isa !== 'XCBuildConfiguration'
      ) {
        continue;
      }

      const settings = configuration.buildSettings;
      if (settings?.SDKROOT === 'watchos') {
        settings.TARGETED_DEVICE_FAMILY = '"4"';
      }
    }

    return config;
  });
};
