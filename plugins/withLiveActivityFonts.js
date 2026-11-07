const fs = require('fs');
const path = require('path');
const plist = require('@expo/plist').default;
const { withDangerousMod, withXcodeProject } = require('expo/config-plugins');

// The target expo-widgets generates for the Live Activity.
const TARGET = 'ExpoWidgetsTarget';
const FONTS = [
  'SofiaSans-SemiBold.ttf',
  'SofiaSans-Bold.ttf',
  'SofiaSans-ExtraBold.ttf',
  'SofiaSansExtraCondensed-ExtraBold.ttf',
];

/**
 * Bundles the Sofia fonts into the widget extension, which cannot read fonts
 * from the app bundle. List this plugin before expo-widgets: a mod registered
 * earlier runs later, and expo-widgets recreates the target folder and target.
 */
module.exports = function withLiveActivityFonts(config) {
  config = withDangerousMod(config, [
    'ios',
    async (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const targetDir = path.join(platformProjectRoot, TARGET);
      const infoPath = path.join(targetDir, 'Info.plist');
      if (!fs.existsSync(infoPath)) {
        throw new Error(`[withLiveActivityFonts] ${infoPath} is missing; list this plugin before expo-widgets`);
      }
      for (const font of FONTS) {
        fs.copyFileSync(path.join(projectRoot, 'assets', 'fonts', font), path.join(targetDir, font));
      }
      const info = plist.parse(fs.readFileSync(infoPath, 'utf8'));
      info.UIAppFonts = FONTS;
      fs.writeFileSync(infoPath, plist.build(info));
      return config;
    },
  ]);

  return withXcodeProject(config, (config) => {
    const project = config.modResults;
    const targetUuid = project.findTargetKey(TARGET);
    const groupKey = project.findPBXGroupKey({ name: TARGET });
    if (!targetUuid || !groupKey) {
      throw new Error('[withLiveActivityFonts] widget target not found; list this plugin before expo-widgets');
    }
    // xcode's pbxResourcesBuildPhaseObj falls back to the app's phase, which
    // would bundle the fonts into the app instead of the extension.
    const resources =
      ownResourcesPhase(project, targetUuid) ??
      project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', targetUuid).buildPhase;
    for (const font of FONTS) {
      const file = project.addFile(font, groupKey, { target: targetUuid });
      if (!file) continue;
      file.uuid = project.generateUuid();
      file.target = targetUuid;
      project.addToPbxBuildFileSection(file);
      resources.files.push({ value: file.uuid, comment: `${font} in Resources` });
    }
    return config;
  });
};

function ownResourcesPhase(project, targetUuid) {
  const phases = project.hash.project.objects.PBXResourcesBuildPhase ?? {};
  const target = project.pbxNativeTargetSection()[targetUuid];
  const ref = target.buildPhases.find(({ value }) => phases[value]);
  return ref ? phases[ref.value] : null;
}
