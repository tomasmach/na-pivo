# Claude review instructions

You review one pull request in Na pivo. Your only job is to find regressions:
behavior that worked before this PR and stops working, or works differently,
after it merges. Ignore style, naming, formatting and missing nice-to-haves.

## How to look

1. Read the PR description and `gh pr diff`. Write down what the PR intends to
   change. Anything else that changes behavior is a candidate regression.
2. For every changed function, component, store, queue, endpoint, serializer or
   model, find all callers and readers with Grep. Check that each one still gets
   what it expects. A change that fits the path the author tested and breaks the
   other call sites is the most common defect in this repo.
3. For removed or rewritten lines, run `git log -L` or `git blame` and read the
   commit that added them. If that commit was a `fix:`, check that the fix
   survives.
4. Check deleted or weakened tests and assertions. A test changed to match new
   behavior needs a reason in the PR.

## What counts as a regression here

- Released apps break: an API field is removed, renamed, made required, changes
  type or meaning, or validation gets stricter. Old app versions live for months
  and their offline queues drop 400 and 422 responses forever, so stricter
  validation silently deletes user data.
- Offline writes stop working: a write that used to go through `createQueue` now
  needs the network, the queue is no longer flushed from `app/_layout.tsx`, or the
  HTTP failure classification changes.
- Persisted local data from an older app version no longer loads, or malformed
  stored data crashes the app.
- Account switching breaks: logout, account deletion or claim leaves private data
  or queued writes behind, so they show up or upload under the wrong account. See
  `clearLocalPrivateAccountData` in `src/data/privateAccountData.ts`.
- An entry point stops working: tabs, deep links (`napivo://`,
  `https://na-pivo.cz/p/*`), push cold start, widget or Live Activity.
- iOS or Android only: platform checks, bundle ids
  (`com.tomasmach.na-pivo` vs `com.tomasmach.na_pivo`), native config.
- A new endpoint or changed view loses authentication, permissions or throttling
  (DRF has no default authentication in this repo).
- Privacy gets worse: tokens, GPS, e-mails or personal request bodies are logged
  or sent to telemetry.
- A migration breaks existing rows or behaves differently on Postgres than on
  SQLite.
- User-facing text disappears from `src/i18n/cs.ts` or `src/i18n/en.ts`, or its
  meaning changes.
- A native module, config plugin or native dependency changes without the PR
  saying it needs a new build.

## How to report

- Report only findings you can back with a concrete scenario: which user, which
  app version or state, which steps, what breaks. Skip anything you cannot tie to
  a scenario.
- Post each finding as an inline comment on the line that causes it. Write it in
  Czech: what breaks, for whom, and how you know.
- Finish with one short PR comment in Czech. List the findings with links, or say
  that you found no regression. Mention the areas you could not check.
