/* global output */
function verify() {
  const state = output.local.state().scenario;
  const check = output.local.check;
  check(state.drinks.length === 1, 'Exactly one tour beer must be delivered after the outage.');
  const beer = state.drinks[0];
  check(beer.beer_name === 'E2E Tour' && beer.price_czk === 41 && beer.volume_ml === 500 && beer.name === 'E2E U Testera', 'The counted tour beer must keep the first stop, volume and price.');
  check(state.plans.length === 0 && state.shares.length === 0 && state.publications.length === 0, 'A private offline plan and journey must remain solely on the device.');
  if (output.tourDrink) check(JSON.stringify(beer) === JSON.stringify(output.tourDrink), 'The persistence oracle must keep the same single delivered beer.');
  output.tourDrink = beer;
}
if (output.tourDrink) verify(); else output.local.poll(verify, 15000);
