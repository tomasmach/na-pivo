/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch-widget",
  name: "NapivoWatchWidgets",
  displayName: "Na pivo",
  deploymentTarget: "11.0",
  bundleIdentifier: ".watch.widgets",
  frameworks: ["AppIntents", "WatchConnectivity"],
  colors: {
    $accent: "#E8A317",
    $widgetBackground: "#1F1308",
  },
  entitlements: {
    "com.apple.security.application-groups": ["group.com.tomasmach.na-pivo"],
  },
  appleTeamId: config.ios.appleTeamId,
});
