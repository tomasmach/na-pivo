const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Keep the Django backend (backend/, incl. its ~7k-file .venv) out of
// Metro's crawler and resolver.
const prevBlockList = config.resolver.blockList;
config.resolver.blockList = [
  ...(Array.isArray(prevBlockList) ? prevBlockList : prevBlockList ? [prevBlockList] : []),
  new RegExp(`^${path.join(__dirname, 'backend')}/.*`),
];

// WebView games ship as one self-contained .html each (see
// `scripts/build-games.mjs`). Metro has to treat them as assets, or `require()`
// of the built file resolves to nothing.
config.resolver.assetExts = [...config.resolver.assetExts, 'html'];

module.exports = config;
