# Profiles feature — MOBILE contract (locked)

Branch `feat/user-accounts`. Beer-social profiles: unique nickname handle, avatar, public-default visibility, a full **Profile tab**, onboarding wizard, edit screen. Backend mirror at `na-pivo-backend/docs/profiles-spec.md`. Build code against this contract; runtime integration needs the backend deployed but the code is fully writable now.

## Canonical endpoints (post-reconcile — these paths are FINAL)
- `PATCH /v1/account/me` — profile write (NOT `/v1/account/profile`). Body = only passed keys of `{nickname, display_name, is_public}` (+ hide_pub_names stays in the prefs path).
- `GET /v1/account/nickname-available?nickname=<encodeURIComponent>` (param is `nickname`, NOT `value`).
- `POST /v1/account/me/avatar` — multipart, field `avatar` (NOT `/v1/account/avatar`). Backend also accepts PUT.
- `DELETE /v1/account/me/avatar` — remove.
- `GET /v1/account/me` — unchanged path; richer body.

## Data layer (`src/data/auth.ts`)
- `AccountProfile` (@30-39) add: `nickname: string | null`, `avatarUrl: string | null`, `isPublic: boolean`. `displayName` stays (now optional real name).
- `RawAccount` (@49-59) add: `nickname?: string|null`, `is_public?: boolean`, `avatar_url?: string|null`, `picture?: string|null` (defensive alias), `has_avatar?: boolean`, `usage?: { walked_distance_m?: number }`.
- `parseProfile` (@63-75) extend: `nickname = typeof data.nickname==='string' && data.nickname.length>0 ? data.nickname : null`; `isPublic = data.is_public !== false`; `avatarUrl = (data.avatar_url ?? data.picture) || null`. (`usage`/`has_avatar` NOT placed on AccountProfile — read `usage` off raw payload in the stats tile.)
- New fns (after `fetchAccountProfile` @379), all never-throw like link/unlink:
  - `updateProfile({nickname?, displayName?, isPublic?}): Promise<AuthResult>` → `PATCH /v1/account/me`, body only passed keys (`display_name` snake), `bearer:'current'`, returns `parseProfile(res.data)`. 409/400 surface via `extractError` as `{code, detail}`.
  - `checkNicknameAvailable(nickname): Promise<{ok:true; available:boolean; reason?:string} | {ok:false; code; detail}>` → GET, own narrow type (no profile). Debounced UX; authoritative check is `updateProfile`.
  - `uploadAvatar(localUri): Promise<AuthResult>` → `POST /v1/account/me/avatar`. **MUST bypass authFetch** (it hardcodes `application/json`). Dedicated multipart fetch: `getSessionToken()` (already imported @19; bail `{ok:false}` if null), `FormData` append `{uri, name:'avatar.jpg', type:'image/jpeg'} as any`, set ONLY `Authorization: Bearer <token>` — **do NOT set Content-Type** (RN injects the boundary). Own `AbortController` 30000ms (not the shared 12s). Parse 2xx body via `parseProfile`.
  - `removeAvatar(): Promise<AuthResult>` → plain authFetch DELETE.

## Store (`src/stores/accountStore.ts`)
- Interface (@35-39) + impl (@102-121): `updateProfile`, `checkNicknameAvailable` (thin pass-through, no state write), `uploadAvatar`, `removeAvatar`. Follow the `linkGoogle`/`setPassword` pattern: `const r = await auth.x(...); if (r.ok) set({profile: r.profile}); return r;` — refetch-from-response, NO `syncSession` (token unchanged), NO optimistic edits (nickname is server-normalized, avatar_url server-minted).
- Selectors after `selectIsSignedIn` (@149): `selectNeedsProfileSetup = signedIn && profile.nickname == null`, `selectNickname`, `selectAvatarUrl`, `selectIsPublic`.
- `is_public` is a PROFILE field — keep it OUT of `AccountPreferences`/`updateAccountPreferences` (that path is hide_pub_names only).

## Deps
- `npx expo install expo-image-picker` (newest SDK-56-compatible) — required, none today; rebuild dev client (native module). Optional `expo-image-manipulator` to pre-downscale to ~512px JPEG before upload.
- Render remote avatars with `expo-image` if present (caching) else RN `Image`.

