const fs = require('fs');
const path = require('path');

// expo-widgets always passes `staleDate: nil` and never tells the layout whether
// the activity is stale. The beer evening sets `staleDateMs` in its props to the
// departure of the last ride home, so the lock screen can redraw itself when the
// ride leaves, even while the app sleeps.

const root = path.join(__dirname, '..', 'node_modules', 'expo-widgets', 'ios');
const tag = '[patch-expo-widgets-stale-date]';

const stringHelper = `
/// Na pivo: the props may carry \`staleDateMs\`; ActivityKit redraws the
/// activity as stale once that moment passes.
private func liveActivityStaleDate(_ props: String?) -> Date? {
  guard let data = props?.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let milliseconds = object["staleDateMs"] as? NSNumber,
        milliseconds.doubleValue > 0 else { return nil }
  return Date(timeIntervalSince1970: milliseconds.doubleValue / 1000)
}
`;

const patches = [
  {
    file: 'LiveActivity.swift',
    marker: 'liveActivityStaleDate',
    replacements: [
      [
        'await activity.update(ActivityContent(state: newState, staleDate: nil))',
        'await activity.update(ActivityContent(state: newState, staleDate: liveActivityStaleDate(props)))',
      ],
      [
        'content = ActivityContent(state: LiveActivityAttributes.ContentState(name: name, props: props), staleDate: nil)',
        'content = ActivityContent(state: LiveActivityAttributes.ContentState(name: name, props: props), staleDate: liveActivityStaleDate(props))',
      ],
    ],
    append: stringHelper,
  },
  {
    file: 'LiveActivityFactory.swift',
    marker: 'liveActivityStaleDate',
    replacements: [
      [
        'content: .init(state: initialState, staleDate: nil),',
        'content: .init(state: initialState, staleDate: liveActivityStaleDate(props)),',
      ],
    ],
    append: stringHelper,
  },
  {
    // Already rewritten by patch-expo-widgets-live-activity.js, which runs first.
    file: path.join('Widgets', 'AppIntent.swift'),
    marker: 'props["staleDateMs"]',
    replacements: [
      [
        'await activity.update(ActivityContent(state: state, staleDate: nil))',
        `let staleDate = (props["staleDateMs"] as? NSNumber).map {
        Date(timeIntervalSince1970: $0.doubleValue / 1000)
      }
      await activity.update(ActivityContent(state: state, staleDate: staleDate))`,
      ],
    ],
  },
  {
    file: path.join('Widgets', 'WidgetLiveActivity.swift'),
    marker: 'withActivityStaleness',
    replacements: [
      [
        `        props: context.state.props,
        environment: environment
      )`,
        `        props: context.state.props,
        environment: withActivityStaleness(environment, context)
      )`,
        2,
      ],
    ],
    append: `
/// Na pivo: lets the layout swap the ride home for its departed state.
private func withActivityStaleness(
  _ environment: [String: Any],
  _ context: ActivityViewContext<LiveActivityAttributes>
) -> [String: Any] {
  guard #available(iOS 16.2, *) else { return environment }
  var env = environment
  env["isStale"] = context.isStale
  return env
}
`,
  },
];

for (const patch of patches) {
  const file = path.join(root, patch.file);
  let source = fs.readFileSync(file, 'utf8');
  if (source.includes(patch.marker)) continue;
  for (const [original, replacement, count = 1] of patch.replacements) {
    const found = source.split(original).length - 1;
    if (found !== count) {
      console.error(`${tag} expected ${count} match(es) in ${patch.file}, found ${found}`);
      process.exit(1);
    }
    source = source.split(original).join(replacement);
  }
  if (patch.append) source += patch.append;
  fs.writeFileSync(file, source);
}
console.log(`${tag} Live Activity stale date is wired`);
