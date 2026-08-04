/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: "watch",
  name: "NapivoWatch",
  displayName: "Na pivo",
  deploymentTarget: "11.0",
  bundleIdentifier: ".watch",
  frameworks: [
    "AppIntents",
    "CoreLocation",
    "WatchConnectivity",
    "WatchKit",
    "WidgetKit",
  ],
  colors: {
    $accent: "#E8A317",
  },
  entitlements: {
    "com.apple.security.application-groups": ["group.com.tomasmach.na-pivo"],
  },
  appleTeamId: config.ios.appleTeamId,
});