## Profile tab — 4th tab
- Tab bar in `app/(tabs)/_layout.tsx` (`<Tabs>` + hand-rolled `src/components/shared/TabBar.tsx`). Today 3 tabs: index/Kompas, counter/Počítadlo, my-beers/Moje piva. Add `<Tabs.Screen name="profile" />` after my-beers; `TAB_META['profile']` (icon `UserIcon`, label `cs.tabs.profile='Profil'`, a11y `cs.a11y.tabProfile`). Screen file `app/(tabs)/profile.tsx` → impl in `src/profile/ProfileScreen.tsx` (mirror `src/myBeers`/`src/about` structure). flex:1 items → 4 distribute evenly, no layout change.
- **Sections** (top→bottom):
  1. **Identity header card** (reuse `account.tsx` identityCard: Colors.stout2, Radius.cardLarge, border). Avatar 72×72 circle: `<Image uri=avatarUrl>` when set, else amber-tinted disk + `UserIcon`/initials. `@nickname` Baloo2-ExtraBold 24; `displayName` Inter 14 foamMuted under it when present. Pencil "Upravit profil" → `/profile/edit`.
  2. **Visibility badge pill** (in/under identity). Public: `EyeIcon` + "Veřejný profil" amber on `withAlpha(amber,0.14)` + amber border. Private: `EyeOffIcon` + "Soukromý profil" mutedText on stout3. Tap → `/profile/edit`. Always visible so public-default is legible (GDPR).
  3. **Stats grid** 2×2 (stout2/Radius.card; big Baloo2-ExtraBold numeral + Inter uppercase mutedText caption, mirror distanceNumber style): (1) PIV NAPOČÍTÁNO — `useTallyStore` sum sessionCount (local). (2) HOSPOD NAVŠTÍVENO — distinct pubKey across tallyStore history+current (local). (3) HODNOCENÍ — `usePubRatingsStore(s=>Object.keys(s.ratings).length)`. (4) NACHOZENO — `data.usage?.walked_distance_m` formatted km, **`—` when absent** (server-only, distinguishes missing from real 0). Optional 5th wide tile UTRACENO (Kč) from sessionTotalCzk + formatPrice. Zero → "0" (grid never collapses).
  4. **Achievements** "ODZNAKY" — ship 2–3 REAL local-threshold badges: "Prvních 10 piv" (tally ≥10), "Stálý host" (≥5 visits to one pub), "Recenzent" (≥10 ratings). Brass medallion style (radial disk + embossed lucide icon); locked = desaturated + `LockKeyholeIcon`.
  5. **Recent activity** "POSLEDNÍ AKTIVITA" — max 3 `PastEveningRow` from `tallyStore.allSessionsNewestFirst(...).slice(0,3)` → tappable to evening detail. Hide section when no sessions.
  6. **Account & settings** — two rows in one stout2 card: `UserIcon` "Spravovat účet" → `/account`; `SettingsIcon` "Nastavení" → `/settings`.
- **Signed-out state** (`selectIsSignedIn === false`): tab still renders. Hero (identity-card shell + default avatar) "Založ si profil" + body about cross-device sync + soon friends; primary GlowButton "Vytvořit účet" → `/auth`. Stats grid STAYS visible (local-first) so anonymous user sees real counts + claim prompt. Identity/badge block hidden.

