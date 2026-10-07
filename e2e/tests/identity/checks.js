/* global output, CASE, PHASE */
output.local.poll(function () {
const state = output.local.state();
const accounts = state.scenario.accounts;
const primary = accounts.find(function (account) { return account.nickname === 'E2EPivar'; });
const check = function (condition, message) { output.local.check(condition, message); };
const equal = function (actual, expected, message) { check(JSON.stringify(actual) === JSON.stringify(expected), message); };
const names = function (account) { return account.drinks.map(function (drink) { return drink.beerName; }); };
const observe = function (role, route, status, password) { const response = output.local.observe(role, route, password); check(response.status === status, 'Expected ' + status + ' from real ' + role + ' GET ' + route); return response.body; };
if (CASE === 'logout') {
  equal(names(primary), ['E2E Archiv A', 'E2E Ležák'], 'Account A must retain exactly its archive and online beer.');
  equal(state.accounts.find(function (a) { return a.publicId === primary.publicId; }).drinks.slice().sort(function (a, b) { return a.beer_name.localeCompare(b.beer_name); }), [{beer_name: 'E2E Archiv A', price_czk: 30, volume_ml: 500, place_context: 'private', drink_type: 'beer'}, {beer_name: 'E2E Ležák', price_czk: 41, volume_ml: 500, place_context: 'pub', drink_type: 'beer'}], 'Online beer must persist exact amount, volume, context and owner.');
  if (PHASE === 'final') {
    equal(names(accounts.find(function (a) { return a.nickname === 'E2EKamarad'; })), ['E2E Archiv B'], 'Account B must never receive account A offline queue.');
    equal(accounts.filter(function (a) { return !a.nickname; }).flatMap(function (a) { return a.drinks; }), [], 'Logout must discard private queued writes before anonymous startup.');
    observe('second', '/v1/account/me', 200);
  }
} else if (CASE === 'delete') {
  if (PHASE === 'before' || PHASE === 'cancel') {
    check(primary.status === 'active' && !primary.deleted, 'Cancel must preserve the active account.');
    equal(names(primary), ['E2E Archiv A', 'E2E Ležák'], 'Cancel must preserve both the existing archive and the active beer.');
    observe('primary', '/v1/account/me', 200);
  } else {
    check(primary.status === 'pending_deletion' && primary.deleted && primary.sessionTokens === 0, 'Deletion must mark the DB account and revoke every real session. Actual requests: ' + JSON.stringify(state.accountWrites || []));
    if (PHASE === 'final') {
      observe('primary', '/v1/account/me', 401);
      equal(accounts.filter(function (a) { return !a.nickname; }).flatMap(function (a) { return a.drinks; }), [], 'Deleted private writes must never reappear under a new anonymous identity.');
    }
  }
} else if (CASE === 'reset') {
  if (PHASE === 'before') observe('primary', '/v1/account/me', 200);
  else if (PHASE === 'mail') check(state.scenario.mail.reset === 1, 'UI must send exactly one real password-reset email.');
  else {
    check(!primary.originalPasswordWorks && primary.newPasswordWorks, 'Reset must invalidate the original password and save the new one.');
    check(primary.oneTimeTokens.some(function (t) { return t.purpose === 'reset_password' && t.used; }), 'Actual reset token must be consumed.');
    observe('primary', '/v1/account/me', 401);
    equal(names(primary), ['E2E Archiv A'], 'Reset must preserve original history.');
    if (PHASE === 'final') observe('primary', '/v1/account/me', 200, 'new');
  }
} else if (CASE === 'register') {
  const registered = accounts.find(function (a) { return a.nickname === 'E2ERegister'; });
  if (PHASE === 'anonymous') {
    const anonymous = state.accounts.filter(function (a) { return !a.registered; });
    check(anonymous.length === 1 && anonymous[0].drinks.length === 1, 'Online anonymous beer must persist before offline registration.');
    output.anonymousId = anonymous[0].publicId;
  } else if (PHASE === 'submitted') {
    check(registered && registered.publicId === output.anonymousId, 'UI submit must register the original anonymous DB account before choosing visibility. Registered: ' + Boolean(registered) + ', validation: ' + output.registrationError);
    check(registered.originalPasswordWorks, 'The actual registered credential must match the complete original fixture password.');
  } else {
    check(registered && registered.publicId === output.anonymousId && !registered.isPublic, 'Registration must claim the same anonymous identity with private visibility.');
    check(registered.originalPasswordWorks, 'Registration must preserve the complete fixture password through app restart.');
    equal(names(registered), ['E2E Ležák', 'E2E Ležák'], 'Claim must preserve exactly both online and offline beers.');
    const expectedDrink = {beer_name: 'E2E Ležák', price_czk: 41, volume_ml: 500, place_context: 'pub', drink_type: 'beer'};
    equal(state.accounts.find(function (a) { return a.publicId === registered.publicId; }).drinks, [expectedDrink, expectedDrink], 'Both claimed drinks must preserve exact price, volume and context.');
    if (PHASE === 'final') observe('outsider', '/v1/friends/' + registered.publicId, 404);
  }
} else if (CASE === 'profile') {
  if (PHASE === 'before') { output.primaryId = primary.publicId; observe('outsider', '/v1/friends/' + primary.publicId, 200); }
  else {
    const edited = accounts.find(function (a) { return a.publicId === output.primaryId; });
    check(edited.nickname === 'E2EUpdated' && edited.displayName === 'E2E Upravený' && !edited.isPublic, 'The actual original profile must retain all edits after restart.');
    equal(names(edited), ['E2E Archiv A'], 'Profile edits must preserve history.');
    observe('outsider', '/v1/friends/' + output.primaryId, 404);
    observe('second', '/v1/friends/' + output.primaryId, 200);
  }
} else if (CASE === 'onboarding') {
  const anonymous = state.accounts.filter(function (a) { return !a.registered; });
  check(anonymous.length === 1 && anonymous[0].activeTokens > 0, 'Restart must retain one actual authenticated anonymous identity.');
  equal(anonymous[0].drinks, [], 'Onboarding must never create drinks.');
} else if (CASE === 'settings') {
  equal(primary.settings, { hidePubNames: true, hapticEnabled: false, marketingEmailsEnabled: false }, 'Server preferences must survive app and language restart.');
  if (PHASE === 'final') { observe('primary', '/v1/account/me', 200); equal(names(primary), ['E2E Archiv A'], 'Settings and language must preserve identity and diary.'); }
} else if (CASE === 'badges') {
  const body = observe('primary', '/v1/account/me', 200);
  check(body.achievements.foto_pivar === true && body.achievements.first_ten === false, 'Actual server badges must match both the unlocked photo and locked ten-beer achievement.');
  equal(names(primary), ['E2E Archiv A'], 'Offline information must preserve the diary.');
} else if (CASE === 'avatar') {
  if (PHASE === 'uploaded') {
    check(primary.hasAvatar && primary.avatarFileExists && primary.avatarDigest, 'Native multipart must create an actual avatar file.');
    output.firstAvatarDigest = primary.avatarDigest;
    output.firstAvatarUrl = observe('primary', '/v1/account/me', 200).avatar_url;
    check(!!output.firstAvatarUrl, 'The real profile must expose the uploaded avatar URL.');
  } else if (PHASE === 'replaced') {
    check(primary.hasAvatar && primary.avatarFileExists && primary.avatarDigest !== output.firstAvatarDigest, 'Replacing the avatar with the other fixture must persist different actual image content.');
    const avatarUrl = observe('primary', '/v1/account/me', 200).avatar_url;
    check(!!avatarUrl && avatarUrl !== output.firstAvatarUrl, 'A replaced avatar must get a new URL so the app cannot keep the cached old image.');
  } else { check(!primary.hasAvatar && !primary.avatarFileExists && !primary.avatarStoredFile, 'Avatar deletion must remove the stored file and survive restart in actual DB/storage.'); if (PHASE === 'final') observe('primary', '/v1/account/me', 200); }
} else if (CASE === 'photos') {
  if (PHASE === 'before') { output.primaryId = primary.publicId; observe('second', '/v1/account/me', 200); observe('outsider', '/v1/account/me', 200); }
  else {
    const photos = primary.photos;
    if (PHASE === 'private') { check(photos.length === 1 && photos[0].caption === 'E2E soukromá' && photos[0].visibility === 'private' && photos[0].fileExists, 'Offline private photo must flush exactly once with a real persisted file.'); output.privatePhotoId = photos[0].publicId; }
    else if (PHASE === 'shared' || PHASE === 'cancel') {
      equal(photos.map(function (p) { return [p.caption, p.visibility, p.fileExists]; }), [['E2E soukromá', 'private', true], ['E2E pro partu', 'friends', true]], 'Both photos must retain their exact visibility and real files.');
      output.sharedPhotoId = photos[1].publicId;
      const friends = observe('second', '/v1/friends/' + output.primaryId + '/beer-photos', 200);
      equal(friends.photos.map(function (p) { return p.id; }), [output.sharedPhotoId], 'Friend API must return exactly the actual shared photo ID.');
      equal(friends.photos.map(function (p) { return p.caption; }), ['E2E pro partu'], 'Friend API must return only the shared photo.');
      observe('outsider', '/v1/friends/' + output.primaryId + '/beer-photos', 404);
      const feed = observe('second', '/v1/friends/beer-photos/feed', 200);
      equal(feed.photos.map(function (p) { return p.id; }), [output.sharedPhotoId], 'Friend feed must return exactly the actual shared photo ID.');
      check(!feed.photos.some(function (p) { return p.id === output.privatePhotoId; }), 'Actual private photo ID must never leak into the friend feed.');
      check(!JSON.stringify(feed).includes('E2E soukromá'), 'Private caption must never leak into the friend feed.');
    } else {
      equal(photos.map(function (p) { return [p.caption, p.visibility, p.fileExists]; }), [['E2E pro partu', 'friends', true]], 'Restart must retain exactly the shared photo after confirmed private deletion.');
      equal(observe('second', '/v1/friends/' + output.primaryId + '/beer-photos', 200).photos.map(function (p) { return p.caption; }), ['E2E pro partu'], 'Friend API must remain correct after deletion/restart.');
      equal(observe('second', '/v1/friends/beer-photos/feed', 200).photos.map(function (p) { return p.id; }), [output.sharedPhotoId], 'Friend feed must retain exactly the shared photo after deletion/restart.');
      observe('outsider', '/v1/friends/' + output.primaryId + '/beer-photos', 404);
    }
  }
} else if (CASE === 'media') {
  check(primary.displayName === 'E2E Bez Fotky' && !primary.hasAvatar, 'Denied permission must preserve profile editing without creating avatar.');
  equal(primary.photos, [], 'Denied camera and canceled native picker must not create photos.');
  observe('primary', '/v1/account/me', 200);
} else throw new Error('Unknown identity oracle.');

}, 15000);
