/* global output, STAGE */
function verify() {
  const state = output.local.state().scenario;
  const check = output.local.check;
  check(state.foreignDiaryWrites === 0, 'Diary writes must never land under another account.');
  if (STAGE === 'original') {
    check(state.drinks.length === 1, 'Expected one online beer before the outage.');
    output.diary = { original: state.drinks[0] };
  } else if (STAGE === 'removable') {
    check(state.drinks.length === 2, 'Both original drinks must reach the backend before the outage.');
    output.diary.removable = state.drinks.find(function (d) { return d.beer_name === 'E2E Odebrat'; });
    check(!!output.diary.removable, 'Expected the removable original drink.');
  } else {
    check(JSON.stringify(state.drinks.map(function (d) { return d.beer_name; })) === JSON.stringify(['E2E Opravený', 'E2E Offline']), 'Expected the renamed original and delivered new offline drink, without the deleted original.');
    check(state.drinks[0].client_id === output.diary.original.client_id && state.drinks[0].drank_at === output.diary.original.drank_at, 'Rename must preserve the original drink identity and timestamp.');
    check(state.drinks[0].price_czk === 41 && state.drinks[1].price_czk === 43 && state.drinks.every(function (d) { return d.volume_ml === 500 && d.name === 'E2E U Testera'; }), 'Expected exact volume, prices and pub.');
    check(state.visits.length === 1 && state.visits[0].closed_at !== null, 'Dopito must persist exactly one closed visit.');
    check(state.stats.total_beers === 2 && state.stats.total_evenings === 1 && state.stats.distinct_pubs === 1 && state.stats.total_spent_czk === 84, 'Expected exactly two beers, one evening, one pub and 84 CZK.');
    if (STAGE === 'synced') output.diary.synced = state.drinks;
    else check(JSON.stringify(state.drinks) === JSON.stringify(output.diary.synced), 'Restart must preserve the same rows without duplicating delivered drinks.');
  }
}
if (STAGE === 'persisted') verify(); else output.local.poll(verify, 15000);
