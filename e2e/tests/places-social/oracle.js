/* global output */
output.ps = {
  equal: function(actual, expected, message) {
    output.local.check(JSON.stringify(actual) === JSON.stringify(expected), message);
  },
  friendActivity: function(automaticVisible, manualVisible) {
    const live = output.local.observe('second', '/v1/friends/live');
    output.local.check(live.status === 200, 'The friend live API responds successfully.');
    const containsPrimary = function(rows) { return rows.some(function(r) { return r.account.nickname === 'E2EPivar'; }); };
    output.local.check(containsPrimary(live.body.presence) === automaticVisible, 'Automatic presence follows persisted sharing and ghost preferences.');
    output.local.check(containsPrimary(live.body.active_friends) === manualVisible, 'The explicit cink stays visible after automatic opt-out and is revoked by ghost mode.');
    const drinks = output.local.observe('second', '/v1/friends/drink-feed');
    output.local.check(drinks.status === 200 && (JSON.stringify(drinks.body).indexOf('E2EPivar') !== -1) === automaticVisible, 'Automatic drink feed follows persisted sharing and ghost preferences.');
    const s = output.local.state().scenario;
    output.local.check(s.presenceVisits.length === 1 && s.presenceVisits[0].account__nickname === 'E2EPivar', 'Privacy preferences retain the original private visit in the database.');
    this.equal(s.manualActivities, [{account__nickname:'E2EPivar',active:true}], 'Privacy preferences preserve the explicit activity while filtering its readers.');
  },
  board: function(category, requestedPeriod, expected, effectivePeriod) {
    const response = output.local.observe('primary', '/v1/leaderboards?category=' + category + '&period=' + requestedPeriod);
    output.local.check(response.status === 200 && response.body.period === effectivePeriod, 'Leaderboard returns the expected effective period.');
    this.equal(response.body.entries.map(function(r) { return [r.account.nickname,r.score]; }), expected, 'Leaderboard contains exactly the public, unblocked fixture accounts and their scores.');
  },
  check: function(phase) {
    const full = output.local.state();
    const s = full.scenario;
    const primary = full.accounts.find(function(a) { return a.nickname === 'E2EPivar'; });
    output.local.check(primary && primary.activeTokens > 0, 'The original primary account remains authenticated.');
    const eventRoute = '/v1/community-events/' + s.eventId;
    if (phase === 'community-before') {
      const guest = output.local.observe('second', eventRoute);
      output.local.check(guest.status === 200 && guest.body.exactAddressPresent === false, 'Pending guest cannot read the exact address.');
    } else if (phase === 'community-approved') {
      this.equal(s.memberships, [{account__nickname:'E2EKamos',status:'approved'}], 'Exactly the seeded guest is approved.');
      const guest = output.local.observe('second', eventRoute);
      const outsider = output.local.observe('outsider', eventRoute);
      output.local.check(guest.status === 200 && guest.body.exactAddressPresent === true, 'Approved guest can read the exact address.');
      output.local.check(outsider.status === 200 && outsider.body.exactAddressPresent === false, 'Unrelated account cannot read the exact address.');
    } else if (phase === 'community-cancelled') {
      this.equal(s.events, [{title:'E2E Večer u hosta',status:'cancelled'}], 'The same event is cancelled in the database.');
      const guest = output.local.observe('second', eventRoute);
      output.local.check(guest.status === 200 && guest.body.exactAddressPresent === false, 'Cancellation revokes the approved guest address.');
    } else if (phase === 'feedback') {
      output.local.check(s.feedback.length === 1, 'Exactly one feedback row was delivered after offline restart.');
      const row = s.feedback[0];
      output.local.check(row.message === 'E2E Test zprávy bez signálu.' && row.category === 'bug' && row.attachmentPresent === true && row.fileExists === true && !!row.clientId, 'Persisted feedback retains the exact text, category and uploaded file after offline process restart.');
    } else if (phase === 'unchanged') {
      this.equal(s.addedPubs, [], 'Catalogue and local home operations must not create a pub.');
      this.equal(s.reports, [], 'Read-only catalogue operations must not report a pub.');
    } else if (phase === 'privacy-baseline') {
      this.friendActivity(true, true);
      output.local.check(output.local.observe('outsider', '/v1/friends/' + s.fixtureAccounts.E2EKamos).status === 200, 'Public friend profile is readable.');
      output.local.check(output.local.observe('primary', '/v1/friends/' + s.fixtureAccounts.E2ECizi).status === 404, 'Private outsider profile is hidden.');
    } else if (phase === 'sharing-off') {
      output.local.check(primary.shareDrinks === false && primary.ghostMode === false, 'Automatic sharing is disabled while ghost mode remains off in the account database.');
      this.friendActivity(false, true);
    } else if (phase === 'ghost-on') {
      output.local.check(primary.shareDrinks === true && primary.ghostMode === true, 'Ghost mode persists while the underlying sharing preference remains enabled.');
      this.friendActivity(false, false);
    } else if (phase === 'blocked') {
      this.equal(s.blocks, [{blocker__nickname:'E2EPivar',blocked__nickname:'E2EKamos'}], 'Exactly the selected friend is blocked.');
      this.equal(s.friendships, [], 'Blocking removes the existing friendship.');
      output.local.check(output.local.observe('second', '/v1/friends/' + s.fixtureAccounts.E2EPivar).status === 404, 'The blocked friend cannot read the primary profile.');
    } else if (phase === 'invited') {
      output.local.check(s.friendships.length === 2, 'Invite claim creates exactly one new accepted friendship.');
      this.equal(s.friendships.filter(function(r) { return r.recipient__nickname === 'E2ECizi'; }), [{requester__nickname:'E2EPivar',recipient__nickname:'E2ECizi',status:'accepted'}], 'Invitation belongs to the primary and seeded outsider.');
      output.local.check(s.friendships.every(function(r) { return r.status === 'accepted'; }), 'Both party relationships are accepted.');
    } else if (phase === 'board-beers') {
      this.board('beers', 'week', [['E2EKamos',2],['E2EPivar',1]], 'week');
    } else if (phase === 'board-mapper') {
      this.board('mapper', 'week', [['E2EKamos',20],['E2EPivar',10]], 'all');
    } else if (phase === 'board-blocked') {
      this.equal(s.blocks, [{blocker__nickname:'E2EPivar',blocked__nickname:'E2EKamos'}], 'Leaderboard block is persisted.');
      this.board('mapper', 'all', [['E2EPivar',10]], 'all');
    } else if (phase === 'contest-entered' || phase === 'contest-withdrawn') {
      const entries = s.entries.filter(function(r) { return r.account__nickname === 'E2EPivar'; });
      const photo = s.photos.find(function(r) { return r.account__nickname === 'E2EPivar'; });
      output.local.check(photo && photo.visibility === 'private', 'Contest entry does not publish the diary photo.');
      if (phase === 'contest-entered') {
        output.local.check(entries.length === 1 && entries[0].photo__public_id === photo.public_id, 'Explicit consent enters exactly the existing private photo.');
      } else {
        this.equal(entries, [], 'Withdrawal removes the primary contest entry.');
        this.equal(s.votes, [], 'The retracted vote stays removed after withdrawal.');
        output.local.check(s.photos.length === 3 && s.entries.length === 2, 'Withdrawal retains all diary photos and both other contestants.');
      }
      const feed = output.local.observe('second', '/v1/friends/beer-photos/feed');
      output.local.check(feed.status === 200 && JSON.stringify(feed.body).indexOf('E2E Fotka E2EPivar') === -1, 'The friend feed does not disclose the private diary photo, including while entered.');
    } else if (phase === 'vote-friend' || phase === 'vote-outsider') {
      this.equal(s.votes, [{voter__nickname:'E2EPivar',entry__account__nickname:phase === 'vote-friend' ? 'E2EKamos' : 'E2ECizi'}], 'Moving a vote preserves exactly one vote for the selected contestant.');
    } else if (phase === 'vote-none') {
      this.equal(s.votes, [], 'Retracting the vote removes the database vote.');
    } else if (phase === 'favorite') {
      this.equal(s.favorites, [{account__nickname:'E2EPivar',cache_key:s.pubKeys['E2E Druhá hospoda']}], 'Exactly one favorite is delivered from the persisted offline queue.');
      const other = output.local.observe('second', '/v1/pub-favorites');
      output.local.check(other.status === 200 && JSON.stringify(other.body).indexOf('E2E Druhá hospoda') === -1, 'Another account cannot read the primary favorite.');
    } else if (phase === 'favorite-none') {
      this.equal(s.favorites, [], 'Removing the favorite persists the retraction.');
    } else if (phase === 'report-none') {
      this.equal(s.reports, [], 'Cancelling report confirmation leaves no report in the database.');
    } else if (phase === 'reported') {
      this.equal(s.reports, [{account__nickname:'E2EPivar',cache_key:s.pubKeys['E2E Druhá hospoda'],reason:'closed'}], 'The offline report is delivered exactly once for the original account.');
      const other = output.local.observe('second', '/v1/pubs/suggest?query=E2E%20Druh%C3%A1&pub_search=true');
      output.local.check(other.status === 200 && JSON.stringify(other.body).indexOf('E2E Druhá hospoda') !== -1, 'A single report must not hide the community pub for another account.');
    } else if (phase === 'pub-created') {
      output.local.check(s.addedPubs.length === 1, 'Exactly one offline pub was delivered.');
      const pub = s.addedPubs[0];
      output.local.check(pub.account__nickname === 'E2EPivar' && pub.name === 'E2E Nová hospoda' && pub.location_source === 'user_pin' && pub.active === true && !!pub.client_id, 'The created pub belongs to the primary account and confirmed map pin.');
      output.ps.created = pub;
    } else if (phase === 'pub-renamed') {
      output.local.check(!!this.created, 'The original published identity was observed before editing.');
      const expected = Object.assign({}, this.created, {name:'E2E Přejmenovaná hospoda'});
      this.equal(s.addedPubs, [expected], 'Owner rename updates only the name and preserves the same durable pub identity.');
    } else if (phase === 'contributions') {
      output.local.check(s.contributions.length === 2 && s.communityXp.length === 2, 'Exactly two public contributions and two XP awards survive a second restart.');
      output.local.check(s.contributions.every(function(r) { return r.account__nickname === 'E2EPivar' && !!r.client_id; }), 'Both contributions belong to the primary account and have durable client identities.');
      this.equal(s.communityXp.map(function(r) { return [r.account__nickname,r.kind]; }).sort(), [['E2EPivar','beers'],['E2EPivar','hours']], 'Hours and beers award XP once each.');
      const pub = s.community.find(function(r) { return r.name === 'E2E Druhá hospoda'; });
      output.local.check(!!pub, 'The edited pub exists.');
      this.equal(pub.hours_json.mo, [], 'Monday is closed in the persisted public hours.');
      output.local.check(pub.beers.some(function(b) { return b.name === 'E2E Nový ležák' && b.price_czk === 52 && b.volume_ml === 500; }), 'The public beer has exactly the submitted name, price and volume.');
    } else if (phase === 'event-pending') {
      const rows = s.pubEvents.filter(function(r) { return r.title === 'E2E Nový kvíz'; });
      output.local.check(rows.length === 1 && rows[0].status === 'pending' && rows[0].account__nickname === 'E2EPivar' && !!rows[0].client_id, 'Retry creates exactly one moderated suggestion for the original account.');
      const response = output.local.observe('primary', '/v1/pub-events?cache_key=' + s.pubKeys['E2E U Testera'] + '&window=upcoming');
      const body = JSON.stringify(response.body);
      output.local.check(response.status === 200 && body.indexOf('E2E Ověřený kvíz') !== -1 && body.indexOf('E2E Nový kvíz') === -1 && body.indexOf('E2E Skončený kvíz') === -1, 'Public events include the verified current event and exclude pending and expired events.');
    } else if (phase === 'denied-feedback') {
      output.local.check(s.feedback.length === 1, 'Camera denial still submits exactly one text feedback row.');
      const row = s.feedback[0];
      output.local.check(row.message === 'E2E Kamera odmítnuta' && row.attachmentPresent === false && row.category === 'bug', 'Camera denial cannot accidentally attach media or lose the feedback text.');
    } else { throw new Error('Unknown places/social oracle phase: ' + phase); }
    return true;
  }
};
