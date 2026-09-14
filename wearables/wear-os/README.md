# Na pivo for Wear OS

Native Wear OS core for the compass and an active evening. It is intentionally
separate from the Expo mobile app and Django backend; the cross-platform JSON
contract lives in `../shared/protocol/`.

## Architecture

- `domain/` contains watch-local facts, choices, targets and evening totals.
- `data/` keeps one atomic DataStore state with the optimistic state and
  durable outbox. Unacknowledged commands and remove tombstones are never
  capped or silently dropped.
- `sync/` uses Wear OS Data Layer DataItems. A command is addressed as
  `/na-pivo/v1/command/{messageId}`, an acknowledgement as
  `/na-pivo/v1/ack/{messageId}`, and only the latest snapshot is coalesced at
  `/na-pivo/v1/state`.
- `sensors/` keeps the observed location and heading in memory only. Nearby
  public POIs are requested with a rounded coarse location and cached with a
  geohash-8 `pubKey`.
- `ui/` is a watch-specific Compose UI. Drink names use the system Wear input,
  so dictation and the installed keyboard remain native.
- `surface/` owns the Tile, ongoing activity notification and complication.

The watch uses the same Tácek identity as the phone: the exact stout/amber/foam
tokens and the same checked-in Baloo 2 (display, numbers, CTA) and Inter (UI)
font files. Round-screen spacing, scrolling, long-press and system input remain
Wear-native rather than copying the phone layout.

The watch never receives a bearer token. It can read the public nearby endpoint
directly; private writes remain in its outbox until the paired phone durably
applies and acknowledges them.

## Build and install

Requirements are a JDK 17 launcher, Android SDK 37 and a Wear OS image capable
of running the app. The checked-in daemon JVM criteria provision Java 25 for
the Gradle daemon, while Android source and bytecode compatibility stay on Java
17. This directory is a standalone Gradle project with its own checked-in
Gradle 9.6.1 wrapper. It uses AGP 9.3.1 with its built-in Kotlin 2.2.10 support;
it does not depend on an Expo-prebuilt `android/` directory.

```bash
cd wearables/wear-os
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

For the local backend:

```bash
./gradlew :app:assembleDebug -PbackendUrl=http://10.0.2.2:8000
```

Install on a running watch emulator:

```bash
adb devices
adb -s <watch-serial> install -r \
  app/build/outputs/apk/debug/app-debug.apk
```

The app uses package ID `com.tomasmach.na_pivo`, exactly like the phone. Data
Layer also requires matching signing certificates. When
`android/app/debug.keystore` exists, the Wear debug build automatically uses it.
In a standalone clone it safely falls back to Gradle's normal user debug
keystore (`~/.android/debug.keystore`) instead of requiring a checked-in key.
To pair with a phone build from elsewhere, point both builds at the same debug
key and pass its absolute path to Wear:

```bash
./gradlew :app:assembleDebug \
  -PsharedDebugKeystore=/absolute/path/to/shared-debug.keystore
```

The shared debug key must use the standard debug alias/password
(`androiddebugkey` / `android`). Do not install phone and watch builds signed by
independent debug keys and expect Data Layer delivery. Release phone and watch
artifacts likewise need the same production signing certificate.

The Wear marketing `versionName` follows the mobile `2.0.0` release line, while
its `versionCode` is intentionally an independent Play Store sequence.

## Emulator pairing

Provisioned AVDs:

- phone: `Medium_Phone_API_36.1`
- watch: `NaPivo_Wear_API_37`

The current watch image declares the Google Pixel Watch companion package
`com.google.android.apps.wear.companion`. Pair it through the supported Google
Play flow:

1. Start both AVDs from Android Studio Device Manager.
2. On `Medium_Phone_API_36.1`, open Google Play and have the user personally
   sign in, preferably with a dedicated test account. An agent must never ask
   for, receive or enter Google credentials.
3. Install the official **Google Pixel Watch** app from Google Play. Do not
   sideload a companion APK from a third-party source.
4. In Device Manager, open the phone row's overflow menu, choose
   **Pair Wearable**, select `NaPivo_Wear_API_37` and finish the prompts in the
   Google Pixel Watch companion.
5. Wait until both Device Manager and the companion report connected before
   testing Data Layer.

Pairing is a runtime relationship; merely running two emulators does not
connect them. An ADB port forward (including the legacy port `5601`) or a custom
socket does not establish Wear OS Data Layer pairing and must not be reported
as a Data Layer end-to-end test.

The watch targets/compiles SDK 37 and is also exercised on the installed stable
Wear OS 7 / API 37 runtime. Android Studio itself must be new enough to manage
that image.

## Deterministic debug scenarios

The debug build accepts state-only fixture broadcasts. They never print payload
contents or personal data.

```bash
adb -s <watch-serial> shell am broadcast \
  -a com.tomasmach.na_pivo.DEBUG_WEAR_SCENARIO \
  --es scenario active
```

Available scenarios:

- `reset` or `nearest`: nearest candidates, no selected target or evening
- `empty`: empty/stale nearby state
- `manual_target`: a manual target as if received from the phone
- `active`: active evening with beer and a non-alcoholic drink
- `change_pub`: active old pub plus a newly selected target
- `pending`: active evening with an unacknowledged durable command
- `conflict`: explicit concurrent-evening sync conflict

Set an emulator position separately when testing distance:

```bash
adb -s <watch-serial> emu geo fix 14.41786 50.08706
```

The debug fixtures are navigation aids, not substitutes for end-to-end paired
phone sync. For reconnect testing, disable connectivity, add drinks, force-stop
and reopen the app, then reconnect and verify that each stable command ID is
acknowledged once.

## Wear surfaces

- The Tile shows the pub and beer/account count. Its single button explicitly
  repeats the last concrete drink by opening `RepeatDrinkActivity`.
- The ongoing notification shows the active pub and count and has one repeat
  action. Tapping the body opens the app.
- The complication displays a repeat glyph with the beer count; its tap action
  repeats the last drink. With no evening it opens the compass instead.
- Live compass arrows are deliberately restricted to the foreground app.

All surfaces refresh after a local mutation, remote snapshot or acknowledgement.

## Physical-watch follow-up

Emulators cannot faithfully certify:

- compass calibration and heading behavior on a moving wrist,
- real haptic strength and accidental sleeve/palm taps,
- Bluetooth/Wi-Fi handoff and a long evening away from the phone,
- battery use of foreground heading/location updates,
- Tile, ongoing activity and complication behavior across real OEM watch faces.

Run those checks on at least one physical Wear OS watch before calling the
hardware experience verified.
