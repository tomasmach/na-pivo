/* global output, STAGE */
function verify() {
  const state = output.local.state().scenario;
  const check = output.local.check;
  check(state.drinks.length === 1, 'Rating must not create an additional counted drink.');
  if (STAGE === 'baseline') {
    check(state.checkins.length === 0, 'Expected no rating before the offline write.');
  } else {
    check(state.checkins.length === 1, 'Exactly one queued rating must reach the backend.');
    const rating = state.checkins[0];
    check(rating.beer_name === 'E2E Ležák' && Number(rating.rating) === 4 && rating.visibility === 'private' && rating.pub_name === 'E2E U Testera' && JSON.stringify(rating.tags) === JSON.stringify(['crisp']), 'Expected a private four-star crisp verdict for the counted menu beer.');
    const detail = output.local.observe('primary', '/v1/beers/detail?beer_name=E2E%20Le%C5%BE%C3%A1k');
    check(detail.status === 200 && detail.body.my_count === 1 && detail.body.my_average_rating === 4 && detail.body.my_tags.crisp === 1, 'Beer detail API must reflect exactly the submitted private rating.');
    if (STAGE === 'synced') output.rating = rating;
    else check(JSON.stringify(rating) === JSON.stringify(output.rating), 'Restart must preserve the same rating identity and contents.');
  }
}
if (STAGE === 'persisted') verify(); else output.local.poll(verify, 15000);
