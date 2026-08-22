const { withXcodeProject } = require('expo/config-plugins');

const WIDGET_TARGET_NAME = 'ExpoWidgetsTarget';

module.exports = function withWidgetVersionParity(config) {
  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const target = project.pbxTargetByName(WIDGET_TARGET_NAME);

    if (!target?.buildConfigurationList) {
      throw new Error(`Missing ${WIDGET_TARGET_NAME} build configuration list`);
    }

    const configurationList = project.pbxXCConfigurationList()[target.buildConfigurationList];
    const buildConfigurations = project.pbxXCBuildConfigurationSection();

    if (!Array.isArray(configurationList?.buildConfigurations)) {
      throw new Error(`Missing ${WIDGET_TARGET_NAME} build configurations`);
    }

    const marketingVersion = config.version ?? '1.0';
    const buildNumber = config.ios?.buildNumber ?? '1';

    for (const { value } of configurationList.buildConfigurations) {
      const buildConfiguration = buildConfigurations[value];
      if (!buildConfiguration?.buildSettings) {
        throw new Error(`Missing ${WIDGET_TARGET_NAME} build settings`);
      }

      buildConfiguration.buildSettings.MARKETING_VERSION = marketingVersion;
      buildConfiguration.buildSettings.CURRENT_PROJECT_VERSION = buildNumber;
    }

    return config;
  });
};
