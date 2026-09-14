# Na pivo pro Apple Watch

Apple Watch část je nativní SwiftUI aplikace a není závislá na běžícím React
Native procesu v telefonu. `@bacons/apple-targets` ji při Expo prebuild přidá
do stejného Xcode projektu jako mobilní aplikaci.

## Struktura

- `_shared/` obsahuje Swift podobu protokolu v1, trvanlivý app-group store,
  outbox a `AppIntent` pro zopakování posledního drinku.
- `watch-app/` je samostatná watchOS aplikace: kompas, potvrzení hospody,
  počítadlo, výběr a vytvoření drinku, účet a řešení sync stavů.
- `watch-widget/` poskytuje Smart Stack widget a komplikace
  `accessoryRectangular`, `accessoryCircular` a `accessoryInline`.
- `../shared/mobile-bridge/ios/` je Expo native module v iPhone aplikaci. Přijímá
  watch příkazy do chráněného inboxu ještě před probuzením JavaScriptu a posílá
  snapshoty a potvrzení přes `WatchConnectivity`.
- `tests/` obsahuje hostitelský Swift probe pro sdílené JSON fixtures a základní
  invariantu, že zopakování drinku vytvoří nové fact UUID.

Telefonní `BeerEveningLiveActivity` zůstává v existujícím `expo-widgets`
targetu. Jeho `ActivityConfiguration` optuje do supplemental rodin `.small` a
`.medium`; watchOS 11 proto iPhone Live Activity automaticky zrcadlí do Smart
Stacku. `.small` používá vlastní `bannerSmall` s hospodou, počtem a jediným
durable `add-beer` tlačítkem, jehož label obsahuje konkrétní pivo, objem a cenu.
Samostatný watch widget používá stejnou app group a slouží jako připnutelný Smart
Stack widget i komplikace. Živou kompasovou šipku záměrně kreslí jen otevřená
aplikace.

## Identifikátory

- iPhone aplikace: `com.tomasmach.na-pivo`
- Apple Watch aplikace: `com.tomasmach.na-pivo.watch`
- Watch widget: `com.tomasmach.na-pivo.watch.widgets`
- sdílená app group: `group.com.tomasmach.na-pivo`

Hodinky mají `WKRunsIndependentlyOfCompanionApp=true`. Lokální stav, widget
snapshot a outbox jsou atomické chráněné soubory v app group. Příkazy se
deduplikují podle stabilního `messageId`; nový zápis drinku vždy dostane nové
UUID.

## Build a contract test

Apple target plugin 5.0.0 při opakovaném in-place prebuild v tomto projektu
selhává při aktualizaci existujícího targetu. Používej proto projektový
`npm run dev`, který dělá čistý iOS prebuild, nebo explicitně:

```bash
npx expo prebuild --clean --platform ios
```

Po čistém Expo prebuild je dostupné schéma `NapivoWatch`. Následující příkaz
je pouze compile check pro CI; výsledný bundle nemá simulátorové app-group
oprávnění a nesmí se instalovat pro funkční sync test:

```bash
xcodebuild \
  -workspace ios/Napivo.xcworkspace \
  -scheme NapivoWatch \
  -configuration Debug \
  -destination 'platform=watchOS Simulator,id=D83B8BB5-BD4F-4586-87C1-F44321CF43C4' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

Pro spustitelný párový test postav celé schéma se zapnutým podpisem, nainstaluj
oba produkty a ověř app-group container:

```bash
xcodebuild \
  -workspace ios/Napivo.xcworkspace \
  -scheme Napivo \
  -configuration Debug \
  -destination 'platform=iOS Simulator,id=DE13B5FD-8997-4C07-93C4-AA8DC675F754' \
  -derivedDataPath /tmp/napivo-paired-derived \
  build

xcrun simctl install \
  DE13B5FD-8997-4C07-93C4-AA8DC675F754 \
  /tmp/napivo-paired-derived/Build/Products/Debug-iphonesimulator/Napivo.app
xcrun simctl install \
  D83B8BB5-BD4F-4586-87C1-F44321CF43C4 \
  /tmp/napivo-paired-derived/Build/Products/Debug-watchsimulator/NapivoWatch.app

xcrun simctl get_app_container \
  D83B8BB5-BD4F-4586-87C1-F44321CF43C4 \
  com.tomasmach.na-pivo.watch \
  group.com.tomasmach.na-pivo
```

Sdílené fixtures ověří:

```bash
wearables/apple-watch/tests/run-contract-tests.sh
```

## Simulátorová dvojice

Pro čistý párový sync test byla použita tato spárovaná dvojice:

- pair: `E4F185EB-A773-4EEA-9700-1EC32287DF5B`
- Apple Watch Series 11 (46 mm): `D83B8BB5-BD4F-4586-87C1-F44321CF43C4`
- iPhone 17 Pro Max: `DE13B5FD-8997-4C07-93C4-AA8DC675F754`

Build produktu je v
`/tmp/napivo-watch-derived/Build/Products/Debug-watchsimulator/NapivoWatch.app`
pouze tehdy, když se použije stejný `-derivedDataPath`.

## Deterministické debug scénáře

Proměnné jsou dostupné jen v `DEBUG` buildu:

- `NAPIVO_WATCH_SCENARIO=compass` použije pevnou polohu v Praze, heading,
  tři hospody a deterministickou nabídku.
- `NAPIVO_WATCH_SCENARIO=active` navíc založí lokální aktivní večer s jedním
  konkrétním pivem.
- `NAPIVO_WATCH_SCENARIO=target_conflict` otevře řešení rozdílného cíle
  z telefonu a hodinek.
- `NAPIVO_WATCH_SCENARIO=evening_conflict` otevře volbu mezi dvěma večery,
  aniž by drinky přesouval mezi hospodami.
- `NAPIVO_WATCH_FORCE_OFFLINE=1` vynutí síťový výpadek.
- `NAPIVO_WATCH_FIXED_HEADING=<stupně>` změní simulovaný heading.
- `NAPIVO_WATCH_BACKEND_URL=<url>` přesměruje pouze debug síťového klienta.

Příklad spuštění:

```bash
SIMCTL_CHILD_NAPIVO_WATCH_SCENARIO=compass \
  xcrun simctl launch --terminate-running-process \
  D83B8BB5-BD4F-4586-87C1-F44321CF43C4 \
  com.tomasmach.na-pivo.watch
```

## Co patří na fyzické hodinky

Simulátor neumí věrně potvrdit skutečný magnetometr na zápěstí, sílu a načasování
haptiky, spotřebu baterie ani dlouhý terénní provoz bez telefonu. Apple také
negarantuje na simulátoru stejné background doručení `transferUserInfo` jako na
zařízení. Před vydáním proto na fyzických Apple Watch ověř:

- živou šipku při chůzi a fallback bez headingu;
- haptiku zápisu, undo a ukončení večera;
- background sync po delším odpojení a po restartu obou zařízení;
- obnovu Smart Stacku a komplikací;
- výdrž během celého večera bez telefonu v dosahu.

Tyto body nejsou simulátorovým buildem ani screenshotem považované za ověřené.
