/* global output */
output.local.poll(function () {
  const state = output.local.state();
  const account = state.accounts.find(function (a) { return a.nickname === 'E2EPivar'; });
  output.local.check(account && account.activeTokens > 0, 'The original fixture account must remain authenticated.');
  output.local.check(JSON.stringify(account.drinks) === JSON.stringify([{ beer_name: 'E2E Ležák', price_czk: 41, volume_ml: 500, place_context: 'pub', drink_type: 'beer' }]), 'Expected exactly one persisted E2E Lezak, 500 ml, 41 CZK.');
  output.local.check(JSON.stringify(state.scenario.primaryDrinkPubNames) === JSON.stringify(['E2E U Testera']), 'The persisted beer must belong to the selected fixture pub.');
}, 15000);
