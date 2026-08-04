# Na pivo wearable sync protocol

`protocol/wearable-sync-v1.schema.json` is the canonical, transport-neutral
contract used by the phone, Apple Watch and Wear OS applications. Platform
types may be native Swift or Kotlin, but their encoders and decoders must pass
the JSON fixtures in this directory.

## Delivery guarantees

Commands use at-least-once delivery. Every interaction gets one stable
`messageId`; every drink gets one stable `drink.id`. A sender writes the command
to its durable outbox before updating the optimistic UI and keeps it until an
acknowledgement arrives.

The phone persists an incoming command before applying it. It acknowledges the
command only after the local domain state and the appropriate backend queue are
durable. Replaying the same command is therefore expected and harmless.

`accountEpoch` changes when the active account changes. Commands from an older
epoch must be rejected and never copied into the new account.

`actorSequence` orders commands from one device. Time stamps describe the real
world event, but never decide sync conflicts because device clocks may differ.

Snapshot `recentDrinks`, `frequentDrinks` and `menuDrinks` contain
`DrinkChoice`, not already logged facts. `choiceId` is only a stable list key.
Repeating any choice must mint a fresh command `messageId` and fresh
`DrinkSpec.id`; copying the choice identity into a drink fact would incorrectly
deduplicate a real second drink.

## Conflict rules

- A drink is an immutable fact keyed by `drink.id`.
- Removing a drink creates a remove-wins tombstone. A delayed add with the same
  ID stays removed, even when the remove arrived first.
- `close_evening` is monotonic. A delayed, causally older drink may be retained
  in the closed evening, but does not reopen it.
- A manual target wins over an automatically selected nearest target.
- Concurrent different manual targets are an explicit conflict; a timestamp
  must not silently choose one.
- Concurrent starts at the same pub on the same drinking day alias to one
  canonical evening. Different pubs remain separate and require an explicit
  conflict resolution; drinks are never moved between pubs.

## Privacy boundary

The watch applications never receive an account bearer token. Private commands
travel to the paired phone, which uses the existing authenticated mobile queues.
A watch may use public nearby-pub reads with a coarse location cell, but raw
observed GPS coordinates and routes are never persisted.

The latitude and longitude in `PubRef` describe a public point of interest, not
the user's observed position. They are necessary for the compass.

Concrete drink names and pub names are operational offline data and may exist
only inside the protected app sandbox and encrypted transport. They must never
appear in application logs, telemetry, crash breadcrumbs, notification
identifiers or sync diagnostics. Tokens, request bodies and personal data are
never logged.

## Compatibility

Protocol additions are made with a new `protocolVersion`. Receivers reject
unknown major versions instead of guessing. Fields in v1 are strict
(`additionalProperties: false`) so a schema mismatch is caught by contract
tests before either native application ships.

Custom drink volume is private diary data and accepts `10..3000 ml` (shots are
limited to `10..200 ml`). The familiar beer sizes are UI presets, not a storage
restriction. A non-standard beer volume must remain in the private log and must
not be merged into the public community menu.
