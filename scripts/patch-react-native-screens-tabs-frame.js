// The tab bar controller's view starts at the screen size and only later takes
// the host's size through Auto Layout. On an open iPhone Duo the tabs are then
// installed into a view that does not reach the rail's edge, and iOS never adds
// the rail's buttons afterwards, so the app starts without tabs. Giving the view
// the host's size before it joins the window avoids that.
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '..',
  'node_modules',
  'react-native-screens',
  'ios',
  'tabs',
  'host',
  'RNSTabsHostComponentView.mm',
);

const needle = `  if (self.window != nil && _controller.parentViewController == nil) {
    BOOL mountResult`;

const replacement = `  if (self.window != nil && _controller.parentViewController == nil) {
    _controller.view.frame = self.bounds;
    BOOL mountResult`;

if (!fs.existsSync(file)) {
  console.warn('[patch-react-native-screens-tabs-frame] react-native-screens tabs source not found; skipping');
  process.exit(0);
}

const source = fs.readFileSync(file, 'utf8');

if (source.includes(replacement)) {
  console.log('[patch-react-native-screens-tabs-frame] tab host frame patch already applied');
  process.exit(0);
}

if (!source.includes(needle)) {
  console.error('[patch-react-native-screens-tabs-frame] expected RNSTabsHostComponentView.mm shape changed');
  process.exit(1);
}

fs.writeFileSync(file, source.replace(needle, replacement));
console.log('[patch-react-native-screens-tabs-frame] sized the tab bar controller view before mounting');
