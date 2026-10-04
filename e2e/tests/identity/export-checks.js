/* global output, PHASE */
output.local.poll(function () {
  const state = output.local.state();
  const primary = state.scenario.accounts.find(function (account) { return account.nickname === 'E2EPivar'; });
  const stored = state.accounts.find(function (account) { return account.publicId === primary.publicId; });
  const check = function (condition, message) { output.local.check(condition, message); };
  const equal = function (actual, expected, message) { check(JSON.stringify(actual) === JSON.stringify(expected), message); };
  equal(primary.drinks.map(function (drink) { return drink.beerName; }), ['E2E Archiv A'], 'Verification and export must preserve the original account history.');
  equal(state.scenario.accounts.find(function (account) { return account.nickname === 'E2EKamarad'; }).drinks.map(function (drink) { return drink.beerName; }), ['E2E Archiv B'], 'The other account must retain its separate history.');
  if (PHASE === 'denied' || PHASE === 'mail') {
    check(!stored.verified, 'The real account must remain unverified before opening the email link.');
    equal(state.scenario.exportAttachments, [], 'An unverified account must not receive a JSON export.');
    equal(state.scenario.exportJobs, [], 'The rejected export must not create a delivery job.');
    check(state.scenario.mail.verify === (PHASE === 'mail' ? 1 : 0), 'The verify CTA must send exactly one actual local verification email.');
  } else {
    check(stored.verified, 'The actual email link must verify the original account.');
    equal(primary.oneTimeTokens.filter(function (token) { return token.purpose === 'verify_email'; }).map(function (token) { return token.used; }), [true], 'Exactly one actual verification token must be consumed.');
    check(state.scenario.mail.verify === 1 && state.scenario.exportAttachments.length === 1, 'Restart must preserve exactly one verification mail and one actual export.');
    equal(state.scenario.exportJobs, [{ publicId: primary.publicId, status: 'delivered' }], 'Exactly one export job must be delivered for this account.');
    const exported = state.scenario.exportAttachments[0];
    check(exported.publicId === primary.publicId && exported.nickname === 'E2EPivar' && exported.verified, 'The attached JSON must identify the same verified account.');
    check(exported.correctRecipient && exported.correctContact && exported.otherPrivateDataAbsent, 'The actual attachment must belong to its recipient and exclude other accounts\' private contacts and drink IDs.');
    equal(exported.drinks, [{ client_id: primary.drinks[0].clientId, beer_name: 'E2E Archiv A', price_czk: 30, volume_ml: 500, place_context: 'private', drink_type: 'beer', serving_type: 'bottle' }], 'The real JSON attachment must contain exactly the original private beer, preserving ID, amount, volume and context.');
    const message = output.local.request('/mail/export');
    check(message.status === 200 && message.attachments === 1, 'The real local export email must have one attachment.');
    if (PHASE === 'final') {
      const response = output.local.observe('primary', '/v1/account/me');
      check(response.status === 200 && response.body.email_verified === true, 'Authenticated API read after app restart must confirm verified state.');
    }
  }
}, 15000);