## Onboarding wizard (`app/profile/setup.tsx`, fullScreenModal, gestureEnabled:false)
- **Gating**: effect in `app/_layout.tsx` (or `<ProfileGate>` over `(tabs)`): when `status==='ready' && profile && !profile.isAnonymous && !profile.nickname` → `router.replace('/profile/setup')`. Runs after initAccount/auth resolves → catches email/Google/Apple + returning users on older builds. Re-entrancy guard: condition false once nickname set. Only STEP 1 is hard-gated.
- **STEP 1 Nickname** (gateway): "@"-prefixed TextInput, autoCapitalize none, autoCorrect off, maxLength 20. Live client validation (3–20, charset, reserved mirror) + debounced ~400ms `checkNicknameAvailable` → inline neutral/green "Volné"/amber "Zabráno/Neplatné". GlowButton "Pokračovat" disabled until valid + available. Submit → `updateProfile({nickname})`; 409 → re-show taken.
- **STEP 2 Avatar (optional/skippable)**: if Google pre-filled (server captured), show it. "Vybrat fotku" → expo-image-picker → `uploadAvatar`. "Přeskočit" advances with fallback.
- **STEP 3 Visibility (GDPR copy)**: toggle DEFAULT ON "Veřejný profil". Consent copy user MUST see: *"Veřejný profil znamená, že tě podle přezdívky a fotky najdou ostatní v žebříčcích a vyhledávání. Tvoje přesná poloha ani jednotlivá piva se nikdy nezveřejňují. Kdykoli to vypneš v nastavení profilu."* + private helper *"Když vypneš, uvidí tě jen tví kamarádi."* "Hotovo" → `updateProfile({isPublic})` → `router.replace` to `(tabs)/profile`.

## Edit screen (`app/profile/edit.tsx`, fullScreenModal, slide_from_bottom)
Single scrollable form (not wizard). Cards: (1) Avatar — current + "Změnit fotku" (picker→upload) + "Odebrat fotku" (removeAvatar). (2) Nickname — same "@" input + live availability, pre-filled, skip availability call if unchanged. (3) display_name — "Jméno (nepovinné)" free text. (4) Visibility toggle + same short GDPR copy. GlowButton "Uložit" → `updateProfile` only changed fields → toast "Profil uložen" + `router.back()`. Nickname errors inline (not toast).

## Nav wiring
New files: `app/(tabs)/profile.tsx`, `app/profile/setup.tsx`, `app/profile/edit.tsx`. `app/_layout.tsx`: Stack.Screen `profile/setup` (fullScreenModal, gestureEnabled:false) + `profile/edit` (fullScreenModal, slide_from_bottom). Existing `auth/index.tsx` success path router.back()s — the gate intercepts nickname-null into setup.

## Design system
Plain RN StyleSheet, reuse theme tokens: Colors (stout/stout2/stout3/border/amber/amberLight/foam/foamMuted/mutedText/success/withAlpha), Fonts (Baloo2 display, Inter UI), Radius (card22/cardLarge28/pill999/medium16), Spacing, FontScaleCap, HitArea.min 44, amberGlow(). Components: GlowButton, IconGlyph (UserIcon, PencilIcon, EyeIcon/EyeOffIcon, CheckIcon, BeerIcon, MapPinIcon, StarIcon/ThumbsUpIcon, RadiusIcon, SettingsIcon, LockKeyholeIcon), cardSectionHeader amber-kicker, AboutRow row, account.tsx avatar+badge+pill, PastEveningRow, useToastStore, useSafeAreaInsets. **Brass Taproom**: those tokens live on `feat/brass-taproom-compass`, NOT this branch — build on flat-stout, align in spirit (rationed amber: avatar ring, primary CTA, public badge, stat icons; brass-style medallions). Retrofit after that branch merges (layout unaffected).

## Cross-repo agreement (must hold at runtime)
Raw `GET /v1/account/me` for a Google user pre-nickname →
```json
{ "id":"7c9e...","device_id":"reg-...","nickname":null,"display_name":"Tomáš Mach",
  "avatar_url":"https://api.na-pivo.cz/media/avatars/7c9e....webp?v=...","has_avatar":true,
  "is_public":true,"email":"tomades1@gmail.com","email_verified":true,"providers":["google"],
  "is_anonymous":false,"status":"active","hide_pub_names":false,"usage":{"walked_distance_m":4213},
  "created_at":"...","last_seen_at":"..." }
```
→ `parseProfile` → `{ nickname:null (→ selectNeedsProfileSetup true), displayName:"Tomáš Mach", avatarUrl:"https://...webp?v=..." (absolute, loadable), isPublic:true, isAnonymous:false, ... }`. Mobile passes avatarUrl straight to `<Image>`, never prefixes (backend guarantees absolute).

Do NOT git commit/push — leave changes in the working tree.
